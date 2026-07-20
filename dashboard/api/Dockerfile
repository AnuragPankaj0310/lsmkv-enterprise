# FastAPI backend — container image
#
# Build context = repo root (set in docker-compose.yml)
# This lets us include the lsmkv source (needed for network.protocol imports).

FROM python:3.12-slim

WORKDIR /app

# Install Python dependencies
COPY dashboard/api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the lsmkv library (needed for network/protocol imports in main.py)
COPY lsmkv/ ./lsmkv/

# Copy API source
COPY dashboard/api/ .

EXPOSE 8000

# Default port — Railway overrides this via the PORT env var.
# Setting it here ensures private-networking callers always find the API on 8000
# unless Railway explicitly changes it.
ENV PORT=8000

# Health endpoint at /health — probed by Docker and Railway
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=5 \
  CMD sh -c "python -c \"import urllib.request; urllib.request.urlopen('http://localhost:${PORT}/health')\""

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
