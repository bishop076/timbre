FROM python:3.12-slim

RUN useradd -m -u 1000 timbre
USER timbre
ENV PATH="/home/timbre/.local/bin:${PATH}"

WORKDIR /home/timbre/app

COPY --chown=timbre:timbre pyproject.toml uv.lock ./
RUN pip install --no-cache-dir --user uv \
 && uv export --frozen --no-dev --no-emit-project --no-hashes -o requirements.txt \
 && pip install --no-cache-dir --user -r requirements.txt \
 && pip uninstall -y uv \
 && rm requirements.txt
COPY --chown=timbre:timbre app ./app

ENV YTMUSIC_HOST=0.0.0.0

ENV PORT=10000
EXPOSE 10000

CMD ["sh", "-c", "exec python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-10000}"]
