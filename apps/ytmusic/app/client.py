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

_clients: dict[str, YTMusic] = {}
_lock = threading.Lock()


def get_client(slot: str = "default") -> YTMusic:
    """Returns a cached client, constructing it on first use.

    Double-checked locking: FastAPI runs sync endpoints in a threadpool, so
    several requests can race here on a cold start.

    **What `slot` is for.** A `YTMusic` holds one `requests.Session`, and
    `/search` now issues its two upstream searches at the same time rather than
    one after the other. Concurrent requests through a single `Session` are
    usually fine and are not *guaranteed* to be — the cookie jar is shared
    mutable state — and the failure that would produce is intermittent, wrong
    results rather than an error, which is the worst kind to go looking for
    later. A client per concurrent caller costs one extra config fetch, once,
    and removes the question.

    Callers doing sequential work should leave the default; only genuinely
    parallel paths need a slot of their own.
    """
    client = _clients.get(slot)
    if client is None:
        with _lock:
            client = _clients.get(slot)
            if client is None:
                client = YTMusic()
                _clients[slot] = client
    return client


def reset_client() -> None:
    """Drops every cached client. For tests, and for recovering from a client
    whose cached YouTube config has gone stale."""
    with _lock:
        _clients.clear()
