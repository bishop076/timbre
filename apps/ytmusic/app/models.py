"""Wire shapes between the sidecar and the Next.js app.

Deliberately flat and boring. The TypeScript adapter maps these into canonical
tracks; keeping this layer dumb means a `ytmusicapi` shape change touches one
Python file and nothing else.
"""

from pydantic import BaseModel, Field


class Track(BaseModel):
    """A playable YouTube Music result."""

    video_id: str
    title: str
    artists: list[str] = []
    album: str | None = None
    duration_seconds: int | None = None
    thumbnail_url: str | None = None
    is_explicit: bool = False
    # 'song' is a proper Music track; 'video' is a YouTube video surfaced in
    # Music — often the only home of a remix, live set or unofficial upload.
    result_type: str = "song"


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    limit: int = Field(default=20, ge=1, le=50)


class SearchResponse(BaseModel):
    items: list[Track]


class ResolveRequest(BaseModel):
    """Resolves a YouTube or YouTube Music URL, or a bare video id."""

    url: str = Field(min_length=1, max_length=2000)


class ResolveResponse(BaseModel):
    track: Track | None
