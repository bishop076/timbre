from fastapi import Depends, FastAPI

from .config import PORT
from .routes import lyrics, playlist, radio, search
from .security import require_shared_secret

app = FastAPI(
    title="Timbre YouTube Music sidecar",
    version="0.1.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


@app.get("/health")
def health() -> dict[str, object]:
    return {"status": "ok", "service": "ytmusic"}


app.include_router(
    search.router,
    dependencies=[Depends(require_shared_secret)],
)

app.include_router(
    radio.router,
    dependencies=[Depends(require_shared_secret)],
)

app.include_router(
    playlist.router,
    dependencies=[Depends(require_shared_secret)],
)

app.include_router(
    lyrics.router,
    dependencies=[Depends(require_shared_secret)],
)


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    from .config import HOST

    uvicorn.run(app, host=HOST, port=PORT)
