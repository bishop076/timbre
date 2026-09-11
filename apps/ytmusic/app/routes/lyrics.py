"""Lyrics route — what YouTube Music shows in its Lyrics tab.

Unauthenticated, like the rest of this service. Two upstream calls at least:
the watch playlist names the lyrics page (`MPLYt…`) for an upload, and that
page holds the words. Only art tracks have a page, so when the web app knows of
none that does, a songs search finds the art track first (see `LyricsRequest`).
All of it happens here so the web app spends one round trip.

**Why a client slot and a lock of its own.** Timed lines come only from YouTube
Music's Android client, which ytmusicapi reaches by rewriting the client's
request context *in place* for the length of the call (`as_mobile()`, which its
own docstring marks "Not thread-safe!"). FastAPI runs these handlers in a
threadpool, so on the shared default client a search running alongside would go
out dressed as the Android app. Lyrics therefore get the `lyrics` slot, and a
lock so two lyrics lookups cannot interleave on it either. The lock covers only
the lyrics page; the watch playlist uses the default client, as `/radio` does.

`def` rather than `async def`, for the same reason as `search.py`: ytmusicapi
blocks, and FastAPI runs sync handlers in a threadpool.
"""

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

_LYRICS_SLOT = "lyrics"
_mobile_lock = threading.Lock()


@router.post("/lyrics", response_model=LyricsResponse)
def lyrics(request: LyricsRequest) -> LyricsResponse:
    browse_id = lyrics_page(request.video_ids)
    if browse_id is None and request.title and request.artist:
        art_track = find_art_track(request.title, request.artist)
        if art_track is not None:
            browse_id = lyrics_page([art_track])

    # No page anywhere means YouTube Music has no words for this song. That is
    # an answer, not a failure.
    if browse_id is None:
        return LyricsResponse()
    return to_lyrics(_fetch_lyrics(browse_id))


def lyrics_page(video_ids: list[str]) -> str | None:
    """The lyrics page of the first upload that has one, in the order given.

    Stops at the first hit: the uploads are one song, so a second page would be
    the same words at the cost of another call. Repeats are asked once.
    """
    for video_id in dict.fromkeys(video_ids):
        try:
            # `limit` is a minimum and one page is the least a watch playlist
            # costs, so asking for one track is the cheapest possible answer.
            watch = get_client().get_watch_playlist(videoId=video_id, limit=1)
        except Exception as error:  # any upstream failure is a 502
            raise upstream_error("lyrics", error) from error

        browse_id = watch.get("lyrics") if isinstance(watch, dict) else None
        if isinstance(browse_id, str) and browse_id:
            return browse_id
    return None


def find_art_track(title: str, artist: str) -> str | None:
    """The art track of this title by this artist, or None.

    A songs search returns art tracks, and its top result was the right one for
    every song measured — but "top result" is a guess, and a wrong guess shows
    another song's words with a licensor's credit on them. So a result counts
    only when its title and one of its artists both match, after the asides
    that differ between copies of one song ("(Remastered)", "- Live") are set
    aside. No match is no lyrics, which is the honest answer.
    """
    try:
        results = get_client().search(f"{title} {artist}", filter="songs", limit=5)
    except Exception as error:  # any upstream failure is a 502
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


# Bracketed asides, a trailing " - …" such as " - Remastered 2009", and an
# unbracketed guest credit ("Song ft. Someone"), which art tracks put in
# brackets and uploads often do not. "with" is deliberately not one: it starts
# too many real titles.
_ASIDES = re.compile(
    r"\s*[(\[][^)\]]*[)\]]|\s+-\s+.*$|\s+(?:feat\.?|ft\.|featuring)\s.*$", re.IGNORECASE
)


def _match_key(text: str) -> str:
    """Case, punctuation and asides removed, and "&" read as "and", so two
    credits of one song compare equal. Letters in any script survive, so a
    non-Latin title still matches."""
    spelled = _ASIDES.sub("", text).casefold().replace("&", "and")
    return "".join(char for char in spelled if char.isalnum())


def _fetch_lyrics(browse_id: str) -> object:
    """The lyrics page, timed if YouTube Music has timings, plain if not.

    Timings are a bonus, and the plain page is the one that must work. The
    Android context ytmusicapi borrows is a hard-coded client version YouTube
    can retire at any time; if that request fails outright, falling through to
    the web page keeps the words rather than 502ing every lookup until
    ytmusicapi catches up. Asked for timings, ytmusicapi also reads the words
    out of the Android page, and a song that was never timed can come back
    empty from it — the tab existed, so the words do, and the web page is the
    second place to look.
    """
    with _mobile_lock:
        client = get_client(_LYRICS_SLOT)
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
    """Flattens `get_lyrics`' two shapes into one.

    Timed lyrics are a list of ytmusicapi `LyricLine` dataclasses; plain lyrics
    are one string. Plain text is split into lines with the blanks kept — they
    are the stanza breaks, and the web app joins the lines back into the same
    text.
    """
    if not isinstance(raw, dict):
        return LyricsResponse()

    source = raw.get("source")
    attribution = source.strip() if isinstance(source, str) and source.strip() else None
    body = raw.get("lyrics")

    if raw.get("hasTimestamps") and isinstance(body, list):
        lines = [line for line in (_timed_line(item) for item in body) if line is not None]
        if lines:
            # Sorted rather than trusted: the web app finds the current line by
            # binary search, which silently lands wrong on an unordered list.
            lines.sort(key=lambda line: line.start_ms or 0)
            return LyricsResponse(synced=True, lines=lines, attribution=attribution)
        return LyricsResponse()

    if isinstance(body, str) and body.strip():
        return LyricsResponse(
            lines=[LyricLine(text=text) for text in body.strip("\n").splitlines()],
            attribution=attribution,
        )

    return LyricsResponse()


def _timed_line(item: object) -> LyricLine | None:
    """One timed line, from ytmusicapi's dataclass or a dict of the same fields.

    A line without a usable start time is dropped rather than guessed at: placed
    anywhere, it would pull the highlight to the wrong moment.
    """
    if isinstance(item, dict):
        text, start = item.get("text"), item.get("start_time")
    else:
        text, start = getattr(item, "text", None), getattr(item, "start_time", None)

    # `bool` is an `int` to Python, and True is not one millisecond.
    if not isinstance(text, str) or isinstance(start, bool) or not isinstance(start, int):
        return None
    return LyricLine(text=text, start_ms=max(0, start))
