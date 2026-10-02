# syntax=docker/dockerfile:1.7
# The admin panel as a small, self-contained image (Next.js "standalone" output, runs as an unprivileged user).
#
#   docker build -t calling-admin ./admin-web
#   docker run -p 3000:3000 -e BACKEND_URL=http://api:8000 -e COOKIE_SECURE=true calling-admin
#
# Build arguments:  APP_NAME  - the name shown in the panel (compiled in, so it is chosen at build time)
#                   APP_DOWNLOAD_URL - where employees get the mobile app; added to the login message sent on WhatsApp
# Runtime settings: BACKEND_URL (where the API lives, as seen from this container), COOKIE_SECURE (true behind HTTPS)

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG APP_NAME="Employee Calling"
ARG APP_DOWNLOAD_URL=""
ENV NEXT_PUBLIC_APP_NAME=${APP_NAME} \
    NEXT_PUBLIC_APP_DOWNLOAD_URL=${APP_DOWNLOAD_URL}
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    BACKEND_URL=http://api:8000 \
    COOKIE_SECURE=true
RUN addgroup -S -g 10001 app && adduser -S -u 10001 -G app app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
