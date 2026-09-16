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
    """Just enough of a `requests.Response` to carry an empty body back up through `Session`."""

    def __init__(self) -> None:
        self.raw = self
        self.closed = False
        self.status_code = 200
        self.headers: dict = {}
        self.history: list = []
        self.is_redirect = False
        self.content = b""

    def read1(self, _size: int, decode_content: bool = True) -> bytes:
        return b""

    def close(self) -> None:
        self.closed = True


def test_every_call_carries_a_timeout(monkeypatch):
    # The timeout rides on the adapter rather than on `Session.request`, because the adapter
    # is the layer every call reaches: `Session.request` sees a request's first call and none
    # of the redirect hops behind it, which `Session.send` sends on the first call's clock.
    seen: list[dict] = []

    def answer(self, request, **kwargs):
        seen.append(kwargs)
        return Answered()

    monkeypatch.setattr(requests.adapters.HTTPAdapter, "send", answer)

    bounded_session().request("GET", "http://example.invalid")
    assert seen[-1]["timeout"] == UPSTREAM_TIMEOUT_SECONDS

    bounded_session(2).request("GET", "http://example.invalid")
    assert seen[-1]["timeout"] == 2


def test_a_hop_draws_on_what_the_chain_has_already_spent(monkeypatch):
    # Not the same as the check on the way in: that one runs once per request, and a chain of
    # hops that each stall on connect would otherwise spend the whole bound thirty times.
    def answer(self, request, **kwargs):
        return Answered()

    monkeypatch.setattr(requests.adapters.HTTPAdapter, "send", answer)
    adapter = client._BoundedAdapter(UPSTREAM_TIMEOUT_SECONDS, MAX_UPSTREAM_BYTES)
    prepared = requests.Request("GET", "http://example.invalid").prepare()

    token = open_budget(-1)
    try:
        with pytest.raises(requests.exceptions.ReadTimeout, match="budget is spent"):
            adapter.send(prepared)
    finally:
        client._deadline.reset(token)


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
    # The old bound covered one call. No route makes only one: `/radio` makes three and `/lyrics`
    # seven, so at 8s each a hung YouTube held a thread for 24s and 56s — worse than the 30s
    # that was removed, and all of it after the caller gave up at 6s. Three calls against a
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
    # that is upstream's ceiling rather than the sample's. A 4 MB cap would cut those in half.
    largest_measured = 3_850_873
    assert MAX_UPSTREAM_BYTES > largest_measured * 2
    assert MAX_UPSTREAM_BYTES < 32 * 1024 * 1024, "a cap this loose is not a cap"


@pytest.fixture
def redirecting():
    """A server whose 302 carries a body of its own, and a destination that answers plainly.

    The hop's body is the thing under test. `resolve_redirects` reads it with a bare
    `resp.content` inside `Session.send`, below the layer the session wrapper occupied, so no
    amount of care in `Session.request` could ever have counted it.
    """
    listeners: list[socket.socket] = []

    def start(hop, landed: bytes = b'{"ok":true}', loop: bool = False):
        listener = socket.socket()
        listener.bind(("127.0.0.1", 0))
        listener.listen(8)
        listeners.append(listener)
        port = listener.getsockname()[1]
        sent: list[int] = []

        def handle(conn: socket.socket) -> None:
            written = 0
            try:
                asked = conn.recv(65536)
                if b"/landed" in asked and not loop:
                    conn.sendall(
                        b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n"
                        b"Content-Length: " + str(len(landed)).encode() + b"\r\n\r\n" + landed
                    )
                    return
                where = b"/" if loop else b"/landed"
                conn.sendall(
                    b"HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:"
                    + str(port).encode() + where
                    + b"\r\nContent-Type: text/html\r\n\r\n"
                )
                for part in hop():
                    conn.sendall(part)
                    written += len(part)
            except OSError:
                pass  # the reader hung up, which is what one of these tests is about
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
        return f"http://127.0.0.1:{port}/", sent

    yield start
    for one in listeners:
        one.close()


def hop_body():
    """An endless body on the 302 itself, which is a shape nothing legitimate produces."""
    block = b"a" * 65536
    sent = 0
    while sent < 64 * 1024 * 1024:  # a stop the test should never reach, so a failure ends
        yield block
        sent += len(block)


def test_a_redirect_body_is_capped_like_the_answer_it_stands_in_front_of(redirecting):
    # The cap lived on `Session.request`, which only ever sees a request's answer. A hop is
    # not that answer: `requests` reads it inside `Session.send` and hands back only the last
    # response, so a 302 that then never stopped writing was buffered whole, and up to thirty
    # times over — 32 MB a hop, a 1.02 GB peak and 31.2s measured against the 8 MB cap and the
    # 8s budget that were both nominally in force.
    url, sent = redirecting(hop_body)
    token = open_budget(30)
    try:
        session = bounded_session(30, max_bytes=1024 * 1024)
        with pytest.raises(UpstreamTooLarge, match=r"more than 1 MB") as caught:
            session.request("GET", url)
    finally:
        client._deadline.reset(token)

    # The refusal names the hop, not the destination the chain never reached.
    assert caught.value.response.status_code == 302
    assert caught.value.response.raw.closed
    until = time.monotonic() + 10
    while not sent and time.monotonic() < until:
        time.sleep(0.05)
    assert sent, "the server never finished, so the connection was not released"
    assert sent[0] < 16 * 1024 * 1024, f"{sent[0]:,} bytes left the server for a 1 MB cap"


def test_a_redirect_is_still_followed_rather_than_refused(redirecting):
    # Refusing redirects was the cheaper way to bound this, and this is why it was not taken:
    # ytmusicapi fetches `music.youtube.com` for a visitor id and the plain `/playlist` page
    # as a fallback, and a consent or region interstitial in front of either is a 302. Left
    # unfollowed that reaches `json.loads` and reports itself as a parser fault instead.
    payload = json.dumps({"ok": True, "where": "landed"}).encode()
    url, _ = redirecting(lambda: iter(()), landed=payload)

    response = bounded_session(30).request("GET", url)

    assert response.content == payload
    assert response.json()["where"] == "landed"
    assert [one.status_code for one in response.history] == [302]


def test_a_chain_stops_long_before_thirty_bodies_are_held_at_once(redirecting):
    # Capping each hop is not capping the chain: every hop stays reachable through
    # `resp.history` until the chain ends, so `requests`' default of 30 would let a hostile
    # host hold thirty caps' worth at once. Nothing upstream needs more than a hop or two.
    url, _ = redirecting(lambda: iter(()), loop=True)

    with pytest.raises(requests.exceptions.TooManyRedirects) as caught:
        bounded_session(30).request("GET", url)

    assert "Exceeded 5 redirects" in str(caught.value)
    assert len(caught.value.response.history) == 5
    # A `RequestException`, so the routes' existing mapping makes it the flat 502 unchanged.
    assert isinstance(caught.value, requests.exceptions.RequestException)
