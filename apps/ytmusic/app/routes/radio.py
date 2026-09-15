import logging

from fastapi import APIRouter

from ..client import get_client
from ..errors import upstream_error
from ..models import RadioRequest, RadioResponse, Track
from ..normalize import to_related_track, to_tracks, to_watch_track

logger = logging.getLogger(__name__)

router = APIRouter()

# YouTube's own heading for the section of individual songs, and the one worth playing first.
# It is not a stable key: it has shipped as both "You might also like" and "Fans might also
# like", and YouTube localises it by exit IP the same way Deezer localises names, so an exact
# match on one English string is a reworded heading away from returning nothing at all.
PREFERRED_SECTION = "might also like"


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
    """Every song `get_song_related` offered, the preferred section first.

    Only the section titled exactly "you might also like" used to count, so a reworded or
    localised heading emptied `related` even though the sections were full of songs. The
    other sections hold playlists and artists, which `to_related_track` drops for having no
    `videoId`, so reading all of them costs nothing and keeps autoplay fed when the heading
    is not the one we expected.
    """
    if not isinstance(sections, list):
        return []

    preferred: list[Track] = []
    rest: list[Track] = []
    for section in sections:
        if not isinstance(section, dict):
            continue
        title = section.get("title")
        songs = to_tracks(section.get("contents"), to_related_track)
        wanted = isinstance(title, str) and PREFERRED_SECTION in title.casefold()
        (preferred if wanted else rest).extend(songs)
    return preferred + rest


def _browse_id(watch: dict) -> str | None:
    found = watch.get("related")
    return found if isinstance(found, str) and found else None


def _mix(video_id: str, limit: int) -> tuple[list[Track], str | None]:
    """The watch playlist for a seed, and the browse id for its related songs.

    `get_watch_playlist` answers with the seed and nothing else often enough — a video with
    no mix yet, a region where the mix is withheld — and the seed is then dropped as a
    duplicate, which left `radio` empty and stopped autoplay dead on that track. Asking again
    with `radio=True` requests the explicit radio mix, which is what the YouTube Music client
    itself plays when the plain watch list runs out. That second call only happens when the
    first came back quickly with nothing, and a failure in it is not worth a 502 while
    `related` may still hold something playable.
    """
    watch = get_client().get_watch_playlist(videoId=video_id, limit=limit)
    if not isinstance(watch, dict):
        # An empty 200 reads downstream as "this song has no radio" and is cached as such. A
        # shape we cannot parse is an upstream fault, and 502 is what the web app retries.
        raise TypeError(f"expected a dict from get_watch_playlist, got {type(watch).__name__}")

    tracks = to_tracks(watch.get("tracks"), to_watch_track)
    browse_id = _browse_id(watch)
    if any(track.video_id != video_id for track in tracks):
        return tracks, browse_id

    logger.info("watch playlist for %s held only the seed; asking for the radio mix", video_id)
    try:
        mix = get_client().get_watch_playlist(videoId=video_id, limit=limit, radio=True)
    except Exception as error:  # noqa: BLE001
        logger.info("radio mix for %s failed, falling back to related: %s", video_id, error)
        return tracks, browse_id

    if isinstance(mix, dict):
        tracks = to_tracks(mix.get("tracks"), to_watch_track) or tracks
        browse_id = browse_id or _browse_id(mix)
    return tracks, browse_id


def _related(browse_id: str | None) -> list[Track]:
    if browse_id is None:
        return []
    try:
        sections = get_client().get_song_related(browse_id)
    except Exception as error:  # noqa: BLE001
        logger.info("related lookup failed, returning radio only: %s", error)
        return []
    return _songs_from_sections(sections)


@router.post("/radio", response_model=RadioResponse)
def radio(request: RadioRequest) -> RadioResponse:
    # One more than asked for: the watch playlist leads with the seed, which `continuation`
    # drops. Capping that at 50 meant a request for 50 could only ever come back with 49.
    try:
        tracks, browse_id = _mix(request.video_id, request.limit + 1)
    except Exception as error:
        raise upstream_error("radio", error) from error

    related = continuation(_related(browse_id), request.video_id, request.limit)
    playable = continuation(tracks, request.video_id, request.limit)

    if not playable:
        # Hand the caller one usable list rather than two empty ones. Moved, not copied: the
        # web app scores a song higher for appearing in several lists, and the same tracks
        # listed twice would invent a consensus that never happened.
        logger.info("no radio for %s; promoting %d related songs", request.video_id, len(related))
        playable, related = related, []

    return RadioResponse(radio=playable, related=related)
