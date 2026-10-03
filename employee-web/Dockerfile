# syntax=docker/dockerfile:1.7
# The employee web app as one small image: Node builds the static files, Caddy serves them and forwards /api/v1/* to the API.
#
#   docker build -t calling-employee-web ./employee-web
#   docker run -p 8080:80 -e API_UPSTREAM=http://api:8000 calling-employee-web
#
# Build arguments:  VITE_APP_VERSION  shown on the Profile page
#                   VITE_API_BASE     leave empty (the web server forwards /api/v1); set it only to build for an API on another
#                                     address - then that address must also be allowed by the API (EXTRA_CORS_ORIGINS)
# Runtime settings: SITE_ADDRESS (":80", or a domain for automatic HTTPS), API_UPSTREAM, ACME_EMAIL - see deploy/Caddyfile

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ARG VITE_APP_VERSION="1.0.0"
ARG VITE_API_BASE=""
ENV VITE_APP_VERSION=${VITE_APP_VERSION} \
    VITE_API_BASE=${VITE_API_BASE}
# type-checks, then builds (the files end up in /app/dist)
RUN npm run build

FROM caddy:2-alpine
# the base image is rebuilt rarely: take the operating system's security fixes when this image is built
RUN apk upgrade --no-cache
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
ENV SITE_ADDRESS=:80 \
    API_UPSTREAM=http://api:8000 \
    WEB_ROOT=/srv
EXPOSE 80 443
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8081/healthz || exit 1
