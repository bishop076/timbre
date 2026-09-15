import pytest
from fastapi import HTTPException

from app.models import RadioRequest, Track
from app.normalize import to_related_track, to_tracks, to_watch_track
from app.routes import radio as route
from app.routes.radio import continuation

WATCH_TRACK = {
    "videoId": "P3cffdsEXXw",
    "title": "Golden (Official Video)",
    "length": "3:30",
    "thumbnail": [
        {"url": "https://small.example/x.jpg", "width": 60, "height": 60},
        {"url": "https://large.example/x.jpg", "width": 544, "height": 544},
    ],
    "artists": [{"name": "Harry Styles", "id": "UC123"}],
    "videoType": "MUSIC_VIDEO_TYPE_OMV",
    "views": "1.2B",
    "likeStatus": "INDIFFERENT",
}

RELATED_TRACK = {
    "videoId": "RmYCOm4ehKs",
    "title": "Save Your Tears",
    "artists": [{"name": "The Weeknd", "id": "UC456"}],
    "album": {"name": "After Hours", "id": "MPRE456"},
    "videoType": "MUSIC_VIDEO_TYPE_ATV",
    "isExplicit": False,
    "thumbnails": [{"url": "https://large.example/y.jpg", "width": 544, "height": 544}],
}


def test_flattens_a_watch_item_that_to_track_would_drop() -> None:
    result = to_watch_track(WATCH_TRACK)
    assert result is not None
    assert result.video_id == "P3cffdsEXXw"
    assert result.artists == ["Harry Styles"]
    assert result.duration_seconds == 210
    assert result.thumbnail_url == "https://large.example/x.jpg"
    assert result.video_type == "MUSIC_VIDEO_TYPE_OMV"
    assert result.album is None
    assert result.is_explicit is False


def test_survives_a_missing_length_and_thumbnail() -> None:
    bare = {key: value for key, value in WATCH_TRACK.items() if key not in {"length", "thumbnail"}}
    result = to_watch_track(bare)
    assert result is not None
    assert result.duration_seconds is None
    assert result.thumbnail_url is None


def test_drops_a_watch_item_with_no_video_id_or_no_list() -> None:
    assert to_watch_track({**WATCH_TRACK, "videoId": None}) is None
    assert to_tracks(None, to_watch_track) == []
    assert to_tracks({"tracks": []}, to_watch_track) == []


def test_related_items_flatten_without_any_duration() -> None:
    result = to_related_track(RELATED_TRACK)
    assert result is not None
    assert result.duration_seconds is None
    assert result.video_type == "MUSIC_VIDEO_TYPE_ATV"


def test_related_drops_non_songs() -> None:
    assert to_related_track({"title": "Pop's Biggest Hits", "playlistId": "RDC123"}) is None
    assert to_related_track({"title": "ZAYN", "browseId": "UC789"}) is None


@pytest.mark.parametrize(
    ("ids", "limit", "expected"),
    [
        (["a", "b"], 10, ["b"]),
        (["b", "a", "c"], 10, ["b", "c"]),
        (["b", "c", "b"], 10, ["b", "c"]),
        (list("bcdefghijk"), 3, ["b", "c", "d"]),
        ([], 10, []),
    ],
    ids=["seed-leads", "seed-anywhere", "repeats", "limit", "empty"],
)
def test_continuation(ids: list[str], limit: int, expected: list[str]) -> None:
    tracks = [Track(video_id=video_id, title="Song") for video_id in ids]
    assert [t.video_id for t in continuation(tracks, "a", limit)] == expected


SEED = "P3cffdsEXXw"
OTHER = "RmYCOm4ehKs"
BROWSE = "MPTRt_placeholder"


def watch_item(video_id: str, title: str = "Song") -> dict:
    return {**WATCH_TRACK, "videoId": video_id, "title": title}


class FakeClient:
    """Stands in for YTMusic. `radio=True` is a different answer, as it is upstream."""

    def __init__(self) -> None:
        self.watch: object = {"tracks": [watch_item(SEED)], "related": BROWSE}
        self.mix: object = {"tracks": [watch_item(SEED), watch_item(OTHER)]}
        self.sections: object = []
        self.errors: dict[str, Exception] = {}
        self.calls: list[tuple[str, int, bool]] = []

    def get_watch_playlist(self, videoId: str, limit: int, radio: bool = False):
        self.calls.append((videoId, limit, radio))
        if error := self.errors.get("mix" if radio else "watch"):
            raise error
        return self.mix if radio else self.watch

    def get_song_related(self, browseId: str):
        self.calls.append((browseId, 0, False))
        if error := self.errors.get("related"):
            raise error
        return self.sections


@pytest.fixture
def fake(monkeypatch):
    client = FakeClient()
    monkeypatch.setattr(route, "get_client", lambda slot="default": client)
    return client


