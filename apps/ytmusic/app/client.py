import threading
from functools import partial

import requests
from ytmusicapi import YTMusic

# ytmusicapi pins its own session to `timeout=30` (ytmusic.py:233). The web app gives up on
# the sidecar after 6s (packages/providers/src/request.ts), so on a slow YouTube every route
# here kept its thread for another 24s after the only caller had walked away — and every
# route is a sync `def`, so each one holds a slot in anyio's 40-thread pool while it waits.
# `/health` is a sync `def` too and is the one unauthenticated route, so exhausting that pool
# also stops the check the web app uses to decide the sidecar is alive. Sit just above the
# caller's deadline instead: long enough that the sidecar is never the first to give up on a
# request someone is still waiting for, short enough that an abandoned one frees its thread.
UPSTREAM_TIMEOUT_SECONDS = 8

_clients: dict[str, YTMusic] = {}
_lock = threading.Lock()


def bounded_session(seconds: float = UPSTREAM_TIMEOUT_SECONDS) -> requests.Session:
    session = requests.Session()
    session.request = partial(session.request, timeout=seconds)  # type: ignore[method-assign]
    return session


def get_client(slot: str = "default") -> YTMusic:
    with _lock:
        if slot not in _clients:
            _clients[slot] = YTMusic(requests_session=bounded_session())
        return _clients[slot]
