"""Radio route — what YouTube Music plays after a track.

Unauthenticated, like the rest of this service. `get_watch_playlist` is the
queue YouTube would play next; the `related` browseId it returns unlocks the
watch panel's "You might also like", which is derived differently. Both are
fetched here so the web app spends **one** round trip on the sidecar rather
than two, and they are returned separately because the ranker upstream scores
agreement between independent lists.

`def` rather than `async def`, for the same reason as `search.py`: ytmusicapi
blocks, and FastAPI runs sync handlers in a threadpool.
"""

import logging

from fastapi import APIRouter

from ..client import get_client
from ..errors import upstream_error
from ..models import RadioRequest, RadioResponse, Track
from ..normalize import to_related_tracks, to_watch_tracks

logger = logging.getLogger(__name__)

router = APIRouter()

# The section of `get_song_related` that holds songs. The others hold playlists,
# artists and albums, which `Track` cannot carry and the app has nowhere to put.
_SONGS_SECTION = "You might also like"


def continuation(tracks: list[Track], seed: str, limit: int) -> list[Track]:
    """Everything after the seed, in YouTube's order, each song once.

    The seed is dropped **by id rather than by position**. It arrives first
    today, but ytmusicapi documents no ordering guarantee, and a seed left in
    place replays the song that just finished. Radios also repeat themselves,
    and a repeat inside a single continuation reads as a stutter rather than
    as a recommendation.
    """
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
            # One more than asked for, since the seed itself occupies a slot.
            limit=request.limit + 1,
        )
    except Exception as error:  # noqa: BLE001 — any upstream failure is a 502
        raise upstream_error("radio", error) from error

    if not isinstance(watch, dict):
        return RadioResponse(radio=[], related=[])

    # Deliberately **not** sorted by embed rank. Unlike search, where ranking
    # decides which copy of one song to try first, here the order *is* the
    # recommendation — it is the only thing YouTube contributed. Demoting art
    # tracks happens in the ranker, where it is one term among several rather
    # than a wholesale reordering.
    queue = continuation(to_watch_tracks(watch.get("tracks")), request.video_id, request.limit)

    # A second, independently-derived list. Failing to get it is not worth
    # failing the request: the radio alone is still a useful answer, and the
    # ranker treats a missing list as an abstention rather than as evidence.
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
    """Pulls the song section out of `get_song_related`'s mixed content.

    Sections are heterogeneous and titled in the user's language, so the title
    is matched leniently and anything without a `videoId` falls out during
    flattening anyway. If YouTube renames the section, this returns nothing and
    the radio list carries the request — a quiet degradation rather than a 502.
    """
    if not isinstance(sections, list):
        return []

    for section in sections:
        if not isinstance(section, dict):
            continue
        title = section.get("title")
        if isinstance(title, str) and title.strip().lower() == _SONGS_SECTION.lower():
            return to_related_tracks(section.get("contents"))
    return []
