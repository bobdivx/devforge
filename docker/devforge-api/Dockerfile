# DevForge API — Laravel/PHP (based on production Coolify image layout)
# Build from repo root:
#   docker build -f docker/devforge-api/Dockerfile -t devforge-api:local .

ARG SERVERSIDEUP_PHP_VERSION=8.4-fpm-nginx-alpine
ARG MINIO_VERSION=RELEASE.2025-05-21T01-59-54Z
ARG CLOUDFLARED_VERSION=2025.7.0
ARG POSTGRES_VERSION=18
ARG NGINX_VERSION=1.31.3-r1
ARG USER_ID=9999
ARG GROUP_ID=9999

FROM serversideup/php:${SERVERSIDEUP_PHP_VERSION} AS base

USER root

ARG NGINX_VERSION
RUN set -eux; \
    apk add --no-cache ca-certificates curl; \
    NGINX_ALPINE_VERSION="$(egrep -o '^[0-9]+\.[0-9]+' /etc/alpine-release)"; \
    NGINX_REPOSITORY="https://nginx.org/packages/mainline/alpine/v${NGINX_ALPINE_VERSION}/main"; \
    sed -i 's|http://nginx.org/packages|https://nginx.org/packages|g' /etc/apk/repositories; \
    grep -qxF "@nginx ${NGINX_REPOSITORY}" /etc/apk/repositories || echo "@nginx ${NGINX_REPOSITORY}" >> /etc/apk/repositories; \
    curl -fsSL https://nginx.org/keys/nginx_signing.rsa.pub -o /etc/apk/keys/nginx_signing.rsa.pub; \
    apk add --no-cache --upgrade "nginx@nginx=${NGINX_VERSION}"; \
    rm -f /etc/nginx/nginx.conf /etc/nginx/conf.d/default.conf; \
    nginx -v

ARG USER_ID
ARG GROUP_ID

RUN docker-php-serversideup-set-id www-data $USER_ID:$GROUP_ID && \
    docker-php-serversideup-set-file-permissions --owner $USER_ID:$GROUP_ID --service nginx

WORKDIR /var/www/html
COPY --chown=www-data:www-data backend/composer.json backend/composer.lock ./
RUN --mount=type=cache,target=/tmp/cache \
    COMPOSER_CACHE_DIR=/tmp/cache composer install --no-dev --no-interaction --no-plugins --no-scripts --prefer-dist

USER www-data

FROM node:24-alpine AS static-assets

WORKDIR /app
COPY package*.json ./
COPY backend/vite.config.js ./backend/vite.config.js
COPY backend/postcss.config.cjs ./backend/postcss.config.cjs
COPY frontend/package.json ./frontend/package.json
RUN --mount=type=cache,target=/root/.npm \
    npm ci
COPY . .
# Laravel Vite assets + DevForge SPA (embedded fallback under public/devforge)
ENV DEVFORGE_SPA_BASE=/devforge
RUN npm run build

FROM minio/mc:${MINIO_VERSION} AS minio-client

FROM serversideup/php:${SERVERSIDEUP_PHP_VERSION}

ARG USER_ID
ARG GROUP_ID
ARG TARGETPLATFORM
ARG POSTGRES_VERSION
ARG CLOUDFLARED_VERSION
ARG NGINX_VERSION
ARG CI=true

WORKDIR /var/www/html

USER root

RUN set -eux; \
    apk add --no-cache ca-certificates curl; \
    NGINX_ALPINE_VERSION="$(egrep -o '^[0-9]+\.[0-9]+' /etc/alpine-release)"; \
    NGINX_REPOSITORY="https://nginx.org/packages/mainline/alpine/v${NGINX_ALPINE_VERSION}/main"; \
    sed -i 's|http://nginx.org/packages|https://nginx.org/packages|g' /etc/apk/repositories; \
    grep -qxF "@nginx ${NGINX_REPOSITORY}" /etc/apk/repositories || echo "@nginx ${NGINX_REPOSITORY}" >> /etc/apk/repositories; \
    curl -fsSL https://nginx.org/keys/nginx_signing.rsa.pub -o /etc/apk/keys/nginx_signing.rsa.pub; \
    apk add --no-cache --upgrade "nginx@nginx=${NGINX_VERSION}"; \
    rm -f /etc/nginx/nginx.conf /etc/nginx/conf.d/default.conf; \
    nginx -v

