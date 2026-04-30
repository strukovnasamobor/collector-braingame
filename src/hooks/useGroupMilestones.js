import { useCallback, useEffect, useRef, useState } from 'react';

const WORDS_12 = [
  'Good', 'Nice', 'Solid', 'Great', 'Excellent', 'Wonderful', 'Awesome',
  'Fabulous', 'Amazing', 'Brilliant', 'Terrific', 'Fantastic', 'Marvelous',
  'Outstanding', 'Superb', 'Stunning', 'Incredible', 'Spectacular',
  'Extraordinary', 'Phenomenal', 'Magnificent', 'Breathtaking', 'Astonishing',
  'Mind-blowing', 'Unbelievable', 'Sublime', 'COLLECTOR'
];

const WORDS_10 = [
  'Good', 'Nice', 'Solid', 'Great', 'Excellent', 'Wonderful', 'Awesome',
  'Fabulous', 'Amazing', 'Brilliant', 'Terrific', 'Fantastic', 'Marvelous',
  'Outstanding', 'Superb', 'Stunning', 'Incredible', 'Spectacular', 'COLLECTOR'
];

const WORDS_8 = [
  'Good', 'Nice', 'Solid', 'Great', 'Excellent', 'Wonderful', 'Awesome',
  'Fabulous', 'Amazing', 'Brilliant', 'Terrific', 'COLLECTOR'
];

const WORDS_6 = [
  'Good', 'Nice', 'Solid', 'Great', 'Excellent', 'Wonderful', 'Awesome'
];

function buildMap(start, words) {
  const map = {};
  for (let i = 0; i < words.length; i++) map[start + i] = words[i];
  return map;
}

export const MILESTONES_BY_SIZE = {
  6: buildMap(2, WORDS_6),
  8: buildMap(4, WORDS_8),
  10: buildMap(6, WORDS_10),
  12: buildMap(8, WORDS_12)
};

function getMilestonesFor(gridSize) {
  return MILESTONES_BY_SIZE[gridSize] || null;
}

function highestLevelAtMost(levels, value) {
  let result = 0;
  for (const level of levels) {
    if (level <= value) result = level;
    else break;
  }
  return result;
}

function highestLevelInRange(levels, prev, cur) {
  let result = 0;
  for (const level of levels) {
    if (level > prev && level <= cur) result = level;
    else if (level > cur) break;
  }
  return result;
}

export function useGroupMilestones({ scores, matchKey, watchPlayers, enabled, gridSize }) {
  const lastSeenRef = useRef({ 1: 0, 2: 0 });
  const queueRef = useRef([]);
  const idRef = useRef(0);
  const matchKeyRef = useRef(matchKey);
  const [event, setEvent] = useState(null);

  useEffect(() => {
    if (matchKeyRef.current !== matchKey) {
      matchKeyRef.current = matchKey;
      lastSeenRef.current = { 1: 0, 2: 0 };
      queueRef.current = [];
      setEvent(null);
    }
  }, [matchKey]);

  useEffect(() => {
    if (!enabled || !watchPlayers || watchPlayers.length === 0) return;
    const milestones = getMilestonesFor(gridSize);
    if (!milestones) return;
    const levels = Object.keys(milestones).map(Number).sort((a, b) => a - b);
    if (levels.length === 0) return;

    let pushed = false;
    for (const p of watchPlayers) {
      const cur = scores?.[p] ?? 0;
      const prev = lastSeenRef.current[p] || 0;
      if (cur > prev) {
        const target = highestLevelInRange(levels, prev, cur);
        if (target > 0) {
          const word = milestones[target];
          idRef.current += 1;
          queueRef.current.push({
            id: idRef.current,
            player: p,
            level: target,
            // 1-indexed position in the word progression — stable across grid sizes
            // (e.g., "Great" is always degree 4) so chime + confetti scaling is
            // tied to the named milestone, not the raw dot count.
            degree: levels.indexOf(target) + 1,
            word,
            isMax: word === 'COLLECTOR'
          });
          lastSeenRef.current[p] = target;
          pushed = true;
        }
      } else if (cur < prev) {
        lastSeenRef.current[p] = highestLevelAtMost(levels, cur);
      }
    }
    if (pushed && event === null) {
      const next = queueRef.current.shift();
      if (next) setEvent(next);
    }
  }, [scores, enabled, watchPlayers, event, gridSize]);

  const dismiss = useCallback(() => {
    const next = queueRef.current.shift();
    setEvent(next || null);
  }, []);

  return { event, dismiss };
}
