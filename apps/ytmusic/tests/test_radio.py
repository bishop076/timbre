from app.models import Track
from app.normalize import to_related_track, to_watch_track, to_watch_tracks
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


def track(video_id: str, title: str = "Song") -> Track:
    return Track(video_id=video_id, title=title)


def test_flattens_a_watch_item_that_to_track_would_drop() -> None:
    result = to_watch_track(WATCH_TRACK)
    assert result is not None
    assert result.video_id == "P3cffdsEXXw"
    assert result.artists == ["Harry Styles"]


def test_reads_the_duration_from_length() -> None:
    result = to_watch_track(WATCH_TRACK)
    assert result is not None
    assert result.duration_seconds == 210


def test_reads_artwork_from_the_singular_thumbnail_key() -> None:
    result = to_watch_track(WATCH_TRACK)
    assert result is not None
    assert result.thumbnail_url == "https://large.example/x.jpg"


def test_preserves_video_type() -> None:
    result = to_watch_track(WATCH_TRACK)
    assert result is not None
    assert result.video_type == "MUSIC_VIDEO_TYPE_OMV"


def test_survives_the_fields_watch_items_never_carry() -> None:
    result = to_watch_track(WATCH_TRACK)
    assert result is not None
    assert result.album is None
    assert result.is_explicit is False


def test_survives_a_missing_length_and_thumbnail() -> None:
    bare = {key: value for key, value in WATCH_TRACK.items() if key not in {"length", "thumbnail"}}
    result = to_watch_track(bare)
    assert result is not None
    assert result.duration_seconds is None
    assert result.thumbnail_url is None


def test_drops_an_item_with_no_video_id() -> None:
    assert to_watch_track({**WATCH_TRACK, "videoId": None}) is None


def test_watch_tracks_survives_a_non_list() -> None:
    assert to_watch_tracks(None) == []
    assert to_watch_tracks({"tracks": []}) == []


def test_related_items_flatten_without_any_duration() -> None:
    result = to_related_track(RELATED_TRACK)
    assert result is not None
    assert result.duration_seconds is None
    assert result.video_type == "MUSIC_VIDEO_TYPE_ATV"


def test_related_drops_non_songs() -> None:
    assert to_related_track({"title": "Pop's Biggest Hits", "playlistId": "RDC123"}) is None
    assert to_related_track({"title": "ZAYN", "browseId": "UC789"}) is None


def test_continuation_drops_the_seed_when_it_leads() -> None:
    tracks = [track("aaaaaaaaaaa"), track("bbbbbbbbbbb")]
    assert [t.video_id for t in continuation(tracks, "aaaaaaaaaaa", 10)] == ["bbbbbbbbbbb"]


def test_continuation_drops_the_seed_wherever_it_sits() -> None:
    tracks = [track("bbbbbbbbbbb"), track("aaaaaaaaaaa"), track("ccccccccccc")]
    assert [t.video_id for t in continuation(tracks, "aaaaaaaaaaa", 10)] == [
        "bbbbbbbbbbb",
        "ccccccccccc",
    ]


def test_continuation_collapses_repeats() -> None:
    tracks = [track("bbbbbbbbbbb"), track("ccccccccccc"), track("bbbbbbbbbbb")]
    assert [t.video_id for t in continuation(tracks, "aaaaaaaaaaa", 10)] == [
        "bbbbbbbbbbb",
        "ccccccccccc",
    ]


def test_continuation_truncates_to_the_limit() -> None:
    tracks = [track(f"{index:011d}") for index in range(10)]
    assert len(continuation(tracks, "aaaaaaaaaaa", 3)) == 3


def test_continuation_of_nothing_is_nothing() -> None:
    assert continuation([], "aaaaaaaaaaa", 10) == []