RUN docker-php-serversideup-set-id www-data $USER_ID:$GROUP_ID && \
    docker-php-serversideup-set-file-permissions --owner $USER_ID:$GROUP_ID --service nginx

RUN apk add --no-cache gnupg && \
    mkdir -p /usr/share/keyrings && \
    curl -fSsL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor > /usr/share/keyrings/postgresql.gpg

RUN --mount=type=cache,target=/var/cache/apk \
    apk upgrade && \
    apk add --no-cache \
    postgresql${POSTGRES_VERSION}-client \
    openssh-client \
    git \
    git-lfs \
    jq \
    lsof \
    vim

RUN echo "alias ll='ls -al'" >> /etc/profile && \
    echo "alias a='php artisan'" >> /etc/profile && \
    echo "alias logs='tail -f storage/logs/laravel.log'" >> /etc/profile

RUN mkdir -p /usr/local/bin && \
    if [ "${TARGETPLATFORM}" = "linux/amd64" ]; then \
    curl -sSL "https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-linux-amd64" -o /usr/local/bin/cloudflared; \
    elif [ "${TARGETPLATFORM}" = "linux/arm64" ]; then \
    curl -sSL "https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-linux-arm64" -o /usr/local/bin/cloudflared; \
    fi && \
    chmod +x /usr/local/bin/cloudflared

COPY docker/production/etc/php/conf.d/zzz-custom-php.ini /usr/local/etc/php/conf.d/zzz-custom-php.ini
ENV PHP_OPCACHE_ENABLE=1

COPY --chmod=755 docker/production/entrypoint.d/ /etc/entrypoint.d

COPY --from=base --chown=www-data:www-data /var/www/html/vendor ./vendor

COPY --chown=www-data:www-data backend/composer.json backend/composer.lock ./
COPY --chown=www-data:www-data backend/app ./app
COPY --chown=www-data:www-data backend/bootstrap ./bootstrap
COPY --chown=www-data:www-data backend/config ./config
COPY --chown=www-data:www-data backend/database ./database
COPY --chown=www-data:www-data backend/lang ./lang
COPY --chown=www-data:www-data backend/public ./public
COPY --from=static-assets --chown=www-data:www-data /app/backend/public/build ./public/build
COPY --from=static-assets --chown=www-data:www-data /app/backend/public/devforge ./public/devforge
COPY --chown=www-data:www-data backend/routes ./routes
COPY --chown=www-data:www-data backend/storage ./storage
COPY --chown=www-data:www-data backend/templates ./templates
COPY --chown=www-data:www-data backend/resources/views ./resources/views
COPY --chown=www-data:www-data backend/artisan artisan
COPY --chown=www-data:www-data backend/openapi.yaml ./openapi.yaml
COPY --chown=www-data:www-data docs/changelogs/ ./changelogs/

RUN composer dump-autoload

COPY docker/production/etc/nginx/conf.d/custom.conf /etc/nginx/conf.d/custom.conf
COPY docker/production/etc/nginx/site-opts.d/http.conf /etc/nginx/site-opts.d/http.conf
COPY --chmod=755 docker/production/etc/s6-overlay/ /etc/s6-overlay/

RUN mkdir -p /etc/nginx/conf.d && \
    chown -R www-data:www-data /etc/nginx && \
    chmod -R 755 /etc/nginx

COPY --from=minio-client /usr/bin/mc /usr/bin/mc
RUN chmod +x /usr/bin/mc

USER www-data

LABEL org.opencontainers.image.title="DevForge API" \
      org.opencontainers.image.description="DevForge Laravel backend" \
      org.opencontainers.image.source="https://github.com/bobdivx/devforge"
