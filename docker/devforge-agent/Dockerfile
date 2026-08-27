# DevForge agent runtime (Rig 0.42) — rustc 1.90 required
FROM rust:1.90-bookworm AS build
WORKDIR /src
COPY agent/ ./
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/target/release/devforge-agent /usr/local/bin/devforge-agent
ENV AGENT_LISTEN=0.0.0.0:8090
EXPOSE 8090
HEALTHCHECK --interval=10s --timeout=3s --retries=10 \
    CMD curl -fsS http://127.0.0.1:8090/health || exit 1
USER 65534:65534
CMD ["devforge-agent"]
