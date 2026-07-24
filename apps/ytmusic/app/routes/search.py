"""Search and resolve routes.

Both are **unauthenticated** against YouTube Music — nobody logs into anything,
so there are no per-user credentials in this service at all.

Endpoints are declared with `def` rather than `async def` on purpose:
`ytmusicapi` is blocking, and FastAPI runs sync handlers in a threadpool. An
`async def` here would stall the event loop for every concurrent request.
"""

import logging
import re
from urllib.parse import parse_qs, urlparse

from fastapi import APIRouter, HTTPException, status

from ..client import get_client
from ..models import (
    ResolveRequest,
    ResolveResponse,
    SearchRequest,
    SearchResponse,
    Track,
)
from ..normalize import to_track, to_tracks

logger = logging.getLogger(__name__)

router = APIRouter()

VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")


def _upstream_error(action: str, error: Exception) -> HTTPException:
    """ytmusicapi rides YouTube's private API, so failures are upstream
    problems rather than bad requests. 502 tells the caller to retry or fall
    back to another source rather than to fix its input."""
    logger.warning("ytmusicapi %s failed: %s", action, error, exc_info=error)
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=f"YouTube Music {action} failed.",
    )


@router.post("/search", response_model=SearchResponse)
def search(request: SearchRequest) -> SearchResponse:
    try:
        results = get_client().search(
            request.query,
            filter="songs",
            limit=request.limit,
        )
    except Exception as error:  # noqa: BLE001 — any upstream failure is a 502
        raise _upstream_error("search", error) from error

    tracks = to_tracks(results)

    # The "songs" filter misses videos, which is where remixes, live sets and
    # unofficial uploads live — often the only copy that exists anywhere. Top
    # up from an unfiltered search when the filtered one is thin.
    if len(tracks) < request.limit:
        try:
            extra = get_client().search(request.query, limit=request.limit)
        except Exception as error:  # noqa: BLE001
            logger.info("supplementary search failed, returning songs only: %s", error)
        else:
            seen = {track.video_id for track in tracks}
            for track in to_tracks(extra):
                if track.video_id not in seen:
                    seen.add(track.video_id)
                    tracks.append(track)

    return SearchResponse(items=tracks[: request.limit])


def extract_video_id(raw: str) -> str | None:
    """Pulls a video id out of a YouTube or YouTube Music URL, or accepts a
    bare id. Returns None if there is nothing that looks like one."""
    candidate = raw.strip()
    if VIDEO_ID.match(candidate):
        return candidate

    try:
        parsed = urlparse(candidate)
    except ValueError:
        return None

    host = (parsed.hostname or "").removeprefix("www.")

    if host == "youtu.be":
        segment = parsed.path.lstrip("/").split("/")[0]
        return segment if VIDEO_ID.match(segment) else None

    if host in {"youtube.com", "music.youtube.com", "m.youtube.com"}:
        values = parse_qs(parsed.query).get("v")
        if values and VIDEO_ID.match(values[0]):
            return values[0]
        # /embed/<id> and /shorts/<id>
        segments = [segment for segment in parsed.path.split("/") if segment]
        if len(segments) >= 2 and segments[0] in {"embed", "shorts", "v"}:
            return segments[1] if VIDEO_ID.match(segments[1]) else None

    return None


@router.post("/resolve", response_model=ResolveResponse)
def resolve(request: ResolveRequest) -> ResolveResponse:
    video_id = extract_video_id(request.url)
    if video_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Not a recognisable YouTube or YouTube Music URL.",
        )

    try:
        song = get_client().get_song(video_id)
    except Exception as error:  # noqa: BLE001
        raise _upstream_error("lookup", error) from error

    details = song.get("videoDetails") if isinstance(song, dict) else None
    if not isinstance(details, dict):
        return ResolveResponse(track=None)

    # `get_song` also returns `streamingData` containing signed audio URLs.
    # Those are deliberately never read or forwarded: Timbre embeds players, it
    # does not extract streams. Only videoDetails is touched.
    length = details.get("lengthSeconds")
    author = details.get("author")

    track = to_track(
        {
            "resultType": "song",
            "videoId": details.get("videoId", video_id),
            "title": details.get("title"),
            "artists": [{"name": author}] if isinstance(author, str) else [],
            "duration_seconds": int(length) if isinstance(length, str) and length.isdigit() else None,
            "thumbnails": (details.get("thumbnail") or {}).get("thumbnails"),
        }
    )
    return ResolveResponse(track=track)
