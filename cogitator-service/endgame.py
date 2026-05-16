"""Exact αβ endgame solver. Used when empty cells <= endgame_depth.
Mirrors aiEngineCore.endgameRoot — searches to terminal, returns the move
that maximizes biggest-group margin from `side`'s perspective.

For Collector specifically:
  - PLACE moves keep side unchanged (just changes phase to ELIMINATE).
  - ELIMINATE moves toggle side (and reset phase to PLACE).
  - Negamax sign-flip happens ONLY on ELIMINATE moves.
"""
from engine import PLACE, ELIMINATE, gen_placements, gen_eliminations, biggest_group


def count_empty(cells, dead, size):
    n2 = size * size
    n = 0
    for i in range(n2):
        if cells[i] == 0 and dead[i] == 0:
            n += 1
    return n


def _eval_terminal(cells, size, side):
    me = biggest_group(cells, size, side)
    op = biggest_group(cells, size, 2 if side == 1 else 1)
    return me - op


def _negamax(cells, dead, phase, side, last_idx, size, alpha, beta):
    """Returns the best achievable margin from `side`'s perspective.
    Mutates cells/dead in place; restores before return."""
    if phase == PLACE:
        moves = gen_placements(cells, dead, size)
    else:
        moves = gen_eliminations(cells, dead, size, last_idx)

    if not moves:
        return _eval_terminal(cells, size, side)

    best = -10**9
    for m in moves:
        if phase == PLACE:
            cells[m] = side
            v = _negamax(cells, dead, ELIMINATE, side, m, size, alpha, beta)
            cells[m] = 0
        else:
            dead[m] = 1
            opp = 2 if side == 1 else 1
            v = -_negamax(cells, dead, PLACE, opp, -1, size, -beta, -alpha)
            dead[m] = 0
        if v > best:
            best = v
        if v > alpha:
            alpha = v
        if alpha >= beta:
            break
    return best


def endgame_search(cells, dead, phase, side, last_idx, size):
    """Returns the best move (flat index) at root via exact αβ.
    Returns -1 if no legal moves (terminal)."""
    # Defensive copies so we don't trash caller's arrays during search.
    cells = list(cells)
    dead = list(dead)

    if phase == PLACE:
        moves = gen_placements(cells, dead, size)
    else:
        moves = gen_eliminations(cells, dead, size, last_idx)
    if not moves:
        return -1

    best_move = moves[0]
    best_score = -10**9
    alpha = -10**9
    beta = 10**9
    for m in moves:
        if phase == PLACE:
            cells[m] = side
            score = _negamax(cells, dead, ELIMINATE, side, m, size, alpha, beta)
            cells[m] = 0
        else:
            dead[m] = 1
            opp = 2 if side == 1 else 1
            score = -_negamax(cells, dead, PLACE, opp, -1, size, -beta, -alpha)
            dead[m] = 0
        if score > best_score:
            best_score = score
            best_move = m
        if score > alpha:
            alpha = score
    return int(best_move)
