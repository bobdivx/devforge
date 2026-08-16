# DevForge proxy — stock nginx with the SPA/API/realtime gateway config.
# Build from repo root:
#   docker build -f docker/devforge-proxy/Dockerfile -t bobdivx/devforge:proxy-4.1.2 .

FROM nginx:1.27.5-alpine

COPY docker/devforge-proxy/nginx.conf /etc/nginx/conf.d/default.conf

HEALTHCHECK --interval=10s --timeout=3s --retries=10 \
    CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1

EXPOSE 80

LABEL org.opencontainers.image.title="DevForge Proxy" \
      org.opencontainers.image.description="DevForge nginx gateway (SPA + API + realtime)" \
      org.opencontainers.image.source="https://github.com/bobdivx/devforge"
