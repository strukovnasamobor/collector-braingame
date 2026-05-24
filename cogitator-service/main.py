"""Cogitator inference service. FastAPI + onnxruntime + PUCT MCTS.
Deployed to Cloud Run. The Cloudflare Worker (collector-game-backend) calls
POST /cogitate with the current game state and gets back a move.

Three features beyond the basic PUCT loop:
  - endgame:    exact αβ solver when empty cells ≤ endgame_depth
  - reuseTree:  per-game subtree cache reused across consecutive moves
  - batched leaf evaluation via ONNX (always on; batch_size=32 by default)
"""
import os
import time
from pathlib import Path
from typing import List, Optional
from threading import Lock

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel
import onnxruntime as ort

from puct import puct_search, pick_move, compute_move_sequence, navigate_tree
from endgame import count_empty, endgame_search


MODEL_PATH = Path(__file__).parent / 'az_iter0_8x8.onnx'

SESSION = ort.InferenceSession(str(MODEL_PATH), providers=['CPUExecutionProvider'])

# Shared-secret auth. Set the COGITATOR_TOKEN env var at deploy time; the
# Cloudflare Worker must send a matching X-Cogitator-Token header. If the env
# var is unset, the endpoint is open (useful for local dev / first deploy).
EXPECTED_TOKEN = os.environ.get('COGITATOR_TOKEN')


def require_token(x_cogitator_token: Optional[str] = Header(None)):
    if EXPECTED_TOKEN is None:
        return
    if x_cogitator_token != EXPECTED_TOKEN:
        raise HTTPException(status_code=401, detail='Invalid or missing token')

# ── reuseTree cache ─────────────────────────────────────────────────────────
# Cloud Run instances are reaped on idle, so this is best-effort. When the
# instance is warm and the same game keeps making moves, the cache hits and
# search starts from the previous turn's tree. On cache miss (cold instance,
# new game, opponent picked a low-prior move we didn't explore), we fall back
# to a fresh tree at zero correctness cost.
_TREE_CACHE = {}              # game_id -> (root, state_snapshot, timestamp)
_TREE_CACHE_LOCK = Lock()
_CACHE_TTL_SEC = 600          # 10 minutes — longer than any realistic game
_CACHE_MAX_ENTRIES = 200      # safety cap; LRU-evict oldest beyond this


def _snapshot_state(state):
    """Deep copy of state for cache storage (list ops would alias)."""
    return {
        'size': state['size'],
        'cells': list(state['cells']),
        'dead': list(state['dead']),
        'phase': state['phase'],
        'side': state['side'],
        'last_idx': state['last_idx'],
    }


def _cleanup_cache():
    """Drop entries older than TTL; if still over cap, evict oldest."""
    now = time.time()
    expired = [gid for gid, entry in _TREE_CACHE.items() if now - entry[2] > _CACHE_TTL_SEC]
    for gid in expired:
        del _TREE_CACHE[gid]
    if len(_TREE_CACHE) > _CACHE_MAX_ENTRIES:
        sorted_keys = sorted(_TREE_CACHE.keys(), key=lambda k: _TREE_CACHE[k][2])
        for gid in sorted_keys[: len(_TREE_CACHE) - _CACHE_MAX_ENTRIES]:
            del _TREE_CACHE[gid]


class CogitateRequest(BaseModel):
    cells: List[int]
    dead: List[int]
    size: int
    phase: int
    side: int
    last_idx: int
    sim_budget: int = 25000
    time_ms: int = 12000
    batch_size: int = 32
    # New optional fields (default behavior = today's behavior):
    game_id: Optional[str] = None       # required for reuseTree
    endgame: bool = False               # if true, hand off to αβ when applicable
    endgame_depth: int = 12             # empty-cell threshold
    min_endgame_board_size: int = 7     # don't bother with αβ on tiny boards


class CogitateResponse(BaseModel):
    move: int
    sims: int
    search_ms: int
    used: str                           # 'endgame', 'reuse', 'fresh' — for telemetry


app = FastAPI(title='cogitator')


