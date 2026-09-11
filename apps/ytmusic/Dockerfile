FROM python:3.12-slim@sha256:78387bc3881b8273120a12ebe6c1ab22b018ccc2c9adf565ae1ac9b536e184ea

RUN useradd -m -u 1000 timbre
USER timbre
ENV PATH="/home/timbre/.local/bin:${PATH}"

WORKDIR /home/timbre/app

COPY --chown=timbre:timbre pyproject.toml uv.lock ./
RUN pip install --no-cache-dir --user uv==0.12.5 \
 && uv export --frozen --no-dev --no-emit-project -o requirements.txt \
 && pip install --no-cache-dir --user --require-hashes -r requirements.txt \
 && pip uninstall -y uv \
 && rm requirements.txt
COPY --chown=timbre:timbre app ./app

ENV YTMUSIC_HOST=0.0.0.0 PORT=10000
EXPOSE 10000

CMD ["sh", "-c", "exec python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-10000}"]
