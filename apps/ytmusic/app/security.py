import hmac

from fastapi import Header, HTTPException, status

from .config import SHARED_SECRETS


def matches(presented: str) -> bool:
    candidate = presented.encode("utf-8", "surrogateescape")
    found = False
    for secret in SHARED_SECRETS:
        found |= hmac.compare_digest(candidate, secret.encode("utf-8"))
    return found


async def require_shared_secret(
    x_timbre_secret: str | None = Header(default=None, alias="X-Timbre-Secret"),
) -> None:
    if x_timbre_secret is None or not matches(x_timbre_secret):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing or invalid shared secret.")
