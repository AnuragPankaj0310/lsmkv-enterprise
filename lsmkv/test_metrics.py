"""
Quick diagnostic: send a SET to node0 and check Prometheus.
Run from: improved_kv_store/lsmkv/
"""
import asyncio
import sys
import urllib.request

sys.path.insert(0, ".")
from network.protocol import encode, read_message

async def send_set(key: str, value: str):
    r, w = await asyncio.wait_for(
        asyncio.open_connection("localhost", 7001), timeout=3.0
    )
    w.write(encode({"cmd": "SET", "key": key, "value": list(value.encode())}))
    await w.drain()
    resp = await asyncio.wait_for(read_message(r), timeout=3.0)
    w.close()
    await w.wait_closed()
    return resp

async def send_get(key: str):
    r, w = await asyncio.wait_for(
        asyncio.open_connection("localhost", 7001), timeout=3.0
    )
    w.write(encode({"cmd": "GET", "key": key}))
    await w.drain()
    resp = await asyncio.wait_for(read_message(r), timeout=3.0)
    w.close()
    await w.wait_closed()
    return resp

async def main():
    print("=== Sending 5 SETs and 5 GETs directly to node0 ===")
    for i in range(5):
        try:
            resp = await send_set(f"diag_key_{i}", f"value_{i}")
            print(f"SET diag_key_{i}: {resp}")
        except Exception as e:
            print(f"SET diag_key_{i} FAILED: {e}")

    for i in range(5):
        try:
            resp = await send_get(f"diag_key_{i}")
            # don't print full value
            print(f"GET diag_key_{i}: ok={resp.get('ok')}")
        except Exception as e:
            print(f"GET diag_key_{i} FAILED: {e}")

    print("\n=== Checking Prometheus on all 3 nodes ===")
    for port in [9001, 9002, 9003]:
        try:
            with urllib.request.urlopen(f"http://localhost:{port}/metrics", timeout=3) as resp:
                text = resp.read().decode()
            # Only show ops lines
            ops_lines = [l for l in text.splitlines() if "ops_total" in l or "latency_seconds_bucket" in l or "latency_seconds_count" in l]
            if ops_lines:
                print(f"\nNode port {port}:")
                for l in ops_lines[:20]:
                    print(f"  {l}")
            else:
                print(f"\nNode port {port}: NO ops data")
        except Exception as e:
            print(f"\nNode port {port}: ERROR {e}")

asyncio.run(main())
