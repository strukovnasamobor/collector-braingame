"""Game primitives for AlphaZero MCTS. Pure-Python port of engine_az.py
(numba kernels) — numpy used only for encode_planes. Cloud Run CPU container
runs this fast enough at sim counts we care about."""
import numpy as np

PLACE = 0
ELIMINATE = 1


def gen_placements(cells, dead, size):
    """Return list of legal placement indices (empty non-dead cells with at least
    one empty non-dead 8-neighbor)."""
    out = []
    n2 = size * size
    for i in range(n2):
        if cells[i] != 0 or dead[i] != 0:
            continue
        r, c = divmod(i, size)
        has_free = False
        for dr in (-1, 0, 1):
            if has_free:
                break
            for dc in (-1, 0, 1):
                if dr == 0 and dc == 0:
                    continue
                nr, nc = r + dr, c + dc
                if not (0 <= nr < size and 0 <= nc < size):
                    continue
                v = nr * size + nc
                if cells[v] == 0 and dead[v] == 0:
                    has_free = True
                    break
        if has_free:
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
            r, c = lr + dr, lc + dc
            if not (0 <= r < size and 0 <= c < size):
                continue
            idx = r * size + c
            if cells[idx] == 0 and dead[idx] == 0:
                out.append(idx)
    return out


def biggest_group(cells, size, player):
    n2 = size * size
    visited = bytearray(n2)
    best = 0
    for start in range(n2):
        if cells[start] != player or visited[start]:
            continue
        count = 0
        stack = [start]
        visited[start] = 1
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


def encode_planes(cells, dead, side, phase, last_idx, size):
    """5-plane encoding from side's POV. Must match worker/src/ai/azEncoder.js
    and the Python encode_planes used during training."""
    opp = 2 if side == 1 else 1
    planes = np.zeros((5, size, size), dtype=np.float32)
    c2 = np.asarray(cells, dtype=np.int8).reshape(size, size)
    d2 = np.asarray(dead, dtype=np.uint8).reshape(size, size)
    planes[0] = (c2 == side).astype(np.float32)
    planes[1] = (c2 == opp).astype(np.float32)
    planes[2] = d2.astype(np.float32)
    if phase == ELIMINATE:
        planes[3] = 1.0
        if last_idx >= 0:
            r, c = divmod(last_idx, size)
            planes[4, r, c] = 1.0
    return planes
