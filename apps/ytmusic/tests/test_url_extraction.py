import pytest

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
    ],
)
def test_rejects_anything_else(url: str) -> None:
    assert extract_video_id(url) is None
