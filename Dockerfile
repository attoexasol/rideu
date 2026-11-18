# syntax=docker/dockerfile:1
#
# DriveWize backend — multi-stage image
# Targets:
#   runtime  (default) — API process: node dist/index.js
#   migrate            — one-shot Drizzle migrator (do not run concurrent migrate jobs)
#
# Base: Node 22 bookworm-slim (glibc) for sharp prebuilt binaries.
# Never bake .env / secrets into layers.

ARG NODE_VERSION=22.23.5

# ---------------------------------------------------------------------------
# Builder: install all deps + compile TypeScript
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS builder

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Production dependency tree only (no Jest/eslint/drizzle-kit/etc.)
FROM node:${NODE_VERSION}-bookworm-slim AS prod-deps

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && npm cache clean --force

# ---------------------------------------------------------------------------
# Production runtime image
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    MIGRATIONS_FOLDER=/app/src/db/migrations

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates tini gosu \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs --create-home --home-dir /home/nodejs nodejs \
  && mkdir -p /app/private-media /app/uploads \
  && chown -R nodejs:nodejs /app /home/nodejs \
  # Runtime needs Node only. Remove base-image npm/corepack so Trivy does not
  # flag unused CLI tooling (pacote/sigstore/picomatch/brace-expansion/etc.).
  && rm -rf /usr/local/lib/node_modules/npm \
            /usr/local/lib/node_modules/corepack \
            /usr/local/bin/npm \
            /usr/local/bin/npx \
            /usr/local/bin/corepack \
            /opt/yarn-v1.22.22 \
            /usr/local/bin/yarn \
            /usr/local/bin/yarnpkg

COPY package.json package-lock.json ./
COPY --from=prod-deps --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/src/db/migrations ./src/db/migrations
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod 755 /entrypoint.sh

# Start as root so entrypoint can chown volume mounts, then gosu → nodejs
USER root

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health',(r)=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>process.exit(r.statusCode===200?0:1));}).on('error',()=>process.exit(1))"

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "dist/index.js"]

# ---------------------------------------------------------------------------
# Migrate target
# ---------------------------------------------------------------------------
FROM runtime AS migrate

ENV NODE_ENV=production
CMD ["node", "dist/db/migrate.js"]
