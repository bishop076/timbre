import importlib
import sys

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.routes import playlist as route
from app.routes.playlist import PlaylistRequest, cover_of, is_missing, to_playlist_track

ITEM = {
    "videoId": "uk_E_RieeWA",
    "title": "ceiling duty",
    "artists": [{"name": "lilibu", "id": "UCgKf4b-fDNaKE_jISAiW2Bg"}],
    "album": {"name": "ceiling duty", "id": "MPREb_0a7WudMoTPK"},
    "duration": "2:23",
    "duration_seconds": 143,
    "isAvailable": True,
    "isExplicit": False,
    "videoType": "MUSIC_VIDEO_TYPE_ATV",
    "setVideoId": "56B44F6D10557CC6",
    "thumbnails": [
        {"url": "https://lh3.googleusercontent.com/a=w60-h60-l90-rj", "width": 60, "height": 60},
        {
            "url": "https://lh3.googleusercontent.com/a=w120-h120-l90-rj",
            "width": 120,
            "height": 120,
        },
    ],
}

COMMUNITY = {
    "owned": False,
    "id": "PL11WrGDTdUZL4uIIT7DsKk7cfzPiIsqat",
    "privacy": "PUBLIC",
    "title": "Lofi Hip Hop 2026 - beats to relax / study to",
    "thumbnails": [
        {"url": "https://yt3.googleusercontent.com/p=s192", "width": 192, "height": 192},
        {"url": "https://yt3.googleusercontent.com/p=s1200", "width": 1200, "height": 1200},
    ],
    "author": {"name": "Hitet Shqip", "id": "UCa5L1YSKUrItZPlFtT37F-A"},
    "year": "2026",
    "trackCount": 60,
    "tracks": [ITEM, {**ITEM, "videoId": "bbbbbbbbbbb", "title": "second"}],
}

ALBUM = {
    "owned": False,
    "privacy": "PUBLIC",
    "description": None,
    "id": "OLAK5uy_mz6eafmqdRHSaR4IwG0ll6J6rgv0_ZpGw",
    "title": "Discovery",
    "thumbnails": [],
    "trackCount": 14,
    "tracks": [{**ITEM, "title": "One More Time", "album": {"name": "Discovery", "id": "MPREb_7"}}],
}

MISSING = KeyError(
    "Unable to find 'contents' using path ['contents', 'twoColumnBrowseResultsRenderer', "
    "'tabs', 0, 'tabRenderer', 'content', 'sectionListRenderer', 'contents', 0] on "
    "{'responseContext': {'serviceTrackingParams': []}, 'trackingParams': 'x', "
    "'microformat': {}}, exception: 'contents'"
)

REARRANGED = KeyError(
    "Unable to find 'musicPlaylistShelfRenderer' using path ['contents', 0, "
    "'musicPlaylistShelfRenderer'] on {'itemSectionRenderer': {}}, exception: "
    "'musicPlaylistShelfRenderer'"
)


class StubClient:
    def __init__(self, answer=None, error: Exception | None = None):
        self.answer = answer
        self.error = error
        self.calls: list[tuple[str, int]] = []

    def get_playlist(self, playlist_id: str, limit: int = 100):
        self.calls.append((playlist_id, limit))
        if self.error is not None:
            raise self.error
        return self.answer


@pytest.fixture
def stub(monkeypatch):
    def install(answer=None, error: Exception | None = None) -> StubClient:
        client = StubClient(answer, error)
        monkeypatch.setattr(route, "get_client", lambda slot="default": client)
        return client

    return install


def request(playlist_id: str = COMMUNITY["id"], limit: int = 100) -> PlaylistRequest:
    return PlaylistRequest(playlist_id=playlist_id, limit=limit)


def test_returns_tracks_in_the_search_wire_shape(stub) -> None:
    stub(COMMUNITY)
    result = route.playlist(request())

    assert [track.video_id for track in result.tracks] == ["uk_E_RieeWA", "bbbbbbbbbbb"]
    first = result.tracks[0]
    assert first.artists == ["lilibu"]
    assert first.album == "ceiling duty"
    assert first.duration_seconds == 143
    assert first.video_type == "MUSIC_VIDEO_TYPE_ATV"
    assert first.thumbnail_url == "https://lh3.googleusercontent.com/a=w120-h120-l90-rj"


