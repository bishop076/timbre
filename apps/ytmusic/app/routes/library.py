"""Library read routes.

Phase 0 defines the request/response contract only; Phase 1 fills in the
`ytmusicapi` calls. The shapes are fixed now so the TypeScript adapter and the
ingest jobs can be written against them first.
"""

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

router = APIRouter()


class YouTubeCredentials(BaseModel):
    """The user's own OAuth credentials, forwarded per request.

    BYO for the same reason as Spotify: YouTube's quota is charged to the
    Google Cloud project that owns the client id, so each user spending their
    own 10,000 units/day is the only arrangement that scales past one user.
    """

    client_id: str
    client_secret: str
    access_token: str
    refresh_token: str | None = None


class LibraryRequest(BaseModel):
    credentials: YouTubeCredentials
    # ytmusicapi paginates by continuation token rather than offset.
    cursor: str | None = None
    limit: int = Field(default=100, ge=1, le=500)


class RawTrack(BaseModel):
    """Passed through close to `ytmusicapi`'s shape.

    Normalization into a canonical track happens in the TypeScript adapter, so
    that every provider is normalized by the same code path.
    """

    video_id: str
    title: str
    artists: list[str] = []
    album: str | None = None
    duration_seconds: int | None = None
    set_video_id: str | None = None


class RawPlaylist(BaseModel):
    playlist_id: str
    title: str
    description: str | None = None
    track_count: int | None = None
    thumbnail_url: str | None = None


class TrackPage(BaseModel):
    items: list[RawTrack]
    cursor: str | None = None


class PlaylistPage(BaseModel):
    items: list[RawPlaylist]
    cursor: str | None = None


def _not_implemented() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Implemented in Phase 1.",
    )


@router.post("/liked", response_model=TrackPage)
async def liked_tracks(request: LibraryRequest) -> TrackPage:
    raise _not_implemented()


@router.post("/playlists", response_model=PlaylistPage)
async def playlists(request: LibraryRequest) -> PlaylistPage:
    raise _not_implemented()


@router.post("/playlists/{playlist_id}/tracks", response_model=TrackPage)
async def playlist_tracks(playlist_id: str, request: LibraryRequest) -> TrackPage:
    raise _not_implemented()
