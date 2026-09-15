import contextvars
import threading
import time

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
#
# That bound is per *call*, and it was once read as if it were per request. It is not: no route
# makes only one call. `/radio` asks for the watch playlist, asks again with `radio=True`
# when the first held only the seed, then fetches the related songs — three. `/lyrics` tries
# up to three ids, searches for an art track, tries that id too, then asks for the timed
# lyrics and the plain page — seven, the last two holding `_mobile_lock` process-wide. At 8s
# each that is 24s and 56s of held thread, which is worse than the 30s that was removed. So the
# same number is a budget for the whole request as well as the cap on any one call within
# it: a chain gets no more wall time than a single hung call would have.
UPSTREAM_TIMEOUT_SECONDS = 8

# Set per request by the middleware below, read by the session on every call. A contextvar
# rather than thread-local state because anyio copies the context into the worker thread it
# runs each sync route in; `routes/search.py` copies it by hand into the one pool we spawn.
_deadline: contextvars.ContextVar[float | None] = contextvars.ContextVar(
    "upstream_deadline", default=None
)

_clients: dict[str, YTMusic] = {}
_lock = threading.Lock()


def open_budget(seconds: float = UPSTREAM_TIMEOUT_SECONDS) -> contextvars.Token:
    """Start a request's upstream budget. Returns the token that closes it again."""
    return _deadline.set(time.monotonic() + seconds)


def remaining(cap: float = UPSTREAM_TIMEOUT_SECONDS) -> float:
    """How long an upstream call may take: what is left of the budget, never more than `cap`.

    With no budget open — a unit test, a script — the cap applies unchanged, so calling this
    module outside a request behaves exactly as it did before there was a budget.
    """
    due = _deadline.get()
    return cap if due is None else min(cap, due - time.monotonic())


def bounded_session(seconds: float = UPSTREAM_TIMEOUT_SECONDS) -> requests.Session:
    session = requests.Session()
    inner = session.request

    def request(*args: object, **kwargs: object) -> requests.Response:
        left = remaining(seconds)
        if left <= 0:
            # Refusing here rather than passing a zero timeout keeps the reason legible in
            # the log, and every route already treats a timeout as an upstream failure: the
            # secondary calls degrade to what they have, the primary ones become a 502.
            raise requests.exceptions.ReadTimeout("this request's upstream budget is spent")
        kwargs.setdefault("timeout", left)
        return inner(*args, **kwargs)

    session.request = request  # type: ignore[method-assign]
    return session


def get_client(slot: str = "default") -> YTMusic:
    with _lock:
        if slot not in _clients:
            _clients[slot] = YTMusic(requests_session=bounded_session())
        return _clients[slot]


class UpstreamBudget:
    """Opens the budget at the start of every request, so no route has to remember to.

    Pure ASGI and installed inside `RequireSharedSecret`, which means a 401 never opens one:
    a refused request makes no upstream call and has nothing to spend.
    """

    def __init__(self, app: object) -> None:
        self.app = app

    async def __call__(self, scope: dict, receive: object, send: object) -> None:
        if scope["type"] == "http":
            open_budget(UPSTREAM_TIMEOUT_SECONDS)
        await self.app(scope, receive, send)  # type: ignore[operator]
