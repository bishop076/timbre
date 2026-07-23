"""Caller authentication for the sidecar."""

import hmac

from fastapi import Header, HTTPException, status

from .config import SHARED_SECRET

HEADER_NAME = "X-Timbre-Secret"


async def require_shared_secret(
    x_timbre_secret: str | None = Header(default=None, alias=HEADER_NAME),
) -> None:
    """Rejects any caller that is not the Timbre web app.

    Uses a constant-time comparison: a naive `==` leaks the secret one byte at a
    time to anyone who can measure response latency.
    """
    if x_timbre_secret is None or not hmac.compare_digest(x_timbre_secret, SHARED_SECRET):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid shared secret.",
        )
