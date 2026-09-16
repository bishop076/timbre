import socket
import threading
import time

import pytest
import requests

from app import client
from app.client import (
    UPSTREAM_TIMEOUT_SECONDS,
    bounded_session,
    open_budget,
    remaining,
)


def test_session_carries_a_timeout(monkeypatch):
    seen: dict = {}
    monkeypatch.setattr(requests.Session, "request", lambda self, *a, **k: seen.update(k))

    bounded_session().request("GET", "http://example.invalid")
    assert seen["timeout"] == UPSTREAM_TIMEOUT_SECONDS

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
