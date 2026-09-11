import logging

from fastapi import APIRouter

from ..client import get_client
from ..errors import upstream_error
from ..models import RadioRequest, RadioResponse, Track
from ..normalize import to_related_track, to_tracks, to_watch_track

logger = logging.getLogger(__name__)

router = APIRouter()


def continuation(tracks: list[Track], seed: str, limit: int) -> list[Track]:
    seen = {seed}
    kept: list[Track] = []
    for track in tracks:
        if track.video_id in seen:
            continue
        seen.add(track.video_id)
        kept.append(track)
        if len(kept) >= limit:
            break
    return kept


def _songs_from_sections(sections: object) -> list[Track]:
    if not isinstance(sections, list):
        return []
    for section in sections:
        title = section.get("title") if isinstance(section, dict) else None
        if isinstance(title, str) and title.strip().lower() == "you might also like":
            return to_tracks(section.get("contents"), to_related_track)
    return []


@router.post("/radio", response_model=RadioResponse)
def radio(request: RadioRequest) -> RadioResponse:
    try:
        watch = get_client().get_watch_playlist(
            videoId=request.video_id, limit=min(request.limit + 1, 50)
        )
    except Exception as error:
        raise upstream_error("radio", error) from error

    if not isinstance(watch, dict):
        return RadioResponse(radio=[], related=[])

    tracks = to_tracks(watch.get("tracks"), to_watch_track)
    related: list[Track] = []
    browse_id = watch.get("related")
    if isinstance(browse_id, str) and browse_id:
        try:
            sections = get_client().get_song_related(browse_id)
        except Exception as error:  # noqa: BLE001
            logger.info("related lookup failed, returning radio only: %s", error)
        else:
            related = _songs_from_sections(sections)

    return RadioResponse(
        radio=continuation(tracks, request.video_id, request.limit),
        related=continuation(related, request.video_id, request.limit),
    )
