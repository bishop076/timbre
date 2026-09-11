FROM ghcr.io/astral-sh/uv:0.12.5@sha256:e85be844203885286c60ffad8a858d48afb6c5a5c237ca0e67f12e74b8f174b1 AS uv

FROM python:3.12-slim@sha256:78387bc3881b8273120a12ebe6c1ab22b018ccc2c9adf565ae1ac9b536e184ea AS requirements
COPY --from=uv /uv /usr/local/bin/uv
WORKDIR /src
COPY pyproject.toml uv.lock ./
RUN uv export --frozen --no-dev --no-emit-project -o requirements.txt

FROM python:3.12-slim@sha256:78387bc3881b8273120a12ebe6c1ab22b018ccc2c9adf565ae1ac9b536e184ea

RUN useradd -m -u 1000 timbre
USER timbre
ENV PATH="/home/timbre/.local/bin:${PATH}"

WORKDIR /home/timbre/app

COPY --from=requirements --chown=timbre:timbre /src/requirements.txt ./
RUN pip install --no-cache-dir --user --require-hashes -r requirements.txt \
 && rm requirements.txt
COPY --chown=timbre:timbre app ./app

ENV YTMUSIC_HOST=0.0.0.0 PORT=10000
EXPOSE 10000

CMD ["sh", "-c", "exec python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-10000}"]
