# 🗄️ Distributed LSM-Tree Key-Value Store

A production-grade distributed key-value store built from scratch, with a live monitoring dashboard. Designed for systems-design interviews.

[![Deploy on Railway](https://railway.app/button.svg)](https://comfortable-light-production-84e9.up.railway.app/)

---

## Architecture

```
                     ┌──────────────────────────────┐
                     │         Browser               │
                     └──────────┬───────────────────┘
                                │ http://your-app.up.railway.app
                                ▼
                     ┌──────────────────────────────┐
                     │    Nginx  (dashboard)         │
                     │  /         → React SPA        │
                     │  /api/*    → FastAPI (strips)  │
                     │  /ws/*     → FastAPI WebSocket │
                     └────────┬──────────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │   FastAPI (api)   │
                    │  MetricsCollector │  ← owns QPS/P50/P99/errors
                    │  GET /api/cluster │    NO Prometheus dependency
                    │  WS /ws/metrics  │
                    └────┬────────┬────┘
                         │        │
            ┌────────────▼──┐  ┌──▼────────────────┐
            │ node0 :7001   │  │ node1/node2 :7002/3│
            │ LSM-Tree KV   │  │  Consistent Hash   │
            └───────────────┘  └────────────────────┘

── Optional SRE tools (docker compose --profile sre up) ──────────────────
   Prometheus scrapes node /metrics   →   Grafana visualises
   Dashboard works with or without these running.
```

---

## 🚀 Quick Start (Local)

### Prerequisites
- Docker + Docker Compose
- OR: Python 3.11+ and Node.js 20+

### Option A — Docker (one command)

```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPO
cd YOUR_REPO

docker compose up --build
# Open http://localhost
```

Add SRE tools (Prometheus + Grafana):
```bash
docker compose --profile sre up --build
# Dashboard:  http://localhost
# Grafana:    http://localhost:3000  (admin / lsmkv)
# Prometheus: http://localhost:9090
```

### Option B — Run without Docker

**Terminal 1 — KV Cluster**
```bash
cd lsmkv
pip install -r requirements.txt

# Start 3 nodes
LSMKV_NODE_INDEX=0 python run_server.py &
LSMKV_NODE_INDEX=1 python run_server.py &
LSMKV_NODE_INDEX=2 python run_server.py &
```

**Terminal 2 — FastAPI Backend**
```bash
cd dashboard/api
pip install -r requirements.txt
python -m uvicorn main:app --port 8000 --reload
# → http://localhost:8000/health  should return {"status":"ok"}
```

**Terminal 3 — React Frontend (dev)**
```bash
cd dashboard/frontend
npm install
npm run dev
# → http://localhost:5173  (Vite proxy forwards /api/* to :8000)
```

---

## ☁️ Deploy to Railway (Recommended — full stack, one URL)

Railway runs the entire stack (KV nodes + API + dashboard) from `docker-compose.yml`.

### Steps

1. **Push to GitHub**
   ```bash
   git init && git add -A && git commit -m "init"
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
   git push -u origin main
   ```

2. **Deploy on Railway**

   Click the button: [![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/github?repo=https://github.com/YOUR_USERNAME/YOUR_REPO)

   Or manually:
   - Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
   - Select your repository
   - Railway auto-detects `docker-compose.yml` and deploys all services

3. **Get your URL**
   - In the Railway dashboard, click the `dashboard` service → **Settings** → **Networking** → **Generate Domain**
   - Share `https://your-app.up.railway.app` 🎉

### Environment variables (optional)
| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `80` | Public port for the dashboard container |

---

## ☁️ Deploy Frontend to Vercel + API to Railway

Use this when you want Vercel's CDN for the frontend and Railway for the backend.

### Step 1 — Deploy API to Railway

1. Create a new Railway project from your GitHub repo
2. Add a service with the `dashboard/api/Dockerfile` (set build context to repo root)
3. Note the public URL (e.g. `https://my-kv-api.up.railway.app`)
4. Also deploy the 3 KV node services (`lsmkv/Dockerfile`)

### Step 2 — Deploy Frontend to Vercel

1. Go to [vercel.com](https://vercel.com) → **New Project** → Import your GitHub repo
2. **Framework preset**: Vite
3. **Root directory**: `dashboard/frontend`
4. **Environment variable**: Add `VITE_API_URL = https://my-kv-api.up.railway.app`
5. Click **Deploy**

Vercel builds with `npm run build` and serves `/dist`. The `VITE_API_URL` env var bakes the Railway API URL into the bundle at build time.

> **WebSocket note**: The Railway API must allow WebSocket connections. Railway supports WebSockets on all plans.

---

## 🔍 Verify it's Working

```bash
# Health check
curl https://your-app.up.railway.app/health
# → {"status":"ok"}

# Cluster status
curl https://your-app.up.railway.app/api/cluster
# → {"total_keys":0,"node_count":3,"healthy_nodes":3,...}

# Logs endpoint
curl https://your-app.up.railway.app/api/logs?limit=5
```

Or open the URL in a browser — the dashboard auto-connects via WebSocket and shows live metrics.

---

## 📁 Project Structure

```
.
├── docker-compose.yml          # One-command full-stack deployment
├── railway.json                # Railway config
├── deployment/
│   └── nginx.conf              # Reverse proxy (/ → React, /api/* → FastAPI)
├── lsmkv/                      # KV store engine
│   ├── Dockerfile              # KV node container
│   ├── run_server.py           # Node entry point
│   ├── storage/                # LSM-tree (memtable, WAL, SSTables)
│   ├── network/                # Consistent hashing & TCP replication
│   └── metrics/                # Prometheus /metrics exporter (SRE only)
└── dashboard/
    ├── api/
    │   ├── Dockerfile          # FastAPI container (Python 3.12)
    │   ├── main.py             # REST + WebSocket endpoints
    │   └── app_metrics/        # MetricsCollector (QPS, P50/P99, errors)
    └── frontend/
        ├── Dockerfile          # Multi-stage: node:20 build → nginx:alpine
        ├── vercel.json         # Vercel frontend config
        └── src/
            ├── api/            # client.ts, cluster.ts, keys.ts ...
            ├── hooks/          # useMetricsWS, useCluster ...
            └── pages/          # Dashboard, Metrics, Logs, Storage ...
```

---

## 🛠️ Key Design Decisions

| Decision | Why |
|---|---|
| **Dashboard is independent of Prometheus** | Grafana/Prometheus can be down; users never notice |
| **MetricsCollector owns QPS/P50/P99** | Computed from real request timings, not scraped |
| **Nginx reverse proxy** | Single public port, no CORS, WebSocket upgrade handled |
| **Relative API paths (`/api/*`)** | Works locally (Vite proxy) and in production (Nginx) identically |
| **`window.location.host` for WebSocket** | Same code works on localhost, Railway, and Vercel |
| **Docker profiles (`--profile sre`)** | Ship Prometheus/Grafana knowledge without making them a dependency |

---

## Interview talking points

- **LSM-Tree**: memtable → WAL → SSTables → compaction
- **Consistent hashing**: virtual nodes, rebalancing on add/remove
- **Replication**: quorum reads/writes, replica lag tracking
- **Observability**: custom MetricsCollector (not Prometheus-dependent), rolling 60s window for P50/P99
- **Deployment**: single Nginx entry point, Docker Compose profiles, cloud-ready
