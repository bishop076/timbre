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

_EMBED_RANK = {
    "MUSIC_VIDEO_TYPE_OMV": 0,
    "MUSIC_VIDEO_TYPE_OFFICIAL_SOURCE_MUSIC": 0,
    "MUSIC_VIDEO_TYPE_UGC": 1,
    "MUSIC_VIDEO_TYPE_ATV": 3,
    "MUSIC_VIDEO_TYPE_PODCAST_EPISODE": 4,
    "MUSIC_VIDEO_TYPE_SHOULDER": 4,
}
_EMBED_RANK_UNKNOWN = 2


def _embed_rank(track: Track) -> int:
    return _EMBED_RANK.get(track.video_type or "", _EMBED_RANK_UNKNOWN)


def _search_videos(query: str, limit: int) -> list | None:
    try:
        return get_client("videos").search(query, filter="videos", limit=limit)
    except Exception as error:  # noqa: BLE001
        logger.info("video search failed, returning songs only: %s", error)
        return None


@router.post("/search", response_model=SearchResponse)
def search(request: SearchRequest) -> SearchResponse:
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending_videos = pool.submit(_search_videos, request.query, request.limit)

        try:
            results = get_client().search(
                request.query,
                filter="songs",
                limit=request.limit,
            )
        except Exception as error:
            raise upstream_error("search", error) from error

        tracks = to_tracks(results)
        videos = pending_videos.result()

    if videos is not None:
        seen = {track.video_id for track in tracks}
        for track in to_tracks(videos):
            if track.video_id not in seen:
                seen.add(track.video_id)
                tracks.append(track)

    tracks.sort(key=_embed_rank)

    return SearchResponse(items=tracks[: request.limit])


def extract_video_id(raw: str) -> str | None:
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
    except Exception as error:
        raise upstream_error("lookup", error) from error

    details = song.get("videoDetails") if isinstance(song, dict) else None
    if not isinstance(details, dict):
        return ResolveResponse(track=None)

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
