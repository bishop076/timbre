from collections.abc import Callable
from typing import Any

from .models import Track


def _area(thumbnail: dict) -> int:
    width, height = thumbnail.get("width"), thumbnail.get("height")
    return width * height if isinstance(width, int) and isinstance(height, int) else 0


def _largest_thumbnail(raw: Any) -> str | None:
    thumbnails = raw.get("thumbnails")
    if not isinstance(thumbnails, list):
        return None
    usable = (t for t in thumbnails if isinstance(t, dict) and isinstance(t.get("url"), str))
    best = max((t for t in usable if t["url"]), key=_area, default=None)
    return best["url"] if best else None


def _artist_names(raw: Any) -> list[str]:
    artists = raw.get("artists")
    if not isinstance(artists, list):
        return []
    names = (artist.get("name") for artist in artists if isinstance(artist, dict))
    return [n.strip() for n in names if isinstance(n, str) and n.strip() not in ("", "•")]


def _album_name(raw: Any) -> str | None:
    album = raw.get("album")
    if isinstance(album, dict):
        name = album.get("name")
        return name if isinstance(name, str) and name.strip() else None
    return album.strip() if isinstance(album, str) and album.strip() else None


def _duration_seconds(raw: Any) -> int | None:
    seconds = raw.get("duration_seconds")
    if isinstance(seconds, int) and seconds > 0:
        return seconds

    display = raw.get("duration")
    if not isinstance(display, str):
        return None
    parts = display.strip().split(":")
    if not all(part.isdecimal() for part in parts) or not 2 <= len(parts) <= 3:
        return None
    return sum(int(part) * 60**power for power, part in enumerate(reversed(parts))) or None


def to_track(raw: Any) -> Track | None:
    if not isinstance(raw, dict):
        return None
    result_type = raw.get("resultType")
    video_id = raw.get("videoId")
    title = raw.get("title")
    if result_type not in ("song", "video") or not isinstance(video_id, str) or not video_id:
        return None
    if not isinstance(title, str) or not title.strip():
        return None

    video_type = raw.get("videoType")
    return Track(
        video_id=video_id,
        title=title.strip(),
        artists=_artist_names(raw),
        album=_album_name(raw),
        duration_seconds=_duration_seconds(raw),
        thumbnail_url=_largest_thumbnail(raw),
        is_explicit=bool(raw.get("isExplicit", False)),
        result_type=result_type,
        video_type=video_type if isinstance(video_type, str) else None,
    )


def to_watch_track(raw: Any) -> Track | None:
    if not isinstance(raw, dict):
        return None
    duration, thumbnails = raw.get("length"), raw.get("thumbnail")
    return to_track({**raw, "resultType": "song", "duration": duration, "thumbnails": thumbnails})


def to_related_track(raw: Any) -> Track | None:
    return to_track({**raw, "resultType": "song"}) if isinstance(raw, dict) else None


def to_tracks(results: Any, convert: Callable[[Any], Track | None] = to_track) -> list[Track]:
    if not isinstance(results, list):
        return []
    return [track for track in map(convert, results) if track is not None]
