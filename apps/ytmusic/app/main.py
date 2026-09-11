from fastapi import FastAPI, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .routes import lyrics, playlist, radio, search
from .security import RequireSharedSecret

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(RequireSharedSecret)


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
