#!/usr/bin/env python3
"""
Rating-based tournament simulator.

Mirrors the online matchmaking flow:
  1. Initial ratings (all bots start at display rating 1000;
     mu = DEFAULT_MU = 1500, sigma = DEFAULT_SIGMA = 500).
  2. For each match on 8×8:
       a. Pick a random bot as the "player".
       b. Run the online matchmaker against the other bots:
          pool = sample min(ceil(N/10) + 1, 1000, N) candidates, then pick the
          one whose display rating is closest to the player's.
       c. Lower-rated bot is P1 (ties → player is P1, matching the online rule
          for human-vs-bot ties).
       d. Play the game; update both ratings via the OpenSkill-style formula
          ported from src/game/skillRating.js.
       e. Print pairing + result + rating deltas.
  3. After all matches, print the final ranking by display rating.

Usage:
  python tournament_sim.py --n 50
  python tournament_sim.py --n 100 --seed 42
"""
import argparse
import json
import math
import os
import random
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from tune import load_config, play_game, EngineProcess  # noqa: E402

# ── Bots ───────────────────────────────────────────────────────────────────
# Curator excluded: it requires Firestore state injection (online-only).
BOTS = [
    'connector', 'concentrator', 'constructor', 'coordinator',
    'confiscator', 'conservator', 'cumulator', 'collector',
]

# ── OpenSkill-style rating math (ported from src/game/skillRating.js) ──────
DEFAULT_MU = 1500.0
DEFAULT_SIGMA = 500.0
OPEN_SKILL_BETA = 250.0
DEFAULT_DISPLAY_RATING = 1000.0
MIN_SIGMA = 1.0
EPSILON = 1e-12
MAX_MU = 5000.0
MAX_DISPLAY_RATING = 9999.0
DISPLAY_SCALE = 1000.0 / math.log(2)
DISPLAY_DIVISOR = 2485.0

def standard_normal_pdf(x):
    return math.exp(-0.5 * x * x) / math.sqrt(2 * math.pi)

def standard_normal_cdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))

def softplus(x):
    if x > 0:
        return x + math.log1p(math.exp(-x))
    return math.log1p(math.exp(x))

def display_rating_from_skill(conservative_skill):
    if not math.isfinite(conservative_skill):
        return DEFAULT_DISPLAY_RATING
    raw = DISPLAY_SCALE * softplus(conservative_skill / DISPLAY_DIVISOR)
    if not math.isfinite(raw):
        return DEFAULT_DISPLAY_RATING
    return min(MAX_DISPLAY_RATING, max(0.0, raw))

def display_rating(profile):
    return round(display_rating_from_skill(profile['mu'] - 3 * profile['sigma']))

def new_profile(mu=DEFAULT_MU, sigma=DEFAULT_SIGMA):
    p = {'mu': mu, 'sigma': sigma}
    p['rating'] = display_rating(p)
    return p

def update_after_win(winner, loser):
    """OpenSkill update: returns (new_winner, new_loser) profiles."""
    w_sig2 = winner['sigma'] ** 2
    l_sig2 = loser['sigma'] ** 2
    c = math.sqrt(2 * OPEN_SKILL_BETA ** 2 + w_sig2 + l_sig2)
    t = (winner['mu'] - loser['mu']) / c
    p = max(standard_normal_cdf(t), EPSILON)
    pdf = standard_normal_pdf(t)
    gamma = 1.0 / c
    v = (pdf * (t + pdf / p)) / p

    new_w_mu = min(MAX_MU, max(0.0, winner['mu'] + (w_sig2 / c) * (pdf / p)))
    new_l_mu = min(MAX_MU, max(0.0, loser['mu'] - (l_sig2 / c) * (pdf / p)))
    new_w_sigma = math.sqrt(max(w_sig2 * (1 - w_sig2 * gamma * gamma * v), MIN_SIGMA ** 2))
    new_l_sigma = math.sqrt(max(l_sig2 * (1 - l_sig2 * gamma * gamma * v), MIN_SIGMA ** 2))

    return new_profile(new_w_mu, new_w_sigma), new_profile(new_l_mu, new_l_sigma)

# ── Matchmaking (mirrors worker/src/index.js ranked-mode matchmaker) ───────
MATCHMAKING_POOL_DIVISOR = 10
MATCHMAKING_POOL_MAX = 1000

def find_opponent(player, profiles, rng):
    """Sample a pool of size min(ceil(N/10)+1, 1000, N) from candidates
    (everyone except `player`), then pick the candidate whose rating is
    closest to player's rating. Ties broken by sample order.
    """
    candidates = [b for b in BOTS if b != player]
    N = len(candidates)
    pool_size = min(math.ceil(N / MATCHMAKING_POOL_DIVISOR) + 1,
                    MATCHMAKING_POOL_MAX, N)
    pool = rng.sample(candidates, pool_size)
    player_rating = profiles[player]['rating']
    best = None
    best_diff = math.inf
    for c in pool:
        diff = abs(profiles[c]['rating'] - player_rating)
        if diff < best_diff:
            best_diff = diff
            best = c
    return best, pool

# ── Match orchestration ────────────────────────────────────────────────────

