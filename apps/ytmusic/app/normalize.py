from typing import Any

from .models import Track

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
    if not isinstance(raw, dict):
        return None

    result_type = raw.get("resultType")
    if result_type not in PLAYABLE_RESULT_TYPES:
        return None

    video_id = raw.get("videoId")
    title = raw.get("title")
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
    if not isinstance(results, list):
        return []
    tracks = (to_track(item) for item in results)
    return [track for track in tracks if track is not None]


def to_watch_track(raw: Any) -> Track | None:
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
    if not isinstance(results, list):
        return []
    tracks = (to_watch_track(item) for item in results)
    return [track for track in tracks if track is not None]


def to_related_track(raw: Any) -> Track | None:
    if not isinstance(raw, dict):
        return None

    return to_track({**raw, "resultType": "song"})


def to_related_tracks(results: Any) -> list[Track]:
    if not isinstance(results, list):
        return []
    tracks = (to_related_track(item) for item in results)
    return [track for track in tracks if track is not None]