def test_carries_the_playlists_own_details(stub) -> None:
    stub(COMMUNITY)
    result = route.playlist(request())

    assert result.id == COMMUNITY["id"]
    assert result.title == COMMUNITY["title"]
    assert result.author == "Hitet Shqip"
    assert result.year == "2026"
    assert result.track_count == 60
    assert result.thumbnail_url == "https://yt3.googleusercontent.com/p=s1200"


def test_an_album_list_borrows_its_first_songs_sleeve_at_a_useful_size(stub) -> None:
    stub(ALBUM)
    result = route.playlist(request(ALBUM["id"]))

    assert result.title == "Discovery"
    assert result.author is None
    assert result.thumbnail_url == "https://lh3.googleusercontent.com/a=w544-h544-l90-rj"


def test_asks_upstream_for_the_id_and_limit_given(stub) -> None:
    client = stub(COMMUNITY)
    route.playlist(request(limit=50))
    assert client.calls == [(COMMUNITY["id"], 50)]


def test_truncates_to_the_limit(stub) -> None:
    stub({**COMMUNITY, "tracks": [{**ITEM, "videoId": f"{index:011d}"} for index in range(5)]})
    assert len(route.playlist(request(limit=3)).tracks) == 3


def test_greyed_out_songs_are_dropped() -> None:
    assert to_playlist_track({**ITEM, "isAvailable": False}) is None
    assert to_playlist_track(ITEM) is not None


def test_an_item_without_an_id_is_dropped() -> None:
    assert to_playlist_track({**ITEM, "videoId": None}) is None
    assert to_playlist_track("not a dict") is None


def test_a_playlist_youtube_will_not_show_is_a_404(stub) -> None:
    stub(error=MISSING)
    with pytest.raises(HTTPException) as caught:
        route.playlist(request())
    assert caught.value.status_code == 404


def test_a_parser_youtube_has_broken_is_a_502_not_a_404(stub) -> None:
    stub(error=REARRANGED)
    with pytest.raises(HTTPException) as caught:
        route.playlist(request())
    assert caught.value.status_code == 502


def test_any_other_upstream_failure_is_a_502(stub) -> None:
    stub(error=ConnectionError("reset by peer"))
    with pytest.raises(HTTPException) as caught:
        route.playlist(request())
    assert caught.value.status_code == 502


def test_a_non_dict_answer_is_a_502(stub) -> None:
    stub([])
    with pytest.raises(HTTPException) as caught:
        route.playlist(request())
    assert caught.value.status_code == 502


def test_is_missing_reads_only_a_failure_at_the_root() -> None:
    assert is_missing(MISSING)
    assert not is_missing(REARRANGED)
    assert not is_missing(KeyError())
    assert not is_missing(ValueError(MISSING.args[0]))


def test_cover_prefers_the_playlists_own() -> None:
    assert cover_of(COMMUNITY, []) == "https://yt3.googleusercontent.com/p=s1200"
    assert cover_of({"thumbnails": []}, []) is None


@pytest.mark.parametrize(
    "playlist_id",
    [
        "",
        "LL",
        "WL",
        "https://www.youtube.com/playlist?list=PL11WrGDTdUZL4uIIT7DsKk7cfzPiIsqat",
        "PL11WrGDTdUZL4uI/../../x",
        "x" * 65,
    ],
)
def test_refuses_anything_that_is_not_a_playlist_id(playlist_id: str) -> None:
    with pytest.raises(ValueError):
        PlaylistRequest(playlist_id=playlist_id)


def test_the_route_is_behind_the_shared_secret(monkeypatch, stub) -> None:
    secret = "5e1f" * 16
    for name in ("app.main", "app.security", "app.config"):
        monkeypatch.delitem(sys.modules, name, raising=False)
    monkeypatch.setenv("YTMUSIC_SHARED_SECRET", secret)
    stub(COMMUNITY)

    client = TestClient(importlib.import_module("app.main").app)
    body = {"playlist_id": COMMUNITY["id"]}

    assert client.post("/playlist", json=body).status_code == 401
    answered = client.post("/playlist", json=body, headers={"X-Timbre-Secret": secret})
    assert answered.status_code == 200
    assert answered.json()["tracks"][0]["video_id"] == "uk_E_RieeWA"
