"""Verify the backend histogram extraction works with live Prometheus data."""
import urllib.request, re

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

for port, name in [(9001, "node0"), (9002, "node1"), (9003, "node2")]:
    try:
        with urllib.request.urlopen(f"http://localhost:{port}/metrics", timeout=3) as r:
            text = r.read().decode()
        q = _extract_histogram_quantiles(text, "lsmkv_latency_seconds")
        print(f"{name} (:{port}): {q if q else 'NO HISTOGRAM DATA'}")
    except Exception as e:
        print(f"{name}: ERROR {e}")