def ask(limit: int = 25) -> dict:
    return route.radio(RadioRequest(video_id=SEED, limit=limit)).model_dump()


def section(title: object, *items: dict) -> dict:
    return {"title": title, "contents": list(items)}


def test_a_healthy_watch_playlist_never_asks_for_the_radio_mix(fake) -> None:
    fake.watch = {"tracks": [watch_item(SEED), watch_item(OTHER)], "related": BROWSE}
    answer = ask()
    assert [track["video_id"] for track in answer["radio"]] == [OTHER]
    assert [call[2] for call in fake.calls] == [False, False]


def test_a_seed_only_watch_playlist_falls_back_to_the_radio_mix(fake) -> None:
    # The whole autoplay complaint: the watch playlist holds the seed, `continuation` drops
    # it as a duplicate, and `radio` used to come back empty with nothing else tried.
    answer = ask()
    assert [track["video_id"] for track in answer["radio"]] == [OTHER]
    assert (SEED, 26, True) in fake.calls


def test_a_failing_radio_mix_promotes_related_into_radio(fake) -> None:
    fake.errors["mix"] = RuntimeError("no mix here")
    fake.sections = [section("You might also like", RELATED_TRACK)]
    answer = ask()
    assert [track["video_id"] for track in answer["radio"]] == [RELATED_TRACK["videoId"]]
    # Moved, not copied: listing the same song twice would invent a consensus downstream.
    assert answer["related"] == []


def test_related_survives_a_heading_that_is_not_the_english_one(fake) -> None:
    # YouTube localises these headings by exit IP. Matching one English string exactly meant
    # `related` was empty behind a non-English VPN exit even though songs were right there.
    fake.watch = {"tracks": [watch_item(SEED), watch_item(OTHER)], "related": BROWSE}
    fake.sections = [section("こちらもおすすめ", RELATED_TRACK)]
    assert [track["video_id"] for track in ask()["related"]] == [RELATED_TRACK["videoId"]]


def test_the_preferred_heading_still_leads(fake) -> None:
    first = {**RELATED_TRACK, "videoId": "aaaaaaaaaaa"}
    fake.watch = {"tracks": [watch_item(SEED), watch_item(OTHER)], "related": BROWSE}
    fake.sections = [
        section("Fans might also like", RELATED_TRACK),
        section("Recommended playlists", {"title": "Pop hits", "playlistId": "RDC123"}),
        section("Similar artists", {"title": "ZAYN", "browseId": "UC789"}),
        section(None, first),
    ]
    ids = [track["video_id"] for track in ask()["related"]]
    assert ids == [RELATED_TRACK["videoId"], "aaaaaaaaaaa"]


@pytest.mark.parametrize(
    "sections",
    [None, "nope", [], [section("You might also like")], [section("x", {"title": "no id"})], [7]],
    ids=["none", "string", "empty", "no contents", "unusable item", "not a section"],
)
def test_unreadable_related_sections_are_simply_no_related(fake, sections) -> None:
    fake.watch = {"tracks": [watch_item(SEED), watch_item(OTHER)], "related": BROWSE}
    fake.sections = sections
    answer = ask()
    assert answer["related"] == []
    assert [track["video_id"] for track in answer["radio"]] == [OTHER]


def test_nothing_anywhere_is_two_empty_lists_and_not_an_error(fake) -> None:
    fake.watch = {"tracks": [watch_item(SEED)], "related": None}
    fake.mix = {"tracks": []}
    assert ask() == {"radio": [], "related": []}


def test_an_unreadable_watch_playlist_is_a_502_and_not_a_500(fake) -> None:
    fake.watch = ["not", "a", "dict"]
    with pytest.raises(HTTPException) as raised:
        ask()
    assert raised.value.status_code == 502
    assert raised.value.detail == "YouTube Music radio failed."


def test_an_upstream_failure_is_a_502(fake) -> None:
    fake.errors["watch"] = RuntimeError("bot wall")
    with pytest.raises(HTTPException) as raised:
        ask()
    assert raised.value.status_code == 502


def test_a_failing_related_lookup_still_returns_the_radio(fake) -> None:
    fake.watch = {"tracks": [watch_item(SEED), watch_item(OTHER)], "related": BROWSE}
    fake.errors["related"] = RuntimeError("gone")
    answer = ask()
    assert [track["video_id"] for track in answer["radio"]] == [OTHER]
    assert answer["related"] == []


def test_the_full_limit_is_reachable(fake) -> None:
    # The seed leads the watch playlist and is dropped, so asking upstream for exactly the
    # limit could only ever yield limit - 1. A request for 50 must be able to return 50.
    fake.watch = {"tracks": [watch_item(SEED), *(watch_item(f"id{n:09d}") for n in range(60))]}
    answer = ask(limit=50)
    assert fake.calls[0] == (SEED, 51, False)
    assert len(answer["radio"]) == 50
