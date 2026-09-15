import pytest

from app.normalize import to_track, to_tracks

SONG = {
    "resultType": "song",
    "videoId": "hpSrLjc5SMs",
    "title": "Wonderwall",
    "artists": [{"name": "Oasis", "id": "UC123"}],
    "album": {"name": "(What's The Story) Morning Glory?", "id": "MPRE123"},
    "duration": "4:19",
    "duration_seconds": 259,
    "isExplicit": False,
    "thumbnails": [
        {"url": "https://small.example/x.jpg", "width": 60, "height": 60},
        {"url": "https://large.example/x.jpg", "width": 544, "height": 544},
    ],
}


def test_flattens_a_song() -> None:
    track = to_track(SONG)
    assert track is not None
    assert track.video_id == "hpSrLjc5SMs"
    assert track.title == "Wonderwall"
    assert track.artists == ["Oasis"]
    assert track.duration_seconds == 259
    assert track.thumbnail_url == "https://large.example/x.jpg"


def test_keeps_videos_not_just_songs() -> None:
    track = to_track({**SONG, "resultType": "video"})
    assert track is not None
    assert track.result_type == "video"


@pytest.mark.parametrize(
    "raw",
    [
        {**SONG, "resultType": "album"},
        {**SONG, "videoId": None},
        {**SONG, "title": "  "},
        None,
        "nonsense",
    ],
)
def test_drops_results_that_cannot_be_played_or_matched(raw: object) -> None:
    assert to_track(raw) is None


@pytest.mark.parametrize(
    ("display", "seconds"),
    [
        ("4:19", 259),
        ("1:02:03", 3723),
        (None, None),
        ("", None),
        ("not:a:time", None),
        ("4:19:22:11", None),
        ("4:1²", None),
    ],
)
def test_falls_back_to_the_display_duration(display: str | None, seconds: int | None) -> None:
    track = to_track({**SONG, "duration_seconds": None, "duration": display})
    assert track is not None
    assert track.duration_seconds == seconds


def test_survives_every_optional_field_disappearing() -> None:
    track = to_track({"resultType": "song", "videoId": "abc12345678", "title": "X"})
    assert track is not None
    assert track.artists == []
    assert track.album is None
    assert track.duration_seconds is None
    assert track.thumbnail_url is None


def test_odd_thumbnail_fields_degrade_rather_than_fail() -> None:
    thumbnails = [
        {"url": "https://odd.example/x.jpg", "width": "wide", "height": 544},
        {"url": ["https://list.example/x.jpg"], "width": 999, "height": 999},
        {"url": "https://small.example/x.jpg", "width": 60, "height": 60},
    ]
    track = to_track({**SONG, "thumbnails": thumbnails})
    assert track is not None
    assert track.thumbnail_url == "https://small.example/x.jpg"


def test_filters_separators_out_of_artist_lists() -> None:
    track = to_track({**SONG, "artists": [{"name": "Oasis"}, {"name": "•"}, {"name": "  "}, "junk"]})
    assert track is not None
    assert track.artists == ["Oasis"]


def test_accepts_album_as_a_bare_string() -> None:
    track = to_track({**SONG, "album": "Morning Glory"})
    assert track is not None
    assert track.album == "Morning Glory"


@pytest.mark.parametrize(
    "video_id",
    [
        # `resolve` has checked upstream's id against this pattern since S-18. Search, radio,
        # the playlist route and the lyrics art-track lookup did not, and `video_id` is the
        # one field the web app interpolates into a URL without encoding it, so a trailing
        # newline or an `&list=` left here as part of a link.
        "dQw4w9WgXcQ\n",
        "dQw4w9WgXcQ&list=PLhostile",
        " dQw4w9WgXcQ",
        "dQw4w9WgXcQ#",
        "../../../etc/passwd",
        "x" * 300,
        "dQw4w9WgXc",
        "dQw4w9WgXcQQ",
        "",
    ],
)
def test_an_id_that_is_not_a_video_id_drops_the_item(video_id: str) -> None:
    assert to_track({**SONG, "videoId": video_id}) is None
    assert to_tracks([SONG, {**SONG, "videoId": video_id}]) == [to_track(SONG)]


def test_to_tracks_drops_unusable_entries_and_non_lists() -> None:
    assert len(to_tracks([SONG, {"resultType": "artist"}, None, {**SONG, "videoId": None}])) == 1
    assert to_tracks(None) == []
    assert to_tracks({"unexpected": "shape"}) == []
