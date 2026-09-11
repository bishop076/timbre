import pytest

from app.models import ResolveRequest
from app.routes import search as search_route
from app.routes.search import extract_video_id

VALID_ID = "hpSrLjc5SMs"


@pytest.mark.parametrize(
    "url",
    [
        VALID_ID,
        f"https://music.youtube.com/watch?v={VALID_ID}",
        f"https://music.youtube.com/watch?v={VALID_ID}&list=RDAMVM123&t=42s",
        f"https://www.youtube.com/watch?v={VALID_ID}",
        f"https://youtube.com/watch?v={VALID_ID}",
        f"https://m.youtube.com/watch?v={VALID_ID}",
        f"https://youtu.be/{VALID_ID}",
        f"https://www.youtube.com/embed/{VALID_ID}",
        f"https://www.youtube.com/shorts/{VALID_ID}",
        f"  https://youtu.be/{VALID_ID}  ",
    ],
)
def test_accepts_every_shape_a_user_might_paste(url: str) -> None:
    assert extract_video_id(url) == VALID_ID


@pytest.mark.parametrize(
    "url",
    [
        "",
        "   ",
        "not a url",
        "abcdefghij!",
        "https://example.com/watch?v=" + VALID_ID,
        "https://soundcloud.com/artist/track",
        "https://youtu.be/",
        "https://www.youtube.com/watch?v=tooshort",
        "https://www.youtube.com/watch?v=" + "x" * 20,
        "https://www.youtube.com/",
        "https://www.youtube.com/embed/",
        "javascript:alert(1)",
        f"https://www.youtube.com/watch?v={VALID_ID}%0A",
        f"https://music.youtube.com/watch?v={VALID_ID}%0A&list=RDAMVM123",
    ],
)
def test_rejects_anything_else(url: str) -> None:
    assert extract_video_id(url) is None


def resolve(monkeypatch, details: object) -> dict | None:
    class StubClient:
        def get_song(self, video_id: str) -> dict:
            return {"videoDetails": details}

    monkeypatch.setattr(search_route, "get_client", lambda slot="default": StubClient())
    track = search_route.resolve(ResolveRequest(url=VALID_ID)).track
    return track.model_dump() if track else None


DETAILS = {
    "videoId": VALID_ID,
    "title": "Song",
    "author": "Artist",
    "lengthSeconds": "259",
    "thumbnail": {"thumbnails": [{"url": "https://large.example/x.jpg", "width": 1, "height": 1}]},
}


def test_resolves_the_upstream_details(monkeypatch) -> None:
    track = resolve(monkeypatch, DETAILS)
    assert track is not None
    assert track["video_id"] == VALID_ID
    assert track["duration_seconds"] == 259
    assert track["thumbnail_url"] == "https://large.example/x.jpg"


def test_odd_upstream_fields_degrade_rather_than_fail(monkeypatch) -> None:
    track = resolve(monkeypatch, {**DETAILS, "lengthSeconds": "²", "thumbnail": [{"url": "x"}]})
    assert track is not None
    assert track["duration_seconds"] is None
    assert track["thumbnail_url"] is None


@pytest.mark.parametrize("found", [f"{VALID_ID}\n", "short", 12345678901])
def test_an_upstream_id_that_is_not_a_video_id_is_dropped(monkeypatch, found: object) -> None:
    assert resolve(monkeypatch, {**DETAILS, "videoId": found}) is None
