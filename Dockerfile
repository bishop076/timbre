FROM node:22-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5

WORKDIR /home/node/app

RUN corepack enable && chown node:node /home/node/app
USER node

COPY --chown=node:node . .

RUN pnpm install --frozen-lockfile

RUN YTMUSIC_SHARED_SECRET=build-placeholder \
    pnpm --filter @timbre/web exec next build

ENV NODE_ENV=production PORT=10000
EXPOSE 10000

CMD ["sh", "-c", "exec pnpm --filter @timbre/web exec next start -p ${PORT:-10000} -H 0.0.0.0"]
