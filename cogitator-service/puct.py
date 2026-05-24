"""PUCT MCTS with batched ONNX leaf evaluation. Mirrors worker/src/ai/azMcts.js
and the training-time mcts_puct.py."""
import math
import time
import numpy as np

from engine import PLACE, ELIMINATE, gen_placements, gen_eliminations, biggest_group, encode_planes


C_PUCT_DEFAULT = 2.0


class PUCTNode:
    __slots__ = ('parent', 'move', 'to_move', 'phase', 'children', 'prior',
                 'visits', 'total', 'virtual_visits', 'expanded')

    def __init__(self, parent, move, to_move, phase, prior=0.0):
        self.parent = parent
        self.move = move
        self.to_move = to_move
        self.phase = phase
        self.children = []
        self.prior = prior
        self.visits = 0
        self.total = 0.0
        self.virtual_visits = 0
        self.expanded = False


def select_child(node, c_puct):
    n_parent = node.visits + node.virtual_visits
    sqrt_n = math.sqrt(max(1, n_parent))
    best_score = -float('inf')
    best = None
    for c in node.children:
        cv = c.visits + c.virtual_visits
        if cv == 0:
            q = 0.0
        else:
            q = (c.total - c.virtual_visits) / cv
            if c.to_move != node.to_move:
                q = -q
        u = c_puct * c.prior * sqrt_n / (1 + cv)
        score = q + u
        if score > best_score:
            best_score = score
            best = c
    return best


def descend_one(root, root_state, c_puct):
    size = root_state['size']
    cells = list(root_state['cells'])
    dead = list(root_state['dead'])
    phase = root_state['phase']
    side = root_state['side']
    last_idx = root_state['last_idx']

    path = [root]
    root.virtual_visits += 1
    node = root

    while node.expanded and node.children:
        child = select_child(node, c_puct)
        if child is None:
            break
        child.virtual_visits += 1
        m = child.move
        if phase == PLACE:
            cells[m] = side
            last_idx = m
            phase = ELIMINATE
        else:
            dead[m] = 1
            last_idx = -1
            side = 2 if side == 1 else 1
            phase = PLACE
        path.append(child)
        node = child

    if phase == PLACE:
        legal = gen_placements(cells, dead, size)
    else:
        legal = gen_eliminations(cells, dead, size, last_idx)
    terminal = len(legal) == 0

    return path, terminal, (cells, dead, phase, side, last_idx, legal)


def expand_and_backprop(path, leaf_state, policy_logits, net_value, is_terminal, size):
    cells, dead, phase, side, last_idx, legal = leaf_state
    leaf_node = path[-1]

    if is_terminal:
        me = biggest_group(cells, size, side)
        op = biggest_group(cells, size, 2 if side == 1 else 1)
        leaf_value = 1.0 if me > op else (-1.0 if me < op else 0.0)
    else:
        if not leaf_node.expanded:
            max_logit = max(float(policy_logits[m]) for m in legal)
            exps = [math.exp(float(policy_logits[m]) - max_logit) for m in legal]
            total = sum(exps)
            for j, m in enumerate(legal):
                if phase == PLACE:
                    child_to_move = side
                    child_phase = ELIMINATE
                else:
                    child_to_move = 2 if side == 1 else 1
                    child_phase = PLACE
                child = PUCTNode(leaf_node, int(m), child_to_move, child_phase, exps[j] / total)
                leaf_node.children.append(child)
            leaf_node.expanded = True
        leaf_value = float(net_value)

    s = leaf_value
    for i in range(len(path) - 1, -1, -1):
        n = path[i]
        n.virtual_visits -= 1
        n.visits += 1
        n.total += s
        if i > 0 and path[i - 1].to_move != n.to_move:
            s = -s


def _find_adjacent_dead(center_idx, dead_idxs, used, size):
    if center_idx < 0:
        return -1
    cr, cc = divmod(center_idx, size)
    for i, d in enumerate(dead_idxs):
        if used[i]:
            continue
        dr, dc = divmod(d, size)
        adr = abs(dr - cr)
        adc = abs(dc - cc)
        if adr <= 1 and adc <= 1 and (adr != 0 or adc != 0):
            used[i] = True
            return d
    return -1


