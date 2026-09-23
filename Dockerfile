# DevForge v2 — API + UI (self-contained).

FROM node:22-bookworm AS web
WORKDIR /web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm install --include=optional
COPY apps/web/ ./
ENV PUBLIC_SERVER_URL=/api/v1
RUN npm run build

FROM rust:bookworm AS builder
WORKDIR /src
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev \
  && rm -rf /var/lib/apt/lists/*
COPY . .
RUN cargo build -p devforge-server --release

FROM docker:27-cli AS dockercli

# Node 22 : atelier `npm i` + `npm run dev` dans le même conteneur que l’API.
FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git libssl3 openssh-client procps psmisc \
  && rm -rf /var/lib/apt/lists/*
COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=dockercli /usr/local/libexec/docker/cli-plugins /usr/local/libexec/docker/cli-plugins
COPY --from=builder /src/target/release/devforge-server /usr/local/bin/devforge-server
COPY --from=web /web/dist /app/web
COPY crates/templates /app/templates
ENV HOST=0.0.0.0 \
    PORT=8000 \
    DATABASE_URL=sqlite:/data/devforge.db?mode=rwc \
    DEVFORGE_DATA_DIR=/data \
    DEVFORGE_STATIC_DIR=/app/web \
    DEVFORGE_TEMPLATES_DIR=/app/templates \
    DEVFORGE_UPDATE_MODE=docker \
    DEVFORGE_SELF_CONTAINER=devforge \
    DEVFORGE_UPDATE_IMAGE=bobdivx/devforge \
    DEVFORGE_EXECUTOR=local \
    DEVFORGE_SSH_KEY=/data/ssh/id_ed25519
VOLUME ["/data"]
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --retries=10 \
  CMD curl -fsS http://127.0.0.1:8000/api/v1/health || exit 1
ENTRYPOINT ["/usr/local/bin/devforge-server"]
