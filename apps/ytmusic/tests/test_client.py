import json
import socket
import threading
import time

import pytest
import requests
from fastapi import HTTPException

from app import client
from app.client import (
    MAX_UPSTREAM_BYTES,
    UPSTREAM_TIMEOUT_SECONDS,
    UpstreamTooLarge,
    bounded_session,
    open_budget,
    remaining,
)


class Answered:
    """Just enough of a `requests.Response` for the wrapper to hand back an empty body."""

    def __init__(self) -> None:
        self.raw = self
        self.closed = False

    def read1(self, _size: int, decode_content: bool = True) -> bytes:
        return b""

    def close(self) -> None:
        self.closed = True


def test_session_carries_a_timeout(monkeypatch):
    seen: dict = {}

    def answer(self, *args, **kwargs):
        seen.update(kwargs)
        return Answered()

    monkeypatch.setattr(requests.Session, "request", answer)

    bounded_session().request("GET", "http://example.invalid")
    assert seen["timeout"] == UPSTREAM_TIMEOUT_SECONDS
    # Without this the body is already buffered by the time the wrapper sees the response,
    # and there is nothing left to count.
    assert seen["stream"] is True

    seen.clear()
    bounded_session(2).request("GET", "http://example.invalid")
    assert seen["timeout"] == 2


def test_the_bound_sits_above_the_caller_deadline_and_well_under_ytmusicapi_default():
    # The web app gives up at 6s; ytmusicapi's own default is 30s. Being the first to give
    # up would fail requests someone is still waiting for; keeping 30s would hold a thread
    # in a 40-slot pool for 24s after the caller had gone.
    assert 6 < UPSTREAM_TIMEOUT_SECONDS < 30


def test_outside_a_request_the_cap_applies_unchanged():
    # Unit tests and scripts call this module with no budget open, and behave as they did
    # before there was one.
    assert remaining() == UPSTREAM_TIMEOUT_SECONDS
    assert remaining(2) == 2


def test_the_budget_shrinks_as_a_request_spends_it():
    token = open_budget(3)
    try:
        left = remaining()
        assert 2 < left <= 3, left  # what is left of the budget, not the 8s bound
        # the per-call cap still wins when it is the smaller of the two
        assert remaining(1) == 1
    finally:
        client._deadline.reset(token)


@pytest.fixture
def black_hole():
    """A socket that accepts a connection and then says nothing, ever."""
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen(8)
    held: list[socket.socket] = []

    def accept():
        while True:
            try:
                held.append(listener.accept()[0])
            except OSError:
                return

    threading.Thread(target=accept, daemon=True).start()
    yield f"http://127.0.0.1:{listener.getsockname()[1]}/"
    listener.close()
    for one in held:
        one.close()


def test_a_chain_of_calls_costs_the_budget_once_not_the_bound_each(black_hole):
    # S-24 bounded one call. No route makes only one: `/radio` makes three and `/lyrics`
    # seven, so at 8s each a hung YouTube held a thread for 24s and 56s — worse than the 30s
    # S-24 removed, and all of it after the caller gave up at 6s. Three calls against a
    # socket that never answers must therefore cost one budget between them, not three.
    budget = 1.5
    token = open_budget(budget)
    try:
        session = bounded_session(budget)
        started = time.monotonic()
        for _ in range(3):
            with pytest.raises(requests.exceptions.RequestException):
                session.request("GET", black_hole)
        elapsed = time.monotonic() - started
    finally:
        client._deadline.reset(token)

    assert elapsed < budget * 2, f"three calls took {elapsed:.2f}s of a {budget}s budget"


def test_a_call_made_after_the_budget_is_spent_never_reaches_the_network():
    token = open_budget(-1)
    try:
        with pytest.raises(requests.exceptions.ReadTimeout, match="budget is spent"):
            bounded_session().request("GET", "http://127.0.0.1:9/")
    finally:
        client._deadline.reset(token)


@pytest.fixture
def streaming():
    """A server that sends a body of the test's choosing and reports how much of it got out.

    The count is the half of this that matters: a cap that stops reading but leaves the socket
    open is not a cap, because the sender keeps sending and something upstream keeps buffering.
    """
    listeners: list[socket.socket] = []

    def start(body) -> tuple[str, list[int]]:
        listener = socket.socket()
        listener.bind(("127.0.0.1", 0))
        listener.listen(8)
        listeners.append(listener)
        sent: list[int] = []

        def handle(conn: socket.socket) -> None:
            written = 0
            try:
                conn.recv(65536)
                for part in body():
                    conn.sendall(part)
                    written += len(part)
            except OSError:
                pass  # the reader hung up, which is what two of these tests are about
            finally:
                sent.append(written)
                conn.close()

        def accept() -> None:
            while True:
                try:
                    conn = listener.accept()[0]
                except OSError:
                    return
                threading.Thread(target=handle, args=(conn,), daemon=True).start()

        threading.Thread(target=accept, daemon=True).start()
        return f"http://127.0.0.1:{listener.getsockname()[1]}/", sent

    yield start
    for one in listeners:
        one.close()


