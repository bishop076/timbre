"""Timbre's YouTube Music sidecar.

Exists for one reason: `ytmusicapi` is Python and has no maintained TypeScript
equivalent, while the rest of Timbre is a Next.js app.

Design rules, which the Phase 1 routes must keep to:

* Stateless. No database, no session store, no on-disk credential cache.
  The web app decrypts the user's OAuth credentials and passes them per call.
* Internal only. Bound to loopback, guarded by a shared secret.
* Thin. Translate to `ytmusicapi` and return its data. Normalization into
  canonical tracks belongs in the TypeScript adapter, so that all three
  providers normalize in exactly one place.
"""

from fastapi import Depends, FastAPI

from .config import PORT
from .routes import library
from .security import require_shared_secret

app = FastAPI(
    title="Timbre YouTube Music sidecar",
    version="0.0.0",
    # Internal service: no public docs.
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


@app.get("/health")
async def health() -> dict[str, object]:
    """Unauthenticated liveness probe, aggregated by the web app's /api/health.

    Deliberately open and deliberately empty of detail: a probe that leaks
    version or credential state is a reconnaissance endpoint.
    """
    return {"status": "ok", "service": "ytmusic"}


app.include_router(
    library.router,
    prefix="/library",
    dependencies=[Depends(require_shared_secret)],
)


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    from .config import HOST

    uvicorn.run(app, host=HOST, port=PORT)
