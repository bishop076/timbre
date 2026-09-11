"""Wire shapes between the sidecar and the Next.js app.

Deliberately flat and boring. The TypeScript adapter maps these into canonical
tracks; keeping this layer dumb means a `ytmusicapi` shape change touches one
Python file and nothing else.
"""

from typing import Annotated

from pydantic import BaseModel, Field, model_validator


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
    # MUSIC_VIDEO_TYPE_ATV (auto-generated Topic art track), _OMV (official
    # music video), _UGC (user upload), and others. Decides embed ranking in
    # routes/search.py: art tracks are the class rights holders bar from
    # embedding, so they are attempted last.
    #
    # This field must exist here for that ranking to work at all. Without it
    # pydantic silently drops the value normalize.py passes, and every track
    # compares equal — which is why the ranking added in 4c49037 never did
    # anything, despite ytmusicapi populating videoType perfectly well.
    video_type: str | None = None


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


class RadioRequest(BaseModel):
    """What YouTube Music itself plays after a track."""

    video_id: str = Field(pattern=r"^[A-Za-z0-9_-]{11}$")
    # `le=50` is load-bearing rather than arbitrary. ytmusicapi treats `limit`
    # as a *minimum*, and one page of a watch queue already returns about 50 —
    # so any value up to 50 costs exactly one upstream request, while 51 starts
    # fetching continuations.
    limit: int = Field(default=25, ge=1, le=50)


class RadioResponse(BaseModel):
    """Two independently-derived lists, kept separate on purpose.

    `radio` is the sequential watch queue — what plays next if you do nothing.
    `related` is the watch panel's "You might also like", which YouTube derives
    a different way. The ranker in @timbre/providers scores a track higher when
    several independent lists reach it, so collapsing these two into one here
    would destroy the signal it exists to measure.
    """

    radio: list[Track]
    related: list[Track]


class LyricsRequest(BaseModel):
    """The words YouTube Music shows in its Lyrics tab, for one song.

    **Only art tracks have a Lyrics tab.** Measured 2026-09-11, unauthenticated,
    across seven songs: 6 of 6 art tracks (MUSIC_VIDEO_TYPE_ATV) had one, and
    0 of 14 official videos and 0 of 26 user uploads did — with no
    `counterpart` on their watch pages pointing at the art track either. Timbre
    plays videos first, since art tracks are the uploads most often barred from
    embedding, so the upload playing is usually one with no lyrics at all.

    Hence two ways in. `video_ids` are art tracks the web app already knows of,
    tried in order. Failing those, `title` and `artist` find the art track with
    a songs search, the way YouTube Music itself would pair a video with its
    song. Three ids at most: each without a tab is a second spent on nothing.
    """

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
    # Milliseconds into the song, or None on every line when YouTube Music has
    # the words but not their timing. Never mixed within one answer.
    start_ms: int | None = None


class LyricsResponse(BaseModel):
    """Always a 200, even when there is nothing to show.

    "No lyrics" is an empty `lines` rather than a 404 because the web app and
    this service deploy independently: a web app ahead of an older sidecar gets
    FastAPI's own 404 for the unknown route, and that has to read as a fault to
    fix, not as a song without words.
    """

    source: str = "ytmusic"
    synced: bool = False
    lines: list[LyricLine] = []
    # YouTube Music licenses its lyrics and names the licensor — "Source:
    # LyricFind" and the like. Passed through verbatim so the credit is shown
    # the way the licensor worded it.
    attribution: str | None = None
