FROM python:3.11-slim

WORKDIR /app

# Install runtime dependencies only (no pytest/mypy/ruff)
COPY requirements.prod.txt .
RUN pip install --no-cache-dir -r requirements.prod.txt


# Copy source
COPY . .

# Data volume (WAL + SSTables)
VOLUME ["/app/data"]

# Default: node 0 on port 7001
ENV LSMKV_NODE_INDEX=0

EXPOSE 7001 9001

CMD ["python", "run_server.py"]
