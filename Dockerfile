# Timbre web app as a container. **Not the primary deployment path** — that is
# Vercel, which builds from source and needs nothing here (see docs/DEPLOY.md).
#
# This exists because free hosting churns: Fly.io's free tier ended in 2024,
# Koyeb's closed to new signups in Feb 2026, and Hugging Face put Docker Spaces
# behind PRO in Jul 2026. Three of four candidate hosts died inside twenty
# months. Keeping a *tested* container build means moving off Vercel is an
# afternoon rather than a project. Build it after changing it, or delete it —
# an untested escape hatch is worse than none.
#
# Build context is the monorepo root, not apps/web: the app imports @timbre/core
# and @timbre/providers as workspace *source* with no build step of their own,
# which is why next.config.ts lists them in transpilePackages. A context of
# apps/web alone would resolve neither.
#
# Deliberately not a multi-stage build. pnpm's node_modules is a symlink farm
# into a content-addressed store, and copying it between stages by hand is the
# kind of thing that works until it silently doesn't. A larger image is the
# better trade here — Spaces don't bill for it.

FROM node:22-slim

# Run unprivileged. Next writes to .next/cache at runtime, so the build output
# has to be owned by the user that will actually run it. The node image already
# ships a `node` user at UID 1000 — creating another there fails the build
# outright, so reuse it rather than adding one.
WORKDIR /home/node/app

# WORKDIR creates the directory as root, and COPY --chown only fixes the files
# inside it — leaving pnpm unable to write its own temp files into the root-owned
# parent. Hand the directory over before dropping privileges.
RUN corepack enable && chown node:node /home/node/app
USER node

COPY --chown=node:node . .

# --frozen-lockfile so a drifted pnpm-lock.yaml fails the build instead of
# quietly resolving different versions than the ones you tested against.
RUN pnpm install --frozen-lockfile

# The `build` script in apps/web/package.json wraps next in `dotenv -e ../../.env`,
# which is right for local development and wrong here: there is no .env in the
# image, and dotenv-cli exits non-zero when the file is missing. Call next directly
# and let the platform's environment through.
#
# The placeholders exist only to satisfy the zod schema in apps/web/lib/env.ts if
# a route evaluates it during prerender. They are overwritten by the real
# environment at runtime and never reach a live connection.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build \
    TIMBRE_ENCRYPTION_KEY=build-placeholder \
    AUTH_SECRET=build-placeholder \
    YTMUSIC_SHARED_SECRET=build-placeholder \
    pnpm --filter @timbre/web exec next build

ENV NODE_ENV=production
ENV PORT=10000
EXPOSE 10000

# -H 0.0.0.0 because the dev script binds 127.0.0.1, and a container bound to
# loopback accepts no traffic at all — it just times out with a healthy-looking
# log. Shell form so ${PORT} expands; hosts assign the port rather than accept one.
CMD ["sh", "-c", "exec pnpm --filter @timbre/web exec next start -p ${PORT:-10000} -H 0.0.0.0"]
