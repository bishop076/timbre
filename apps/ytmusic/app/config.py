"""Sidecar configuration.

Deliberately tiny. There is no database and no user credential anywhere in
Timbre: every call this service makes to YouTube Music is unauthenticated, so
there is nothing here worth stealing. The one secret is the shared token
proving a caller is the web app rather than the open internet.
"""

import os


class ConfigError(RuntimeError):
    """Raised at import time so a misconfigured service fails to boot loudly."""


def require(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise ConfigError(
            f"{name} is not set. The ytmusic sidecar refuses to start without it."
        )
    return value


def require_secrets(name: str) -> tuple[str, ...]:
    """The accepted shared secrets, newest first, from one comma-separated variable.

    **A list rather than a value, so rotation is not an outage.** The web app and this
    service are deployed independently, so a single secret can only be changed in two
    steps, and between them one side holds the new value while the other still sends the
    old — every search 401s until both settle. A secret whose rotation costs downtime does
    not get rotated, which is how a static credential quietly becomes a permanent one.

    With a list the sequence has no gap: add the new secret here alongside the old, move
    the web app to the new one, then drop the old from here.

    Commas cannot appear in a secret. That is not a real constraint — the documented way to
    make one is `openssl rand -hex 32`.
    """
    values = tuple(part.strip() for part in require(name).split(",") if part.strip())
    if not values:
        raise ConfigError(f"{name} is set but contains no usable secret.")
    return values


# Must match YTMUSIC_SHARED_SECRET in the web app's environment. The web app sends exactly
# one; this accepts any in the list, which is what makes the changeover seamless.
SHARED_SECRETS = require_secrets("YTMUSIC_SHARED_SECRET")

# Bind to loopback by default. This service authenticates callers with a static
# shared secret only, which is adequate on a private network and inadequate on
# a public one — so exposing it must be a deliberate act.
HOST = os.environ.get("YTMUSIC_HOST", "127.0.0.1")
PORT = int(os.environ.get("YTMUSIC_PORT", "8787"))
