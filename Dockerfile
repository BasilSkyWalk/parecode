# syntax=docker/dockerfile:1
#
# Dockerfile for Glama automated safety/quality checks.
# Glama runs this image; it does NOT need to live in the repo (you can paste it
# into the server's admin page on glama.ai instead). Kept here for version control.
#
# parecode's only runtime dependency is ripgrep on PATH — it shells out to the
# system binary and never bundles it, so the runtime image installs it via apt.

FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ripgrep \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY plugins ./plugins
COPY .claude-plugin ./.claude-plugin
ENTRYPOINT ["node", "dist/cli/index.js", "serve"]
