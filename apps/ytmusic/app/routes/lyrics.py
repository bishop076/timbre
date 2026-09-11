import logging
import re
import threading

from fastapi import APIRouter

from ..client import get_client
from ..errors import upstream_error
from ..models import LyricLine, LyricsRequest, LyricsResponse
from ..normalize import to_tracks

logger = logging.getLogger(__name__)

router = APIRouter()

_mobile_lock = threading.Lock()

_ASIDES = re.compile(
    r"\s*[(\[][^)\]]*[)\]]|\s+-\s+.*$|\s+(?:feat\.?|ft\.|featuring)\s.*$", re.IGNORECASE
)


@router.post("/lyrics", response_model=LyricsResponse)
def lyrics(request: LyricsRequest) -> LyricsResponse:
    browse_id = lyrics_page(request.video_ids)
    if browse_id is None and request.title and request.artist:
        art_track = find_art_track(request.title, request.artist)
        if art_track is not None:
            browse_id = lyrics_page([art_track])

    return LyricsResponse() if browse_id is None else to_lyrics(_fetch_lyrics(browse_id))


def lyrics_page(video_ids: list[str]) -> str | None:
    for video_id in dict.fromkeys(video_ids):
        try:
            watch = get_client().get_watch_playlist(videoId=video_id, limit=1)
        except Exception as error:
            raise upstream_error("lyrics", error) from error

        browse_id = watch.get("lyrics") if isinstance(watch, dict) else None
        if isinstance(browse_id, str) and browse_id:
            return browse_id
    return None


def find_art_track(title: str, artist: str) -> str | None:
    try:
        results = get_client().search(f"{title} {artist}", filter="songs", limit=5)
    except Exception as error:
        raise upstream_error("lyrics", error) from error

    wanted_title, wanted_artist = _match_key(title), _match_key(artist)
    if not wanted_title or not wanted_artist:
        return None

    for track in to_tracks(results):
        if _match_key(track.title) != wanted_title:
            continue
        if any(_match_key(name) == wanted_artist for name in track.artists):
            return track.video_id
    return None


def _match_key(text: str) -> str:
    spelled = _ASIDES.sub("", text).casefold().replace("&", "and")
    return "".join(char for char in spelled if char.isalnum())


def _fetch_lyrics(browse_id: str) -> object:
    with _mobile_lock:
        client = get_client("lyrics")
        try:
            found = client.get_lyrics(browse_id, timestamps=True)
        except Exception as error:  # noqa: BLE001
            logger.info("timed lyrics failed, trying the plain page: %s", error)
            found = None
        if found is not None:
            return found

        try:
            return client.get_lyrics(browse_id)
        except Exception as error:
            raise upstream_error("lyrics", error) from error


def to_lyrics(raw: object) -> LyricsResponse:
    if not isinstance(raw, dict):
        return LyricsResponse()

    source = raw.get("source")
    attribution = source.strip() if isinstance(source, str) and source.strip() else None
    body = raw.get("lyrics")

    if raw.get("hasTimestamps") and isinstance(body, list):
        lines = [line for line in map(_timed_line, body) if line is not None]
        if not lines:
            return LyricsResponse()
        lines.sort(key=lambda line: line.start_ms or 0)
        return LyricsResponse(synced=True, lines=lines, attribution=attribution)

    if isinstance(body, str) and body.strip():
        lines = [LyricLine(text=text) for text in body.strip("\n").splitlines()]
        return LyricsResponse(lines=lines, attribution=attribution)

    return LyricsResponse()


def _timed_line(item: object) -> LyricLine | None:
    if isinstance(item, dict):
        text, start = item.get("text"), item.get("start_time")
    else:
        text, start = getattr(item, "text", None), getattr(item, "start_time", None)

    if not isinstance(text, str) or isinstance(start, bool) or not isinstance(start, int):
        return None
    return LyricLine(text=text, start_ms=max(0, start))
