import logging

from fastapi import APIRouter

from ..client import get_client
from ..errors import upstream_error
from ..models import RadioRequest, RadioResponse, Track
from ..normalize import to_related_tracks, to_watch_tracks

logger = logging.getLogger(__name__)

router = APIRouter()

_SONGS_SECTION = "You might also like"


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


@router.post("/radio", response_model=RadioResponse)
def radio(request: RadioRequest) -> RadioResponse:
    try:
        watch = get_client().get_watch_playlist(
            videoId=request.video_id,
            limit=min(request.limit + 1, 50),
        )
    except Exception as error:
        raise upstream_error("radio", error) from error

    if not isinstance(watch, dict):
        return RadioResponse(radio=[], related=[])

    queue = continuation(to_watch_tracks(watch.get("tracks")), request.video_id, request.limit)

    related: list[Track] = []
    browse_id = watch.get("related")
    if isinstance(browse_id, str) and browse_id:
        try:
            sections = get_client().get_song_related(browse_id)
        except Exception as error:  # noqa: BLE001
            logger.info("related lookup failed, returning radio only: %s", error)
        else:
            related = continuation(
                _songs_from_sections(sections), request.video_id, request.limit
            )

    return RadioResponse(radio=queue, related=related)


def _songs_from_sections(sections: object) -> list[Track]:
    if not isinstance(sections, list):
        return []

    for section in sections:
        if not isinstance(section, dict):
            continue
        title = section.get("title")
        if isinstance(title, str) and title.strip().lower() == _SONGS_SECTION.lower():
            return to_related_tracks(section.get("contents"))
    return []
