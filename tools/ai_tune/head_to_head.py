#!/usr/bin/env python3
"""
Head-to-head match: full-budget Coordinator (12 s IDAB) vs full-budget
Constructor (depth-3 fixedAB) across the three standard board sizes.

Defaults are tuned for a single overnight run. Bring your patience —
at 12 s per Coordinator move, ~25 moves per game, 20 games per size,
and 4 sizes... a single worker plays roughly one game every 5–6 minutes.
Scale workers to your core count to parallelize.

Usage:
  python head_to_head.py                                  # 20 games/size, sizes 6,8,10
  python head_to_head.py --games 50 --workers 4
  python head_to_head.py --sizes 6,8,10,12
  python head_to_head.py --a coordinator --b confiscator  # any two configs
"""
import argparse
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from tune import load_config, run_pair, elo_diff, wilson_interval


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--a', default='coordinator', help='config A (default: constructor)')
    ap.add_argument('--b', default='constructor', help='config B (default: collector)')
    ap.add_argument('--sizes', default='6,8,10', help='comma list of board sizes')
    ap.add_argument('--games', type=int, default=48, help='games per size (default 48)')
    ap.add_argument('--workers', type=int, default=min(16, os.cpu_count() or 16))
    ap.add_argument('--no-switch', action='store_true',
                    help='disable side-switching (A always plays first)')
    args = ap.parse_args()

    sizes = [int(s.strip()) for s in args.sizes.split(',') if s.strip()]
    cfg_a = load_config(args.a)
    cfg_b = load_config(args.b)
    switch_sides = not args.no_switch

    print(f'{args.a}  vs  {args.b}')
    print(f'  A cfg: {cfg_a}')
    print(f'  B cfg: {cfg_b}')
    print(f'  Sizes: {sizes}   Games/size: {args.games}   Workers: {args.workers}')
    print(f'  Side switching: {switch_sides}')

    t0 = time.time()
    rows = []
    total_score_a = 0.0
    total_n = 0

    for sz in sizes:
        print(f'\n=== size {sz}x{sz} ===', flush=True)
        r = run_pair(cfg_a, cfg_b, sz, args.games, args.workers,
                     name_a=args.a, name_b=args.b,
                     switch_sides=switch_sides, verbose=True)
        r['size'] = sz
        rows.append(r)
        score_a = r['wins_a'] + 0.5 * r['draws']
        total_score_a += score_a
        total_n += r['n']

    # Final aggregate table.
    print('\n' + '=' * 78)
    print(f'Summary: {args.a} vs {args.b}   ({total_n} games total)')
    print('=' * 78)
    print(f'  {"size":>6} | {args.a[:7]:>7} wins | {args.b[:7]:>7} wins | draws |'
          f'  score%   95% CI         | Elo (95% CI)')
    print('  ' + '-' * 84)
    for r in rows:
        print(f'  {r["size"]:>6} | {r["wins_a"]:>12} | {r["wins_b"]:>12} | {r["draws"]:>5} |'
              f'  {r["score"]*100:>5.1f}   [{r["ci_lo"]*100:>4.1f},{r["ci_hi"]*100:>4.1f}]   |'
              f' {r["elo"]:+5.0f}  [{r["elo_lo"]:+5.0f},{r["elo_hi"]:+5.0f}]')

    if total_n > 0:
        overall_p = total_score_a / total_n
        lo, _, hi = wilson_interval(total_score_a, total_n)
        print('  ' + '-' * 84)
        print(f'  {"ALL":>6} | {sum(r["wins_a"] for r in rows):>12} |'
              f' {sum(r["wins_b"] for r in rows):>12} |'
              f' {sum(r["draws"] for r in rows):>5} |'
              f'  {overall_p*100:>5.1f}   [{lo*100:>4.1f},{hi*100:>4.1f}]   |'
              f' {elo_diff(overall_p):+5.0f}  '
              f'[{elo_diff(lo):+5.0f},{elo_diff(hi):+5.0f}]')

    wall = time.time() - t0
    print(f'\nWall time: {wall:.1f}s ({wall/60:.1f} min)   '
          f'Throughput: {total_n / wall:.2f} games/s')


if __name__ == '__main__':
    main()
