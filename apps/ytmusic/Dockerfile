# Timbre's YouTube Music sidecar, packaged for a Hugging Face Docker Space.
#
# Build context is apps/ytmusic — the sidecar depends on nothing else in the
# monorepo by design (see app/main.py: stateless, credential-free, no database).
# That independence is what lets it deploy as its own Space.

FROM python:3.12-slim

# Hugging Face Spaces run the container as UID 1000. Installing as root and
# running as root works, but pip's cache and any runtime temp files then belong
# to a user the platform may not give us, so match its expectation up front.
RUN useradd -m -u 1000 timbre
USER timbre
ENV PATH="/home/timbre/.local/bin:${PATH}"

WORKDIR /home/timbre/app

# Manifest and lockfile first: dependency installs stay cached while route code churns.
#
# Installed from `uv.lock` — the pins CI and Vercel install — rather than `pip install .`,
# which re-resolved every open range in pyproject.toml at build time and could ship a
# ytmusicapi nothing had tested. There is also no `[build-system]` to install the project
# *with*: the app runs from the working directory, not from site-packages, so only the
# dependencies are installed (`--no-emit-project`).
COPY --chown=timbre:timbre pyproject.toml uv.lock ./
RUN pip install --no-cache-dir --user uv \
 && uv export --frozen --no-dev --no-emit-project --no-hashes -o requirements.txt \
 && pip install --no-cache-dir --user -r requirements.txt \
 && pip uninstall -y uv \
 && rm requirements.txt
COPY --chown=timbre:timbre app ./app

# config.py defaults to loopback on purpose — exposing this service has to be a
# deliberate act. This is that act. It is still guarded by the shared secret,
# which is the only thing standing between the open internet and your quota, so
# YTMUSIC_SHARED_SECRET must be a real 32-byte random value, not a placeholder.
ENV YTMUSIC_HOST=0.0.0.0

# The host assigns the port at runtime — Render injects $PORT and routes to it,
# and a hardcoded port means the health check never passes. 10000 is Render's
# default and a fine local fallback.
ENV PORT=10000
EXPOSE 10000

# Shell form, not exec form: ${PORT} needs a shell to expand. Exec form would
# pass the literal string "${PORT}" to uvicorn and fail to parse it as an int.
#
# No --reload: that spawns a supervisor plus a child, which is what orphans a
# stale process holding the port (see RUNNING.md). One process, one job.
CMD ["sh", "-c", "exec python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-10000}"]
