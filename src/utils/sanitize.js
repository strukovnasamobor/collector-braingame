// Client-side sanitization helpers. The worker re-validates everything authoritatively;
// these mirror its rules so the UI rejects bad input early and doesn't waste round-trips.

const MAX_DISPLAY_NAME_LENGTH = 32;
const ALLOWED_GRID_SIZES = [4, 6, 8, 10, 12];
const ROOM_CODE_LENGTH = 6;

const DANGEROUS_NAME_CHARS = new RegExp(
  '[' +
    '\\u00AD' +
    '\\u061C' +
    '\\u180E' +
    '\\u200B-\\u200F' +
    '\\u202A-\\u202E' +
    '\\u2060-\\u2064' +
    '\\u2066-\\u206F' +
    '\\uFE00-\\uFE0F' +
    '\\uFEFF' +
    ']' +
    '|[\\u{E0000}-\\u{E007F}]',
  'gu'
);
const CONTROL_CHARS = /[\x00-\x1F\x7F-\x9F]/g;

export function sanitizeDisplayName(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .normalize('NFKC')
    .replace(DANGEROUS_NAME_CHARS, '')
    .replace(CONTROL_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_DISPLAY_NAME_LENGTH);
}

export function sanitizeRoomCode(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, ROOM_CODE_LENGTH);
}

export function clampGridSize(raw, fallback = 6) {
  const n = Number(raw);
  return ALLOWED_GRID_SIZES.includes(n) ? n : fallback;
}

export const DISPLAY_NAME_MAX = MAX_DISPLAY_NAME_LENGTH;
export const ROOM_CODE_LEN = ROOM_CODE_LENGTH;
