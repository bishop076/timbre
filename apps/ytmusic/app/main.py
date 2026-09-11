from fastapi import Depends, FastAPI

from .routes import lyrics, playlist, radio, search
from .security import require_shared_secret

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/health")
def health() -> dict[str, object]:
    return {"status": "ok", "service": "ytmusic"}


for module in (search, radio, playlist, lyrics):
    app.include_router(module.router, dependencies=[Depends(require_shared_secret)])


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    from .config import HOST, PORT

    uvicorn.run(app, host=HOST, port=PORT)
