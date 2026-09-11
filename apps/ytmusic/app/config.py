import os


class ConfigError(RuntimeError):
    ...


def require(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise ConfigError(
            f"{name} is not set. The ytmusic sidecar refuses to start without it."
        )
    return value


def require_secrets(name: str) -> tuple[str, ...]:
    values = tuple(part.strip() for part in require(name).split(",") if part.strip())
    if not values:
        raise ConfigError(f"{name} is set but contains no usable secret.")
    return values


SHARED_SECRETS = require_secrets("YTMUSIC_SHARED_SECRET")

HOST = os.environ.get("YTMUSIC_HOST", "127.0.0.1")
PORT = int(os.environ.get("YTMUSIC_PORT", "8787"))
