"""The embed rank, and what it decides survives `limit`.

The rank does two jobs at once: it orders the candidates the player walks, and
it chooses which of them are cut off by `limit`. The second is the one that
fails silently — nothing errors, the search just returns worse copies — so the
route is exercised end to end here with a stub client, not only the lookup.

The tiers are those measured in RESEARCH-2026-08-20 G-5.
"""

from app.models import SearchRequest, Track
from app.routes import search as search_route
from app.routes.search import _embed_rank


def track(video_type: str | None, video_id: str = "x") -> Track:
    return Track(video_id=video_id, title="Song", video_type=video_type)


def test_official_source_music_ranks_with_official_videos() -> None:
    assert _embed_rank(track("MUSIC_VIDEO_TYPE_OFFICIAL_SOURCE_MUSIC")) == _embed_rank(
        track("MUSIC_VIDEO_TYPE_OMV")
    )
    assert _embed_rank(track("MUSIC_VIDEO_TYPE_OFFICIAL_SOURCE_MUSIC")) < _embed_rank(
        track("MUSIC_VIDEO_TYPE_UGC")
    )


def test_podcast_episodes_and_shoulder_rank_below_art_tracks() -> None:
    art = _embed_rank(track("MUSIC_VIDEO_TYPE_ATV"))
    assert _embed_rank(track("MUSIC_VIDEO_TYPE_PODCAST_EPISODE")) > art
    assert _embed_rank(track("MUSIC_VIDEO_TYPE_SHOULDER")) > art


def test_an_unknown_type_still_sits_between_user_uploads_and_art_tracks() -> None:
    unknown = _embed_rank(track(None))
    assert (
        _embed_rank(track("MUSIC_VIDEO_TYPE_UGC"))
        < unknown
        < _embed_rank(track("MUSIC_VIDEO_TYPE_ATV"))
    )
    assert _embed_rank(track("MUSIC_VIDEO_TYPE_SOMETHING_NEW")) == unknown


def result(video_id: str, video_type: str, result_type: str = "video") -> dict:
    return {
        "resultType": result_type,
        "videoId": video_id,
        "title": "Delilah (pull me out of this)",
        "artists": [{"name": "Fred again.."}],
        "videoType": video_type,
    }


class StubClient:
    def __init__(self, songs: list[dict], videos: list[dict]) -> None:
        self.songs = songs
        self.videos = videos

    def search(self, query: str, filter: str, limit: int) -> list[dict]:
        return self.songs if filter == "songs" else self.videos


def test_the_artists_own_upload_survives_the_limit(monkeypatch) -> None:
    # The measured shape of "Fred again Delilah": user re-uploads first, the
    # artist's own OFFICIAL_SOURCE_MUSIC upload near the end. At "unknown" it was
    # cut by limit=10 while ten re-uploads survived.
    songs = [result("atv", "MUSIC_VIDEO_TYPE_ATV", "song")]
    videos = [result(f"ugc{index}", "MUSIC_VIDEO_TYPE_UGC") for index in range(14)]
    videos.append(result("own", "MUSIC_VIDEO_TYPE_OFFICIAL_SOURCE_MUSIC"))

    client = StubClient(songs, videos)
    monkeypatch.setattr(search_route, "get_client", lambda slot="default": client)

    response = search_route.search(SearchRequest(query="Fred again Delilah", limit=10))
    ids = [item.video_id for item in response.items]

    assert len(ids) == 10
    assert ids[0] == "own"


def test_a_podcast_episode_no_longer_outranks_the_song(monkeypatch) -> None:
    songs = [result("atv", "MUSIC_VIDEO_TYPE_ATV", "song")]
    videos = [result("episode", "MUSIC_VIDEO_TYPE_PODCAST_EPISODE")]

    client = StubClient(songs, videos)
    monkeypatch.setattr(search_route, "get_client", lambda slot="default": client)

    response = search_route.search(SearchRequest(query="lofi study mix", limit=10))
    assert [item.video_id for item in response.items] == ["atv", "episode"]
