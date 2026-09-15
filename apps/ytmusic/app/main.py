import logging

from fastapi import FastAPI, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .routes import lyrics, playlist, radio, search
from .security import RequireSharedSecret

logger = logging.getLogger(__name__)

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(RequireSharedSecret)


@app.exception_handler(Exception)
async def unexpected(request: Request, error: Exception) -> JSONResponse:
    """The last stop for anything a route did not turn into an HTTPException.

    Starlette's own fallback answers `text/plain` "Internal Server Error", which is the one
    reply from this service that is not the `{"detail": ...}` shape every caller parses, and
    it names neither the route nor the exception in our logs. Starlette re-raises afterwards,
    so uvicorn still prints the traceback; this line only says which request produced it.
    """
    logger.error(
        "unhandled %s on %s %s: %s",
        type(error).__name__,
        request.method,
        request.url.path,
        error,
    )
    detail = "The ytmusic sidecar failed to handle that request."
    return JSONResponse({"detail": detail}, status.HTTP_500_INTERNAL_SERVER_ERROR)


@app.exception_handler(RequestValidationError)
async def invalid_request(_: Request, error: RequestValidationError) -> JSONResponse:
    issues = [
        {key: value for key, value in issue.items() if key != "input"} for issue in error.errors()
    ]
    return JSONResponse({"detail": jsonable_encoder(issues)}, status.HTTP_422_UNPROCESSABLE_CONTENT)


@app.get("/health")
def health() -> dict[str, object]:
    return {"status": "ok", "service": "ytmusic"}


for module in (search, radio, playlist, lyrics):
    app.include_router(module.router)


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    from .config import HOST, PORT

    uvicorn.run(app, host=HOST, port=PORT)
