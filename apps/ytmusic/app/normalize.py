"""Flattening `ytmusicapi` result dicts into a stable wire shape.

`ytmusicapi` tracks YouTube's private API, so its result dicts change shape
without warning and vary between result types. Everything here is defensive:
a field that has moved or vanished degrades that one value to None rather than
failing the whole request.

Only flattening happens here. Canonical normalization — title parsing, variant
detection, artist splitting — lives in @timbre/core so that every source is
normalized by one implementation.
"""

from typing import Any

from .models import Track

# Result types worth returning. 'song' is a proper YouTube Music track;
# 'video' is a YouTube video surfaced in Music, which is often the only place
# a remix, live set or unofficial upload exists — exactly the catalogue Timbre
# is built to reach, so it is kept rather than filtered out.
PLAYABLE_RESULT_TYPES = {"song", "video"}


def _largest_thumbnail(raw: Any) -> str | None:
    thumbnails = raw.get("thumbnails")
    if not isinstance(thumbnails, list) or not thumbnails:
        return None
    best = max(
        (t for t in thumbnails if isinstance(t, dict) and t.get("url")),
        key=lambda t: (t.get("width") or 0) * (t.get("height") or 0),
        default=None,
    )
    return best.get("url") if best else None


def _artist_names(raw: Any) -> list[str]:
    artists = raw.get("artists")
    if not isinstance(artists, list):
        return []
    names: list[str] = []
    for artist in artists:
        if not isinstance(artist, dict):
            continue
        name = artist.get("name")
        # Separators and view counts appear in this list on video results.
        if isinstance(name, str) and name.strip() and name.strip() != "•":
            names.append(name.strip())
    return names


def _album_name(raw: Any) -> str | None:
    album = raw.get("album")
    if isinstance(album, dict):
        name = album.get("name")
        return name if isinstance(name, str) and name.strip() else None
    if isinstance(album, str) and album.strip():
        return album.strip()
    return None


def _duration_seconds(raw: Any) -> int | None:
    seconds = raw.get("duration_seconds")
    if isinstance(seconds, int) and seconds > 0:
        return seconds

    # Fall back to the display string, "4:19" or "1:02:03".
    display = raw.get("duration")
    if not isinstance(display, str):
        return None
    parts = display.strip().split(":")
    if not all(part.isdigit() for part in parts) or not 2 <= len(parts) <= 3:
        return None
    total = 0
    for part in parts:
        total = total * 60 + int(part)
    return total or None


def to_track(raw: Any) -> Track | None:
    """Flattens one search result. Returns None if it is not a playable track."""
    if not isinstance(raw, dict):
        return None

    result_type = raw.get("resultType")
    if result_type not in PLAYABLE_RESULT_TYPES:
        return None

    video_id = raw.get("videoId")
    title = raw.get("title")
    # Without an id there is nothing to play, and without a title nothing to
    # match on — either makes the result useless.
    if not isinstance(video_id, str) or not video_id:
        return None
    if not isinstance(title, str) or not title.strip():
        return None

    return Track(
        video_id=video_id,
        title=title.strip(),
        artists=_artist_names(raw),
        album=_album_name(raw),
        duration_seconds=_duration_seconds(raw),
        thumbnail_url=_largest_thumbnail(raw),
        is_explicit=bool(raw.get("isExplicit", False)),
        result_type=result_type,
        video_type=raw.get("videoType") if isinstance(raw.get("videoType"), str) else None,
    )


def to_tracks(results: Any) -> list[Track]:
    """Flattens a result list, dropping anything unplayable."""
    if not isinstance(results, list):
        return []
    tracks = (to_track(item) for item in results)
    return [track for track in tracks if track is not None]


def to_watch_track(raw: Any) -> Track | None:
    """Flattens one `get_watch_playlist` item — a radio entry.

    Watch items are a **different shape** from search results, and `to_track`
    would drop every single one of them. Verified against ytmusicapi 1.12.2:

        resultType   absent entirely     -> to_track returns None for all 50
        duration     called `length`     -> "3:30", not `duration_seconds`
        thumbnails   called `thumbnail`  -> singular, still a list
        album        absent on every one
        isExplicit   absent on every one

    Aliasing those keys and delegating keeps one set of validation rules
    rather than a second copy that drifts. `resultType` is injected because a
    watch item is playable by construction — being in the queue is what that
    field would have been asserting.

    `counterpart` (the song/video twin YouTube attaches) is deliberately
    ignored: it would make a decent extra fall-through candidate, but the
    client already re-searches when an upload refuses to embed.
    """
    if not isinstance(raw, dict):
        return None

    return to_track(
        {
            **raw,
            "resultType": "song",
            "duration": raw.get("length"),
            "thumbnails": raw.get("thumbnail"),
        }
    )


def to_watch_tracks(results: Any) -> list[Track]:
    """Flattens a watch queue, dropping anything unplayable."""
    if not isinstance(results, list):
        return []
    tracks = (to_watch_track(item) for item in results)
    return [track for track in tracks if track is not None]


def to_related_track(raw: Any) -> Track | None:
    """Flattens one item from a `get_song_related` section.

    These come from `parse_song_flat`, which is flatter still: no
    `resultType`, and **no duration in any form**. That matters downstream —
    @timbre/core's `durationsMatch` treats a null duration as "unknown, not a
    mismatch", so these merge more loosely than search results do and a live
    take can collapse into the studio version. Accepted deliberately: the
    alternative is dropping the single richest free recommendation source.
    """
    if not isinstance(raw, dict):
        return None

    return to_track({**raw, "resultType": "song"})


def to_related_tracks(results: Any) -> list[Track]:
    """Flattens one section's contents, dropping anything unplayable.

    Sections are heterogeneous — songs, playlists, artists and albums share
    one list — so entries without a `videoId` (a playlist, an artist) simply
    fall out here rather than needing to be filtered by the caller.
    """
    if not isinstance(results, list):
        return []
    tracks = (to_related_track(item) for item in results)
    return [track for track in tracks if track is not None]