def assign_p1_p2(player, opponent, profiles, rng):
    """Lower-rated plays P1. Ties: player is P1 (matches the online
    bot-tie rule). Returns (p1_name, p2_name).
    """
    p_rating = profiles[player]['rating']
    o_rating = profiles[opponent]['rating']
    if p_rating < o_rating:
        return player, opponent
    if p_rating > o_rating:
        return opponent, player
    return player, opponent  # tie → player is P1

# ── Main ───────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--n', type=int, default=50,
                    help='Number of matches to play (default 50)')
    ap.add_argument('--size', type=int, default=8,
                    help='Board size (default 8)')
    ap.add_argument('--prefix', default='test_',
                    help='Config prefix (default test_ for fast variants)')
    ap.add_argument('--seed', type=int, default=None,
                    help='Random seed (default: nondeterministic)')
    args = ap.parse_args()

    rng = random.Random(args.seed) if args.seed is not None else random.Random()

    configs = {b: load_config(f'{args.prefix}{b}') for b in BOTS}
    profiles = {b: new_profile() for b in BOTS}
    stats = {b: {'played': 0, 'wins': 0, 'draws': 0, 'losses': 0} for b in BOTS}

    print(f'Tournament: {args.n} matches on {args.size}x{args.size}')
    print(f'Bots:       {", ".join(BOTS)}')
    print(f'Configs:    {args.prefix}<bot>.json')
    print(f'Initial ratings: all = {profiles[BOTS[0]]["rating"]}')
    print(f'Matchmaking: pool=min(ceil(N/10)+1, 1000, N)={min(math.ceil(len(BOTS)-1)/MATCHMAKING_POOL_DIVISOR + 1, MATCHMAKING_POOL_MAX, len(BOTS)-1):.0f}; closest by rating')
    print(f'P1 rule:     lower-rated plays first')
    print('=' * 78)

    eng = EngineProcess()
    t0 = time.time()
    try:
        for match_idx in range(1, args.n + 1):
            player = rng.choice(BOTS)
            opponent, pool = find_opponent(player, profiles, rng)
            p1, p2 = assign_p1_p2(player, opponent, profiles, rng)

            cfg_p1 = configs[p1]
            cfg_p2 = configs[p2]
            r = play_game(eng, cfg_p1, cfg_p2, args.size, swap=False)
            # play_game returns 'A' if cfg_a (= P1) wins, 'B' if cfg_b (= P2),
            # 'draw' otherwise.
            if r == 'A':
                winner, loser = p1, p2
            elif r == 'B':
                winner, loser = p2, p1
            else:
                winner = loser = None

            # Rating update (draws: no rating change, matching the
            # `scoreA === 0.5` branch in computeSkillDelta).
            before_p = dict(profiles[player])
            before_o = dict(profiles[opponent])
            if winner is not None:
                new_w, new_l = update_after_win(profiles[winner], profiles[loser])
                profiles[winner] = new_w
                profiles[loser] = new_l

            outcome = 'DRAW' if winner is None else winner
            dp = profiles[player]['rating'] - before_p['rating']
            do = profiles[opponent]['rating'] - before_o['rating']

            # Game-count stats per bot — both sides record the match, the
            # outcome side records the W/D/L (player/opponent symmetric).
            stats[player]['played'] += 1
            stats[opponent]['played'] += 1
            if winner is None:
                stats[player]['draws'] += 1
                stats[opponent]['draws'] += 1
            else:
                stats[winner]['wins'] += 1
                stats[loser]['losses'] += 1

            print(
                f'#{match_idx:>3} | player {player:>12}({before_p["rating"]:>4})  '
                f'opp {opponent:>12}({before_o["rating"]:>4})  '
                f'pool[{",".join(pool)}]  '
                f'P1={p1:>12}  '
                f'-> {outcome:>12}  '
                f'd {player}{dp:+d}/{opponent}{do:+d}',
                flush=True
            )
    finally:
        eng.close()

    elapsed = time.time() - t0
    print('=' * 78)
    print(f'\nFinal ratings ({args.n} matches, {elapsed:.1f}s wall):')
    print(f'  {"#":>2}  {"bot":>13}  {"rating":>6}  {"mu":>7}  {"sigma":>5}  '
          f'{"games":>5}  {"W":>3}/{"D":>2}/{"L":>3}  {"win%":>5}')
    ladder = sorted(BOTS, key=lambda b: -profiles[b]['rating'])
    for i, b in enumerate(ladder, 1):
        p = profiles[b]
        s = stats[b]
        # Score = wins + 0.5·draws (matches the W/D/L scoring used elsewhere
        # in the harness, e.g. tune.py run_pair).
        score = s['wins'] + 0.5 * s['draws']
        win_pct = (100.0 * score / s['played']) if s['played'] else 0.0
        print(f'  {i:>2}. {b:>12}  {p["rating"]:>6}  {p["mu"]:>7.1f}  {p["sigma"]:>5.1f}  '
              f'{s["played"]:>5}  {s["wins"]:>3}/{s["draws"]:>2}/{s["losses"]:>3}  '
              f'{win_pct:>4.1f}%')

if __name__ == '__main__':
    main()
