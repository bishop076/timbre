"""Search and resolve routes.

Both are **unauthenticated** against YouTube Music — nobody logs into anything,
so there are no per-user credentials in this service at all.

Endpoints are declared with `def` rather than `async def` on purpose:
`ytmusicapi` is blocking, and FastAPI runs sync handlers in a threadpool. An
`async def` here would stall the event loop for every concurrent request.
"""

import logging
import re
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import parse_qs, urlparse

from fastapi import APIRouter, HTTPException, status

from ..client import get_client
from ..errors import upstream_error
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

# Lower sorts first. Official music videos were never barred in testing; art
# tracks were the only class that was. Anything whose type is missing or
# unrecognised sits between the two rather than being trusted or punished.
_EMBED_RANK = {
    "MUSIC_VIDEO_TYPE_OMV": 0,  # official music video
    "MUSIC_VIDEO_TYPE_UGC": 1,  # user upload
    "MUSIC_VIDEO_TYPE_ATV": 3,  # auto-generated Topic art track — barred ~7%
}
_EMBED_RANK_UNKNOWN = 2


def _embed_rank(track: Track) -> int:
    return _EMBED_RANK.get(track.video_type or "", _EMBED_RANK_UNKNOWN)


def _search_videos(query: str, limit: int) -> list | None:
    """The video-filter half of a search, or None if it failed.

    Failure is logged and swallowed rather than raised: songs-only is a
    degraded but perfectly usable answer, and it is what this endpoint returned
    before the video search existed at all.
    """
    try:
        return get_client("videos").search(query, filter="videos", limit=limit)
    except Exception as error:  # noqa: BLE001
        logger.info("video search failed, returning songs only: %s", error)
        return None


@router.post("/search", response_model=SearchResponse)
def search(request: SearchRequest) -> SearchResponse:
    # **Always** search videos as well, never conditionally.
    #
    # `filter="songs"` returns art tracks (MUSIC_VIDEO_TYPE_ATV) essentially
    # exclusively, and art tracks are the class rights holders bar from
    # embedding. `filter="videos"` is where the official music videos
    # (MUSIC_VIDEO_TYPE_OMV) and user uploads (UGC) live, and those are the
    # copies that actually play.
    #
    # This used to run only when the songs filter came back thin — but it
    # almost never does, so in practice every candidate handed to the client
    # was an art track and the client's fall-through had nothing better to try.
    #
    # **At the same time as the songs search, not after it.** Measured warm,
    # each of these is about 1.4s against YouTube, and they were sequential —
    # so making the video search unconditional (correctly) also made every
    # search take the *sum* of two round trips, about 2.8s, for two requests
    # that share no data and neither of which depends on the other's result.
    # Run together the endpoint costs the slower of the two instead. Each gets
    # its own client, because they would otherwise share one `requests.Session`
    # — see `get_client`.
    #
    # One extra thread, not two: the songs search runs on the request's own
    # thread, which is already in FastAPI's threadpool and would otherwise be
    # sitting idle waiting for the other one.
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending_videos = pool.submit(_search_videos, request.query, request.limit)

        try:
            results = get_client().search(
                request.query,
                filter="songs",
                limit=request.limit,
            )
        except Exception as error:  # any upstream failure is a 502
            # Leaving the block waits for the video search to finish before this
            # propagates, which costs a failed search up to one extra round trip.
            # Deliberately not worked around: cancelling a future that has
            # already started does nothing, and racing `cancel()` against a
            # submit that has *not* started yet is how `result()` below ends up
            # raising CancelledError on the success path instead. A slower error
            # is worth more than a subtle one.
            raise upstream_error("search", error) from error

        tracks = to_tracks(results)
        # Never raises: `_search_videos` turns its own failures into None.
        videos = pending_videos.result()

    if videos is not None:
        seen = {track.video_id for track in tracks}
        for track in to_tracks(videos):
            if track.video_id not in seen:
                seen.add(track.video_id)
                tracks.append(track)

    # Order by how likely the copy is to play in an embed, best first.
    #
    # Measured Aug 2026 over 64 uploads across 15 chart songs, in a real browser
    # driving the IFrame API (the only way to know — a barred upload still
    # answers oEmbed 200 and reports playableInEmbed:true, so this genuinely
    # cannot be determined server-side):
    #
    #     art tracks (ATV)        45 tested, 3 barred with error 150   ~7%
    #     official videos (OMV)   19 tested, 0 barred                   0%
    #
    # Ranking also decides what survives the `limit` truncation below, so
    # without it the video results would be appended and then cut straight off
    # again. The client's fall-through remains the real remedy; this just makes
    # the first attempt the one most likely to succeed.
    tracks.sort(key=_embed_rank)

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
    except Exception as error:  # any upstream failure is a 502
        raise upstream_error("lookup", error) from error

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
