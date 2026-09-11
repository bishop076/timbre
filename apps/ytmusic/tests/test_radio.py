import pytest

from app.models import Track
from app.normalize import to_related_track, to_tracks, to_watch_track
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
