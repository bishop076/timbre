import importlib
import sys

import pytest

OLD = "0f2c" * 16
NEW = "9a71" * 16


def load(monkeypatch, value: str | None, module: str = "app.security"):
    for name in ("app.security", "app.config"):
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


@pytest.mark.parametrize(
    ("value", "message"), [(None, "refuses to start"), (" , , ", "no usable secret")]
)
def test_an_unusable_secret_refuses_to_boot(monkeypatch, value, message):
    with pytest.raises(Exception, match=message):
        load(monkeypatch, value, "app.config")
