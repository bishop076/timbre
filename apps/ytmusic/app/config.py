import os

MIN_SECRET_LENGTH = 32


class ConfigError(RuntimeError):
    ...


def require_secrets(name: str) -> tuple[str, ...]:
    raw = os.environ.get(name)
    if not raw:
        raise ConfigError(f"{name} is not set. The ytmusic sidecar refuses to start without it.")
    values = tuple(part.strip() for part in raw.split(",") if part.strip())
    if not values:
        raise ConfigError(f"{name} is set but contains no usable secret.")
    if any(len(value) < MIN_SECRET_LENGTH for value in values):
        # A warning is the wrong answer to a guessable credential. There is no rate limit in
        # front of this service and no alert on a run of 401s, so a short secret is a door
        # left open quietly rather than a defect anyone would notice in a log. Refusing to
        # start makes it a deploy that fails loudly instead. Nothing ships a short one: both
        # Vercel projects hold freshly generated 64-character values, the two placeholders in
        # CI (`ci-placeholder`, `build-placeholder`) are the web app's and never reach this
        # module, and DEPLOY.md and RUNNING.md both say `openssl rand -hex 32`.
        raise ConfigError(
            f"{name} holds a secret shorter than {MIN_SECRET_LENGTH} characters. "
            "Replace it with one from openssl rand -hex 32."
        )
    return values


SHARED_SECRETS = require_secrets("YTMUSIC_SHARED_SECRET")

HOST = os.environ.get("YTMUSIC_HOST", "127.0.0.1")
PORT = int(os.environ.get("YTMUSIC_PORT", "8787"))
