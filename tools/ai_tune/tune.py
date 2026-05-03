#!/usr/bin/env python3
"""
AI-vs-AI tournament harness for the Collector engine.

Spawns Node subprocesses running the actual JS engine (src/game/aiEngineCore.js)
and plays full games between two configurations. Reports win rates with 95%
confidence intervals and Elo deltas.

Usage:
  python tune.py pair --a collector --b hunter --size 8 --games 100
  python tune.py sweep --base collector --opp collector simBudget 5000,15000,40000
  python tune.py sweep --base collector --opp hunter timeMs 2000,5000,10000

Configs live in ./configs/<name>.json.

Statistical guidance:
- 100 games gives 95% CI of roughly +/-10 percentage points.
- 400 games gives roughly +/-5 pp.
- Engine uses Math.random() for tie-breaking and rollouts, so each run varies.

Tunable cfg fields the live engine honors today:
  kind: 'oneply' | 'fixedab' | 'mctsrave'
  simBudget   (mctsrave)
  timeMs      (mctsrave, fixedab)
  depth       (fixedab)
  endgame     (boolean, mctsrave + fixedab)
  endgameDepth (mctsrave + fixedab; falls back to ENDGAME_THRESHOLD = 12)
  evalName    ('simple' | 'basic')
  policy      ('heavy' currently the only option)

To tune the deeper MCTS constants (MCTS_C, RAVE_K, PW_ALPHA, heavy policy
weights), the engine needs a small patch to read them from cfg — the harness
will pass them through, but src/game/aiEngineCore.js must honor them.
"""
import argparse
import json
import math
import os
import queue
import subprocess
import sys
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
BRIDGE = HERE / 'engine_bridge.js'
CONFIGS_DIR = HERE / 'configs'

# ── Game rules (mirrors src/game/aiEngineCore.js move generation) ──────────

def has_adjacent_free(idx, cells, dead, size):
    r, c = divmod(idx, size)
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            if dr == 0 and dc == 0:
                continue
            nr, nc = r + dr, c + dc
            if not (0 <= nr < size and 0 <= nc < size):
                continue
            v = nr * size + nc
            if cells[v] == 0 and not dead[v]:
                return True
    return False

def gen_placements(cells, dead, size):
    out = []
    n2 = size * size
    for i in range(n2):
        if cells[i] != 0 or dead[i]:
            continue
        if has_adjacent_free(i, cells, dead, size):
            out.append(i)
    return out

def gen_eliminations(cells, dead, size, last_idx):
    if last_idx < 0:
        return []
    out = []
    lr, lc = divmod(last_idx, size)
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            if dr == 0 and dc == 0:
                continue
            nr, nc = lr + dr, lc + dc
            if not (0 <= nr < size and 0 <= nc < size):
                continue
            v = nr * size + nc
            if cells[v] == 0 and not dead[v]:
                out.append(v)
    return out

def biggest_group(cells, size, player):
    n2 = size * size
    visited = bytearray(n2)
    best = 0
    for start in range(n2):
        if cells[start] != player or visited[start]:
            continue
        stack = [start]
        visited[start] = 1
        count = 0
        while stack:
            u = stack.pop()
            count += 1
            ur, uc = divmod(u, size)
            for dr in (-1, 0, 1):
                for dc in (-1, 0, 1):
                    if dr == 0 and dc == 0:
                        continue
                    nr, nc = ur + dr, uc + dc
                    if not (0 <= nr < size and 0 <= nc < size):
                        continue
                    v = nr * size + nc
                    if not visited[v] and cells[v] == player:
                        visited[v] = 1
                        stack.append(v)
        if count > best:
            best = count
    return best

def state_to_json(cells, dead, size):
    return [
        [
            {"player": cells[r * size + c],
             "eliminated": bool(dead[r * size + c])}
            for c in range(size)
        ]
        for r in range(size)
    ]

# ── Engine subprocess (Node + JS engine via esbuild bundle) ────────────────

