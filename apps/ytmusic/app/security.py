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

    **Compared as bytes, and that is not a style choice.** `hmac.compare_digest` raises
    `TypeError` on `str` arguments holding any character outside ASCII, and ASGI decodes
    header bytes as latin-1 — so a single byte >= 0x80 in `X-Timbre-Secret` reached this
    function as a non-ASCII `str` and took the whole request down with an unhandled
    exception. Measured 2026-08-21, against the deployed sidecar as well as locally:
    `X-Timbre-Secret: caf\\xe9` answered **500** where a wrong ASCII secret answers 401.

    That is a refusal either way, so nothing was ever let through. What it cost was an
    unauthenticated crash path anyone could hold open — a billed invocation per request on
    a serverless host — and a 401-vs-500 split that reports which service is answering.

    `surrogateescape` is what makes the encode total: latin-1 decoding can produce lone
    surrogates, and a plain `.encode()` would raise here for exactly the inputs this is
    meant to survive. The timing properties are unchanged; `compare_digest` on equal-length
    bytes is the same primitive.
    """
    candidate = presented.encode("utf-8", "surrogateescape")
    found = False
    for secret in SHARED_SECRETS:
        found |= hmac.compare_digest(candidate, secret.encode("utf-8"))
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
