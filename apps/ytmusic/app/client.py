"""Shared, unauthenticated YouTube Music client.

`YTMusic()` with no credentials supports search and public track lookup, which
is everything Timbre needs — nobody logs into anything. That removes OAuth,
per-user tokens and credential storage from this service entirely.

The client is created lazily rather than at import, because construction makes
a network call to fetch YouTube's client config. Doing that at import time
would mean the process fails to start whenever YouTube is briefly unreachable,
and would slow every test that merely imports the module.
"""

import threading

from ytmusicapi import YTMusic

_client: YTMusic | None = None
_lock = threading.Lock()


def get_client() -> YTMusic:
    """Returns the shared client, constructing it on first use.

    Double-checked locking: FastAPI runs sync endpoints in a threadpool, so
    several requests can race here on a cold start.
    """
    global _client
    if _client is None:
        with _lock:
            if _client is None:
                _client = YTMusic()
    return _client


def reset_client() -> None:
    """Drops the cached client. For tests, and for recovering from a client
    whose cached YouTube config has gone stale."""
    global _client
    with _lock:
        _client = None
