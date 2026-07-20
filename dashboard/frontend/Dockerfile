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

# Standalone nginx.conf lives in deployment/ at repo root
COPY deployment/nginx.conf /etc/nginx/conf.d/app.conf

# Compiled React app from Stage 1
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
