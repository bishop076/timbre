"""Caller authentication, and the rotation it is shaped for.

`app.config` reads the environment at import, so each case builds its own copy of the
module rather than importing at the top of the file. `monkeypatch` owns the variable so a
case cannot leave the environment dirty for whatever runs next — the boot-failure tests
below unset it, and without that they would be the reason a later test file failed.

See docs/EXPOSURE.md, E-11.
"""

import importlib
import sys

import pytest

OLD = "0f2c" * 16
NEW = "9a71" * 16


def build(monkeypatch, value: str | None):
    """Imports `app.security` fresh against a given YTMUSIC_SHARED_SECRET."""
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
    # The state the sidecar sits in while the web app is moved across. Neither side is ever
    # down, which is the whole reason the list exists.
    security = build(monkeypatch, f"{OLD},{NEW}")("app.security")
    assert security.matches(OLD)
    assert security.matches(NEW)


def test_whitespace_and_empty_entries_are_ignored(monkeypatch):
    security = build(monkeypatch, f" {OLD} , , {NEW} ,")("app.security")
    assert security.matches(OLD)
    assert security.matches(NEW)
    # An empty entry must never become an accepted secret, or a trailing comma would let a
    # blank header through.
    assert not security.matches("")


def test_anything_else_is_refused(monkeypatch):
    security = build(monkeypatch, f"{OLD},{NEW}")("app.security")
    # Truncated, extended, re-cased, and the raw variable itself — that last one matters,
    # since the joined string is what an attacker would find in a leaked config.
    for wrong in ["", "  ", NEW[:-1], NEW + "x", NEW.upper(), f"{OLD},{NEW}"]:
        assert not security.matches(wrong), wrong


def test_a_non_ascii_secret_is_refused_rather_than_raising(monkeypatch):
    """A header byte >= 0x80 must be a 401, not a 500.

    `hmac.compare_digest` raises `TypeError` on `str` holding anything outside ASCII, and
    ASGI hands header values over as latin-1 — so `X-Timbre-Secret: caf\\xe9` used to reach
    `matches` as a non-ASCII `str` and take the request down. An unhandled exception is a
    refusal too, but it is a billed invocation and it answers 500 where every other wrong
    secret answers 401. See docs/SECURITY.md, S-7.
    """
    security = build(monkeypatch, f"{OLD},{NEW}")("app.security")

    for wrong in ["café", "\xe9", "🎵", NEW[:-1] + "é", "\udce9"]:
        # The assertion is that this returns at all: before the fix each of these raised.
        assert not security.matches(wrong), wrong


def test_a_missing_secret_refuses_to_boot(monkeypatch):
    load = build(monkeypatch, None)
    with pytest.raises(Exception, match="refuses to start"):
        load("app.config")


def test_a_secret_of_only_separators_refuses_to_boot(monkeypatch):
    load = build(monkeypatch, " , , ")
    with pytest.raises(Exception, match="no usable secret"):
        load("app.config")
