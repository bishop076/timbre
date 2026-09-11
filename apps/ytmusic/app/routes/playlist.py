"""Playlist route — a public YouTube or YouTube Music playlist, flattened.

Unauthenticated like everything else here. `get_playlist` reads a public playlist
without a login, and that includes the two kinds nobody makes by hand: an
album's `OLAK5uy_` list, which is how YouTube Music shares an album, and YouTube Music's
own `RDCLAK5uy_` editorial playlists. Measured 2026-09-11, ytmusicapi 1.12.2.

What it cannot read is anything personal — Liked, Watch later, a private list — or a
radio mix (`RDAMVM…`), which is a watch queue rather than a playlist and has no browse
page at all. All of those answer the same way a playlist that never existed does, so all
of them are a 404 here.

The wire models live beside the route rather than in `models.py`: they are this route's
contract alone, and the track inside is the shared `Track`, so the shape a playlist's songs
arrive in is exactly the shape a search's do.

`def` rather than `async def`, for the same reason as `search.py`.
"""

import re
from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from ..client import get_client
from ..errors import upstream_error
from ..models import Track
from ..normalize import to_track

router = APIRouter()

# Real ids run from 18 characters (`PL` + 16, the oldest) to 43 (`RDCLAK5uy_` + 33). The
# bounds are loose on purpose; what they are for is keeping a pasted URL, a path or a
# personal two-letter list (`LL`, `WL`, `LM`) from ever reaching YouTube.
PLAYLIST_ID = r"^[A-Za-z0-9_-]{12,64}$"

# A googleusercontent thumbnail states its size at the end — `=w120-h120-l90-rj`.
_THUMBNAIL_SIZE = re.compile(r"=w\d+-h\d+")


class PlaylistRequest(BaseModel):
    playlist_id: str = Field(pattern=PLAYLIST_ID)
    # 100 is one page of a playlist's tracks, so the default costs one upstream request.
    # Past it ytmusicapi fetches continuations, 100 at a time, which is why this stops at
    # 200 rather than at "all of it": a 5,000-song playlist would be fifty requests.
    limit: int = Field(default=100, ge=1, le=200)


class PlaylistResponse(BaseModel):
    id: str
    title: str
    author: str | None = None
    year: str | None = None
    # What YouTube says the playlist holds, which is more than `tracks` when the list is
    # longer than `limit` or some of it has been taken down.
    track_count: int | None = None
    thumbnail_url: str | None = None
    tracks: list[Track]


def is_missing(error: Exception) -> bool:
    """Whether a `get_playlist` failure means "there is no such public playlist".

    YouTube does not say so in any direct way. A browse for a playlist it will not show
    answers **200** with no `contents` at all — only `responseContext`, `trackingParams`
    and `microformat` — and ytmusicapi's first `nav()` into that raises a `KeyError`
    naming the missing key and the object it looked in. Measured 2026-09-11 for a made-up
    `PL…`, a made-up `OLAK5uy_…` and a real `RDAMVM…` mix.

    Every other `KeyError` is ytmusicapi failing to follow a shape YouTube has changed,
    and that is an upstream fault rather than a missing playlist — hence reading which
    object the lookup failed on, not merely that one did. Reporting a parser break as 404
    would tell the reader their link is wrong when it is not.
    """
    if not isinstance(error, KeyError) or not error.args:
        return False
    message = error.args[0]
    return (
        isinstance(message, str)
        and message.startswith("Unable to find 'contents' using path ['contents',")
        and " on {'responseContext'" in message
    )


def to_playlist_track(raw: Any) -> Track | None:
    """Flattens one playlist item, or None if it cannot be played.

    Playlist items are search-shaped apart from carrying no `resultType`, so one is
    supplied and `to_track` does the rest. Being in the list is what that field would
    have asserted.

    Greyed-out items are dropped here. A deleted or region-blocked upload stays in a
    playlist as a row YouTube itself will not play, and ytmusicapi still hands back its
    id — so without this the page would offer songs that fail the moment they are pressed.
    """
    if not isinstance(raw, dict) or raw.get("isAvailable") is False:
        return None
    return to_track({**raw, "resultType": "song"})


def _largest(thumbnails: Any) -> str | None:
    if not isinstance(thumbnails, list):
        return None
    best = max(
        (t for t in thumbnails if isinstance(t, dict) and isinstance(t.get("url"), str)),
        key=lambda t: (t.get("width") or 0) * (t.get("height") or 0),
        default=None,
    )
    return best["url"] if best else None


def cover_of(playlist: dict, tracks: list[Track]) -> str | None:
    """The playlist's own artwork, or its first song's when it has none.

    An album's `OLAK5uy_` list is parsed by a different path in ytmusicapi that returns no
    thumbnails at all, and there the first song's sleeve *is* the album's. That one comes
    at 120px, so it is asked for at 544 — the size YouTube Music draws its own album pages
    at — rather than being stretched across the page header.
    """
    own = _largest(playlist.get("thumbnails"))
    if own:
        return own
    first = next((track.thumbnail_url for track in tracks if track.thumbnail_url), None)
    return _THUMBNAIL_SIZE.sub("=w544-h544", first) if first else None


def _text(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


@router.post("/playlist", response_model=PlaylistResponse)
def playlist(request: PlaylistRequest) -> PlaylistResponse:
    try:
        raw = get_client().get_playlist(request.playlist_id, limit=request.limit)
    except Exception as error:  # any upstream failure is a 502, bar the one above
        if is_missing(error):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No public playlist with that id.",
            ) from error
        raise upstream_error("playlist", error) from error

    if not isinstance(raw, dict):
        raise upstream_error("playlist", TypeError(f"expected a dict, got {type(raw).__name__}"))

    items = raw.get("tracks")
    flattened = (to_playlist_track(item) for item in (items if isinstance(items, list) else []))
    tracks = [track for track in flattened if track is not None][: request.limit]

    author = raw.get("author")
    count = raw.get("trackCount")

    return PlaylistResponse(
        # The id asked for, not the one parsed back: ytmusicapi reads its own with
        # `none_if_absent`, so it can be None, and the caller has already keyed a page on this.
        id=request.playlist_id,
        title=_text(raw.get("title")) or "Untitled playlist",
        author=_text(author.get("name")) if isinstance(author, dict) else None,
        year=_text(raw.get("year")),
        track_count=count if isinstance(count, int) else None,
        thumbnail_url=cover_of(raw, tracks),
        tracks=tracks,
    )
