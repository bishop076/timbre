from typing import Annotated

from pydantic import BaseModel, Field, model_validator


class Track(BaseModel):
    video_id: str
    title: str
    artists: list[str] = []
    album: str | None = None
    duration_seconds: int | None = None
    thumbnail_url: str | None = None
    is_explicit: bool = False
    result_type: str = "song"
    video_type: str | None = None


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    limit: int = Field(default=20, ge=1, le=50)


class SearchResponse(BaseModel):
    items: list[Track]


class ResolveRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2000)


class ResolveResponse(BaseModel):
    track: Track | None


class RadioRequest(BaseModel):
    video_id: str = Field(pattern=r"^[A-Za-z0-9_-]{11}$")
    limit: int = Field(default=25, ge=1, le=50)


class RadioResponse(BaseModel):
    radio: list[Track]
    related: list[Track]


class LyricsRequest(BaseModel):
    video_ids: list[Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{11}$")]] = Field(
        default=[], max_length=3
    )
    title: str | None = Field(default=None, min_length=1, max_length=300)
    artist: str | None = Field(default=None, min_length=1, max_length=300)

    @model_validator(mode="after")
    def _something_to_look_up(self) -> "LyricsRequest":
        if not self.video_ids and not (self.title and self.artist):
            raise ValueError("Give video_ids, or a title and an artist.")
        return self


class LyricLine(BaseModel):
    text: str
    start_ms: int | None = None


class LyricsResponse(BaseModel):
    source: str = "ytmusic"
    synced: bool = False
    lines: list[LyricLine] = []
    attribution: str | None = None
