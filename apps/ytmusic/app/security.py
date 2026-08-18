"""Caller authentication for the sidecar."""

import hmac

from fastapi import Header, HTTPException, status

from .config import SHARED_SECRETS

HEADER_NAME = "X-Timbre-Secret"


def matches(presented: str) -> bool:
    """Whether `presented` is any of the accepted secrets.

    Constant-time throughout, in two respects. Each comparison is `hmac.compare_digest`,
    because a naive `==` leaks the secret one byte at a time to anyone who can measure
    response latency. And the results are accumulated rather than short-circuited — `any()`
    with a generator stops at the first match, so the time taken would report *which*
    secret matched, and during a rotation that distinguishes a caller still on the old one.
    Every configured secret is compared, every time.
    """
    found = False
    for secret in SHARED_SECRETS:
        found |= hmac.compare_digest(presented, secret)
    return found


async def require_shared_secret(
    x_timbre_secret: str | None = Header(default=None, alias=HEADER_NAME),
) -> None:
    """Rejects any caller that is not the Timbre web app."""
    if x_timbre_secret is None or not matches(x_timbre_secret):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid shared secret.",
        )
