import importlib
import sys

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from ytmusicapi.models.lyrics import LyricLine as UpstreamLine

from app.models import LyricsRequest
from app.routes import lyrics as route

VIDEO, OTHER, THIRD = "aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"
BROWSE = "MPLYt_placeholder"
CREDIT = "Source: Placeholder Licensing"
EMPTY = {"source": "ytmusic", "synced": False, "lines": [], "attribution": None}


class FakeClient:
    def __init__(self):
        self.tabs: dict[str, str | None] = {VIDEO: BROWSE}
        self.songs: list[dict] = []
        self.timed = None
        self.plain = None
        self.errors: dict[str, Exception] = {}
        self.searched: list[str] = []
        self.watched: list[str] = []
        self.calls: list[tuple[str, bool]] = []

    def _fail(self, name: str) -> None:
        if name in self.errors:
            raise self.errors[name]

    def search(self, query: str, filter: str, limit: int):
        assert filter == "songs", "only a songs search returns art tracks"
        self.searched.append(query)
        self._fail("search")
        return self.songs

    def get_watch_playlist(self, videoId: str, limit: int):
        self.watched.append(videoId)
        self._fail(f"watch:{videoId}")
        self._fail("watch")
        return {"tracks": [], "lyrics": self.tabs.get(videoId)}

    def get_lyrics(self, browseId: str, timestamps: bool = False):
        self.calls.append((browseId, timestamps))
        self._fail("timed" if timestamps else "plain")
        return self.timed if timestamps else self.plain


@pytest.fixture
def client(monkeypatch):
    fake = FakeClient()
    monkeypatch.setattr(route, "get_client", lambda slot="default": fake)
    return fake


def timed(*pairs: tuple[str, int]) -> dict:
    lines = [
        UpstreamLine(text, start, start + 1000, index) for index, (text, start) in enumerate(pairs)
    ]
    return {"lyrics": lines, "source": CREDIT, "hasTimestamps": True}


def ask(*video_ids: str, title: str | None = None, artist: str | None = None) -> dict:
    request = LyricsRequest(video_ids=list(video_ids), title=title, artist=artist)
    return route.lyrics(request).model_dump()


def texts(answer: dict) -> list[str]:
    return [line["text"] for line in answer["lines"]]


def song(video_id: str, title: str, *artists: str) -> dict:
    return {
        "resultType": "song",
        "videoId": video_id,
        "title": title,
        "artists": [{"name": name} for name in artists],
        "videoType": "MUSIC_VIDEO_TYPE_ATV",
    }


def test_timed_lines_come_back_in_milliseconds_with_the_credit(client) -> None:
    client.timed = timed(("line one", 1200), ("line two", 3400))
    answer = ask(VIDEO)
    assert answer["synced"] is True
    assert answer["source"] == "ytmusic"
    assert answer["attribution"] == CREDIT
    assert [line["start_ms"] for line in answer["lines"]] == [1200, 3400]
    assert texts(answer) == ["line one", "line two"]


def test_timed_lines_are_sorted_rather_than_trusted(client) -> None:
    client.timed = timed(("la", 5000), ("la la", 1000))
    assert [line["start_ms"] for line in ask(VIDEO)["lines"]] == [1000, 5000]


def test_plain_lyrics_split_into_untimed_lines_with_stanza_breaks(client) -> None:
    client.timed = {
        "lyrics": "line one\nline two\n\nline three\n",
        "source": CREDIT,
        "hasTimestamps": False,
    }
    answer = ask(VIDEO)
    assert answer["synced"] is False
    assert texts(answer) == ["line one", "line two", "", "line three"]
    assert all(line["start_ms"] is None for line in answer["lines"])
    assert answer["attribution"] == CREDIT


