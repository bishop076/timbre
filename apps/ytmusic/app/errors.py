"""Shared error mapping for the routes.

Lifted out of `routes/search.py` when a second router needed it. Importing a
private name across sibling route modules is worse than a small shared module.
"""

import logging

from fastapi import HTTPException, status

logger = logging.getLogger(__name__)


def upstream_error(action: str, error: Exception) -> HTTPException:
    """ytmusicapi rides YouTube's private API, so failures are upstream
    problems rather than bad requests. 502 tells the caller to retry or fall
    back to another source rather than to fix its input."""
    logger.warning("ytmusicapi %s failed: %s", action, error, exc_info=error)
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=f"YouTube Music {action} failed.",
    )
