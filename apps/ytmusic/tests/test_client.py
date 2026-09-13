from app.client import UPSTREAM_TIMEOUT_SECONDS, bounded_session


def test_session_carries_a_timeout():
    session = bounded_session()
    assert session.request.keywords["timeout"] == UPSTREAM_TIMEOUT_SECONDS


def test_the_bound_sits_above_the_caller_deadline_and_well_under_ytmusicapi_default():
    # The web app gives up at 6s; ytmusicapi's own default is 30s. Being the first to give
    # up would fail requests someone is still waiting for; keeping 30s would hold a thread
    # in a 40-slot pool for 24s after the caller had gone.
    assert 6 < UPSTREAM_TIMEOUT_SECONDS < 30


def test_an_explicit_bound_is_honoured():
    assert bounded_session(2).request.keywords["timeout"] == 2
