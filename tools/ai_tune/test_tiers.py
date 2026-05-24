#!/usr/bin/env python3
"""
Round-robin tournament across multiple board sizes for the four tiers
defined in src/game/aiEngineCore.js POLICY_DEFAULTS:

  confiscator (attackHeavy) — placeOwn:+2, placeOpp:+4, placeDead:-2, elimOwn:-2, elimOpp:+6
  conservator (defenseHeavy)— placeOwn:+6, placeOpp:-4, placeDead:-4, elimOwn:-4, elimOpp:+2
  cumulator   (collectHeavy)— placeOwn:+6, placeOpp: 0, placeDead:-2, elimOwn:-4, elimOpp:+4
  collector   (heavy)       — placeOwn:+6, placeOpp:+2, placeDead:-2, elimOwn:-2, elimOpp:+4

Uses the fast test_* configs to keep wall time reasonable. The actual
search settings (simBudget, timeMs) come from those JSON files.

Output: per-size pair-table + cross-size aggregate Elo ladder.
"""
import argparse
import itertools
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from tune import load_config, run_pair, elo_diff, wilson_interval

TIERS = ['connector', 'concentrator', 'constructor', 'coordinator',
         'confiscator', 'conservator', 'cumulator', 'collector']

def short(name):
    return {'connector':    'Cnt', 'concentrator': 'Cnc',
            'constructor':  'Cst', 'coordinator':  'Crd',
            'confiscator':  'Fis', 'conservator':  'Cns',
            'cumulator':    'Cum', 'collector':    'Col'}[name]

def run_size(size, games, workers, configs):
    pairs = list(itertools.combinations(TIERS, 2))
    results = {}      # (a, b) -> result dict (A=a, B=b)
    tier_score = {t: 0.0 for t in TIERS}
    tier_n     = {t: 0   for t in TIERS}

    print(f'\n{"#" * 78}')
    print(f'# Board {size}x{size}  ({games} games per pair, {workers} workers)')
    print(f'{"#" * 78}')

    for (a, b) in pairs:
        print(f'\n--- {a} vs {b} ---', flush=True)
        r = run_pair(configs[a], configs[b], size, games, workers,
                     name_a=a, name_b=b, switch_sides=True, verbose=False)
        results[(a, b)] = r
        # Score: each side gets wins + 0.5 * draws across its games.
        a_score = r['wins_a'] + 0.5 * r['draws']
        b_score = r['wins_b'] + 0.5 * r['draws']
        tier_score[a] += a_score; tier_n[a] += r['n']
        tier_score[b] += b_score; tier_n[b] += r['n']
        print(f'    {a}: {r["wins_a"]}  {b}: {r["wins_b"]}  draws: {r["draws"]}  '
              f'(A win% {r["score"]*100:5.1f}, Elo {r["elo"]:+5.0f})',
              flush=True)

    # Cross-table.
    print(f'\n  {"":>14}  ' + '  '.join(f'{short(t):>5}' for t in TIERS) + '   score    games   win%')
    for a in TIERS:
        row = []
        for b in TIERS:
            if a == b:
                row.append('  --  ')
            elif (a, b) in results:
                r = results[(a, b)]
                row.append(f'{r["wins_a"]:>2}-{r["wins_b"]}-{r["draws"]}')
            else:
                r = results[(b, a)]
                row.append(f'{r["wins_b"]:>2}-{r["wins_a"]}-{r["draws"]}')
        wr = (tier_score[a] / tier_n[a]) if tier_n[a] else 0
        print(f'  {a:>14}  ' + '  '.join(f'{c:>5}' for c in row)
              + f'   {tier_score[a]:>5.1f}  {tier_n[a]:>5}   {wr*100:5.1f}%')

    return results, tier_score, tier_n

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--sizes', default='6,8',
                    help='Comma list of board sizes (default 6,8)')
    ap.add_argument('--games', type=int, default=12,
                    help='Games per pair per size (default 12)')
    ap.add_argument('--workers', type=int, default=min(6, os.cpu_count() or 4))
    ap.add_argument('--prefix', default='test_',
                    help='Config prefix (default "test_" for fast variants). '
                         'Use "" for the full-budget configs.')
    args = ap.parse_args()

    sizes = [int(s.strip()) for s in args.sizes.split(',') if s.strip()]
    configs = {t: load_config(f'{args.prefix}{t}') for t in TIERS}

    print(f'Tiers: {", ".join(TIERS)}')
    print(f'Sizes: {sizes}  Games/pair: {args.games}  Workers: {args.workers}')
    print(f'Config: {args.prefix}<tier>.json  '
          f'(simBudget={configs[TIERS[0]].get("simBudget")}, '
          f'timeMs={configs[TIERS[0]].get("timeMs")})')

    t0 = time.time()
    overall_score = {t: 0.0 for t in TIERS}
    overall_n     = {t: 0   for t in TIERS}
    per_size = {}

    for sz in sizes:
        results, scores, ns = run_size(sz, args.games, args.workers, configs)
        per_size[sz] = (results, scores, ns)
        for t in TIERS:
            overall_score[t] += scores[t]
            overall_n[t]     += ns[t]

    # Final aggregate.
    print(f'\n{"=" * 78}')
    print(f'OVERALL ({sum(overall_n.values())//2} games across sizes {sizes})')
    print(f'{"=" * 78}')
    print(f'  {"tier":>14}  {"score":>7}  {"games":>6}  {"win%":>6}  {"Elo":>6}')
    ladder = sorted(TIERS, key=lambda t: -overall_score[t] / overall_n[t] if overall_n[t] else 0)
    for t in ladder:
        wr = (overall_score[t] / overall_n[t]) if overall_n[t] else 0
        lo, _, hi = wilson_interval(overall_score[t], overall_n[t])
        print(f'  {t:>14}  {overall_score[t]:>7.1f}  {overall_n[t]:>6}  '
              f'{wr*100:>5.1f}%  {elo_diff(wr):+5.0f}  '
              f'(95% CI [{lo*100:4.1f}%, {hi*100:4.1f}%])')

    print(f'\nWall time: {time.time() - t0:.1f}s')

if __name__ == '__main__':
    main()
