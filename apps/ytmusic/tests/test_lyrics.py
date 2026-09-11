import importlib
import sys

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from ytmusicapi.models.lyrics import LyricLine as UpstreamLine

from app.models import LyricsRequest
from app.routes import lyrics as route

VIDEO = "aaaaaaaaaaa"
BROWSE = "MPLYt_placeholder"
CREDIT = "Source: Placeholder Licensing"


class FakeClient:
    def __init__(self, watch=None, timed=None, plain=None, timed_error=None, plain_error=None):
        self.watch = {"tracks": [], "lyrics": BROWSE} if watch is None else watch
        self.timed = timed
        self.plain = plain
        self.timed_error = timed_error
        self.plain_error = plain_error
        self.tabs: dict[str, str | None] | None = None
        self.songs: list[dict] = []
        self.search_error: Exception | None = None
        self.searched: list[str] = []
        self.watched: list[str] = []
        self.calls: list[tuple[str, bool]] = []

    def search(self, query: str, filter: str, limit: int):
        assert filter == "songs", "only a songs search returns art tracks"
        self.searched.append(query)
        if self.search_error:
            raise self.search_error
        return self.songs

    def get_watch_playlist(self, videoId: str, limit: int):
        self.watched.append(videoId)
        if self.tabs is not None:
            return {"tracks": [], "lyrics": self.tabs.get(videoId)}
        return self.watch

    def get_lyrics(self, browseId: str, timestamps: bool = False):
        self.calls.append((browseId, timestamps))
        if timestamps:
            if self.timed_error:
                raise self.timed_error
            return self.timed
        if self.plain_error:
            raise self.plain_error
        return self.plain


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


def ask(*video_ids: str) -> dict:
    return route.lyrics(LyricsRequest(video_ids=list(video_ids or (VIDEO,)))).model_dump()


def ask_by_name(title: str, artist: str, *video_ids: str) -> dict:
    request = LyricsRequest(video_ids=list(video_ids), title=title, artist=artist)
    return route.lyrics(request).model_dump()


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
    answer = ask()
    assert answer["synced"] is True
    assert answer["source"] == "ytmusic"
    assert answer["attribution"] == CREDIT
    assert [line["start_ms"] for line in answer["lines"]] == [1200, 3400]
    assert [line["text"] for line in answer["lines"]] == ["line one", "line two"]


def test_timed_lines_are_sorted_rather_than_trusted(client) -> None:
    client.timed = timed(("la", 5000), ("la la", 1000))
    assert [line["start_ms"] for line in ask()["lines"]] == [1000, 5000]


def test_a_blank_timed_line_keeps_its_slot(client) -> None:
    client.timed = timed(("line one", 1000), ("", 4000), ("line two", 9000))
    assert [line["text"] for line in ask()["lines"]] == ["line one", "", "line two"]


def test_a_timed_line_without_a_usable_start_is_dropped(client) -> None:
    client.timed = {
        "lyrics": [
            {"text": "line one", "start_time": 1000},
            {"text": "no time", "start_time": None},
            {"text": "a bool is not a time", "start_time": True},
        ],
        "source": CREDIT,
        "hasTimestamps": True,
    }
    assert [line["text"] for line in ask()["lines"]] == ["line one"]


def test_plain_lyrics_split_into_untimed_lines_with_stanza_breaks(client) -> None:
    client.timed = {
        "lyrics": "line one\nline two\n\nline three\n",
        "source": CREDIT,
        "hasTimestamps": False,
    }
    answer = ask()
    assert answer["synced"] is False
    assert [line["text"] for line in answer["lines"]] == ["line one", "line two", "", "line three"]
    assert all(line["start_ms"] is None for line in answer["lines"])
    assert answer["attribution"] == CREDIT


def test_an_empty_timed_answer_falls_back_to_the_plain_page(client) -> None:
    client.timed = None
    client.plain = {"lyrics": "la la", "source": CREDIT, "hasTimestamps": False}
    answer = ask()
    assert [line["text"] for line in answer["lines"]] == ["la la"]
    assert client.calls == [(BROWSE, True), (BROWSE, False)]


