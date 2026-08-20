"""Shared, unauthenticated YouTube Music client.

`YTMusic()` with no credentials supports search and public track lookup, which
is everything Timbre needs — nobody logs into anything. That removes OAuth,
per-user tokens and credential storage from this service entirely.

The client is created lazily rather than at import. **The original reason given
here was wrong and is worth correcting:** construction makes no network call at
all — 20 `YTMusic()` instances build in 0.048s (measured 2026-08-19, ytmusicapi
1.12.2). What costs is the *first search on each instance*, ~3.1-3.4s against
~0.9s warm, and no construction timing avoids that.

Lazy construction is still right, for the reason that survives: a module that
builds nothing at import cannot fail to load, and tests that merely import it
stay fast. The latency argument belongs to the cache below, not to laziness.
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
    later. A client per concurrent caller removes the question.

    **What that costs, measured:** each new slot pays ytmusicapi's first-search
    warm-up of ~3.1-3.4s, once, against ~0.9s warm. That is not free, so keep the
    set of slots small and fixed — one per genuinely parallel path, never one per
    request. It also makes this cache load-bearing for latency: `reset_client()`
    re-pays the warm-up on every slot.

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
