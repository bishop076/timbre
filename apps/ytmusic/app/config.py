import os


class ConfigError(RuntimeError):
    ...


def require_secrets(name: str) -> tuple[str, ...]:
    raw = os.environ.get(name)
    if not raw:
        raise ConfigError(f"{name} is not set. The ytmusic sidecar refuses to start without it.")
    values = tuple(part.strip() for part in raw.split(",") if part.strip())
    if not values:
        raise ConfigError(f"{name} is set but contains no usable secret.")
    return values


SHARED_SECRETS = require_secrets("YTMUSIC_SHARED_SECRET")

HOST = os.environ.get("YTMUSIC_HOST", "127.0.0.1")
PORT = int(os.environ.get("YTMUSIC_PORT", "8787"))