@pytest.mark.parametrize(
    ("page", "expected"),
    [
        (timed(("line one", 1000), ("", 4000), ("line two", 9000)), ["line one", "", "line two"]),
        (
            {
                "lyrics": [
                    {"text": "line one", "start_time": 1000},
                    {"text": "no time", "start_time": None},
                    {"text": "a bool is not a time", "start_time": True},
                ],
                "source": CREDIT,
                "hasTimestamps": True,
            },
            ["line one"],
        ),
        ({"lyrics": "  \n\n ", "source": CREDIT, "hasTimestamps": False}, []),
        (None, []),
    ],
    ids=[
        "a blank timed line keeps its slot",
        "a timed line without a usable start is dropped",
        "whitespace-only plain lyrics are empty",
        "a tab with nothing behind it is empty",
    ],
)
def test_lines_read_from_the_lyrics_page(client, page, expected) -> None:
    client.timed = page
    assert texts(ask(VIDEO)) == expected


@pytest.mark.parametrize(
    "errors",
    [{}, {"timed": RuntimeError("client version retired")}],
    ids=["an empty timed answer", "a failed timed request"],
)
def test_the_plain_page_is_the_fallback(client, errors) -> None:
    client.plain = {"lyrics": "la la", "source": None, "hasTimestamps": False}
    client.errors = errors
    answer = ask(VIDEO)
    assert texts(answer) == ["la la"]
    assert answer["attribution"] is None
    assert client.calls == [(BROWSE, True), (BROWSE, False)]


def test_no_lyrics_tab_is_an_empty_answer_without_a_second_call(client) -> None:
    client.tabs = {}
    assert ask(VIDEO) == EMPTY
    assert client.calls == []


@pytest.mark.parametrize(
    ("tabs", "asked", "watched", "calls"),
    [
        ({OTHER: None, THIRD: BROWSE}, [OTHER, THIRD], [OTHER, THIRD], [(BROWSE, True)]),
        ({OTHER: BROWSE, THIRD: "MPLYt_other"}, [OTHER, THIRD], [OTHER], [(BROWSE, True)]),
        ({}, [OTHER, OTHER, THIRD], [OTHER, THIRD], []),
    ],
    ids=[
        "an upload without a tab gives way to the next",
        "the first upload with a tab ends the search",
        "a repeat is asked once, and no tab anywhere is no lyrics",
    ],
)
def test_uploads_are_tried_in_order(client, tabs, asked, watched, calls) -> None:
    client.tabs = tabs
    client.timed = timed(("line one", 0))
    assert texts(ask(*asked)) == (["line one"] if calls else [])
    assert client.watched == watched
    assert client.calls == calls


def test_one_failing_upload_does_not_end_the_search(client) -> None:
    """A candidate that fails is skipped, not fatal.

    Each id is handed over precisely so the next can be tried; raising on the first meant one
    region-blocked upload returned 502 and the panel said YouTube Music did not answer, while
    a sibling id had the lyrics.
    """
    client.errors = {f"watch:{OTHER}": RuntimeError("region blocked")}
    client.tabs = {THIRD: BROWSE}
    client.timed = timed(("line one", 0))

    assert texts(ask(OTHER, THIRD)) == ["line one"]
    assert client.watched == [OTHER, THIRD]


def test_every_upload_failing_is_still_an_upstream_failure(client) -> None:
    client.errors = {"watch": RuntimeError("ytmusic is down")}
    with pytest.raises(HTTPException) as raised:
        ask(OTHER, THIRD)
    assert raised.value.status_code == 502
    assert client.watched == [OTHER, THIRD]


@pytest.mark.parametrize(
    "fields",
    [
        {"video_ids": []},
        {"video_ids": [VIDEO] * 4},
        {"video_ids": ["not-an-id"]},
        {"title": "Song Title"},
    ],
)
def test_the_request_is_bounded(fields: dict) -> None:
    with pytest.raises(ValueError):
        LyricsRequest(**fields)


def test_a_title_and_artist_alone_are_enough() -> None:
    assert LyricsRequest(title="Song Title", artist="Artist").video_ids == []