def compute_move_sequence(prev_state, new_state):
    """Reconstruct the sequence of moves that took prev_state to new_state.
    Returns list of flat move indices, or None if the diff is inconsistent
    (e.g. moves we can't reconcile, branch mismatch). Empty list = no moves."""
    size = prev_state['size']
    if size != new_state['size']:
        return None
    n2 = size * size

    prev_cells = prev_state['cells']
    prev_dead = prev_state['dead']
    new_cells = new_state['cells']
    new_dead = new_state['dead']

    new_dots = []
    new_dead_idxs = []
    for i in range(n2):
        was_dot = prev_cells[i] != 0
        is_dot = new_cells[i] != 0
        if was_dot and not is_dot:
            return None
        if was_dot and is_dot and prev_cells[i] != new_cells[i]:
            return None
        if not was_dot and is_dot:
            new_dots.append((i, new_cells[i]))
        was_dead = bool(prev_dead[i])
        is_dead = bool(new_dead[i])
        if was_dead and not is_dead:
            return None
        if not was_dead and is_dead:
            new_dead_idxs.append(i)

    if not new_dots and not new_dead_idxs:
        return []

    prev_side = prev_state['side']
    other_side = 2 if prev_side == 1 else 1
    my_dot = None
    opp_dot = None
    for d in new_dots:
        if d[1] == prev_side and my_dot is None:
            my_dot = d
        elif d[1] == other_side and opp_dot is None:
            opp_dot = d
    for d in new_dots:
        if d is not my_dot and d is not opp_dot:
            return None

    used = [False] * len(new_dead_idxs)
    moves = []
    if prev_state['phase'] == PLACE:
        if my_dot is not None:
            moves.append(my_dot[0])
            my_dead = _find_adjacent_dead(my_dot[0], new_dead_idxs, used, size)
            if my_dead >= 0:
                moves.append(my_dead)
        if opp_dot is not None:
            moves.append(opp_dot[0])
            opp_dead = _find_adjacent_dead(opp_dot[0], new_dead_idxs, used, size)
            if opp_dead >= 0:
                moves.append(opp_dead)
    else:
        prev_last = prev_state['last_idx']
        if prev_last >= 0:
            my_dead = _find_adjacent_dead(prev_last, new_dead_idxs, used, size)
            if my_dead >= 0:
                moves.append(my_dead)
        if opp_dot is not None:
            moves.append(opp_dot[0])
            opp_dead = _find_adjacent_dead(opp_dot[0], new_dead_idxs, used, size)
            if opp_dead >= 0:
                moves.append(opp_dead)
    for u in used:
        if not u:
            return None
    return moves


def navigate_tree(prev_root, moves, expected_to_move, expected_phase):
    """Walk down prev_root following `moves` (flat indices). Returns the node
    at the end of the path, or None if any move isn't an explored child."""
    node = prev_root
    for m in moves:
        if not node.children:
            return None
        found = None
        for c in node.children:
            if c.move == m:
                found = c
                break
        if found is None:
            return None
        node = found
    if node.to_move != expected_to_move or node.phase != expected_phase:
        return None
    return node


def puct_search(state, sim_budget, session, batch_size=32, c_puct=C_PUCT_DEFAULT,
                time_ms=None, reused_root=None):
    """Returns (root, sims_done). If reused_root is provided, search continues
    from that subtree instead of building a fresh root."""
    size = state['size']
    if reused_root is not None:
        root = reused_root
        root.parent = None  # detach from old tree so it can GC
    else:
        root = PUCTNode(None, -1, state['side'], state['phase'], 1.0)
    sims_done = 0
    t_start = time.monotonic() if time_ms is not None else 0.0

    while sims_done < sim_budget:
        if time_ms is not None and (time.monotonic() - t_start) * 1000 >= time_ms:
            break
        this_batch = min(batch_size, sim_budget - sims_done)
        descents = []
        for _ in range(this_batch):
            descents.append(descend_one(root, state, c_puct))

        nt_indices = [i for i, d in enumerate(descents) if not d[1]]
        if nt_indices:
            K = len(nt_indices)
            batch_planes = np.zeros((K, 5, size, size), dtype=np.float32)
            for bi, di in enumerate(nt_indices):
                cells, dead, phase, side, last_idx, _ = descents[di][2]
                batch_planes[bi] = encode_planes(cells, dead, side, phase, last_idx, size)
            outputs = session.run(['policy_logits', 'value'], {'state': batch_planes})
            policy_arr = outputs[0]
            value_arr = outputs[1]
        else:
            policy_arr = None
            value_arr = None

        nt_iter = 0
        for i, (path, terminal, leaf_state) in enumerate(descents):
            if terminal:
                expand_and_backprop(path, leaf_state, None, None, True, size)
            else:
                expand_and_backprop(path, leaf_state, policy_arr[nt_iter],
                                    float(value_arr[nt_iter]), False, size)
                nt_iter += 1
            sims_done += 1

    return root, sims_done


def pick_move(root):
    if not root.children:
        return -1
    best = max(root.children, key=lambda c: c.visits)
    return int(best.move)
