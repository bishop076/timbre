"""Flattening ytmusicapi's result dicts.

`ytmusicapi` tracks YouTube's private API and its shapes change without
warning, so these tests are mostly about degrading gracefully rather than
about happy paths.
"""

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


def test_picks_the_largest_thumbnail() -> None:
    track = to_track(SONG)
    assert track is not None
    assert track.thumbnail_url == "https://large.example/x.jpg"


def test_keeps_videos_not_just_songs() -> None:
    # Videos are where remixes, live sets and unofficial uploads live — often
    # the only copy in existence, and precisely the catalogue Timbre targets.
    video = {**SONG, "resultType": "video"}
    track = to_track(video)
    assert track is not None
    assert track.result_type == "video"


def test_drops_results_that_cannot_be_played_or_matched() -> None:
    assert to_track({**SONG, "resultType": "album"}) is None
    assert to_track({**SONG, "videoId": None}) is None
    assert to_track({**SONG, "title": "  "}) is None
    assert to_track(None) is None
    assert to_track("nonsense") is None


def test_parses_duration_when_only_the_display_string_is_present() -> None:
    track = to_track({**SONG, "duration_seconds": None, "duration": "4:19"})
    assert track is not None
    assert track.duration_seconds == 259


def test_parses_hour_long_durations() -> None:
    track = to_track({**SONG, "duration_seconds": None, "duration": "1:02:03"})
    assert track is not None
    assert track.duration_seconds == 3723


def test_survives_a_missing_or_malformed_duration() -> None:
    for value in [None, "", "not:a:time", "4:19:22:11"]:
        track = to_track({**SONG, "duration_seconds": None, "duration": value})
        assert track is not None
        assert track.duration_seconds is None


def test_survives_every_optional_field_disappearing() -> None:
    # The shape after a hypothetical upstream change: only the two fields we
    # genuinely require survive.
    track = to_track({"resultType": "song", "videoId": "abc12345678", "title": "X"})
    assert track is not None
    assert track.artists == []
    assert track.album is None
    assert track.duration_seconds is None
    assert track.thumbnail_url is None


def test_filters_separators_out_of_artist_lists() -> None:
    # Video results interleave bullet separators and view counts with artists.
    track = to_track({**SONG, "artists": [{"name": "Oasis"}, {"name": "•"}, {"name": "  "}, "junk"]})
    assert track is not None
    assert track.artists == ["Oasis"]


def test_accepts_album_as_a_bare_string() -> None:
    track = to_track({**SONG, "album": "Morning Glory"})
    assert track is not None
    assert track.album == "Morning Glory"


def test_to_tracks_drops_unusable_entries_without_failing() -> None:
    tracks = to_tracks([SONG, {"resultType": "artist"}, None, {**SONG, "videoId": None}])
    assert len(tracks) == 1


def test_to_tracks_handles_a_non_list() -> None:
    assert to_tracks(None) == []
    assert to_tracks({"unexpected": "shape"}) == []