@pytest.mark.parametrize(
    ("title", "artist", "found_title", "found_artists", "matched"),
    [
        ("Song Title", "Artist", "Song Title", ["Artist"], True),
        ("song title", "Artist", "Song Title (Remastered 2009)", ["Other", "ARTIST"], True),
        ("Song (Audio) ft. Guest, Other", "Artist", "Song (feat. Guest)", ["Artist"], True),
        ("This and That", "Artist", "This & That", ["Artist"], True),
        ("Song Title", "Artist", "Song Title - Live at Somewhere", ["Artist"], True),
        ("歌のタイトル", "アーティスト", "歌のタイトル", ["アーティスト"], True),
        ("Song Title", "Artist", "Song Title", ["Somebody Else"], False),
    ],
    ids=[
        "an exact match",
        "asides and case",
        "an unbracketed guest credit",
        "an ampersand for and",
        "a trailing dash aside",
        "a non-latin title",
        "a top result by someone else is not taken",
    ],
)
def test_with_no_known_art_track_a_songs_search_finds_one(
    client, title, artist, found_title, found_artists, matched
) -> None:
    client.tabs = {OTHER: BROWSE}
    client.songs = [song(OTHER, found_title, *found_artists)]
    client.timed = timed(("line one", 0))

    answer = ask(title=title, artist=artist)
    assert client.searched == [f"{title} {artist}"]
    assert client.watched == ([OTHER] if matched else [])
    assert texts(answer) == (["line one"] if matched else [])


def test_a_different_title_by_the_same_artist_is_not_taken(client) -> None:
    client.tabs = {OTHER: BROWSE, THIRD: "MPLYt_second"}
    client.songs = [
        song(OTHER, "Song Title Part Two", "Artist"),
        song(THIRD, "Song Title", "Artist"),
    ]
    client.timed = timed(("line one", 0))
    ask(title="Song Title", artist="Artist")
    assert client.watched == [THIRD], "the first result that matches, not the first"


def test_the_search_is_skipped_when_a_known_upload_has_a_page(client) -> None:
    client.timed = timed(("line one", 0))
    ask(VIDEO, title="Song Title", artist="Artist")
    assert client.searched == []


def test_the_search_follows_known_uploads_without_a_page(client) -> None:
    client.tabs = {VIDEO: None, OTHER: BROWSE}
    client.songs = [song(OTHER, "Song Title", "Artist")]
    client.timed = timed(("line one", 0))
    assert ask(VIDEO, title="Song Title", artist="Artist")["lines"]
    assert client.watched == [VIDEO, OTHER]


@pytest.mark.parametrize(
    ("failing", "tabs"), [("watch", {VIDEO: BROWSE}), ("search", {}), ("plain", {VIDEO: BROWSE})]
)
def test_an_upstream_failure_is_a_502(client, failing, tabs) -> None:
    client.tabs = tabs
    client.errors = {failing: RuntimeError("upstream down")}
    with pytest.raises(HTTPException) as caught:
        ask(VIDEO, title="Song Title", artist="Artist")
    assert caught.value.status_code == 502


def test_lyrics_use_their_own_client_slot(monkeypatch) -> None:
    slots: list[str] = []
    fake = FakeClient()
    fake.timed = timed(("line one", 0))

    def get(slot: str = "default"):
        slots.append(slot)
        return fake

    monkeypatch.setattr(route, "get_client", get)
    ask(VIDEO)
    assert slots == ["default", "lyrics"]


def test_the_route_is_registered_behind_the_shared_secret(monkeypatch, client) -> None:
    secret = "0f2c" * 16
    for name in ("app.main", "app.security", "app.config"):
        monkeypatch.delitem(sys.modules, name, raising=False)
    monkeypatch.setenv("YTMUSIC_SHARED_SECRET", secret)
    app = importlib.import_module("app.main").app

    client.timed = timed(("line one", 0))
    http = TestClient(app)

    body = {"video_ids": [VIDEO]}
    assert http.post("/lyrics", json=body).status_code == 401
    answer = http.post("/lyrics", json=body, headers={"x-timbre-secret": secret})
    assert answer.status_code == 200
    assert answer.json()["synced"] is True
    refused = http.post(
        "/lyrics", json={"video_ids": ["nope"]}, headers={"x-timbre-secret": secret}
    )
    assert refused.status_code == 422