def test_a_failed_timed_request_falls_back_to_the_plain_page(client) -> None:
    client.timed_error = RuntimeError("client version retired")
    client.plain = {"lyrics": "la la", "source": None, "hasTimestamps": False}
    answer = ask()
    assert [line["text"] for line in answer["lines"]] == ["la la"]
    assert answer["attribution"] is None


def test_no_lyrics_tab_is_an_empty_answer_without_a_second_call(client) -> None:
    client.watch = {"tracks": [], "lyrics": None}
    answer = ask()
    assert answer == {"source": "ytmusic", "synced": False, "lines": [], "attribution": None}
    assert client.calls == []


def test_an_upload_without_a_tab_gives_way_to_the_next(client) -> None:
    client.tabs = {"bbbbbbbbbbb": None, "ccccccccccc": BROWSE}
    client.timed = timed(("line one", 0))
    assert ask("bbbbbbbbbbb", "ccccccccccc")["lines"][0]["text"] == "line one"
    assert client.watched == ["bbbbbbbbbbb", "ccccccccccc"]


def test_the_first_upload_with_a_tab_ends_the_search(client) -> None:
    client.tabs = {"bbbbbbbbbbb": BROWSE, "ccccccccccc": "MPLYt_other"}
    client.timed = timed(("line one", 0))
    ask("bbbbbbbbbbb", "ccccccccccc")
    assert client.watched == ["bbbbbbbbbbb"]
    assert client.calls == [(BROWSE, True)]


def test_a_repeated_upload_is_asked_about_once(client) -> None:
    client.tabs = {}
    ask("bbbbbbbbbbb", "bbbbbbbbbbb", "ccccccccccc")
    assert client.watched == ["bbbbbbbbbbb", "ccccccccccc"]


def test_no_upload_with_a_tab_is_an_empty_answer(client) -> None:
    client.tabs = {}
    assert ask("bbbbbbbbbbb", "ccccccccccc")["lines"] == []
    assert client.calls == []


def test_the_request_is_bounded() -> None:
    with pytest.raises(ValueError):
        LyricsRequest(video_ids=[])
    with pytest.raises(ValueError):
        LyricsRequest(video_ids=["aaaaaaaaaaa"] * 4)
    with pytest.raises(ValueError):
        LyricsRequest(video_ids=["not-an-id"])
    with pytest.raises(ValueError):
        LyricsRequest(title="Song Title")
    assert LyricsRequest(title="Song Title", artist="Artist").video_ids == []


def test_with_no_known_art_track_a_songs_search_finds_one(client) -> None:
    client.tabs = {"bbbbbbbbbbb": BROWSE}
    client.songs = [song("bbbbbbbbbbb", "Song Title", "Artist")]
    client.timed = timed(("line one", 0))

    answer = ask_by_name("Song Title", "Artist")
    assert answer["lines"][0]["text"] == "line one"
    assert client.searched == ["Song Title Artist"]
    assert client.watched == ["bbbbbbbbbbb"]


def test_the_search_is_skipped_when_a_known_upload_has_a_page(client) -> None:
    client.tabs = {"aaaaaaaaaaa": BROWSE}
    client.timed = timed(("line one", 0))
    ask_by_name("Song Title", "Artist", "aaaaaaaaaaa")
    assert client.searched == []


def test_the_search_follows_known_uploads_without_a_page(client) -> None:
    client.tabs = {"aaaaaaaaaaa": None, "bbbbbbbbbbb": BROWSE}
    client.songs = [song("bbbbbbbbbbb", "Song Title", "Artist")]
    client.timed = timed(("line one", 0))
    assert ask_by_name("Song Title", "Artist", "aaaaaaaaaaa")["lines"]
    assert client.watched == ["aaaaaaaaaaa", "bbbbbbbbbbb"]


def test_asides_and_case_do_not_stop_a_match(client) -> None:
    client.tabs = {"bbbbbbbbbbb": BROWSE}
    client.songs = [song("bbbbbbbbbbb", "Song Title (Remastered 2009)", "Other", "ARTIST")]
    client.timed = timed(("line one", 0))
    assert ask_by_name("song title", "Artist")["lines"]


