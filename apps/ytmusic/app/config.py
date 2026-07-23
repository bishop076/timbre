"""Sidecar configuration.

Deliberately tiny. This service holds no secrets of its own and never touches
the database: the web app decrypts a user's YouTube credentials and passes them
per request. The only secret here is the shared token proving the caller is the
web app.
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


# Must match YTMUSIC_SHARED_SECRET in the web app's environment.
SHARED_SECRET = require("YTMUSIC_SHARED_SECRET")

# Bind to loopback by default. This service authenticates callers with a static
# shared secret only, which is adequate on a private network and inadequate on
# a public one — so exposing it must be a deliberate act.
HOST = os.environ.get("YTMUSIC_HOST", "127.0.0.1")
PORT = int(os.environ.get("YTMUSIC_PORT", "8787"))
