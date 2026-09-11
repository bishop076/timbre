import re
from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from ..client import get_client
from ..errors import upstream_error
from ..models import Track
from ..normalize import _largest_thumbnail, to_related_track, to_tracks

router = APIRouter()


class PlaylistRequest(BaseModel):
    playlist_id: str = Field(pattern=r"^[A-Za-z0-9_-]{12,64}$")
    limit: int = Field(default=100, ge=1, le=200)


class PlaylistResponse(BaseModel):
    id: str
    title: str
    author: str | None = None
    year: str | None = None
    track_count: int | None = None
    thumbnail_url: str | None = None
    tracks: list[Track]


def is_missing(error: Exception) -> bool:
    message = error.args[0] if isinstance(error, KeyError) and error.args else None
    return (
        isinstance(message, str)
        and message.startswith("Unable to find 'contents' using path ['contents',")
        and " on {'responseContext'" in message
    )


def to_playlist_track(raw: Any) -> Track | None:
    if isinstance(raw, dict) and raw.get("isAvailable") is False:
        return None
    return to_related_track(raw)


def cover_of(playlist: dict, tracks: list[Track]) -> str | None:
    own = _largest_thumbnail(playlist)
    if own:
        return own
    first = next((track.thumbnail_url for track in tracks if track.thumbnail_url), None)
    return re.sub(r"=w\d+-h\d+", "=w544-h544", first) if first else None


def _text(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


@router.post("/playlist", response_model=PlaylistResponse)
def playlist(request: PlaylistRequest) -> PlaylistResponse:
    try:
        raw = get_client().get_playlist(request.playlist_id, limit=request.limit)
    except Exception as error:
        if is_missing(error):
            raise HTTPException(
                status.HTTP_404_NOT_FOUND, "No public playlist with that id."
            ) from error
        raise upstream_error("playlist", error) from error

    if not isinstance(raw, dict):
        raise upstream_error("playlist", TypeError(f"expected a dict, got {type(raw).__name__}"))

    tracks = to_tracks(raw.get("tracks"), to_playlist_track)[: request.limit]
    author = raw.get("author")
    count = raw.get("trackCount")

    return PlaylistResponse(
        id=request.playlist_id,
        title=_text(raw.get("title")) or "Untitled playlist",
        author=_text(author.get("name")) if isinstance(author, dict) else None,
        year=_text(raw.get("year")),
        track_count=count if isinstance(count, int) else None,
        thumbnail_url=cover_of(raw, tracks),
        tracks=tracks,
    )
