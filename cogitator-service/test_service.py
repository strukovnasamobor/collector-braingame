"""Smoke test for the deployed Cogitator service.

Reads COGITATOR_URL and COGITATOR_TOKEN from .env (this dir first, then walking
up to repo root). Uses only stdlib — no `requests` / `dotenv` install required.

Run:
  python cogitator-service/test_service.py
"""
import json
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path


def load_env() -> dict:
    """Find .env in this dir or any parent. Returns dict of KEY=VALUE pairs.
    Strips surrounding quotes from values. Skips comment lines."""
    here = Path(__file__).resolve().parent
    for d in [here, *here.parents]:
        f = d / '.env'
        if f.exists():
            env = {}
            for line in f.read_text().splitlines():
                s = line.strip()
                if not s or s.startswith('#') or '=' not in s:
                    continue
                k, v = s.split('=', 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
            print(f"Loaded .env from {f}")
            return env
    raise FileNotFoundError("No .env found in this dir or any parent")


def http_get(url: str, headers: dict | None = None) -> dict:
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode('utf-8'))


def http_post(url: str, headers: dict, body: dict) -> tuple[dict, int]:
    payload = json.dumps(body).encode('utf-8')
    req = urllib.request.Request(
        url, method='POST',
        headers={**headers, 'content-type': 'application/json'},
        data=payload,
    )
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        body_text = e.read().decode('utf-8', errors='replace')
        raise RuntimeError(f"HTTP {e.code} — {body_text}") from None
    dt_ms = int((time.monotonic() - t0) * 1000)
    return data, dt_ms


def empty_board_request() -> dict:
    return {
        'cells':     [0] * 64,
        'dead':      [0] * 64,
        'size':      8,
        'phase':     0,
        'side':      1,
        'last_idx':  -1,
        'sim_budget':  2500,
        'time_ms':     12000,
        'batch_size':  32,
        'endgame':         True,
        'endgame_depth':   12,
    }


def main() -> int:
    env = load_env()
    url = env.get('COGITATOR_URL')
    token = env.get('COGITATOR_TOKEN')
    if not url:
        print("ERROR: COGITATOR_URL not set in .env", file=sys.stderr)
        return 1
    url = url.rstrip('/')

    headers = {}
    if token:
        headers['x-cogitator-token'] = token

    print(f"\nService: {url}")
    print(f"Token:   {'present (' + token[:8] + '...)' if token else 'absent'}")
    print("=" * 70)

    # 1) Health -----------------------------------------------------------
    print("\n[1] Health check (GET /)")
    try:
        health = http_get(url + '/')
        print(f"  ok:           {health.get('ok')}")
        print(f"  inputs:       {health.get('inputs')}")
        print(f"  outputs:      {health.get('outputs')}")
        print(f"  cache_size:   {health.get('cache_size')}")
        print(f"  auth_enabled: {health.get('auth_enabled')}")
    except Exception as e:
        print(f"  FAILED: {e}")
        return 2

    # 2) PLACE phase, fresh game -----------------------------------------
    print("\n[2] PLACE phase, empty board")
    body = empty_board_request()
    data, dt = http_post(url + '/cogitate', headers, body)
    print(f"  move:        {data['move']}  (row={data['move']//8}, col={data['move']%8})")
    print(f"  sims:        {data['sims']}")
    print(f"  search_ms:   {data['search_ms']}")
    print(f"  used:        {data['used']}")
    print(f"  round-trip:  {dt} ms")

    # 3) ELIMINATE phase — verifies the phase-budget split ----------------
    print("\n[3] ELIMINATE phase (should be ~4s / ~625 sims with phase split active)")
    body = empty_board_request()
    body['cells'][27] = 1        # P1 dot at (3,3)
    body['phase'] = 1
    body['last_idx'] = 27
    data, dt = http_post(url + '/cogitate', headers, body)
    print(f"  move:        {data['move']}")
    print(f"  sims:        {data['sims']}")
    print(f"  search_ms:   {data['search_ms']}")
    print(f"  used:        {data['used']}")
    print(f"  round-trip:  {dt} ms")
    if data['search_ms'] > 8000:
        print(f"  ⚠ search_ms > 8000 — phase split might not be deployed yet")

    # 4) reuseTree — two calls with the same game_id ---------------------
    print("\n[4] reuseTree (game_id='test-reuse-1', two calls)")
    body = empty_board_request()
    body['game_id'] = 'test-reuse-1'
    d1, dt1 = http_post(url + '/cogitate', headers, body)
    print(f"  call 1 (fresh):  move={d1['move']}  used={d1['used']}  rt={dt1}ms")

    # Simulate: P1 placed at d1['move'], must now eliminate
    body2 = empty_board_request()
    body2['cells'][d1['move']] = 1
    body2['phase'] = 1
    body2['last_idx'] = d1['move']
    body2['game_id'] = 'test-reuse-1'
    d2, dt2 = http_post(url + '/cogitate', headers, body2)
    print(f"  call 2 (should reuse):  move={d2['move']}  used={d2['used']}  rt={dt2}ms")
    if d2['used'] != 'reuse':
        print(f"  ⚠ expected used=reuse, got {d2['used']!r}")

    # 5) Auth negative test — request without token should 401 -----------
    if token:
        print("\n[5] Auth negative test (POST without token → 401)")
        try:
            http_post(url + '/cogitate', {}, empty_board_request())
            print("  ⚠ request without token succeeded — auth is NOT enforced")
        except RuntimeError as e:
            if '401' in str(e):
                print(f"  ✓ correctly rejected (401)")
            else:
                print(f"  ⚠ unexpected error: {e}")

    print("\n" + "=" * 70)
    print("All tests complete.")
    return 0


if __name__ == '__main__':
    sys.exit(main())