def test_an_unbracketed_guest_credit_does_not_stop_a_match(client) -> None:
    client.tabs = {"bbbbbbbbbbb": BROWSE}
    client.songs = [song("bbbbbbbbbbb", "Song Title (feat. Guest)", "Artist")]
    client.timed = timed(("line one", 0))
    assert ask_by_name("Song Title (Official Audio) ft. Guest, Other", "Artist")["lines"]


def test_an_ampersand_matches_and(client) -> None:
    client.tabs = {"bbbbbbbbbbb": BROWSE}
    client.songs = [song("bbbbbbbbbbb", "This & That", "Artist")]
    client.timed = timed(("line one", 0))
    assert ask_by_name("This and That", "Artist")["lines"]


def test_a_trailing_dash_aside_does_not_stop_a_match(client) -> None:
    client.tabs = {"bbbbbbbbbbb": BROWSE}
    client.songs = [song("bbbbbbbbbbb", "Song Title - Live at Somewhere", "Artist")]
    client.timed = timed(("line one", 0))
    assert ask_by_name("Song Title", "Artist")["lines"]


def test_a_top_result_by_someone_else_is_not_taken(client) -> None:
    client.tabs = {"bbbbbbbbbbb": BROWSE}
    client.songs = [song("bbbbbbbbbbb", "Song Title", "Somebody Else")]
    assert ask_by_name("Song Title", "Artist")["lines"] == []
    assert client.watched == []


def test_a_different_title_by_the_same_artist_is_not_taken(client) -> None:
    client.tabs = {"bbbbbbbbbbb": BROWSE}
    client.songs = [
        song("bbbbbbbbbbb", "Song Title Part Two", "Artist"),
        song("ccccccccccc", "Song Title", "Artist"),
    ]
    client.tabs["ccccccccccc"] = "MPLYt_second"
    client.timed = timed(("line one", 0))
    ask_by_name("Song Title", "Artist")
    assert client.watched == ["ccccccccccc"], "the first result that matches, not the first"


def test_a_non_latin_title_still_matches(client) -> None:
    client.tabs = {"bbbbbbbbbbb": BROWSE}
    client.songs = [song("bbbbbbbbbbb", "歌のタイトル", "アーティスト")]
    client.timed = timed(("line one", 0))
    assert ask_by_name("歌のタイトル", "アーティスト")["lines"]


def test_a_failing_songs_search_is_a_502(client) -> None:
    client.tabs = {}
    client.search_error = RuntimeError("upstream down")
    with pytest.raises(HTTPException) as caught:
        ask_by_name("Song Title", "Artist")
    assert caught.value.status_code == 502


def test_a_tab_with_nothing_behind_it_is_empty_too(client) -> None:
    client.timed = None
    client.plain = None
    assert ask()["lines"] == []


def test_whitespace_only_plain_lyrics_are_empty(client) -> None:
    client.timed = {"lyrics": "  \n\n ", "source": CREDIT, "hasTimestamps": False}
    assert ask()["lines"] == []


def test_a_failing_watch_playlist_is_a_502(monkeypatch) -> None:
    class Broken:
        def get_watch_playlist(self, **_):
            raise RuntimeError("upstream down")

    monkeypatch.setattr(route, "get_client", lambda slot="default": Broken())
    with pytest.raises(HTTPException) as caught:
        ask()
    assert caught.value.status_code == 502


def test_a_failing_plain_page_is_a_502(client) -> None:
    client.timed = None
    client.plain_error = RuntimeError("upstream down")
    with pytest.raises(HTTPException) as caught:
        ask()
    assert caught.value.status_code == 502


def test_lyrics_use_their_own_client_slot(monkeypatch) -> None:
    slots: list[str] = []
    fake = FakeClient(timed=timed(("line one", 0)))

    def get(slot: str = "default"):
        slots.append(slot)
        return fake

    monkeypatch.setattr(route, "get_client", get)
    ask()
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
