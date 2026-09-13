import hmac
import logging

from fastapi import HTTPException, status
from fastapi.responses import JSONResponse
from starlette.datastructures import Headers
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .config import SHARED_SECRETS

logger = logging.getLogger(__name__)

MAX_BODY = 16 * 1024
UNAUTHORIZED = "Missing or invalid shared secret."
TOO_LARGE = "Request body too large."


def matches(presented: str) -> bool:
    candidate = presented.encode("utf-8", "surrogateescape")
    found = False
    for secret in SHARED_SECRETS:
        found |= hmac.compare_digest(candidate, secret.encode("utf-8"))
    return found


class RequireSharedSecret:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["path"] == "/health":
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        secret = headers.get("x-timbre-secret")
        if secret is None or not matches(secret):
            # A brute-force attempt and a misconfigured deploy are the same event without
            # this line. Never log the value presented: a near-miss is still a credential.
            client = scope.get("client")
            logger.warning(
                "refused %s %s from %s: %s",
                scope.get("method", "?"),
                scope["path"],
                client[0] if client else "unknown",
                "no shared secret" if secret is None else "wrong shared secret",
            )
            refusal = JSONResponse({"detail": UNAUTHORIZED}, status.HTTP_401_UNAUTHORIZED)
            await refusal(scope, receive, send)
            return

        length = headers.get("content-length", "0")
        if not length.isdecimal() or int(length) > MAX_BODY:
            refusal = JSONResponse({"detail": TOO_LARGE}, status.HTTP_413_CONTENT_TOO_LARGE)
            await refusal(scope, receive, send)
            return

        received = 0

        async def capped() -> Message:
            nonlocal received
            message = await receive()
            received += len(message.get("body", b""))
            if received > MAX_BODY:
                raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, TOO_LARGE)
            return message

        await self.app(scope, capped, send)
