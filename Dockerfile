FROM node:22-slim

WORKDIR /home/node/app

RUN corepack enable && chown node:node /home/node/app
USER node

COPY --chown=node:node . .

RUN pnpm install --frozen-lockfile

RUN YTMUSIC_SHARED_SECRET=build-placeholder \
    pnpm --filter @timbre/web exec next build

ENV NODE_ENV=production
ENV PORT=10000
EXPOSE 10000

CMD ["sh", "-c", "exec pnpm --filter @timbre/web exec next start -p ${PORT:-10000} -H 0.0.0.0"]