class EngineProcess:
    """One Node subprocess holding a long-lived engine instance.
    Single outstanding request at a time (serialized via lock).
    """
    def __init__(self):
        self.proc = subprocess.Popen(
            ['node', str(BRIDGE)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            bufsize=1,
            cwd=str(HERE),
        )
        ready_line = self.proc.stdout.readline()
        if not ready_line:
            raise RuntimeError('engine bridge failed to start')
        ready = json.loads(ready_line)
        if not ready.get('ready'):
            raise RuntimeError(f'unexpected bridge handshake: {ready}')
        self._lock = threading.Lock()
        self._counter = 0

    def choose_move(self, cfg, cells, dead, size, phase, last_idx, current_player):
        with self._lock:
            self._counter += 1
            req_id = self._counter
            last_places = None
            if phase == 'eliminate' and last_idx >= 0:
                lr, lc = divmod(last_idx, size)
                last_places = {'row': lr, 'col': lc}
            req = {
                'id': req_id,
                'cfg': cfg,
                'state': state_to_json(cells, dead, size),
                'size': size,
                'phase': phase,
                'lastPlaces': last_places,
                'currentPlayer': current_player,
            }
            self.proc.stdin.write(json.dumps(req) + '\n')
            self.proc.stdin.flush()
            line = self.proc.stdout.readline()
            if not line:
                raise RuntimeError('engine bridge died')
            resp = json.loads(line)
            if resp.get('error'):
                raise RuntimeError(resp['error'])
            move = resp.get('move')
            if move is None:
                return None
            return move['row'] * size + move['col']

    def close(self):
        try:
            self.proc.stdin.close()
            self.proc.wait(timeout=2)
        except Exception:
            try:
                self.proc.kill()
            except Exception:
                pass

# ── Match playing ──────────────────────────────────────────────────────────

def play_game(engine, cfg_a, cfg_b, size, swap=False, max_plies=4000):
    """Single game on a fresh board.
    swap=False: A is player1, B is player2.
    swap=True:  A is player2, B is player1.
    Returns 'A', 'B', or 'draw'.
    """
    n2 = size * size
    cells = [0] * n2
    dead = [False] * n2
    phase = 'place'
    current_player = 1
    last_idx = -1
    plies = 0

    while plies < max_plies:
        if (current_player == 1) ^ swap:
            cfg = cfg_a
        else:
            cfg = cfg_b

        if phase == 'place':
            legal = gen_placements(cells, dead, size)
            if not legal:
                break  # current player has no legal placement → game over
            move = engine.choose_move(cfg, cells, dead, size, 'place', -1, current_player)
            if move is None or move not in legal:
                # engine resigned or returned illegal → terminal, score decides
                break
            cells[move] = current_player
            last_idx = move
            phase = 'eliminate'
        else:  # eliminate
            legal = gen_eliminations(cells, dead, size, last_idx)
            if not legal:
                # No legal eliminate (placed dot is fully boxed in by dots/dead/edges).
                # Skip elimination and pass turn — matches the engine's permissive behavior.
                phase = 'place'
                current_player = 3 - current_player
                last_idx = -1
                plies += 1
                continue
            move = engine.choose_move(cfg, cells, dead, size, 'eliminate', last_idx, current_player)
            if move is None or move not in legal:
                break
            dead[move] = True
            phase = 'place'
            current_player = 3 - current_player
            last_idx = -1
        plies += 1

    s1 = biggest_group(cells, size, 1)
    s2 = biggest_group(cells, size, 2)
    if s1 == s2:
        return 'draw'
    p1_wins = s1 > s2
    if swap:
        return 'A' if not p1_wins else 'B'
    return 'A' if p1_wins else 'B'

# ── Statistics ─────────────────────────────────────────────────────────────

def wilson_interval(score, n, z=1.96):
    """95% Wilson confidence interval for win-fraction, draws counted as 0.5.
    `score` is wins + 0.5 * draws.
    """
    if n == 0:
        return (0.0, 0.0, 0.0)
    p = score / n
    p = max(0.0, min(1.0, p))
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = (z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / denom
    return (max(0.0, centre - half), p, min(1.0, centre + half))

def elo_diff(win_rate):
    """Elo difference from win rate. Caps at +/-800 to avoid infinity prints."""
    if win_rate <= 0.001:
        return -800.0
    if win_rate >= 0.999:
        return 800.0
    return -400 * math.log10(1 / win_rate - 1)

# ── Tournament ─────────────────────────────────────────────────────────────

def run_pair(cfg_a, cfg_b, size, n_games, n_workers, name_a='A', name_b='B', verbose=True):
    """Play n_games between A and B, alternating sides each game.
    Returns dict with results.
    """
    n_workers = max(1, min(n_workers, n_games))
    job_q = queue.Queue()
    for i in range(n_games):
        job_q.put(i)

    state = {'A': 0, 'B': 0, 'draw': 0, 'errors': 0, 'done': 0}
    state_lock = threading.Lock()
    t0 = time.time()

    if verbose:
        print(f'Spinning up {n_workers} engine workers...', flush=True)

    def worker():
        try:
            eng = EngineProcess()
        except Exception as e:
            with state_lock:
                state['errors'] += 1
            print(f'  worker startup failed: {e}', file=sys.stderr)
            return
        try:
            while True:
                try:
                    game_idx = job_q.get_nowait()
                except queue.Empty:
                    return
                swap = (game_idx % 2 == 1)
                try:
                    r = play_game(eng, cfg_a, cfg_b, size, swap=swap)
                except Exception as e:
                    r = None
                    print(f'  game {game_idx} failed: {e}', file=sys.stderr)
                with state_lock:
                    if r in ('A', 'B', 'draw'):
                        state[r] += 1
                    else:
                        state['errors'] += 1
                    state['done'] += 1
                    done = state['done']
                if verbose and (done % max(1, n_games // 20) == 0 or done == n_games):
                    elapsed = time.time() - t0
                    rate = done / elapsed if elapsed > 0 else 0
                    print(f'  [{done:>4}/{n_games}] '
                          f'{name_a}={state["A"]}  {name_b}={state["B"]}  '
                          f'D={state["draw"]}  err={state["errors"]}  '
                          f'({rate:.2f} g/s)', flush=True)
        finally:
            eng.close()

    threads = [threading.Thread(target=worker, daemon=True) for _ in range(n_workers)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    n = state['A'] + state['B'] + state['draw']
    score_a = state['A'] + 0.5 * state['draw']
    lo, p, hi = wilson_interval(score_a, n) if n else (0, 0, 0)

    if verbose:
        elapsed = time.time() - t0
        print()
        print(f'{name_a} vs {name_b}: {state["A"]} wins, {state["B"]} losses, '
              f'{state["draw"]} draws  ({n} games, {elapsed:.1f}s)')
        print(f'  {name_a} score: {score_a:g}/{n} = {p*100:.1f}%  '
              f'(95% CI [{lo*100:.1f}%, {hi*100:.1f}%])')
        print(f'  Elo({name_a} - {name_b}) ~= {elo_diff(p):+.0f}  '
              f'(CI [{elo_diff(lo):+.0f}, {elo_diff(hi):+.0f}])')
        if state['errors']:
            print(f'  WARNING: {state["errors"]} game(s) failed (counted as no-result).')

    return {
        'wins_a': state['A'], 'wins_b': state['B'], 'draws': state['draw'],
        'errors': state['errors'], 'n': n,
        'score': p, 'ci_lo': lo, 'ci_hi': hi,
        'elo': elo_diff(p), 'elo_lo': elo_diff(lo), 'elo_hi': elo_diff(hi),
    }

def run_sweep(base_cfg, opp_cfg, param, values, size, games_per_value, n_workers,
              base_name='base', opp_name='opp'):
    """Sweep one param on `base_cfg`, each variant plays games_per_value vs `opp_cfg`."""
    rows = []
    for v in values:
        cfg = dict(base_cfg)
        cfg[param] = v
        label = f'{base_name}({param}={v})'
        print(f'\n=== {label} vs {opp_name} ({games_per_value} games, size {size}) ===')
        r = run_pair(cfg, opp_cfg, size, games_per_value, n_workers,
                     name_a=label, name_b=opp_name)
        r[param] = v
        rows.append(r)

    print('\n' + '=' * 70)
    print(f'Sweep summary: {base_name}.{param}  vs  {opp_name}  '
          f'(size {size}, {games_per_value} games per value)')
    print('=' * 70)
    print(f'{param:>14} | A wins | B wins | draws | score%   95% CI       | Elo')
    print('-' * 70)
    for r in rows:
        print(f'{str(r[param]):>14} | {r["wins_a"]:>6} | {r["wins_b"]:>6} | {r["draws"]:>5} | '
              f'{r["score"]*100:>5.1f}   [{r["ci_lo"]*100:>4.1f},{r["ci_hi"]*100:>4.1f}] | '
              f'{r["elo"]:+5.0f}')

    best = max(rows, key=lambda x: x['score'])
    print(f'\nBest: {param}={best[param]}  (score {best["score"]*100:.1f}%, Elo {best["elo"]:+.0f})')

# ── Config IO ──────────────────────────────────────────────────────────────

def load_config(name):
    p = CONFIGS_DIR / f'{name}.json'
    if not p.exists():
        print(f'Config not found: {p}', file=sys.stderr)
        sys.exit(2)
    return json.loads(p.read_text())

def parse_values(s):
    out = []
    for v in s.split(','):
        v = v.strip()
        try:
            out.append(int(v))
        except ValueError:
            try:
                out.append(float(v))
            except ValueError:
                if v.lower() == 'true':
                    out.append(True)
                elif v.lower() == 'false':
                    out.append(False)
                else:
                    out.append(v)
    return out

# ── CLI ────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description='Collector AI tournament harness.')
    sub = ap.add_subparsers(dest='cmd', required=True)

    pair = sub.add_parser('pair', help='Head-to-head: A vs B over N games.')
    pair.add_argument('--a', default='collector', help='Config name for A (default: collector)')
    pair.add_argument('--b', default='hunter', help='Config name for B (default: hunter)')
    pair.add_argument('--size', type=int, default=8)
    pair.add_argument('--games', type=int, default=100)
    pair.add_argument('--workers', type=int, default=os.cpu_count() or 4)

    sw = sub.add_parser('sweep', help='Sweep one parameter; each variant plays vs --opp.')
    sw.add_argument('--base', default='collector', help='Base config to mutate.')
    sw.add_argument('--opp', default='collector', help='Opponent config (constant).')
    sw.add_argument('param', help='Field name to vary, e.g. simBudget')
    sw.add_argument('values', help='Comma-separated values, e.g. 5000,15000,40000')
    sw.add_argument('--size', type=int, default=8)
    sw.add_argument('--games', type=int, default=50,
                    help='Games per parameter value (default 50; use >=100 for tight CI).')
    sw.add_argument('--workers', type=int, default=os.cpu_count() or 4)

    args = ap.parse_args()

    if args.cmd == 'pair':
        cfg_a = load_config(args.a)
        cfg_b = load_config(args.b)
        run_pair(cfg_a, cfg_b, args.size, args.games, args.workers,
                 name_a=args.a, name_b=args.b)
    elif args.cmd == 'sweep':
        base = load_config(args.base)
        opp = load_config(args.opp)
        vals = parse_values(args.values)
        run_sweep(base, opp, args.param, vals, args.size, args.games, args.workers,
                  base_name=args.base, opp_name=args.opp)

if __name__ == '__main__':
    main()
