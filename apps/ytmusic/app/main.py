"""Timbre's YouTube Music sidecar.

Exists for one reason: `ytmusicapi` is Python and has no maintained TypeScript
equivalent, while the rest of Timbre is a Next.js app.

Design rules the routes keep to:

* **Stateless and credential-free.** Search and public lookup work
  unauthenticated, so this service holds no user tokens, no sessions and no
  database connection. Compromising it yields nothing at rest.
* **Internal only.** Bound to loopback, guarded by a shared secret.
* **Thin.** Flatten `ytmusicapi`'s shapes and return them. Canonical
  normalization lives in @timbre/core so every source normalizes once.
* **Never extracts streams.** Timbre embeds official players. Signed audio
  URLs returned by upstream calls are ignored, never forwarded.
"""

from fastapi import Depends, FastAPI

from .config import PORT
from .routes import search
from .security import require_shared_secret

app = FastAPI(
    title="Timbre YouTube Music sidecar",
    version="0.1.0",
    # Internal service: no public docs.
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


@app.get("/health")
def health() -> dict[str, object]:
    """Unauthenticated liveness probe, aggregated by the web app's /api/health.

    Deliberately open and deliberately empty of detail: a probe that leaks
    version or credential state is a reconnaissance endpoint.
    """
    return {"status": "ok", "service": "ytmusic"}


app.include_router(
    search.router,
    dependencies=[Depends(require_shared_secret)],
)


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    from .config import HOST

    uvicorn.run(app, host=HOST, port=PORT)