def endless():
    yield b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n"
    block = b"a" * 65536
    sent = 0
    while sent < 64 * 1024 * 1024:  # a stop the test should never reach, so a failure ends
        yield block
        sent += len(block)


def test_a_body_larger_than_we_agreed_to_read_is_refused_by_name(streaming):
    # Nothing bounded how much an answer could be: a host that kept writing was buffered whole,
    # 300 MB of it, at a 619 MB peak. The reply has to name the size rather than hand back what
    # arrived, because a half-read body reaching `json.loads` reports itself as a parser fault.
    url, sent = streaming(endless)
    token = open_budget(30)
    try:
        session = bounded_session(30, max_bytes=1024 * 1024)
        with pytest.raises(UpstreamTooLarge, match=r"more than 1 MB") as caught:
            session.request("GET", url)
    finally:
        client._deadline.reset(token)

    assert "the read was stopped" in str(caught.value)
    # And the source is let go rather than drained, so the sender stops instead of filling a
    # buffer we are no longer reading.
    assert caught.value.response.raw.closed
    until = time.monotonic() + 10
    while not sent and time.monotonic() < until:
        time.sleep(0.05)
    assert sent, "the server never finished, so the connection was not released"
    assert sent[0] < 16 * 1024 * 1024, f"{sent[0]:,} bytes left the server for a 1 MB cap"


def test_that_refusal_reaches_the_caller_as_the_flat_502(monkeypatch):
    # Typed so the routes' existing mapping picks it up unchanged: an upstream that sent too
    # much is an upstream failure, and the caller is told that and not the shape of our buffer.
    from app.routes import playlist as route

    too_large = UpstreamTooLarge("YouTube Music sent more than 8 MB; the read was stopped.")

    def refuse(slot: str = "default"):
        raise too_large

    monkeypatch.setattr(route, "get_client", refuse)
    with pytest.raises(HTTPException) as caught:
        route.playlist(route.PlaylistRequest(playlist_id="PL11WrGDTdUZL4uIIT7DsKk7cfzPiI"))

    assert caught.value.status_code == 502
    assert caught.value.detail == "YouTube Music playlist failed."
    assert "8 MB" not in caught.value.detail


def test_a_body_inside_the_cap_still_arrives_whole(streaming):
    # The risk in reading the stream ourselves is handing back a truncated body that then
    # fails a parse somewhere else. A full-size answer has to come through byte for byte.
    payload = json.dumps({"tracks": [{"videoId": "x" * 11, "title": "y" * 40}] * 12000}).encode()
    assert len(payload) > 900 * 1024, "too small to have crossed several read boundaries"

    def answer():
        yield (
            b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n"
            b"Content-Length: " + str(len(payload)).encode() + b"\r\n\r\n"
        )
        for at in range(0, len(payload), 4096):
            yield payload[at : at + 4096]

    url, _ = streaming(answer)
    response = bounded_session(30).request("GET", url)

    assert response.content == payload
    assert response.text == payload.decode()
    assert len(response.json()["tracks"]) == 12000


def drip():
    yield b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 4096\r\n\r\n"
    for _ in range(4096):
        time.sleep(0.2)
        yield b"x"


def test_a_trickle_costs_the_budget_and_not_a_fresh_timeout_per_byte(streaming):
    # `requests`' timeout is per socket read, so every byte that arrives resets it and a slow
    # drip outlives any bound: 12.0s measured against a 3s one for a 13-byte body, and no
    # bound at all for a longer one. The clock has to run over the whole read.
    url, _ = streaming(drip)
    budget = 1.5
    token = open_budget(budget)
    try:
        session = bounded_session(budget)
        started = time.monotonic()
        with pytest.raises(requests.exceptions.ReadTimeout, match="still sending") as caught:
            session.request("GET", url)
        elapsed = time.monotonic() - started
    finally:
        client._deadline.reset(token)

    assert caught.value.response.raw.closed
    assert elapsed < budget * 2, f"a {budget}s budget spent {elapsed:.2f}s on one byte per 200ms"


def test_the_cap_is_the_size_youtube_actually_sends_with_room_over():
    # 198 live calls on 2026-09-16: the largest answer YouTube Music has been seen to give is a
    # 3.67 MB playlist browse, and 115 playlists of 94 to 200 tracks all landed under it, so
    # that is upstream's ceiling rather than the sample's. S-29's 4 MB would cut those in half.
    largest_measured = 3_850_873
    assert MAX_UPSTREAM_BYTES > largest_measured * 2
    assert MAX_UPSTREAM_BYTES < 32 * 1024 * 1024, "a cap this loose is not a cap"
