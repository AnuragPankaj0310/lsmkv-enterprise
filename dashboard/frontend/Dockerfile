# React frontend — multi-stage container image
#
# Build context = repo root (set in docker-compose.yml)
# This lets us copy deployment/nginx.conf from the repo root.
#
# Stage 1: node:20-alpine — npm ci + npm run build
# Stage 2: nginx:alpine   — serve dist/ with deployment/nginx.conf

# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first for better layer caching
COPY dashboard/frontend/package.json dashboard/frontend/package-lock.json ./
RUN npm ci

# Copy frontend source
COPY dashboard/frontend/ .

# Build the React app
RUN npm run build
# → /app/dist

# ── Stage 2: Serve ────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS server

# Remove default Nginx placeholder config
RUN rm /etc/nginx/conf.d/default.conf

# nginx.conf uses ${API_UPSTREAM} which envsubst fills in at startup.
# Storing it as a template so the raw file is never used directly.
COPY deployment/nginx.conf /etc/nginx/conf.d/app.conf.template

# Compiled React app from Stage 1
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

# Render the nginx template at startup, substituting only ${API_UPSTREAM}.
# Other nginx variables ($host, $remote_addr, etc.) are left untouched
# because envsubst only replaces the braces-form variable we specify.
CMD ["/bin/sh", "-c", "envsubst '${API_UPSTREAM}' < /etc/nginx/conf.d/app.conf.template > /etc/nginx/conf.d/app.conf && nginx -g 'daemon off;'"]
