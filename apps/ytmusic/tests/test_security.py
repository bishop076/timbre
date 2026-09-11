import asyncio
import importlib
import sys

import pytest
from fastapi.testclient import TestClient

OLD = "0f2c" * 16
NEW = "9a71" * 16
LIMIT = 16 * 1024


def load(monkeypatch, value: str | None, module: str = "app.security"):
    for name in ("app.main", "app.security", "app.config"):
        monkeypatch.delitem(sys.modules, name, raising=False)
    if value is None:
        monkeypatch.delenv("YTMUSIC_SHARED_SECRET", raising=False)
    else:
        monkeypatch.setenv("YTMUSIC_SHARED_SECRET", value)
    return importlib.import_module(module)


def test_one_secret_is_accepted(monkeypatch):
    security = load(monkeypatch, NEW)
    assert security.matches(NEW)
    assert not security.matches(OLD)


@pytest.mark.parametrize("configured", [f"{OLD},{NEW}", f" {OLD} , , {NEW} ,"])
def test_every_listed_secret_is_accepted_mid_rotation(monkeypatch, configured):
    security = load(monkeypatch, configured)
    assert security.matches(OLD)
    assert security.matches(NEW)
    assert not security.matches("")


def test_anything_else_is_refused_rather_than_raising(monkeypatch):
    security = load(monkeypatch, f"{OLD},{NEW}")
    wrong = ["", "  ", NEW[:-1], NEW + "x", NEW.upper(), f"{OLD},{NEW}"]
    non_ascii = ["café", "\xe9", "🎵", NEW[:-1] + "é", "\udce9"]
    for presented in wrong + non_ascii:
        assert not security.matches(presented), presented


@pytest.mark.parametrize("value", ["x" * 31, f"{NEW},dummy"])
def test_a_weak_secret_boots_with_a_warning(monkeypatch, value):
    with pytest.warns(UserWarning, match="shorter than 32"):
        load(monkeypatch, value, "app.config")


@pytest.mark.parametrize(
    ("value", "message"),
    [
        (None, "refuses to start"),
        (" , , ", "no usable secret"),
    ],
)
def test_an_unusable_secret_refuses_to_boot(monkeypatch, value, message):
    with pytest.raises(Exception, match=message):
        load(monkeypatch, value, "app.config")


def call(app, headers: dict[str, str], chunks: list[bytes]) -> tuple[int, int]:
    pending, reads, sent = list(chunks), [], []

    async def receive():
        body = pending.pop(0) if pending else b""
        reads.append(body)
        return {"type": "http.request", "body": body, "more_body": bool(pending)}

    async def send(message):
        sent.append(message)

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/search",
        "raw_path": b"/search",
        "root_path": "",
        "query_string": b"",
        "headers": [(name.encode(), value.encode()) for name, value in headers.items()],
        "client": ("127.0.0.1", 50000),
        "server": ("testserver", 80),
    }
    asyncio.run(app(scope, receive, send))
    return sent[0]["status"], len(reads)


@pytest.mark.parametrize("secret", [None, OLD, ""], ids=["missing", "wrong", "empty"])
@pytest.mark.parametrize(
    "body", [b"{bad", b'{"query": "x"}', b"x" * (400 * LIMIT)], ids=["malformed", "valid", "huge"]
)
def test_no_secret_is_refused_before_the_body_is_read(monkeypatch, secret, body):
    app = load(monkeypatch, NEW, "app.main").app
    headers = {"content-type": "application/json", "content-length": str(len(body))}
    if secret is not None:
        headers["x-timbre-secret"] = secret
    assert call(app, headers, [body]) == (401, 0)


def test_an_oversized_body_is_refused(monkeypatch):
    app = load(monkeypatch, NEW, "app.main").app
    declared = {"x-timbre-secret": NEW, "content-length": str(LIMIT + 1)}
    assert call(app, declared, [b"x" * (LIMIT + 1)]) == (413, 0)
    assert call(app, {**declared, "content-length": "12x"}, [b"{}"]) == (413, 0)

    status, reads = call(app, {"x-timbre-secret": NEW}, [b"x" * 4096] * 100)
    assert status == 413
    assert reads == 5


def test_a_valid_request_still_works(monkeypatch):
    app = load(monkeypatch, NEW, "app.main").app
    search = importlib.import_module("app.routes.search")
    song = {"resultType": "song", "videoId": "hpSrLjc5SMs", "title": "Wonderwall"}

    class StubClient:
        def search(self, query: str, filter: str, limit: int) -> list[dict]:
            return [song] if filter == "songs" else []

    monkeypatch.setattr(search, "get_client", lambda slot="default": StubClient())
    http = TestClient(app)
    answer = http.post("/search", json={"query": "oasis"}, headers={"X-Timbre-Secret": NEW})
    assert answer.status_code == 200
    assert [item["video_id"] for item in answer.json()["items"]] == ["hpSrLjc5SMs"]
    assert http.post("/search", json={"query": "oasis"}).json() == {
        "detail": "Missing or invalid shared secret."
    }


def test_health_stays_open(monkeypatch):
    http = TestClient(load(monkeypatch, NEW, "app.main").app)
    answer = http.get("/health")
    assert answer.status_code == 200
    assert answer.json() == {"status": "ok", "service": "ytmusic"}


@pytest.mark.parametrize(
    ("path", "body"),
    [
        ("/search", b'{"query": "\\ud800"}'),
        ("/resolve", b'{"query": "\\ud800"}'),
        ("/resolve", b'{"url": "' + b"y" * 2001 + b'"}'),
    ],
)
def test_bad_input_is_a_422_that_does_not_echo_it(monkeypatch, path, body):
    http = TestClient(load(monkeypatch, NEW, "app.main").app)
    headers = {"X-Timbre-Secret": NEW, "content-type": "application/json"}
    answer = http.post(path, content=body, headers=headers)
    assert answer.status_code == 422
    assert all("input" not in issue for issue in answer.json()["detail"])
    assert "yyyy" not in answer.text
