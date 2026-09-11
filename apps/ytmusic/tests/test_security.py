import importlib
import sys

import pytest

OLD = "0f2c" * 16
NEW = "9a71" * 16


def build(monkeypatch, value: str | None):
    for name in ("app.security", "app.config"):
        monkeypatch.delitem(sys.modules, name, raising=False)

    if value is None:
        monkeypatch.delenv("YTMUSIC_SHARED_SECRET", raising=False)
    else:
        monkeypatch.setenv("YTMUSIC_SHARED_SECRET", value)

    return lambda module: importlib.import_module(module)


def test_one_secret_is_accepted(monkeypatch):
    security = build(monkeypatch, NEW)("app.security")
    assert security.matches(NEW)
    assert not security.matches(OLD)


def test_both_secrets_are_accepted_mid_rotation(monkeypatch):
    security = build(monkeypatch, f"{OLD},{NEW}")("app.security")
    assert security.matches(OLD)
    assert security.matches(NEW)


def test_whitespace_and_empty_entries_are_ignored(monkeypatch):
    security = build(monkeypatch, f" {OLD} , , {NEW} ,")("app.security")
    assert security.matches(OLD)
    assert security.matches(NEW)
    assert not security.matches("")


def test_anything_else_is_refused(monkeypatch):
    security = build(monkeypatch, f"{OLD},{NEW}")("app.security")
    for wrong in ["", "  ", NEW[:-1], NEW + "x", NEW.upper(), f"{OLD},{NEW}"]:
        assert not security.matches(wrong), wrong


def test_a_non_ascii_secret_is_refused_rather_than_raising(monkeypatch):
    security = build(monkeypatch, f"{OLD},{NEW}")("app.security")

    for wrong in ["café", "\xe9", "🎵", NEW[:-1] + "é", "\udce9"]:
        assert not security.matches(wrong), wrong


def test_a_missing_secret_refuses_to_boot(monkeypatch):
    load = build(monkeypatch, None)
    with pytest.raises(Exception, match="refuses to start"):
        load("app.config")


def test_a_secret_of_only_separators_refuses_to_boot(monkeypatch):
    load = build(monkeypatch, " , , ")
    with pytest.raises(Exception, match="no usable secret"):
        load("app.config")
