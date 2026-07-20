"""
Simulate what the backend ws/metrics sends.
Shows if P50 comes through correctly.
"""
import asyncio, sys
sys.path.insert(0, r"C:\Users\evilk\OneDrive\Desktop\improved_kv_store\lsmkv")

import httpx, re

def _metrics_port_for(addr):
    port = int(addr.rsplit(":", 1)[1])
    return 9000 + (port - 7000)

def _extract_histogram_quantiles(raw_text, metric_base):
    buckets = []
    total_count = 0.0
    for line in raw_text.splitlines():
        line = line.strip()
        if line.startswith("#") or not line:
            continue
        if f"{metric_base}_bucket" in line:
            try:
                le_match = re.search(r'le="([^"]+)"', line)
                if not le_match:
                    continue
                le_val = float(le_match.group(1))
                count_val = float(line.split()[-1])
                if le_val != float("+Inf"):
                    buckets.append((le_val, count_val))
                else:
                    total_count = count_val
            except Exception:
                continue
    if not buckets or total_count == 0:
        return {}
    result = {}
    for q_name, q in [("p50", 0.50), ("p95", 0.95), ("p99", 0.99)]:
        target = q * total_count
        for i, (le_val, cum) in enumerate(buckets):
            if cum >= target:
                if i == 0:
                    val_s = le_val * (target / cum) if cum > 0 else le_val
                else:
                    prev_le, prev_cum = buckets[i - 1]
                    if cum == prev_cum:
                        val_s = le_val
                    else:
                        frac = (target - prev_cum) / (cum - prev_cum)
                        val_s = prev_le + frac * (le_val - prev_le)
                result[q_name] = round(val_s * 1000, 2)
                break
    return result

async def main():
    nodes = ["node0:7001", "node1:7002", "node2:7003"]
    print("=== Simulating ws/metrics payload ===")
    for addr in nodes:
        port = _metrics_port_for(addr)
        short = addr.split(":")[0]
        try:
            async with httpx.AsyncClient(timeout=2) as c:
                r = await c.get(f"http://localhost:{port}/metrics")
                raw = r.text
        except Exception as e:
            print(f"{short}: ERROR {e}")
            continue
        q = _extract_histogram_quantiles(raw, "lsmkv_latency_seconds")
        p50 = q.get("p50", 0.0)
        p99 = q.get("p99", 0.0)
        ops_lines = [l for l in raw.splitlines() if "ops_total{" in l]
        print(f"{short}: P50={p50}ms  P99={p99}ms  ops={ops_lines}")

asyncio.run(main())
