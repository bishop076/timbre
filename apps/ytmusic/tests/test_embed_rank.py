import pytest

from app.models import SearchRequest, Track
from app.routes import search as search_route
from app.routes.search import _embed_rank

OMV, OFFICIAL, UGC, ATV = (
    "MUSIC_VIDEO_TYPE_OMV",
    "MUSIC_VIDEO_TYPE_OFFICIAL_SOURCE_MUSIC",
    "MUSIC_VIDEO_TYPE_UGC",
    "MUSIC_VIDEO_TYPE_ATV",
)


def rank(video_type: str | None) -> int:
    return _embed_rank(Track(video_id="x", title="Song", video_type=video_type))


@pytest.mark.parametrize(
    ("first", "second"),
    [
        (OFFICIAL, UGC),
        (UGC, None),
        (None, ATV),
        (ATV, "MUSIC_VIDEO_TYPE_PODCAST_EPISODE"),
        (ATV, "MUSIC_VIDEO_TYPE_SHOULDER"),
    ],
)
def test_embed_rank_orders_one_type_before_another(first, second) -> None:
    assert rank(first) < rank(second)


@pytest.mark.parametrize(
    ("one", "other"), [(OFFICIAL, OMV), ("MUSIC_VIDEO_TYPE_SOMETHING_NEW", None)]
)
def test_embed_rank_ties(one, other) -> None:
    assert rank(one) == rank(other)


def result(video_id: str, video_type: str, result_type: str = "video") -> dict:
    return {
        "resultType": result_type,
        "videoId": video_id,
        "title": "Delilah (pull me out of this)",
        "artists": [{"name": "Fred again.."}],
        "videoType": video_type,
    }


def search(monkeypatch, songs: list[dict], videos: list[dict]) -> list[str]:
    class StubClient:
        def search(self, query: str, filter: str, limit: int) -> list[dict]:
            return songs if filter == "songs" else videos

    monkeypatch.setattr(search_route, "get_client", lambda slot="default": StubClient())
    response = search_route.search(SearchRequest(query="Fred again Delilah", limit=10))
    return [item.video_id for item in response.items]


def test_the_artists_own_upload_survives_the_limit(monkeypatch) -> None:
    videos = [result(f"ugc{index}", UGC) for index in range(14)] + [result("own", OFFICIAL)]
    ids = search(monkeypatch, [result("atv", ATV, "song")], videos)
    assert len(ids) == 10
    assert ids[0] == "own"


def test_a_podcast_episode_no_longer_outranks_the_song(monkeypatch) -> None:
    videos = [result("episode", "MUSIC_VIDEO_TYPE_PODCAST_EPISODE")]
    assert search(monkeypatch, [result("atv", ATV, "song")], videos) == ["atv", "episode"]
