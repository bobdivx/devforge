# DevForge Web — nginx serving the Astro/Preact SPA at /
# Build from repo root:
#   docker build -f docker/devforge-web/Dockerfile -t devforge-web:local .

FROM node:24-alpine AS build

WORKDIR /app
COPY package*.json ./
COPY frontend/package.json ./frontend/package.json
RUN --mount=type=cache,target=/root/.npm \
    npm ci

COPY frontend ./frontend
COPY package.json ./

# Production SPA root (gateway proxies API separately)
ENV DEVFORGE_SPA_BASE=/
WORKDIR /app/frontend
RUN npm run build

FROM nginx:1.27-alpine

RUN rm -f /etc/nginx/conf.d/default.conf
COPY docker/devforge-web/nginx.conf /etc/nginx/conf.d/devforge.conf
COPY --from=build /app/backend/public/devforge /usr/share/nginx/html

# Astro with base=/ still writes into outDir ../backend/public/devforge;
# when base is /, assets are at site root of that outDir — serve as document root.
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
    CMD wget -qO- http://127.0.0.1:80/ >/dev/null || exit 1

EXPOSE 80

LABEL org.opencontainers.image.title="DevForge Web" \
      org.opencontainers.image.description="DevForge static SPA" \
      org.opencontainers.image.source="https://github.com/bobdivx/devforge"
