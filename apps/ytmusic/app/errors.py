import logging

from fastapi import HTTPException, status

logger = logging.getLogger(__name__)


def upstream_error(action: str, error: Exception) -> HTTPException:
    logger.warning("ytmusicapi %s failed: %s", action, error, exc_info=error)
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=f"YouTube Music {action} failed.",
    )
