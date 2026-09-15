import threading

import pytest
from fastapi import HTTPException

from app.models import SearchRequest
from app.routes import search as route

SONG = {
    "resultType": "song",
    "videoId": "hpSrLjc5SMs",
    "title": "Wonderwall",
    "artists": [{"name": "Oasis"}],
    "videoType": "MUSIC_VIDEO_TYPE_ATV",
}


class SlowVideoClient:
    """Songs answer at once; the video search blocks until it is let go, as a stalled one does."""

    def __init__(self, songs: list[dict] | Exception) -> None:
        self.songs = songs
        self.release = threading.Event()
        self.finished = threading.Event()

    def search(self, query: str, filter: str, limit: int) -> list[dict]:
        if filter == "songs":
            if isinstance(self.songs, Exception):
                raise self.songs
            return self.songs
        self.release.wait(10)
        self.finished.set()
        return []


@pytest.fixture
def slow(monkeypatch):
    clients: list[SlowVideoClient] = []

    def build(songs: list[dict] | Exception) -> SlowVideoClient:
        client = SlowVideoClient(songs)
        clients.append(client)
        monkeypatch.setattr(route, "get_client", lambda slot="default": client)
        return client

    yield build
    for client in clients:
        client.release.set()


def test_a_failed_song_search_answers_without_waiting_for_the_video_search(slow) -> None:
    # `with ThreadPoolExecutor(...)` joined the stalled video thread on the way out of the
    # exception, so a 502 that was ready at once was delivered a full upstream timeout later
    # — after the web app's 6s deadline had already reported the sidecar as unreachable.
    client = slow(RuntimeError("bot wall"))

    with pytest.raises(HTTPException) as raised:
        route.search(SearchRequest(query="oasis", limit=10))

    assert raised.value.status_code == 502
    assert not client.finished.is_set(), "the route waited for the video search before failing"


def test_a_successful_search_still_waits_for_the_videos(slow) -> None:
    client = slow([SONG])
    client.release.set()
    answer = route.search(SearchRequest(query="oasis", limit=10))
    assert [item.video_id for item in answer.items] == ["hpSrLjc5SMs"]
    assert client.finished.is_set()
