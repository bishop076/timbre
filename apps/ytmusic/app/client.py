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


# How much of an answer YouTube Music is allowed to be.
#
# The timeout above bounds how long a call may take; nothing bounded how much it could send,
# so a host that kept writing filled the heap instead of the clock — 300 MB buffered and a
# 619 MB peak, measured against a socket that simply never stopped. The same hazard exists in
# the other runtime, and `readCapped` in `packages/providers/src/request.ts` is the shape it
# takes there.
#
# The number is measured, not chosen. 198 live calls across every route on 2026-09-16, median
# 2.40 MB, and the largest each endpoint gave:
#
#     /youtubei/v1/player      271 KB      one song's details
#     /youtubei/v1/search      677 KB      50 results
#     /youtubei/v1/next       2.00 MB      a watch playlist of 51
#     /youtubei/v1/browse     3.67 MB      a playlist of 200
#
# The browse figure is the one that matters, and it is upstream's own ceiling rather than our
# sample's: 115 playlists of between 94 and 200 tracks all land between 3.60 and 3.67 MB and
# not one goes over. So a 4 MB cap would cut real playlists in half; twice the largest thing
# YouTube has ever been seen to send leaves that ceiling clear without inviting a heap back.
#
# Per call, not per request, unlike the deadline. The lesson there was that a bound on one call is
# not a bound on a request, and that holds for the clock because held threads accumulate. Bytes
# do not: `/lyrics` makes seven calls, but each body is parsed and dropped before the next goes
# out, so the peak is one body and not seven.
MAX_UPSTREAM_BYTES = 8 * 1024 * 1024

# Big enough that the cap costs one comparison per 64 KB rather than per kilobyte, small enough
# that at most that much is read past the line before the read stops.
_CHUNK_BYTES = 64 * 1024


class UpstreamTooLarge(requests.exceptions.RequestException):
    """YouTube Music sent more than we agreed to read, so the read was stopped.

    A `RequestException` because every route already turns one into the flat 502 the API
    requires, and the secondary calls already degrade rather than fail the request.
    """


def _as_size(byte_count: int) -> str:
    if byte_count >= 1024 * 1024:
        return f"{round(byte_count / 1024 / 1024)} MB"
    if byte_count >= 1024:
        return f"{round(byte_count / 1024)} KB"
    # A trickle is the case where this is read most often, and "0 KB" of it is a lie.
    return f"{byte_count} bytes"


def _read_capped(response: requests.Response, due: float, limit: int, budget: float) -> None:
    """Buffer the body, stopping at the first chunk that crosses the size or the deadline.

    Counting after the fact would mean the bytes were already here, so this reads the stream
    and stops at the first chunk over the line: the connection is closed, nothing further is
    read, and the caller is told plainly how much was too much. **Truncating instead would be
    worse than either** — a half-read body reaches `json.loads` in ytmusicapi's `_send_request`
    and reports itself as "Expecting value", which sends whoever reads the log looking for a
    parser bug in a body that was fine up to the point we stopped taking it.

    The deadline is here rather than left to `timeout` because `requests`' timeout is per
    socket read, not per call: every byte that arrives resets it, so a host writing one byte a
    second survived an 8s bound indefinitely — 12.0s for a 13-byte body, and unbounded for a
    longer one. `due` is the wall clock for the whole call, taken from the same per-request
    budget, so a trickle costs what a hang costs and no more.

    `read1` rather than `iter_content`, which is what makes that deadline reachable at all:
    `iter_content(n)` blocks until it has all *n* bytes, so against a host writing a byte every
    200ms it yielded nothing whatever in two minutes and the check below never ran once. `read1`
    hands back whatever has actually arrived, which is the only granularity a clock can see.
    It still decodes `content-encoding`, so the bytes counted are the bytes that would sit in
    the heap — a gzip bomb is measured at its unpacked size, not its compressed one.

    On success the body is handed back through the response's own `content`, so every caller —
    `response.text`, `response.json()` — reads it exactly as it did when `requests` buffered it.
    """
    body = bytearray()
    try:
        while True:
            chunk = response.raw.read1(_CHUNK_BYTES, decode_content=True)
            if not chunk:
                break
            body += chunk
            if len(body) > limit:
                raise UpstreamTooLarge(
                    f"YouTube Music sent more than {_as_size(limit)}; the read was stopped.",
                    response=response,
                )
            if time.monotonic() >= due:
                raise requests.exceptions.ReadTimeout(
                    f"YouTube Music was still sending {_as_size(len(body))} after "
                    f"{budget:.1f}s; the read was stopped.",
                    response=response,
                )
    except BaseException:
        # Releases the connection instead of leaving a half-read socket in the pool for the
        # next call to inherit. The size and the deadline are the reasons to be here; a socket
        # error on the way through wants it just as much.
        response.close()
        raise

    # The two fields `requests` sets itself when it does the buffering. Reaching for them is
    # the price of counting the bytes first; the alternative is a second copy of the body.
    response._content = bytes(body)
    response._content_consumed = True


def bounded_session(
    seconds: float = UPSTREAM_TIMEOUT_SECONDS, max_bytes: int = MAX_UPSTREAM_BYTES
) -> requests.Session:
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
        # `stream=True` is what makes the body ours to count rather than something `requests`
        # has already finished buffering by the time we see it. Nothing here asks to stream:
        # ytmusicapi reads `response.text` and `response.json()`, both of which go on working
        # because `_read_capped` fills in the content it would otherwise have read itself.
        kwargs["stream"] = True
        due = time.monotonic() + left
        response = inner(*args, **kwargs)
        _read_capped(response, due, max_bytes, left)
        return response

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