@app.get('/')
def health():
    with _TREE_CACHE_LOCK:
        cache_size = len(_TREE_CACHE)
    return {
        'ok': True,
        'inputs': [i.name for i in SESSION.get_inputs()],
        'outputs': [o.name for o in SESSION.get_outputs()],
        'cache_size': cache_size,
        'auth_enabled': EXPECTED_TOKEN is not None,
    }


@app.post('/cogitate')
def cogitate(req: CogitateRequest,
             x_cogitator_token: Optional[str] = Header(None)) -> CogitateResponse:
    # Token check — when COGITATOR_TOKEN env var is set, request must carry
    # a matching X-Cogitator-Token header. When unset, open (for local dev).
    if EXPECTED_TOKEN is not None and x_cogitator_token != EXPECTED_TOKEN:
        raise HTTPException(status_code=401, detail='Invalid or missing token')
    t0 = time.monotonic()
    state = {
        'size': req.size,
        'cells': list(req.cells),
        'dead': list(req.dead),
        'phase': int(req.phase),
        'side': int(req.side),
        'last_idx': int(req.last_idx),
    }

    # 1. Endgame αβ handoff
    if req.endgame and req.size >= req.min_endgame_board_size \
            and count_empty(state['cells'], state['dead'], state['size']) <= req.endgame_depth:
        move = endgame_search(
            state['cells'], state['dead'], state['phase'], state['side'],
            state['last_idx'], state['size'],
        )
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        return CogitateResponse(move=move, sims=0, search_ms=elapsed_ms, used='endgame')

    # 2. Per-phase budget split — ELIMINATE has at most 8 legal moves (8-
    # neighbors of last_idx), so PUCT converges in a fraction of the PLACE-
    # phase budget. Mirrors the same logic in worker/src/ai/aiEngine.js for
    # MCTS-RAVE: 1/4 sims, 1/3 time on eliminate. Guarantees a player's
    # full turn (place + eliminate) fits comfortably inside the 30 s ranked
    # timer without spending the same compute twice.
    eff_sim_budget = req.sim_budget
    eff_time_ms = req.time_ms
    if state['phase'] == 1:  # ELIMINATE
        eff_sim_budget = min(req.sim_budget, max(500, req.sim_budget // 4))
        eff_time_ms    = min(req.time_ms,    max(1500, req.time_ms // 3))

    # 2. Try tree reuse
    reused_root = None
    used = 'fresh'
    if req.game_id:
        with _TREE_CACHE_LOCK:
            _cleanup_cache()
            cached = _TREE_CACHE.get(req.game_id)
        if cached is not None:
            prev_root, prev_state, _ = cached
            moves = compute_move_sequence(prev_state, state)
            if moves is not None:
                navigated = navigate_tree(prev_root, moves, state['side'], state['phase'])
                if navigated is not None:
                    reused_root = navigated
                    used = 'reuse'

    # 4. Run PUCT
    root, sims = puct_search(
        state,
        sim_budget=eff_sim_budget,
        session=SESSION,
        batch_size=req.batch_size,
        time_ms=eff_time_ms,
        reused_root=reused_root,
    )
    move = pick_move(root)

    # 4. Cache for next call
    if req.game_id and move >= 0:
        # Apply the picked move to compute the post-move state we'll resume from.
        post_state = _snapshot_state(state)
        if post_state['phase'] == 0:        # PLACE → ELIMINATE
            post_state['cells'][move] = post_state['side']
            post_state['last_idx'] = move
            post_state['phase'] = 1
        else:                                # ELIMINATE → PLACE (side flips)
            post_state['dead'][move] = 1
            post_state['last_idx'] = -1
            post_state['side'] = 2 if post_state['side'] == 1 else 1
            post_state['phase'] = 0
        # Find the picked child to use as the new cache root.
        new_root = None
        for c in root.children:
            if c.move == move:
                new_root = c
                break
        if new_root is not None:
            new_root.parent = None
            with _TREE_CACHE_LOCK:
                _TREE_CACHE[req.game_id] = (new_root, post_state, time.time())

    elapsed_ms = int((time.monotonic() - t0) * 1000)
    return CogitateResponse(move=move, sims=sims, search_ms=elapsed_ms, used=used)
