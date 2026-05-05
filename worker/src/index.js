import { importX509, jwtVerify } from 'jose';
import { ensureBotProfilesOnce } from './bootstrap/seedBots';
import { chooseAIMove as chooseBotMove } from './ai/aiEngine';
import {
  ALL_TIERS,
  BOT_DISPLAY,
  BOT_UID_PREFIX,
  STANDARD_BOT_GRID_SIZES,
  isBotUid,
  tierFromBotUid,
  botUidFor,
  standardBotQueueDocId,
  rankedBotQueueDocId
} from './ai/bots';
import { getBotProfile, invalidateBotProfile } from './ai/botProfileCache';

const FIREBASE_CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const FIREBASE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FIRESTORE_SCOPE = 'https://www.googleapis.com/auth/datastore';

// Hostnames whose cross-origin requests should receive CORS headers. The default fetch handler
// reflects the request Origin only when its hostname is in this set; everything else gets no
// Access-Control-Allow-Origin and is blocked by the browser. Bearer-token auth means a stolen
// token still works regardless of origin, but tightening this is cheap defense-in-depth.
const ALLOWED_ORIGIN_HOSTS = new Set([
  'collector-braingame.web.app',
  'collector-braingame.firebaseapp.com',
  'localhost',
  '127.0.0.1'
]);
// Inner handlers attach a wildcard placeholder; the outer fetch handler rewrites it based on
// the request's Origin. This keeps every handler's response shape uniform.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
};

const DEFAULT_MU = 1500;
const DEFAULT_SIGMA = 500;
const DEFAULT_DISPLAY_RATING = 1000;
const OPEN_SKILL_BETA = 250;
const DISPLAY_SCALE = 1000 / Math.LN2;
const DISPLAY_DIVISOR = 2485;
const MIN_SIGMA = 1;
const EPSILON = 1e-12;
const MAX_MU = 5000;
const MAX_DISPLAY_RATING = 9999;
const MATCHMAKING_STALE_MS_BY_MODE = {
  ranked: 25 * 1000,
  standard: 30 * 1000
};
const MATCHMAKING_STALE_MS = 30 * 1000;
const STALE_GAME_THRESHOLD_MS = 60 * 1000;
const STALE_STANDARD_GAME_THRESHOLD_MS = 5 * 60 * 1000;
const TURN_DURATION_MS = 30 * 1000;
// Clients submit moves via the worker, which adds RTT. 2s covers normal jitter while keeping
// the post-deadline abuse window small (was 5s, which let fast clients steal a free turn).
const TURN_DEADLINE_GRACE_MS = 2 * 1000;
const QUEUE_QUERY_LIMIT = 200;
const ACTIVE_GAME_QUERY_LIMIT = 5;

const MATCHMAKING_POOL_DIVISOR = 10;
const MATCHMAKING_POOL_MAX = 1000;

const ALLOWED_GRID_SIZES = new Set([4, 6, 8, 10, 12]);
const RANKED_GRID_SIZE = 8;
const ROOM_CODE_PATTERN = /^[A-Z0-9]{6}$/;
const GAME_ID_PATTERN = /^[A-Za-z0-9_]{1,40}$/;
const MAX_DISPLAY_NAME_LENGTH = 32;
// Strip codepoints that let names spoof or mislead other players: bidi controls (RTL/LTR
// override), zero-width joiners, format chars, variation selectors, soft hyphen, BOM.
// React still escapes HTML, so XSS is not the concern; visual deception is.
const DANGEROUS_NAME_CHARS = new RegExp(
  '[' +
    '\\u00AD' +              // soft hyphen
    '\\u061C' +              // Arabic letter mark
    '\\u180E' +              // Mongolian vowel separator
    '\\u200B-\\u200F' +      // zero-width spaces, joiners, LRM, RLM
    '\\u202A-\\u202E' +      // bidi embed/override (incl. RTL override U+202E)
    '\\u2060-\\u2064' +      // word joiner, invisible operators
    '\\u2066-\\u206F' +      // bidi isolates, deprecated format chars
    '\\uFE00-\\uFE0F' +      // variation selectors
    '\\uFEFF' +              // BOM / zero-width no-break space
    ']' +
    '|[\\u{E0000}-\\u{E007F}]',  // tag characters (extra range needs its own class)
  'gu'
);
// C0/C1 control characters: never belong in a display name.
const CONTROL_CHARS = /[\x00-\x1F\x7F-\x9F]/g;

class HttpError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
    this.exposed = true;
  }
}

function clampDisplayName(name) {
  if (typeof name !== 'string') return '';
  // NFKC folds compatibility forms (full-width Latin, ligatures) so 'Ｐlayer' and 'Player'
  // collapse to the same canonical name. Then strip bidi/zero-width/control characters that
  // enable visual spoofing, collapse runs of whitespace, and trim.
  const cleaned = name
    .normalize('NFKC')
    .replace(DANGEROUS_NAME_CHARS, '')
    .replace(CONTROL_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, MAX_DISPLAY_NAME_LENGTH);
}

function parseGridSize(raw, { fallback = 6 } = {}) {
  const n = Number(raw);
  return ALLOWED_GRID_SIZES.has(n) ? n : fallback;
}

function requireGridSize(raw) {
  const n = Number(raw);
  if (!ALLOWED_GRID_SIZES.has(n)) {
    throw new HttpError('Invalid grid size.', 400);
  }
  return n;
}

function requireRoomCode(raw) {
  const code = String(raw || '').toUpperCase().trim();
  if (!ROOM_CODE_PATTERN.test(code)) {
    throw new HttpError('Room code is required.', 400);
  }
  return code;
}

function requireGameId(raw) {
  const id = String(raw || '');
  if (!GAME_ID_PATTERN.test(id)) {
    throw new HttpError('gameId is required.', 400);
  }
  return id;
}

function requireBoardIndex(raw, size, label) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n >= size) {
    throw new HttpError(`Invalid ${label}.`, 400);
  }
  return n;
}

let certCache = null;
let certCacheExpiresAt = 0;
let googleTokenCache = null;
let googleTokenExpiresAt = 0;
let pkcs8KeyPromise = null;

function corsResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
}

function errorResponse(message, status = 400) {
  return corsResponse({ error: message }, status);
}

function base64UrlEncode(bytes) {
  let str = '';
  bytes.forEach((byte) => {
    str += String.fromCharCode(byte);
  });
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(input) {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (input.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function jsonToBase64Url(json) {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(json)));
}

function isAllowedEmail(email) {
  return typeof email === 'string' && email.toLowerCase().endsWith('@gmail.com');
}

function normalizeMode(mode) {
  return mode === 'ranked' ? 'ranked' : 'standard';
}

function matchmakingCollection(mode) {
  return mode === 'ranked' ? 'matchmakingQueue_ranked' : 'matchmakingQueue_standard';
}
function buildPlayerName(entry) {
  return entry.displayName || 'Player';
}

function createInitialState(size) {
  const state = [];
  for (let i = 0; i < size; i += 1) {
    const row = [];
    for (let j = 0; j < size; j += 1) {
      row.push({ player: null, eliminated: false });
    }
    state.push(row);
  }
  return state;
}

function normalizeGameState(gameStateJSON, size) {
  if (!gameStateJSON) return createInitialState(size);
  try {
    const parsed = JSON.parse(gameStateJSON);
    if (!Array.isArray(parsed) || !parsed.length) {
      return createInitialState(size);
    }
    return parsed;
  } catch (_) {
    return createInitialState(size);
  }
}

function deepCopyState(state) {
  return (state || []).map((row) => row.map((cell) => ({ ...cell })));
}

function hasAdjacentFree(state, size, row, col) {
  for (let i = -1; i <= 1; i += 1) {
    for (let j = -1; j <= 1; j += 1) {
      if (i === 0 && j === 0) continue;
      const r = row + i;
      const c = col + j;
      if (r < 0 || r >= size || c < 0 || c >= size) continue;
      const cell = state[r][c];
      if (cell.player === null && !cell.eliminated) return true;
    }
  }
  return false;
}

function isValidPlacement(state, size, row, col) {
  const cell = state[row]?.[col];
  if (!cell || cell.player !== null || cell.eliminated) return false;
  return hasAdjacentFree(state, size, row, col);
}

function isValidElimination(state, lastPlaces, row, col) {
  if (!lastPlaces) return false;
  const cell = state[row]?.[col];
  if (!cell || cell.player !== null || cell.eliminated) return false;
  const dr = Math.abs(row - lastPlaces.row);
  const dc = Math.abs(col - lastPlaces.col);
  if (dr > 1 || dc > 1 || (dr === 0 && dc === 0)) return false;
  return true;
}

function applyPlace(state, player, row, col) {
  const nextState = deepCopyState(state);
  nextState[row][col].player = player;
  return nextState;
}

function applyEliminate(state, row, col) {
  const nextState = deepCopyState(state);
  nextState[row][col].eliminated = true;
  return nextState;
}

function dfs(state, size, r, c, player, visited) {
  if (r < 0 || r >= size || c < 0 || c >= size) return 0;
  if (visited[r][c]) return 0;
  if (state[r][c].player !== player) return 0;
  visited[r][c] = true;
  let count = 1;
  for (const [dr, dc] of [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1], [0, 1],
    [1, -1], [1, 0], [1, 1]
  ]) {
    count += dfs(state, size, r + dr, c + dc, player, visited);
  }
  return count;
}

function getBiggestGroup(state, size, player) {
  const visited = Array.from({ length: size }, () => new Array(size).fill(false));
  let best = 0;
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j < size; j += 1) {
      if (state[i][j].player === player && !visited[i][j]) {
        best = Math.max(best, dfs(state, size, i, j, player, visited));
      }
    }
  }
  return best;
}

function hasAnyValidMove(state, size) {
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j < size; j += 1) {
      if (state[i][j].player === null && !state[i][j].eliminated) {
        if (hasAdjacentFree(state, size, i, j)) return true;
      }
    }
  }
  return false;
}

function computeGameResult(state, size) {
  if (hasAnyValidMove(state, size)) return null;
  const score1 = getBiggestGroup(state, size, 1);
  const score2 = getBiggestGroup(state, size, 2);
  return {
    winner: score1 === score2 ? 0 : score1 > score2 ? 1 : 2,
    score1,
    score2
  };
}

function erf(x) {
  const sign = Math.sign(x) || 1;
  const absX = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * absX);
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX));
  return sign * y;
}

function standardNormalPdf(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function standardNormalCdf(x) {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function softplus(x) {
  if (x > 0) return x + Math.log1p(Math.exp(-x));
  return Math.log1p(Math.exp(x));
}

function conservativeSkillFromDisplayRating(displayRating) {
  const normalizedDisplay = Math.max(0, Number(displayRating) || 0);
  const scaled = (normalizedDisplay * Math.LN2) / 1000;
  if (scaled === 0) return Number.NEGATIVE_INFINITY;
  return DISPLAY_DIVISOR * Math.log(Math.expm1(scaled));
}

function displayRatingFromConservativeSkill(conservativeSkill) {
  const value = Number(conservativeSkill);
  if (!Number.isFinite(value)) return DEFAULT_DISPLAY_RATING;
  const raw = DISPLAY_SCALE * softplus(value / DISPLAY_DIVISOR);
  if (!Number.isFinite(raw)) return DEFAULT_DISPLAY_RATING;
  return Math.min(MAX_DISPLAY_RATING, Math.max(0, raw));
}

function normalizeSkillProfile(profile = {}) {
  const mu = Number(profile.mu);
  const sigma = Number(profile.sigma);
  // Defensive clamps: a corrupted player doc (e.g. NaN/Infinity sneaking in via a future
  // direct-write path) must not propagate into softplus or the matchmaking rating compare.
  if (Number.isFinite(mu) && Number.isFinite(sigma)) {
    const clampedMu = Math.min(MAX_MU, Math.max(0, mu));
    const clampedSigma = Math.min(DEFAULT_SIGMA, Math.max(MIN_SIGMA, sigma));
    return {
      mu: clampedMu,
      sigma: clampedSigma,
      rating: Math.round(displayRatingFromConservativeSkill(clampedMu - 3 * clampedSigma))
    };
  }

  const legacyRating = Number(profile.rating);
  if (Number.isFinite(legacyRating)) {
    const clampedRating = Math.min(MAX_DISPLAY_RATING, Math.max(0, legacyRating));
    const conservativeSkill = conservativeSkillFromDisplayRating(clampedRating);
    const seedMu = Number.isFinite(conservativeSkill)
      ? Math.min(MAX_MU, Math.max(0, conservativeSkill + 3 * DEFAULT_SIGMA))
      : DEFAULT_MU;
    return {
      mu: seedMu,
      sigma: DEFAULT_SIGMA,
      rating: Math.round(clampedRating)
    };
  }

  return {
    mu: DEFAULT_MU,
    sigma: DEFAULT_SIGMA,
    rating: DEFAULT_DISPLAY_RATING
  };
}

function computeSkillDelta(profileA, profileB, scoreA) {
  const a = normalizeSkillProfile(profileA);
  const b = normalizeSkillProfile(profileB);

  if (scoreA === 0.5) {
    return {
      delta1: 0,
      delta2: 0,
      newR1: a.rating,
      newR2: b.rating,
      profile1: a,
      profile2: b
    };
  }

  const firstIsWinner = scoreA === 1;
  const winner = firstIsWinner ? a : b;
  const loser = firstIsWinner ? b : a;
  const winnerSigmaSq = winner.sigma ** 2;
  const loserSigmaSq = loser.sigma ** 2;
  const c = Math.sqrt(2 * OPEN_SKILL_BETA ** 2 + winnerSigmaSq + loserSigmaSq);
  const t = (winner.mu - loser.mu) / c;
  const p = Math.max(standardNormalCdf(t), EPSILON);
  const pdf = standardNormalPdf(t);
  const gamma = 1 / c;
  const v = (pdf * (t + pdf / p)) / p;

  const rawWinnerMu = winner.mu + (winnerSigmaSq / c) * (pdf / p);
  const rawLoserMu = loser.mu - (loserSigmaSq / c) * (pdf / p);
  const winnerMu = Number.isFinite(rawWinnerMu) ? Math.min(MAX_MU, Math.max(0, rawWinnerMu)) : winner.mu;
  const loserMu = Number.isFinite(rawLoserMu) ? Math.min(MAX_MU, Math.max(0, rawLoserMu)) : loser.mu;
  const winnerSigma = Math.sqrt(Math.max(winnerSigmaSq * (1 - winnerSigmaSq * gamma * gamma * v), MIN_SIGMA ** 2));
  const loserSigma = Math.sqrt(Math.max(loserSigmaSq * (1 - loserSigmaSq * gamma * gamma * v), MIN_SIGMA ** 2));

  const winnerProfile = {
    mu: winnerMu,
    sigma: winnerSigma,
    rating: Math.round(displayRatingFromConservativeSkill(winnerMu - 3 * winnerSigma))
  };
  const loserProfile = {
    mu: loserMu,
    sigma: loserSigma,
    rating: Math.round(displayRatingFromConservativeSkill(loserMu - 3 * loserSigma))
  };

  const profile1 = firstIsWinner ? winnerProfile : loserProfile;
  const profile2 = firstIsWinner ? loserProfile : winnerProfile;

  return {
    delta1: profile1.rating - a.rating,
    delta2: profile2.rating - b.rating,
    newR1: profile1.rating,
    newR2: profile2.rating,
    profile1,
    profile2
  };
}

function historyToArray(history) {
  if (Array.isArray(history)) {
    return history
      .map((point) => {
        if (Array.isArray(point) && point.length === 2) {
          return { r: point[0], c: point[1] };
        }
        if (point && Number.isInteger(point.r) && Number.isInteger(point.c)) {
          return { r: point.r, c: point.c };
        }
        if (point && Number.isInteger(point.row) && Number.isInteger(point.col)) {
          return { r: point.row, c: point.col };
        }
        return null;
      })
      .filter(Boolean);
  }
  return [];
}

function getQueueEntryAgeMs(entry) {
  const data = entry?.data || {};
  const timestamp = Number(data.updatedAtMs || data.joinedAtMs || Date.parse(data.updatedAt || data.joinedAt || '') || 0);
  return Number.isFinite(timestamp) ? Date.now() - timestamp : Number.POSITIVE_INFINITY;
}

function isFreshQueueEntry(entry) {
  const mode = normalizeMode(entry?.data?.mode);
  const staleMs = MATCHMAKING_STALE_MS_BY_MODE[mode] || MATCHMAKING_STALE_MS;
  return getQueueEntryAgeMs(entry) <= staleMs;
}

function docPath(collectionName, id) {
  return `/${collectionName}/${id}`;
}

function firestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map((item) => firestoreValue(item))
      }
    };
  }
  if (typeof value === 'object') {
    const fields = {};
    Object.entries(value).forEach(([key, val]) => {
      if (val !== undefined) fields[key] = firestoreValue(val);
    });
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

function firestoreFieldsFromObject(obj = {}) {
  const fields = {};
  Object.entries(obj).forEach(([key, value]) => {
    if (value !== undefined) fields[key] = firestoreValue(value);
  });
  return fields;
}

function firestoreObjectFromFields(fields = {}) {
  const result = {};
  Object.entries(fields).forEach(([key, value]) => {
    result[key] = firestoreValueToJs(value);
  });
  return result;
}

function firestoreValueToJs(value) {
  if (value == null) return null;
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) {
    return (value.arrayValue?.values || []).map((entry) => firestoreValueToJs(entry));
  }
  if ('mapValue' in value) {
    return firestoreObjectFromFields(value.mapValue?.fields || {});
  }
  return null;
}

async function getGoogleAccessToken(env) {
  if (googleTokenCache && Date.now() < googleTokenExpiresAt - 60_000) {
    return googleTokenCache;
  }

  const privateKey = env.FIREBASE_PRIVATE_KEY;
  const clientEmail = env.FIREBASE_CLIENT_EMAIL;
  if (!privateKey || !clientEmail) {
    throw new Error('Missing Cloudflare worker secrets for Firebase service account.');
  }

  const assertion = await createServiceAccountJwt(env, clientEmail, privateKey);
  const response = await fetch(FIREBASE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });

  if (!response.ok) {
    throw new Error(`Failed to obtain Google access token: ${response.status}`);
  }

  const data = await response.json();
  googleTokenCache = data.access_token;
  googleTokenExpiresAt = Date.now() + (Number(data.expires_in || 0) * 1000);
  return googleTokenCache;
}

async function createServiceAccountJwt(env, clientEmail, privateKeyPem) {
  if (!pkcs8KeyPromise) {
    const pkcs8 = pemToArrayBuffer(privateKeyPem);
    pkcs8KeyPromise = crypto.subtle.importKey(
      'pkcs8',
      pkcs8,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: clientEmail,
    scope: FIRESTORE_SCOPE,
    aud: FIREBASE_TOKEN_URL,
    iat: now,
    exp: now + 3600,
    sub: clientEmail
  };

  const encoder = new TextEncoder();
  const signingInput = `${jsonToBase64Url(header)}.${jsonToBase64Url(payload)}`;
  const key = await pkcs8KeyPromise;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(signingInput));
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

function pemToArrayBuffer(pem) {
  const normalized = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function firestoreFetch(env, path, options = {}) {
  const accessToken = await getGoogleAccessToken(env);
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  return response;
}

async function getDocument(env, collectionName, id) {
  const response = await firestoreFetch(env, docPath(collectionName, id));
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Failed to read document ${collectionName}/${id}: ${response.status}`);
  }
  const data = await response.json();
  return {
    name: data.name,
    id: data.name?.split('/').pop(),
    updateTime: data.updateTime,
    createTime: data.createTime,
    data: firestoreObjectFromFields(data.fields || {})
  };
}

async function writeDocument(env, collectionName, id, data, updateTime, options = {}) {
  // updateMask: when supplied, only the listed top-level fields are replaced and the rest of
  // the doc is untouched. Used for hot-path partial writes (heartbeats) so they don't compete
  // with whole-doc writes (moves, leaves) for the precondition slot.
  const params = new URLSearchParams();
  if (updateTime) params.set('currentDocument.updateTime', updateTime);
  const updateMask = Array.isArray(options.updateMask) ? options.updateMask : null;
  if (updateMask) {
    for (const path of updateMask) params.append('updateMask.fieldPaths', path);
  }
  const queryString = params.toString();
  const url = queryString ? `${docPath(collectionName, id)}?${queryString}` : docPath(collectionName, id);

  const fields = updateMask
    ? Object.fromEntries(updateMask
        .filter((k) => data[k] !== undefined)
        .map((k) => [k, firestoreValue(data[k])]))
    : firestoreFieldsFromObject(data);

  const response = await firestoreFetch(env, url, {
    method: 'PATCH',
    body: JSON.stringify({ fields })
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to write document ${collectionName}/${id}: ${response.status} ${errorText}`);
  }
  const body = await response.json();
  return {
    name: body.name,
    id: body.name?.split('/').pop(),
    updateTime: body.updateTime,
    data: firestoreObjectFromFields(body.fields || {})
  };
}

async function deleteDocument(env, collectionName, id) {
  const response = await firestoreFetch(env, docPath(collectionName, id), {
    method: 'DELETE'
  });
  if (!response.ok && response.status !== 404) {
    const errorText = await response.text();
    throw new Error(`Failed to delete document ${collectionName}/${id}: ${response.status} ${errorText}`);
  }
  return { ok: true };
}

async function mergePlayerWithRetry(env, uid, mutate, { maxAttempts = 4 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const fresh = await getDocument(env, 'players', uid);
    const next = mutate(fresh?.data || {});
    try {
      return await writeDocument(env, 'players', uid, next, fresh?.updateTime);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Failed to update player profile after retries.');
}

async function ensurePlayerDoc(env, authUser, { refreshDisplayName = false } = {}) {
  const written = await mergePlayerWithRetry(env, authUser.uid, (current) => {
    const seedName = clampDisplayName(refreshDisplayName
      ? (authUser.name || current.displayName || 'Player')
      : (current.displayName || authUser.name || 'Player'));
    const games = Number(current.games || 0);
    const wins = Number(current.wins || 0);
    const losses = Number(current.losses || 0);
    const draws = Number(current.draws || 0);
    // Brain Gold Coin economy seeding. Every account — new or pre-economy —
    // starts with 0 coins and only the 6×6 board unlocked. Players must earn
    // coins by playing Standard matches to unlock larger boards. Existing
    // economy state is preserved on subsequent ensures.
    const existingCoins = Number(current.coins);
    const existingGrids = Array.isArray(current.unlocks?.onlineGrids)
      ? current.unlocks.onlineGrids.map(Number).filter((n) => Number.isFinite(n))
      : null;
    const coins = Number.isFinite(existingCoins) ? Math.max(0, existingCoins) : 0;
    const onlineGrids = existingGrids && existingGrids.length > 0
      ? existingGrids
      : [6];
    return {
      displayName: seedName || 'Player',
      mu: Number.isFinite(Number(current.mu))
        ? Math.min(MAX_MU, Math.max(0, Number(current.mu)))
        : DEFAULT_MU,
      sigma: Number.isFinite(Number(current.sigma))
        ? Math.min(DEFAULT_SIGMA, Math.max(MIN_SIGMA, Number(current.sigma)))
        : DEFAULT_SIGMA,
      rating: Number.isFinite(Number(current.rating))
        ? Math.min(MAX_DISPLAY_RATING, Math.max(0, Number(current.rating)))
        : DEFAULT_DISPLAY_RATING,
      games,
      wins,
      losses,
      draws,
      state: current.state || 'idle',
      coins,
      unlocks: { onlineGrids },
      updatedAt: new Date().toISOString()
    };
  });
  return written.data;
}

async function setPlayerState(env, uid, newState) {
  return await mergePlayerWithRetry(env, uid, (current) => ({
    ...current,
    email: undefined,
    state: newState,
    updatedAt: new Date().toISOString()
  }));
}

async function verifyFirebaseIdToken(request, env) {
  const authorization = request.headers.get('Authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) throw new HttpError('Authentication required.', 401);

  let payload;
  try {
    ({ payload } = await jwtVerify(token, async (header) => {
      if (!header.kid) throw new Error('Firebase token missing key id.');
      const certs = await getFirebaseCerts();
      const pem = certs[header.kid];
      if (!pem) throw new Error('Firebase cert not found for token kid.');
      return importX509(pem, 'RS256');
    }, {
      audience: env.FIREBASE_PROJECT_ID,
      issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`
    }));
  } catch (_) {
    throw new HttpError('Authentication required.', 401);
  }

  if (payload.email_verified !== true) {
    throw new HttpError('Email must be verified.', 401);
  }
  if (!isAllowedEmail(payload.email || '')) {
    throw new HttpError('Only @gmail.com accounts can use this app.', 403);
  }

  return {
    uid: payload.user_id || payload.sub,
    email: payload.email || '',
    name: clampDisplayName(payload.name || payload.email || '')
  };
}

async function getFirebaseCerts() {
  if (certCache && Date.now() < certCacheExpiresAt) return certCache;
  const response = await fetch(FIREBASE_CERTS_URL);
  if (!response.ok) throw new Error('Failed to fetch Firebase public certificates.');
  certCache = await response.json();
  certCacheExpiresAt = Date.now() + 60 * 60 * 1000;
  return certCache;
}

function getRequestJson(request) {
  return request.json().catch(() => ({}));
}

async function queryQueueDocs(env, mode, extraFilters = {}) {
  const collectionId = matchmakingCollection(mode);
  const filters = [
    { fieldFilter: { field: { fieldPath: 'mode' }, op: 'EQUAL', value: { stringValue: mode } } },
    { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'searching' } } }
  ];
  if (Number.isFinite(Number(extraFilters.gridSize))) {
    filters.push({
      fieldFilter: {
        field: { fieldPath: 'gridSize' },
        op: 'EQUAL',
        value: { integerValue: String(Number(extraFilters.gridSize)) }
      }
    });
  }
  if (typeof extraFilters.timerEnabled === 'boolean') {
    filters.push({
      fieldFilter: {
        field: { fieldPath: 'timerEnabled' },
        op: 'EQUAL',
        value: { booleanValue: extraFilters.timerEnabled }
      }
    });
  }
  const response = await firestoreFetch(env, ':runQuery', {
    method: 'POST',
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
        where: { compositeFilter: { op: 'AND', filters } },
        limit: QUEUE_QUERY_LIMIT
      }
    })
  });
  if (!response.ok) throw new Error('Failed to query matchmaking queue.');
  const rows = await response.json();
  return rows
    .map((row) => row.document)
    .filter(Boolean)
    .map((doc) => ({
      id: doc.name?.split('/').pop(),
      updateTime: doc.updateTime,
      data: firestoreObjectFromFields(doc.fields || {})
    }));
}

async function queryGamesByUidField(env, fieldPath, uid) {
  // Single-field equality query. Firestore auto-creates the per-field index, so no entry
  // in firestore.indexes.json is required. Returns games where the user is in that slot,
  // not necessarily active — caller filters status to avoid the (uid, status) composite index.
  const response = await firestoreFetch(env, ':runQuery', {
    method: 'POST',
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'games' }],
        where: {
          fieldFilter: { field: { fieldPath }, op: 'EQUAL', value: { stringValue: uid } }
        },
        limit: ACTIVE_GAME_QUERY_LIMIT
      }
    })
  });
  if (!response.ok) return [];
  const rows = await response.json();
  return rows
    .map((row) => row.document)
    .filter(Boolean)
    .map((doc) => ({
      id: doc.name?.split('/').pop(),
      updateTime: doc.updateTime,
      data: firestoreObjectFromFields(doc.fields || {})
    }));
}

async function findActiveGameForUser(env, uid) {
  // Two narrow queries (player1uid, player2uid) instead of a full collection scan over every
  // active game. Each is bounded by ACTIVE_GAME_QUERY_LIMIT and uses Firestore's auto-created
  // single-field index, so the cost stays O(1) regardless of total active game count.
  const [asP1, asP2] = await Promise.all([
    queryGamesByUidField(env, 'player1uid', uid),
    queryGamesByUidField(env, 'player2uid', uid)
  ]);
  for (const game of [...asP1, ...asP2]) {
    if (game.data?.status === 'active') return game;
  }
  return null;
}

async function handleProfileEnsure(env, authUser) {
  const profile = await ensurePlayerDoc(env, authUser);
  return corsResponse({ ok: true, profile });
}

// Hard delete of the signed-in user's data: removes their player profile
// (which is what the leaderboard reads) plus any leftover queue presence.
// Active games are deliberately NOT deleted — the opponent may still be
// playing; their game doc just keeps the historical names. After this, the
// client signs out. If the user signs back in later, ensurePlayerDoc will
// create a fresh player doc at default rating.
async function handleProfileDelete(env, authUser) {
  try { await deleteDocument(env, 'matchmakingQueue_ranked', authUser.uid); } catch (_) {}
  try { await deleteDocument(env, 'matchmakingQueue_standard', authUser.uid); } catch (_) {}
  try { await deleteDocument(env, 'players', authUser.uid); } catch (_) {}
  return corsResponse({ ok: true });
}

// Lets a signed-in user override the auto-synced Google name with one of
// their own. Writes the sanitised name straight onto players/<uid> so the
// leaderboard reflects it immediately. Firebase Auth's profile is updated
// client-side (via updateProfile) so the next ID token also carries the
// new name and the auto-sync on enqueue doesn't undo this rename.
async function handleProfileUpdateName(env, authUser, body) {
  const requested = clampDisplayName(body?.displayName || '');
  if (!requested) {
    return errorResponse('Display name is required.', 400);
  }
  const playerRef = await getDocument(env, 'players', authUser.uid);
  if (!playerRef) {
    return errorResponse('Profile not found. Sign in again to initialise.', 404);
  }
  const next = {
    ...playerRef.data,
    displayName: requested,
    updatedAt: new Date().toISOString()
  };
  await writeDocument(env, 'players', authUser.uid, next);
  return corsResponse({ ok: true, displayName: requested });
}

async function handleRoomAction(env, authUser, body) {
  const action = String(body.action || '');
  const displayName = clampDisplayName(authUser.name || 'Player');

  if (action === 'create') {
    const code = requireRoomCode(body.code);
    const gridSize = requireGridSize(body.gridSize);
    const gameId = `game_${code}`;
    await writeDocument(env, 'games', gameId, {
      gameCode: code,
      mode: 'standard',
      source: 'room',
      status: 'waiting',
      player1uid: authUser.uid,
      player1name: displayName,
      player2uid: null,
      player2name: null,
      gridSize,
      timerEnabled: !!body.timerEnabled,
      currentPlayer: 1,
      phase: 'place',
      lastPlaces: null,
      gameStateJSON: null,
      placementHistory: { p1: [], p2: [] },
      timeouts: { p1: 0, p2: 0 },
      result: null,
      createdAt: new Date().toISOString(),
      createdAtMs: Date.now()
    });
    return corsResponse({ ok: true, gameId });
  }

  if (action === 'join') {
    const code = requireRoomCode(body.code);
    const gameId = `game_${code}`;
    const game = await getDocument(env, 'games', gameId);
    if (!game) return errorResponse('Room not found.', 404);
    const current = game.data;
    if (current.status !== 'waiting' || current.mode !== 'standard' || current.source !== 'room') {
      return errorResponse('Room is not available.', 412);
    }
    if (current.player1uid === authUser.uid || current.player2uid === authUser.uid) {
      return corsResponse({ ok: true, gameId });
    }
    if (current.player2uid) return errorResponse('Room is already full.', 412);
    await writeDocument(env, 'games', gameId, {
      ...current,
      player2uid: authUser.uid,
      player2name: displayName,
      status: 'active',
      turnDeadlineMs: current.timerEnabled ? Date.now() + TURN_DURATION_MS : null
    }, game.updateTime);
    return corsResponse({ ok: true, gameId });
  }

  if (action === 'cancel') {
    const code = requireRoomCode(body.code);
    const gameId = `game_${code}`;
    const game = await getDocument(env, 'games', gameId);
    if (!game) return corsResponse({ ok: true });
    const current = game.data;
    if (current.player1uid !== authUser.uid) {
      return errorResponse('Only the room owner can cancel it.', 403);
    }
    await writeDocument(env, 'games', gameId, { ...current, status: 'cancelled' }, game.updateTime);
    return corsResponse({ ok: true });
  }

  return errorResponse('Unknown room action.', 400);
}

async function handleMatchmakingAction(env, authUser, body) {
  const action = String(body.action || '');
  const mode = normalizeMode(body.mode);
  const queueCollection = matchmakingCollection(mode);

  if (action === 'enqueue') {
    // Reject only if there is a *fresh* searching entry; stale entries (e.g. from a tab that
    // didn't get to call /matchmaking/cancel) are silently overwritten by the write below.
    const existingQueue = await getDocument(env, queueCollection, authUser.uid);
    if (existingQueue && existingQueue.data.status === 'searching' && isFreshQueueEntry(existingQueue)) {
      return errorResponse('Already searching for a match', 400);
    }

    const activeGame = await findActiveGameForUser(env, authUser.uid);
    if (activeGame) {
      return corsResponse({
        error: 'You are already in an active game.',
        activeGameId: activeGame.id
      }, 409);
    }

    const profile = await ensurePlayerDoc(env, authUser, { refreshDisplayName: true });
    let effectiveState = profile.state;
    // Heal a stale 'playing' or 'searching' profile state that's been left
    // orphaned (no active game, no live queue entry). Causes include
    // setPlayerState calls inside finalizeMatchCleanup failing silently, or a
    // game ending via a path that didn't run cleanup. We've just confirmed
    // there's no active game above, so resetting to 'idle' is safe.
    if (effectiveState === 'playing' || effectiveState === 'searching') {
      try { await setPlayerState(env, authUser.uid, 'idle'); } catch (_) {}
      // Best-effort: also remove any orphan queue entries this user might
      // still have in either mode collection.
      try { await deleteDocument(env, 'matchmakingQueue_ranked', authUser.uid); } catch (_) {}
      try { await deleteDocument(env, 'matchmakingQueue_standard', authUser.uid); } catch (_) {}
      effectiveState = 'idle';
    }
    if (effectiveState !== 'idle' && effectiveState !== 'finished') {
      return errorResponse(`Cannot enqueue while in state: ${effectiveState}`, 400);
    }

    const queueGridSize = mode === 'ranked' ? RANKED_GRID_SIZE : requireGridSize(body.gridSize);
    const unlockedGrids = Array.isArray(profile.unlocks?.onlineGrids) ? profile.unlocks.onlineGrids.map(Number) : [6];
    if (!unlockedGrids.includes(queueGridSize)) {
      return errorResponse('GRID_LOCKED', 403);
    }
    const queueData = {
      uid: authUser.uid,
      mode,
      status: 'searching',
      displayName: clampDisplayName(authUser.name || 'Player'),
      gridSize: queueGridSize,
      timerEnabled: mode === 'ranked' ? true : !!body.timerEnabled,
      mu: profile.mu,
      sigma: profile.sigma,
      rating: profile.rating,
      gameId: null,
      matchedWith: null,
      queueToken: crypto.randomUUID(),
      joinedAtMs: Date.now(),
      updatedAtMs: Date.now(),
      updatedAt: new Date().toISOString(),
      joinedAt: new Date().toISOString()
    };
    await writeDocument(env, queueCollection, authUser.uid, queueData);
    await setPlayerState(env, authUser.uid, 'searching');
    return corsResponse({ ok: true });
  }

  if (action === 'cancel') {
    const profile = await getDocument(env, 'players', authUser.uid);
    const currentState = profile?.data?.state;
    const queue = await getDocument(env, queueCollection, authUser.uid);
    if (queue) {
      await deleteDocument(env, queueCollection, authUser.uid);
    }
    // Never reset profile state to 'idle' if the player is mid-game on another device.
    if (currentState !== 'playing') {
      await setPlayerState(env, authUser.uid, 'idle');
    }
    return corsResponse({ ok: true });
  }

  if (action === 'heartbeat') {
    const queue = await getDocument(env, queueCollection, authUser.uid);
    if (!queue) return corsResponse({ ok: true, alive: false });
    if (queue.data.status !== 'searching') {
      return corsResponse({ ok: true, alive: false, status: queue.data.status, gameId: queue.data.gameId || null });
    }
    await writeDocument(env, queueCollection, authUser.uid, {
      ...queue.data,
      updatedAtMs: Date.now(),
      updatedAt: new Date().toISOString()
    }, queue.updateTime);
    return corsResponse({ ok: true, alive: true });
  }

  if (action === 'run') {
    const queue = await getDocument(env, queueCollection, authUser.uid);
    if (!queue) return corsResponse({ ok: true, gameId: null });
    const self = queue.data;
    if (self.status !== 'searching') return corsResponse({ ok: true, gameId: null });

    // Profile docs for `players/bot:{tier}` are required by handleRankedFinalize.
    // First /run on a fresh isolate ensures they exist; subsequent calls no-op.
    await ensureBotProfilesOnce(env, { getDocument, writeDocument });

    const selfGridSize = Number(self.gridSize) || 6;
    const selfTimerEnabled = !!self.timerEnabled;

    const candidates = await queryQueueDocs(
      env,
      mode,
      mode === 'standard'
        ? { gridSize: selfGridSize, timerEnabled: selfTimerEnabled }
        : {}
    );
    const humanOthers = candidates.filter((entry) => entry.id !== authUser.uid);

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    // Filter humans first so the bot-inclusion decision below can see how many
    // *live* humans are actually matchable, not how many docs are sitting in
    // the collection (some may be stale and get pruned here).
    const liveCandidates = [];
    let liveHumanCount = 0;
    for (const entry of humanOthers) {
      if (!isFreshQueueEntry(entry)) {
        // Stale entries are deleted (not relabeled) so the queue collection doesn't grow
        // unbounded under abuse. Best-effort: another writer may have already removed it.
        try {
          await deleteDocument(env, queueCollection, entry.id);
        } catch (_) {}
        continue;
      }
      if (entry.data?.status !== 'searching') continue;
      if (entry.data?.matchedWith || entry.data?.gameId) continue;
      if (mode === 'standard') {
        const candGrid = Number(entry.data.gridSize) || 6;
        const candTimer = !!entry.data.timerEnabled;
        if (candGrid !== selfGridSize || candTimer !== selfTimerEnabled) continue;
      }
      liveCandidates.push(entry);
      liveHumanCount++;
    }

    // Bot inclusion policy: a bot is a candidate alongside any live human
    // (random pick can land on either), but if the user is alone in the queue
    // they wait HUMAN_WAIT_MS before bots are eligible. Without this, /run
    // would always match the soloer to a bot before any second human had a
    // chance to enqueue.
    const HUMAN_WAIT_MS = 10 * 1000;
    const selfWaitMs = nowMs - Number(self.joinedAtMs || nowMs);
    const botsConfigured =
      mode === 'standard'
        ? (STANDARD_BOT_GRID_SIZES.includes(selfGridSize) && selfTimerEnabled)
        : (mode === 'ranked' && selfGridSize === 8 && selfTimerEnabled);
    const includeBots =
      botsConfigured && (liveHumanCount > 0 || selfWaitMs >= HUMAN_WAIT_MS);

    if (includeBots) {
      // Standard admits all 3 tiers on any STANDARD_BOT_GRID_SIZES grid.
      // Ranked admits all 3 tiers only on the canonical 8x8 timer-on config.
      // Ranked reads fresh ratings every time so closest-rating selection
      // doesn't pair off the per-isolate cache (warm isolates can hold
      // stale ratings indefinitely if they never run /ranked/finalize).
      const forceFresh = mode === 'ranked';
      for (const tier of ALL_TIERS) {
        const uid = botUidFor(tier);
        const profile = await getBotProfile(env, uid, getDocument, { forceFresh });
        const docId = mode === 'standard'
          ? standardBotQueueDocId(tier, selfGridSize)
          : rankedBotQueueDocId(tier);
        liveCandidates.push({
          id: docId,
          updateTime: null,
          data: {
            uid,
            isBot: true,
            botTier: tier,
            displayName: BOT_DISPLAY[tier],
            mode,
            gridSize: mode === 'ranked' ? 8 : selfGridSize,
            timerEnabled: true,
            mu: profile.mu,
            sigma: profile.sigma,
            rating: profile.rating,
            status: 'searching',
            gameId: null,
            matchedWith: null,
            joinedAtMs: nowMs,
            updatedAtMs: nowMs,
            updatedAt: nowIso
          }
        });
      }
    }

    const now = nowMs;
    const selfDisplayRating = Number(self.rating || DEFAULT_DISPLAY_RATING);

    const N = liveCandidates.length;
    if (!N) return corsResponse({ ok: true, gameId: null });

    // Standard mode: pick uniformly at random — ratings are not updated in
    // Standard, so proximity has no meaning. Ranked mode: sample a random pool
    // of size K = min(ceil(N/10) + 1, 1000, N) then pick the closest by rating
    // so skilled players are matched fairly.
    let chosen = null;
    if (mode === 'standard') {
      const idx = Math.floor(Math.random() * N);
      const entry = liveCandidates[idx];
      chosen = { candidate: entry, displayRating: Number(entry.data.rating || DEFAULT_DISPLAY_RATING) };
    } else {
      const poolSize = Math.min(
        Math.ceil(N / MATCHMAKING_POOL_DIVISOR) + 1,
        MATCHMAKING_POOL_MAX,
        N
      );
      const pool = liveCandidates.slice();
      for (let i = 0; i < poolSize; i++) {
        const j = i + Math.floor(Math.random() * (pool.length - i));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      pool.length = poolSize;

      let bestDiff = Infinity;
      for (const entry of pool) {
        const rating = Number(entry.data.rating || DEFAULT_DISPLAY_RATING);
        const diff = Math.abs(rating - selfDisplayRating);
        if (diff < bestDiff) {
          bestDiff = diff;
          chosen = { candidate: entry, displayRating: rating };
        }
      }
    }
    if (!chosen) return corsResponse({ ok: true, gameId: null });

    // Bot-aware pairing: a candidate's *uid* (the player identity going into the
    // game doc) is `entry.data.uid`; the *queue doc id* (`entry.id`) may differ
    // for bots that use a composite id like `bot:captor_8` so the same bot uid
    // can hold queue presence at multiple grid sizes simultaneously. Humans have
    // entry.data.uid === entry.id so this collapses to the original logic.
    const candidateUid = chosen.candidate.data?.uid || chosen.candidate.id;
    const candidateIsBot = isBotUid(candidateUid);

    // Deterministic pairing: only the lexicographically smaller UID creates the match.
    // The other player observes their queue doc flip to `matched` via Firestore listener.
    // Bots never call /matchmaking/run — when one is the candidate, the human
    // always creates the match regardless of uid order.
    if (!candidateIsBot && authUser.uid >= candidateUid) {
      return corsResponse({ ok: true, gameId: null });
    }

    // Virtual bots have no Firestore queue doc — reuse the synthesized entry.
    const candidateQueue = candidateIsBot
      ? { data: chosen.candidate.data, updateTime: null }
      : await getDocument(env, queueCollection, chosen.candidate.id);
    if (!candidateQueue) return corsResponse({ ok: true, gameId: null });

    const liveSelf = await getDocument(env, queueCollection, authUser.uid);
    if (!liveSelf || liveSelf.data.status !== 'searching') return corsResponse({ ok: true, gameId: null });
    const selfProfileDoc = await getDocument(env, 'players', authUser.uid);
    if (!selfProfileDoc || selfProfileDoc.data?.state !== 'searching') return corsResponse({ ok: true, gameId: null });
    const liveCandidate = candidateQueue.data;
    // Bots are looked up by their canonical uid (not the composite queue doc
    // id); their player profile state is not 'searching' (they're "always
    // available", possibly mid-N-other-games), so we skip that check for bots.
    const candidateProfileDoc = await getDocument(env, 'players', candidateUid);
    if (!candidateProfileDoc) return corsResponse({ ok: true, gameId: null });
    if (!candidateIsBot && candidateProfileDoc.data?.state !== 'searching') {
      return corsResponse({ ok: true, gameId: null });
    }
    // Bots stay 'searching' across many parallel matches — only check the
    // matchedWith/gameId fields for non-bot candidates.
    if (liveCandidate.status !== 'searching' || liveCandidate.mode !== mode) {
      return corsResponse({ ok: true, gameId: null });
    }
    if (!candidateIsBot && (liveCandidate.gameId || liveCandidate.matchedWith)) {
      return corsResponse({ ok: true, gameId: null });
    }
    if (mode === 'standard') {
      const liveSelfGrid = Number(liveSelf.data.gridSize) || 6;
      const liveSelfTimer = !!liveSelf.data.timerEnabled;
      const liveCandGrid = Number(liveCandidate.gridSize) || 6;
      const liveCandTimer = !!liveCandidate.timerEnabled;
      if (liveCandGrid !== liveSelfGrid || liveCandTimer !== liveSelfTimer) {
        return corsResponse({ ok: true, gameId: null });
      }
    }

    // P1/P2 assignment: randomised in all cases. For human vs bot, 50/50 coin
    // flip. For human vs human, arrival order is a sufficient proxy for
    // randomness (unpredictable in practice), with lex-uid as tiebreak.
    const selfJoined = liveSelf.data.joinedAtMs || 0;
    const opponentJoined = liveCandidate.joinedAtMs || 0;
    const selfIsP1 = candidateIsBot
      ? (Math.random() < 0.5)
      : (selfJoined < opponentJoined || (selfJoined === opponentJoined && authUser.uid < candidateUid));
    const p1 = selfIsP1 ? liveSelf.data : liveCandidate;
    const p2 = selfIsP1 ? liveCandidate : liveSelf.data;

    const gameId = `game_${crypto.randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase()}`;
    // Use liveSelf (re-fetched and validated above) rather than the snapshot
    // captured at the top of /run — between those two reads the user may have
    // re-enqueued at a different gridSize from another tab, and the game must
    // be created at the value the validation step actually agreed on.
    const matchGridSize = mode === 'ranked' ? RANKED_GRID_SIZE : parseGridSize(liveSelf.data.gridSize);
    const matchTimerEnabled = mode === 'ranked' ? true : !!liveSelf.data.timerEnabled;
    await writeDocument(env, 'games', gameId, {
      gameCode: null,
      mode,
      source: 'matchmaking',
      status: 'active',
      player1uid: selfIsP1 ? authUser.uid : candidateUid,
      player1name: clampDisplayName(buildPlayerName(p1)),
      player2uid: selfIsP1 ? candidateUid : authUser.uid,
      player2name: clampDisplayName(buildPlayerName(p2)),
      gridSize: matchGridSize,
      timerEnabled: matchTimerEnabled,
      currentPlayer: 1,
      phase: 'place',
      lastPlaces: null,
      gameStateJSON: null,
      placementHistory: { p1: [], p2: [] },
      timeouts: { p1: 0, p2: 0 },
      result: null,
      createdAt: new Date().toISOString(),
      turnDeadlineMs: matchTimerEnabled ? Date.now() + TURN_DURATION_MS : null
    });

    // Stronger guards: verify neither queue entry already references a game.
    // Bots' queue entries intentionally don't carry gameId across matches, so
    // we skip the candidate-side check when the opponent is a bot.
    if ((liveSelf.data && liveSelf.data.gameId) ||
        (!candidateIsBot && liveCandidate && liveCandidate.gameId)) {
      try {
        await writeDocument(
          env,
          'games',
          gameId,
          { status: 'cancelled' },
          undefined,
          { updateMask: ['status'] }
        );
      } catch (e) {}
      return corsResponse({ ok: true, gameId: null });
    }

    // Update queue rows + spin up MatchBot DO. Failure rolls the game back.
    try {
      await writeDocument(env, queueCollection, authUser.uid, {
        ...liveSelf.data,
        status: 'matched',
        gameId,
        matchedWith: candidateUid,
        matchedAt: new Date().toISOString(),
        updatedAtMs: Date.now(),
        updatedAt: new Date().toISOString()
      }, liveSelf.updateTime);

      if (!candidateIsBot) {
        // Bots have no Firestore queue doc — nothing to update on the bot side.
        await writeDocument(env, queueCollection, chosen.candidate.id, {
          ...liveCandidate,
          status: 'matched',
          gameId,
          matchedWith: authUser.uid,
          matchedAt: new Date().toISOString(),
          updatedAtMs: Date.now(),
          updatedAt: new Date().toISOString()
        }, candidateQueue.updateTime);
      }

      // Set state=playing for the human (and the candidate human if any).
      await setPlayerState(env, authUser.uid, 'playing');
      if (!candidateIsBot) {
        await setPlayerState(env, candidateUid, 'playing');
      }

      // For bot opponents, kick off the per-game MatchBot DO. It owns the
      // turn loop until the game finishes.
      if (candidateIsBot) {
        try {
          const tier = tierFromBotUid(candidateUid);
          const botPlayerNumber = selfIsP1 ? 2 : 1;
          const id = env.MATCH_BOT.idFromName(gameId);
          const stub = env.MATCH_BOT.get(id);
          await stub.fetch('https://match-bot.internal/start', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ gameId, botUid: candidateUid, tier, botPlayerNumber })
          });
        } catch (botErr) {
          console.warn('MatchBot kickoff failed', gameId, botErr?.message);
          // Don't block the human — DO will start late on next alarm if its
          // storage was already populated; if not, the human will just see
          // the bot stall, which is recoverable via /game/leave.
        }
      }

      return corsResponse({ ok: true, gameId });
    } catch (err) {
      try {
        // updateMask: keep player1uid/player2uid/gridSize/etc. on the doc — a
        // bare PATCH would strip them, which makes the human's already-loaded
        // OnlineGamePage decide they aren't a participant and bounce them to
        // the lobby. We only need to flip status + record the reason.
        await writeDocument(
          env,
          'games',
          gameId,
          {
            status: 'cancelled',
            cancelledReason: 'queue_update_failed',
            cancelledAt: new Date().toISOString()
          },
          undefined,
          { updateMask: ['status', 'cancelledReason', 'cancelledAt'] }
        );
      } catch (e) {}
      return corsResponse({ ok: true, gameId: null });
    }
  }

  return errorResponse('Unknown matchmaking action.', 400);
}

// Brain Gold Coin economy — additive update to a single player's wallet.
// Clamped at 0 so the leaver penalty never produces a negative balance.
async function bumpPlayerCoins(env, uid, delta) {
  if (!uid || !Number.isFinite(delta) || delta === 0) return;
  try {
    await mergePlayerWithRetry(env, uid, (raw) => {
      const cur = Number.isFinite(Number(raw.coins)) ? Number(raw.coins) : 0;
      const next = Math.max(0, cur + delta);
      return {
        ...raw,
        email: undefined,
        coins: next,
        updatedAt: new Date().toISOString()
      };
    });
  } catch (err) {
    console.warn('[bumpPlayerCoins] failed', uid, delta, err?.message);
  }
}

// Computes and applies coin grants for a game that just transitioned to a
// terminal state (finished, left). Pure no-op for private rooms (off-economy).
//
// Standard MM payouts (system-minted, additive):
//   • Decisive end: winner += winnerGroup × 10, loser += loserGroup × 1
//   • Draw: each player += groupSize × 5
//   • Forfeit (leave or 3-turn timeout): stayer += stayerCurrentGroup × 10
//
// Coins only apply to Standard matchmade games. Ranked has no coin economy.
// Returns { delta1, delta2 } — both 0 for ineligible games.
function computeCoinDeltas(game) {
  if (!game || game.source !== 'matchmaking') return { delta1: 0, delta2: 0 };
  if (normalizeMode(game.mode) !== 'standard') return { delta1: 0, delta2: 0 };
  const player1uid = game.player1uid;
  const player2uid = game.player2uid;
  if (!player1uid || !player2uid) return { delta1: 0, delta2: 0 };

  const size = parseGridSize(game.gridSize);
  const state = normalizeGameState(game.gameStateJSON, size);
  const group1 = getBiggestGroup(state, size, 1);
  const group2 = getBiggestGroup(state, size, 2);

  let delta1 = 0;
  let delta2 = 0;

  const isTimeout = !!game.result?.timeout;
  const leaverUid = game.leftBy || null;
  const isForfeit = isTimeout || !!leaverUid;

  if (isForfeit) {
    let leaverNum;
    if (isTimeout) {
      leaverNum = game.result.loser;
    } else if (leaverUid === player1uid) {
      leaverNum = 1;
    } else if (leaverUid === player2uid) {
      leaverNum = 2;
    } else {
      return { delta1: 0, delta2: 0 };
    }
    const stayerNum = leaverNum === 1 ? 2 : 1;
    if (leaverNum === 1) delta1 = -100; else delta2 = -100;
    const stayerGroup = stayerNum === 1 ? group1 : group2;
    if (stayerNum === 1) delta1 = stayerGroup * 10; else delta2 = stayerGroup * 10;
  } else {
    const winner = game.result?.winner;
    if (winner === 1) {
      delta1 = group1 * 10; delta2 = group2 * 1;
    } else if (winner === 2) {
      delta1 = group1 * 1; delta2 = group2 * 10;
    } else if (winner === 0) {
      delta1 = group1 * 5; delta2 = group2 * 5;
    }
  }
  return { delta1, delta2 };
}

async function awardCoinsForGame(env, game) {
  const { delta1, delta2 } = computeCoinDeltas(game);
  if (delta1 === 0 && delta2 === 0) return;
  await Promise.all([
    bumpPlayerCoins(env, game.player1uid, delta1),
    bumpPlayerCoins(env, game.player2uid, delta2)
  ]);
}

async function finalizeMatchCleanup(env, game) {
  if (!game) return;
  const mode = normalizeMode(game.mode);
  const queueCollection = matchmakingCollection(mode);
  const uids = [game.player1uid, game.player2uid].filter(Boolean);
  await Promise.all(uids.map(async (uid) => {
    // Bots maintain persistent queue presence + a single shared profile across
    // many parallel matches. Cleaning up after one match would (a) yank the
    // bot's ranked queue entry until the next cron tick re-seeds it, leaving
    // a ~60 s gap where humans can't match against the bot, and (b) flip the
    // bot's profile state to 'idle' even though it's still mid-game in many
    // other simultaneous matches.
    if (isBotUid(uid)) return;
    try { await deleteDocument(env, queueCollection, uid); } catch (_) {}
    try { await setPlayerState(env, uid, 'idle'); } catch (_) {}
  }));
}

// Strikes the player whose turn it currently is. Reverts the placed dot if the
// timeout occurred during the eliminate sub-phase. Used by both the self-report
// timeout endpoint and the opponent-claim / cron-sweeper paths.
//
// Retries on updateTime precondition failure so that heartbeat-spam from the current
// player can't stall the timeout enforcement — but only as long as the target player
// still hasn't actually moved (currentPlayer / phase / their placement count unchanged).
async function applyTurnTimeout(env, gameDoc, gameId, { maxAttempts = 3 } = {}) {
  const initialTarget = gameDoc.data.currentPlayer;
  const initialPhase = gameDoc.data.phase;
  const initialHistoryLen = ((gameDoc.data.placementHistory || {})[`p${initialTarget}`] || []).length;
  let lastError;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      gameDoc = await getDocument(env, 'games', gameId);
      if (!gameDoc) return { applied: false, reason: 'gone' };
      const fresh = gameDoc.data;
      if (fresh.status !== 'active') return { applied: false, reason: 'not_active' };
      if (fresh.currentPlayer !== initialTarget || fresh.phase !== initialPhase) {
        return { applied: false, reason: 'player_moved' };
      }
      const freshLen = ((fresh.placementHistory || {})[`p${initialTarget}`] || []).length;
      if (freshLen !== initialHistoryLen) {
        return { applied: false, reason: 'player_moved' };
      }
    }

    const current = gameDoc.data;
    if (current.status !== 'active') return { applied: false, reason: 'not_active' };
    const targetPlayerNumber = current.currentPlayer;
    if (targetPlayerNumber !== 1 && targetPlayerNumber !== 2) {
      return { applied: false, reason: 'invalid_current_player' };
    }
    const size = parseGridSize(current.gridSize);
    const state = normalizeGameState(current.gameStateJSON, size);
    const timeouts = current.timeouts || { p1: 0, p2: 0 };
    const myKey = `p${targetPlayerNumber}`;
    const newCount = (timeouts[myKey] || 0) + 1;

    let revertedState = state;
    let revertedHistory = current.placementHistory || { p1: [], p2: [] };
    if (current.phase === 'eliminate' && current.lastPlaces) {
      revertedState = deepCopyState(state);
      const r = current.lastPlaces.row;
      const c = current.lastPlaces.col;
      if (revertedState[r] && revertedState[r][c]) {
        revertedState[r][c].player = null;
      }
      const myHist = historyToArray(revertedHistory[myKey] || []);
      myHist.pop();
      revertedHistory = {
        p1: historyToArray(revertedHistory.p1 || []),
        p2: historyToArray(revertedHistory.p2 || []),
        [myKey]: myHist
      };
    }

    try {
      if (newCount >= 3) {
        const s1 = getBiggestGroup(revertedState, size, 1);
        const s2 = getBiggestGroup(revertedState, size, 2);
        const winner = targetPlayerNumber === 1 ? 2 : 1;
        const finishedGame = {
          ...current,
          status: 'finished',
          gameStateJSON: JSON.stringify(revertedState),
          placementHistory: revertedHistory,
          lastPlaces: null,
          result: { winner, score1: s1, score2: s2, timeout: true, loser: targetPlayerNumber },
          timeouts: { ...timeouts, [myKey]: newCount },
          turnDeadlineMs: null
        };
        const { delta1: coinDelta1, delta2: coinDelta2 } = computeCoinDeltas(finishedGame);
        if (coinDelta1 !== 0 || coinDelta2 !== 0) {
          finishedGame.result = { ...finishedGame.result, coinDelta1, coinDelta2 };
        }
        await writeDocument(env, 'games', gameId, finishedGame, gameDoc.updateTime);
        await awardCoinsForGame(env, finishedGame);
        await finalizeMatchCleanup(env, finishedGame);
        return { applied: true, finished: true };
      }

      const nextDeadline = current.timerEnabled ? Date.now() + TURN_DURATION_MS : null;
      await writeDocument(env, 'games', gameId, {
        ...current,
        currentPlayer: targetPlayerNumber === 1 ? 2 : 1,
        phase: 'place',
        lastPlaces: null,
        gameStateJSON: JSON.stringify(revertedState),
        placementHistory: revertedHistory,
        timeouts: { ...timeouts, [myKey]: newCount },
        turnDeadlineMs: nextDeadline
      }, gameDoc.updateTime);
      return { applied: true, finished: false };
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('applyTurnTimeout: precondition failed after retries');
}

async function applyRankedForfeit(env, gameDoc, gameId, forfeitingUid) {
  const current = gameDoc.data;
  if (current.status !== 'active' || current.mode !== 'ranked') return null;
  const forfeiterIsP1 = forfeitingUid === current.player1uid;
  const forfeiterNumber = forfeiterIsP1 ? 1 : 2;
  const opponentNumber = forfeiterIsP1 ? 2 : 1;

  const [p1Doc, p2Doc] = await Promise.all([
    getDocument(env, 'players', current.player1uid),
    getDocument(env, 'players', current.player2uid)
  ]);
  const p1Raw = p1Doc?.data || {};
  const p2Raw = p2Doc?.data || {};
  const p1 = normalizeSkillProfile(p1Raw);
  const p2 = normalizeSkillProfile(p2Raw);
  const scoreP1 = forfeiterIsP1 ? 0 : 1;
  const { delta1, delta2, newR1, newR2, profile1, profile2 } = computeSkillDelta(p1, p2, scoreP1);

  const size = parseGridSize(current.gridSize);
  const state = normalizeGameState(current.gameStateJSON, size);
  const score1 = getBiggestGroup(state, size, 1);
  const score2 = getBiggestGroup(state, size, 2);

  const finishedGame = {
    ...current,
    status: 'finished',
    leftBy: forfeitingUid,
    turnDeadlineMs: null,
    result: {
      winner: opponentNumber,
      score1,
      score2,
      forfeit: true,
      loser: forfeiterNumber,
      delta1,
      delta2,
      newR1,
      newR2
    }
  };
  // Conditional on the game's updateTime so two concurrent forfeits cannot both apply rating.
  // The losing call gets 412 here and bails before touching player profiles.
  await writeDocument(env, 'games', gameId, finishedGame, gameDoc.updateTime);

  await mergePlayerWithRetry(env, current.player1uid, (raw) => ({
    ...raw,
    email: undefined,
    displayName: clampDisplayName(raw.displayName || current.player1name || 'Player'),
    mu: profile1.mu,
    sigma: profile1.sigma,
    rating: newR1,
    games: Number(raw.games || 0) + 1,
    wins: scoreP1 === 1 ? Number(raw.wins || 0) + 1 : Number(raw.wins || 0),
    losses: scoreP1 === 0 ? Number(raw.losses || 0) + 1 : Number(raw.losses || 0),
    draws: Number(raw.draws || 0),
    updatedAt: new Date().toISOString()
  }));

  await mergePlayerWithRetry(env, current.player2uid, (raw) => ({
    ...raw,
    email: undefined,
    displayName: clampDisplayName(raw.displayName || current.player2name || 'Player'),
    mu: profile2.mu,
    sigma: profile2.sigma,
    rating: newR2,
    games: Number(raw.games || 0) + 1,
    wins: scoreP1 === 0 ? Number(raw.wins || 0) + 1 : Number(raw.wins || 0),
    losses: scoreP1 === 1 ? Number(raw.losses || 0) + 1 : Number(raw.losses || 0),
    draws: Number(raw.draws || 0),
    updatedAt: new Date().toISOString()
  }));

  // Ranked has no coin economy — no payout, no leaver penalty.
  await awardCoinsForGame(env, finishedGame);
  await finalizeMatchCleanup(env, finishedGame);
  return finishedGame;
}

async function handleGameValidate(env, authUser, body) {
  const gameId = requireGameId(body.gameId);
  const game = await getDocument(env, 'games', gameId);
  if (!game) return corsResponse({ ok: true, valid: false });
  const current = game.data;
  const isParticipant = current.player1uid === authUser.uid || current.player2uid === authUser.uid;
  const active = current.status === 'active';
  return corsResponse({ ok: true, valid: Boolean(isParticipant && active) });
}

// Internal: apply a move to a game on behalf of `callerUid`. Used by both the
// authenticated HTTP path (handleGameAction → /game/move) and by MatchBot
// Durable Objects, which must be able to play moves without a Firebase ID
// token. Throws HttpError on validation failures so the HTTP wrapper can map
// them back to status codes; the DO catches and logs.
export async function applyMoveInternal(env, callerUid, gameId, rawRow, rawCol, requestKind = null) {
  const game = await getDocument(env, 'games', gameId);
  if (!game) throw new HttpError('Game not found.', 404);
  const current = game.data;
  if (current.status !== 'active') throw new HttpError('Game is not active.', 412);
  if (current.player1uid !== callerUid && current.player2uid !== callerUid) {
    throw new HttpError('Only participants can play.', 403);
  }

  const playerNumber = current.player1uid === callerUid ? 1 : 2;
  if (current.currentPlayer !== playerNumber) throw new HttpError('Not your turn.', 412);

  // Soft-validate the client's intent against the server's authoritative phase.
  // Without this, a client whose place was rejected can have a queued eliminate
  // silently re-interpreted as a placement (server dispatches by phase only),
  // dropping a dot on the cell the player meant to eliminate. Tighten to required
  // once all clients send kind. MatchBot omits kind by design — it reads phase
  // from the same snapshot it then plays into, so mismatch is impossible.
  if (requestKind && requestKind !== 'place' && requestKind !== 'eliminate') {
    throw new HttpError('Invalid move kind.', 400);
  }
  if (requestKind && requestKind !== current.phase) {
    throw new HttpError('Phase mismatch — please retry.', 412);
  }

  // Hard deadline enforcement: a move arriving past the turn deadline + grace is rejected
  // so the wall-clock timer is actually binding (otherwise the deadline is only enforced by
  // the opponent's claim-timeout call or the cron sweep, leaving a window for stalled moves).
  if (current.timerEnabled) {
    const deadline = Number(current.turnDeadlineMs);
    if (Number.isFinite(deadline) && deadline > 0 && Date.now() > deadline + TURN_DEADLINE_GRACE_MS) {
      throw new HttpError('Turn has timed out.', 412);
    }
  }

  const size = parseGridSize(current.gridSize);
  const row = requireBoardIndex(rawRow, size, 'row');
  const col = requireBoardIndex(rawCol, size, 'col');
  const state = normalizeGameState(current.gameStateJSON, size);
  const history = current.placementHistory || { p1: [], p2: [] };

  if (current.phase === 'place') {
    if (!isValidPlacement(state, size, row, col)) {
      throw new HttpError('Invalid placement.', 400);
    }
    const nextState = applyPlace(state, playerNumber, row, col);
    const nextHistory = {
      p1: historyToArray(history.p1),
      p2: historyToArray(history.p2)
    };
    nextHistory[`p${playerNumber}`].push({ r: row, c: col });
    try {
      await writeDocument(env, 'games', gameId, {
        ...current,
        phase: 'eliminate',
        lastPlaces: { row, col },
        gameStateJSON: JSON.stringify(nextState),
        placementHistory: nextHistory,
        timeouts: { ...(current.timeouts || { p1: 0, p2: 0 }), [`p${playerNumber}`]: 0 }
      }, game.updateTime);
    } catch (_) {
      throw new HttpError('Game state changed. Please retry.', 409);
    }
    return { ok: true };
  }

  if (current.phase === 'eliminate') {
    if (!isValidElimination(state, current.lastPlaces, row, col)) {
      throw new HttpError('Invalid elimination.', 400);
    }
    const nextState = applyEliminate(state, row, col);
    const nextHistory = {
      p1: historyToArray(history.p1),
      p2: historyToArray(history.p2)
    };
    const result = computeGameResult(nextState, size);
    const update = {
      ...current,
      gameStateJSON: JSON.stringify(nextState),
      placementHistory: nextHistory,
      lastPlaces: null
    };
    if (result) {
      update.status = 'finished';
      update.result = result;
      update.turnDeadlineMs = null;
      const { delta1: coinDelta1, delta2: coinDelta2 } = computeCoinDeltas(update);
      if (coinDelta1 !== 0 || coinDelta2 !== 0) {
        update.result = { ...result, coinDelta1, coinDelta2 };
      }
    } else {
      update.currentPlayer = playerNumber === 1 ? 2 : 1;
      update.phase = 'place';
      update.turnDeadlineMs = current.timerEnabled ? Date.now() + TURN_DURATION_MS : null;
    }
    try {
      await writeDocument(env, 'games', gameId, update, game.updateTime);
    } catch (_) {
      throw new HttpError('Game state changed. Please retry.', 409);
    }
    if (result) {
      await awardCoinsForGame(env, update);
      await finalizeMatchCleanup(env, update);
    }
    return { ok: true };
  }

  throw new HttpError('Invalid game phase.', 412);
}

async function handleGameAction(env, authUser, body) {
  const action = String(body.action || '');
  const gameId = requireGameId(body.gameId);

  if (action === 'join') {
    const game = await getDocument(env, 'games', gameId);
    if (!game) return errorResponse('Game not found.', 404);
    const current = game.data;
    if (current.status !== 'active') return errorResponse('Game is not active.', 412);
    if (current.player1uid !== authUser.uid && current.player2uid !== authUser.uid) {
      return errorResponse('Only participants can join.', 403);
    }
    // Set player state to playing
    await setPlayerState(env, authUser.uid, 'playing');
    return corsResponse({ ok: true });
  }

  if (action === 'move') {
    try {
      await applyMoveInternal(env, authUser.uid, gameId, body.row, body.col, body.kind || null);
      return corsResponse({ ok: true });
    } catch (err) {
      if (err instanceof HttpError) return errorResponse(err.message, err.status);
      throw err;
    }
  }

  if (action === 'timeout') {
    const game = await getDocument(env, 'games', gameId);
    if (!game) return errorResponse('Game not found.', 404);
    const current = game.data;
    if (current.status !== 'active') return errorResponse('Game is not active.', 412);
    if (current.player1uid !== authUser.uid && current.player2uid !== authUser.uid) {
      return errorResponse('Only participants can time out.', 403);
    }
    const playerNumber = current.player1uid === authUser.uid ? 1 : 2;
    if (current.currentPlayer !== playerNumber) return errorResponse('Not your turn.', 412);

    // Self-report timeout requires the wall-clock deadline to have actually expired —
    // otherwise a player could call this mid-turn to force-revert their own placement
    // (eliminate-phase rollback in applyTurnTimeout) and probe positions for free.
    if (!current.timerEnabled) {
      return errorResponse('Timer is not enabled for this game.', 412);
    }
    const deadline = Number(current.turnDeadlineMs);
    if (!Number.isFinite(deadline) || deadline <= 0) {
      return errorResponse('No turn deadline set.', 412);
    }
    if (Date.now() < deadline) {
      return errorResponse('Turn has not timed out yet.', 412);
    }

    try {
      await applyTurnTimeout(env, game, gameId);
    } catch (_) {
      return errorResponse('Game state changed. Please retry.', 409);
    }
    return corsResponse({ ok: true });
  }

  if (action === 'claim-timeout') {
    const game = await getDocument(env, 'games', gameId);
    if (!game) return errorResponse('Game not found.', 404);
    const current = game.data;
    if (current.status !== 'active') return errorResponse('Game is not active.', 412);
    if (current.player1uid !== authUser.uid && current.player2uid !== authUser.uid) {
      return errorResponse('Only participants can claim timeout.', 403);
    }
    const callerNumber = current.player1uid === authUser.uid ? 1 : 2;
    // Only the OPPONENT (the non-current player) can claim a timeout.
    if (current.currentPlayer === callerNumber) {
      return errorResponse('Cannot claim timeout on your own turn.', 412);
    }
    if (!current.timerEnabled) {
      return errorResponse('Timer is not enabled for this game.', 412);
    }
    const deadline = Number(current.turnDeadlineMs);
    if (!Number.isFinite(deadline) || deadline <= 0) {
      return errorResponse('No turn deadline set.', 412);
    }
    if (Date.now() < deadline) {
      return errorResponse('Turn has not timed out yet.', 412);
    }

    try {
      await applyTurnTimeout(env, game, gameId);
    } catch (_) {
      return errorResponse('Game state changed. Please retry.', 409);
    }
    return corsResponse({ ok: true });
  }

  if (action === 'leave') {
    const game = await getDocument(env, 'games', gameId);
    if (!game) return corsResponse({ ok: true });
    const current = game.data;
    if (current.status !== 'active') return corsResponse({ ok: true });
    if (current.player1uid !== authUser.uid && current.player2uid !== authUser.uid) {
      return errorResponse('Only participants can leave.', 403);
    }

    if (current.mode === 'ranked') {
      try {
        await applyRankedForfeit(env, game, gameId, authUser.uid);
      } catch (_) {
        // Lost a precondition race (heartbeat bumped updateTime, opposite leave finished first,
        // a final move landed, or cron sweep already forfeited). Re-read and retry once if the
        // game is still active; otherwise treat as idempotent success.
        const refreshed = await getDocument(env, 'games', gameId);
        if (refreshed?.data?.status === 'active') {
          await applyRankedForfeit(env, refreshed, gameId, authUser.uid);
        }
      }
      return corsResponse({ ok: true });
    }

    const leftGame = {
      ...current,
      status: 'left',
      leftBy: authUser.uid
    };
    const { delta1: coinDelta1, delta2: coinDelta2 } = computeCoinDeltas(leftGame);
    if (coinDelta1 !== 0 || coinDelta2 !== 0) {
      leftGame.result = { ...(leftGame.result || {}), coinDelta1, coinDelta2 };
    }
    await writeDocument(env, 'games', gameId, leftGame, game.updateTime);
    await awardCoinsForGame(env, leftGame);
    await finalizeMatchCleanup(env, leftGame);
    return corsResponse({ ok: true });
  }

  if (action === 'heartbeat') {
    const game = await getDocument(env, 'games', gameId);
    if (!game) return corsResponse({ ok: true });
    const current = game.data;
    if (current.status !== 'active') return corsResponse({ ok: true });
    if (current.player1uid !== authUser.uid && current.player2uid !== authUser.uid) {
      return errorResponse('Only participants can heartbeat.', 403);
    }
    const playerNumber = current.player1uid === authUser.uid ? 1 : 2;
    const fieldPath = `lastSeenP${playerNumber}Ms`;
    try {
      // Field-mask write: only lastSeenP{n}Ms is touched, no precondition. Concurrent moves
      // and leaves are unaffected by heartbeat traffic, eliminating the move-retry storm
      // a heartbeat-spammer could otherwise force on the opponent.
      await writeDocument(
        env,
        'games',
        gameId,
        { [fieldPath]: Date.now() },
        null,
        { updateMask: [fieldPath] }
      );
    } catch (_) {
      // Best-effort. The cron sweep is the ultimate backstop.
    }
    return corsResponse({ ok: true });
  }

  return errorResponse('Unknown game action.', 400);
}

const GRID_UNLOCK_COSTS = { 8: 1000, 10: 10000, 12: 100000 };

async function handleUnlockGrid(env, authUser, body) {
  const size = Number(body.size);
  if (!GRID_UNLOCK_COSTS[size]) return errorResponse('Invalid grid size.', 400);

  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    const doc = await getDocument(env, 'players', authUser.uid);
    if (!doc) return errorResponse('Player profile not found.', 404);
    const data = doc.data || {};

    const existingGrids = Array.isArray(data.unlocks?.onlineGrids)
      ? data.unlocks.onlineGrids.map(Number).filter((n) => Number.isFinite(n))
      : [6];
    if (existingGrids.includes(size)) return corsResponse({ ok: true, alreadyOwned: true });

    const cost = GRID_UNLOCK_COSTS[size];
    const currentCoins = Number.isFinite(Number(data.coins)) ? Math.max(0, Number(data.coins)) : 0;
    if (currentCoins < cost) return errorResponse('INSUFFICIENT_COINS', 402);

    const newGrids = [...new Set([...existingGrids, size])].sort((a, b) => a - b);
    try {
      await writeDocument(env, 'players', authUser.uid, {
        ...data,
        coins: currentCoins - cost,
        unlocks: { ...data.unlocks, onlineGrids: newGrids }
      }, doc.updateTime);
      return corsResponse({ ok: true, coins: currentCoins - cost, unlockedGrids: newGrids });
    } catch (e) {
      lastErr = e;
    }
  }
  return errorResponse('Unlock failed. Please try again.', 500);
}

async function handleRankedFinalize(env, authUser, body) {
  const gameId = requireGameId(body.gameId);

  const game = await getDocument(env, 'games', gameId);
  if (!game) return errorResponse('Game not found.', 404);
  const current = game.data;
  if (current.player1uid !== authUser.uid && current.player2uid !== authUser.uid) {
    return errorResponse('Only participants can finalize game result.', 403);
  }
  if (current.mode !== 'ranked') return errorResponse('Only ranked games are finalized here.', 412);
  if (current.status !== 'finished' || !current.result) return errorResponse('Game is not finished.', 412);

  if (current.result.delta1 != null && current.result.delta2 != null) {
    return corsResponse({ ok: true, result: current.result });
  }

  const [p1Doc, p2Doc] = await Promise.all([
    getDocument(env, 'players', current.player1uid),
    getDocument(env, 'players', current.player2uid)
  ]);
  const p1 = normalizeSkillProfile(p1Doc?.data || {});
  const p2 = normalizeSkillProfile(p2Doc?.data || {});
  const scoreP1 = current.result.winner === 1 ? 1 : current.result.winner === 2 ? 0 : 0.5;
  const { delta1, delta2, newR1, newR2, profile1, profile2 } = computeSkillDelta(p1, p2, scoreP1);

  const result = { ...current.result, delta1, delta2, newR1, newR2 };

  // Claim the finalization slot atomically. If a concurrent call already wrote the deltas,
  // our precondition fails — we re-read and return the winning result without re-applying.
  try {
    await writeDocument(env, 'games', gameId, { ...current, result }, game.updateTime);
  } catch (_) {
    const refreshed = await getDocument(env, 'games', gameId);
    const refreshedResult = refreshed?.data?.result;
    if (refreshedResult?.delta1 != null && refreshedResult?.delta2 != null) {
      return corsResponse({ ok: true, result: refreshedResult });
    }
    return errorResponse('Game state changed. Please retry.', 409);
  }

  // Slot claimed — apply player profile updates with their own retry loop so concurrent
  // ensurePlayerDoc / setPlayerState calls cannot clobber the games/wins/losses counters.
  await mergePlayerWithRetry(env, current.player1uid, (raw) => ({
    ...raw,
    email: undefined,
    displayName: clampDisplayName(raw.displayName || current.player1name || 'Player'),
    mu: profile1.mu,
    sigma: profile1.sigma,
    rating: newR1,
    games: Number(raw.games || 0) + 1,
    wins: scoreP1 === 1 ? Number(raw.wins || 0) + 1 : Number(raw.wins || 0),
    losses: scoreP1 === 0 ? Number(raw.losses || 0) + 1 : Number(raw.losses || 0),
    draws: scoreP1 === 0.5 ? Number(raw.draws || 0) + 1 : Number(raw.draws || 0),
    updatedAt: new Date().toISOString()
  }));

  await mergePlayerWithRetry(env, current.player2uid, (raw) => ({
    ...raw,
    email: undefined,
    displayName: clampDisplayName(raw.displayName || current.player2name || 'Player'),
    mu: profile2.mu,
    sigma: profile2.sigma,
    rating: newR2,
    games: Number(raw.games || 0) + 1,
    wins: scoreP1 === 0 ? Number(raw.wins || 0) + 1 : Number(raw.wins || 0),
    losses: scoreP1 === 1 ? Number(raw.losses || 0) + 1 : Number(raw.losses || 0),
    draws: scoreP1 === 0.5 ? Number(raw.draws || 0) + 1 : Number(raw.draws || 0),
    updatedAt: new Date().toISOString()
  }));

  await setPlayerState(env, current.player1uid, 'idle');
  await setPlayerState(env, current.player2uid, 'idle');

  // Bots' rating cache must be invalidated so the next /run picks up the
  // fresh number rather than the previous (now stale) cached entry.
  if (isBotUid(current.player1uid)) invalidateBotProfile(current.player1uid);
  if (isBotUid(current.player2uid)) invalidateBotProfile(current.player2uid);

  return corsResponse({ ok: true, result });
}

function pickAllowedOrigin(origin) {
  if (!origin) return null;
  try {
    const u = new URL(origin);
    return ALLOWED_ORIGIN_HOSTS.has(u.hostname) ? origin : null;
  } catch (_) {
    return null;
  }
}

// Optional Cloudflare Rate Limiting binding. If unbound (e.g., local dev or older deploys),
// the call is a no-op and returns true. Keys are uid:pathname so each endpoint has its own
// budget per user; legitimate play stays well under the limit.
async function checkRateLimit(env, key) {
  const limiter = env?.RATE_LIMITER;
  if (!limiter || typeof limiter.limit !== 'function') return true;
  try {
    const { success } = await limiter.limit({ key });
    return !!success;
  } catch (_) {
    return true;
  }
}

async function handleRequest(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);

  const url = new URL(request.url);
  const authUser = await verifyFirebaseIdToken(request, env);
  const body = await getRequestJson(request);

  if (!(await checkRateLimit(env, `${authUser.uid}:${url.pathname}`))) {
    return errorResponse('Too many requests. Please slow down.', 429);
  }

  if (url.pathname === '/profile/update-name') {
    return handleProfileUpdateName(env, authUser, body);
  }
  if (url.pathname === '/profile/delete') {
    return handleProfileDelete(env, authUser);
  }
  if (url.pathname === '/profile/ensure') {
    return handleProfileEnsure(env, authUser);
  }
  if (url.pathname === '/game/validate') {
    return handleGameValidate(env, authUser, body);
  }
  if (url.pathname === '/profile/state') {
    const player = await getDocument(env, 'players', authUser.uid);
    const state = player?.data?.state || 'idle';
    return corsResponse({ state, playerExists: !!player });
  }
  if (url.pathname === '/room/create' || url.pathname === '/room/join' || url.pathname === '/room/cancel') {
    const action = url.pathname.split('/').pop();
    return handleRoomAction(env, authUser, { ...body, action });
  }
  if (
    url.pathname === '/matchmaking/enqueue' ||
    url.pathname === '/matchmaking/run' ||
    url.pathname === '/matchmaking/cancel' ||
    url.pathname === '/matchmaking/heartbeat'
  ) {
    const action = url.pathname.split('/').pop();
    return handleMatchmakingAction(env, authUser, { ...body, action });
  }
  if (
    url.pathname === '/game/move' ||
    url.pathname === '/game/timeout' ||
    url.pathname === '/game/claim-timeout' ||
    url.pathname === '/game/leave' ||
    url.pathname === '/game/join' ||
    url.pathname === '/game/heartbeat'
  ) {
    const action = url.pathname.split('/').pop();
    return handleGameAction(env, authUser, { ...body, action });
  }
  if (url.pathname === '/ranked/finalize') {
    return handleRankedFinalize(env, authUser, body);
  }
  if (url.pathname === '/economy/unlock-grid') {
    return handleUnlockGrid(env, authUser, body);
  }

  return errorResponse('Not found.', 404);
}

async function sweepStaleGames(env) {
  let response;
  try {
    response = await firestoreFetch(env, ':runQuery', {
      method: 'POST',
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'games' }],
          where: {
            fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'active' } }
          },
          limit: 500
        }
      })
    });
  } catch (_) {
    return;
  }
  if (!response.ok) return;
  const rows = await response.json();
  const games = rows
    .map((row) => row.document)
    .filter(Boolean)
    .map((doc) => ({
      id: doc.name?.split('/').pop(),
      updateTime: doc.updateTime,
      data: firestoreObjectFromFields(doc.fields || {})
    }));

  const now = Date.now();

  for (const game of games) {
    const data = game.data || {};
    const isRanked = data.mode === 'ranked';

    // Turn-deadline enforcement: if the active player blew through their per-turn budget
    // (timer-enabled games only), force-strike them via applyTurnTimeout. Done first because
    // it's the cheap, common case.
    const deadline = Number(data.turnDeadlineMs);
    if (data.timerEnabled && Number.isFinite(deadline) && deadline > 0
        && now > deadline + TURN_DEADLINE_GRACE_MS) {
      try {
        await applyTurnTimeout(env, game, game.id);
      } catch (_) {
        // Race: a real move, leave, or claim-timeout landed first. Skip; next tick reassesses.
      }
      continue;
    }

    const cutoff = now - (isRanked ? STALE_GAME_THRESHOLD_MS : STALE_STANDARD_GAME_THRESHOLD_MS);
    const createdFloor = Number(data.createdAtMs) || Date.parse(data.createdAt || '') || now;
    const lastP1 = Number(data.lastSeenP1Ms) || createdFloor;
    const lastP2 = Number(data.lastSeenP2Ms) || createdFloor;
    let p1Stale = lastP1 < cutoff;
    let p2Stale = lastP2 < cutoff;

    // Bot players are driven by Durable Objects, not by client heartbeats —
    // their lastSeenP*Ms is never refreshed, so the heartbeat-based stale
    // check would falsely forfeit them ~60 s into every bot match. Treat
    // bots as always alive here; if a MatchBot DO is genuinely stuck the
    // human can still claim a turn-deadline timeout via /game/timeout.
    if (p1Stale && isBotUid(data.player1uid)) p1Stale = false;
    if (p2Stale && isBotUid(data.player2uid)) p2Stale = false;

    if (!p1Stale && !p2Stale) continue;

    try {
      if (!isRanked || (p1Stale && p2Stale)) {
        // Standard: always cancel (no rating consequence). Ranked w/ both silent: same.
        const cancelledGame = {
          ...data,
          status: 'cancelled',
          cancelledReason: isRanked ? 'both_abandoned' : 'standard_abandoned',
          cancelledAt: new Date().toISOString()
        };
        await writeDocument(env, 'games', game.id, cancelledGame, game.updateTime);
        await finalizeMatchCleanup(env, cancelledGame);
      } else {
        const staleUid = p1Stale ? data.player1uid : data.player2uid;
        if (staleUid) {
          await applyRankedForfeit(env, game, game.id, staleUid);
        }
      }
    } catch (_) {
      // Race: another writer (a leave call, a final move) beat us. Skip; next tick will reassess.
    }
  }
}

// Weekly purge: hard-delete every game whose createdAtMs is older than 7 days,
// regardless of status. Uses Firestore batched `:commit` so a full page of 300
// deletes costs one subrequest — well inside the Free plan's 50-subrequest cap
// even with several pages. Loops until no rows remain or we hit the safety cap.
async function purgeOldGames(env) {
  const PURGE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
  const PAGE_SIZE = 300;
  const MAX_PAGES = 20; // 20 × 300 = 6,000 docs max per cron run
  const cutoff = Date.now() - PURGE_AGE_MS;
  let totalDeleted = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    let response;
    try {
      response = await firestoreFetch(env, ':runQuery', {
        method: 'POST',
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: 'games' }],
            where: {
              fieldFilter: {
                field: { fieldPath: 'createdAtMs' },
                op: 'LESS_THAN',
                value: { integerValue: String(cutoff) }
              }
            },
            limit: PAGE_SIZE
          }
        })
      });
    } catch (err) {
      console.error('[purgeOldGames] runQuery threw', err?.message);
      break;
    }
    if (!response.ok) {
      const txt = await response.text();
      console.error(`[purgeOldGames] runQuery ${response.status}: ${txt}`);
      break;
    }
    const rows = await response.json();
    const docs = rows.map((r) => r.document).filter(Boolean);
    if (docs.length === 0) break;

    const writes = docs.map((d) => ({ delete: d.name }));
    try {
      const commit = await firestoreFetch(env, ':commit', {
        method: 'POST',
        body: JSON.stringify({ writes })
      });
      if (!commit.ok) {
        const txt = await commit.text();
        console.error(`[purgeOldGames] commit ${commit.status}: ${txt}`);
        break;
      }
      totalDeleted += writes.length;
    } catch (err) {
      console.error('[purgeOldGames] commit threw', err?.message);
      break;
    }

    // Page returned fewer than PAGE_SIZE → no more matches; stop early.
    if (docs.length < PAGE_SIZE) break;
  }

  console.log(`[purgeOldGames] done — deleted ${totalDeleted} games older than 7 days (cutoff=${cutoff})`);
}

// Wrap a Response to apply the validated CORS origin. Inner handlers always emit
// `Access-Control-Allow-Origin: *`; here we replace it with the reflected request Origin
// (when allowlisted) or strip it entirely. Bearer-token auth means a leaked token still
// works regardless of origin, but tightening this is cheap defense-in-depth.
function applyCorsOrigin(response, allowOrigin) {
  const headers = new Headers(response.headers);
  if (allowOrigin) {
    headers.set('Access-Control-Allow-Origin', allowOrigin);
    const existingVary = headers.get('Vary');
    headers.set('Vary', existingVary ? `${existingVary}, Origin` : 'Origin');
  } else {
    headers.delete('Access-Control-Allow-Origin');
  }
  return new Response(response.body, { status: response.status, headers });
}

// ── MatchBot Durable Object ────────────────────────────────────────────────
// One DO instance per active bot game (named by gameId). Alarm-driven loop:
//  • POST /start lands the cfg, sets a near-immediate alarm.
//  • alarm() reads games/{gameId}; if it's the bot's turn, run the AI engine
//    and apply the move via applyMoveInternal. Re-arm at ~800 ms cadence so
//    place + eliminate land back-to-back without a long human-style pause
//    between halves of the bot's turn.
//  • When game.status leaves 'active' (finished / cancelled), wipe storage —
//    no further alarms, DO becomes inert.
//
// Security notes (see plan): no public route to this class; only callable via
// env.MATCH_BOT bindings from inside this Worker. The /start handler ignores
// any payload whose gameId doesn't match the DO's name.
export class MatchBot {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/start' && request.method === 'POST') {
      let cfg;
      try { cfg = await request.json(); } catch (_) { return new Response('bad json', { status: 400 }); }
      if (!cfg || typeof cfg.gameId !== 'string') return new Response('bad cfg', { status: 400 });
      // The DO is named by gameId via idFromName; our state must match.
      // (Defense-in-depth — there's no public route here, but if one slipped in
      // via misconfiguration, this prevents cross-game pokes.)
      const expectedName = this.state.id.name;
      if (expectedName && expectedName !== cfg.gameId) {
        return new Response('cfg/gameId mismatch', { status: 400 });
      }
      await this.state.storage.put('cfg', cfg);
      await this.state.storage.setAlarm(Date.now() + 500);
      return new Response('ok');
    }
    return new Response('not found', { status: 404 });
  }

  async alarm() {
    // ── Diagnostic instrumentation ──
    // All logs prefixed with [MatchBot:gameId:tier] so `wrangler tail` can be
    // grepped by gameId. Strip these once the Collector hang on Free CPU is
    // fully diagnosed.
    const alarmStart = Date.now();
    const cfg = await this.state.storage.get('cfg');
    if (!cfg) {
      console.log('[MatchBot] alarm fired with no cfg — DO already cleaned');
      return;
    }
    const tag = `[MatchBot:${cfg.gameId.slice(-6)}:${cfg.tier}]`;

    let game;
    const readStart = Date.now();
    try {
      game = await getDocument(this.env, 'games', cfg.gameId);
    } catch (err) {
      console.warn(`${tag} firestore read FAILED`, err?.message);
      await this.state.storage.setAlarm(Date.now() + 1500);
      return;
    }
    const readMs = Date.now() - readStart;

    if (!game || game.data?.status !== 'active') {
      console.log(`${tag} game ended (${game?.data?.status || 'missing'}) — DO cleanup`);
      await this.state.storage.deleteAll();
      return;
    }

    if (game.data.currentPlayer !== cfg.botPlayerNumber) {
      console.log(`${tag} not my turn (current=${game.data.currentPlayer}, me=${cfg.botPlayerNumber}) — re-poll in 1500ms (read ${readMs}ms)`);
      await this.state.storage.setAlarm(Date.now() + 1500);
      return;
    }

    console.log(`${tag} MY TURN phase=${game.data.phase} — starting search (read ${readMs}ms)`);

    // Bot's turn. Build engine input from the live Firestore state.
    const size = parseGridSize(game.data.gridSize);
    const state = normalizeGameState(game.data.gameStateJSON, size);

    const searchStart = Date.now();
    let move = null;
    let searchError = null;
    try {
      move = await chooseBotMove({
        tier: cfg.tier,
        state,
        size,
        phase: game.data.phase,
        lastPlaces: game.data.lastPlaces,
        currentPlayer: cfg.botPlayerNumber
      });
    } catch (err) {
      searchError = err;
    }
    const searchMs = Date.now() - searchStart;

    if (searchError) {
      console.error(`${tag} chooseBotMove THREW after ${searchMs}ms:`, searchError?.message, searchError?.stack);
    } else if (!move) {
      console.warn(`${tag} chooseBotMove returned NULL after ${searchMs}ms (phase=${game.data.phase}, gridSize=${size})`);
    } else {
      console.log(`${tag} chooseBotMove → ${move.row},${move.col} after ${searchMs}ms`);
    }

    if (move) {
      const applyStart = Date.now();
      try {
        await applyMoveInternal(this.env, cfg.botUid, cfg.gameId, move.row, move.col);
        console.log(`${tag} move APPLIED in ${Date.now() - applyStart}ms (total alarm ${Date.now() - alarmStart}ms)`);
      } catch (err) {
        console.warn(`${tag} applyMoveInternal REJECTED:`, err?.message);
      }
    } else {
      console.warn(`${tag} skipping apply — no move (alarm total ${Date.now() - alarmStart}ms)`);
    }

    await this.state.storage.setAlarm(Date.now() + 800);
  }
}

export default {
  async fetch(request, env) {
    const allowOrigin = pickAllowedOrigin(request.headers.get('Origin'));
    let response;
    try {
      response = await handleRequest(request, env);
    } catch (error) {
      if (error instanceof HttpError) {
        response = errorResponse(error.message, error.status);
      } else {
        console.error('worker: unhandled error', error);
        response = errorResponse('Internal server error.', 500);
      }
    }
    return applyCorsOrigin(response, allowOrigin);
  },
  async scheduled(event, env, ctx) {
    // Dispatch by cron expression so the per-minute sweep and the weekly
    // purge stay independent. event.cron is the literal pattern from
    // wrangler.toml that triggered this invocation.
    if (event.cron === '0 0 * * SAT') {
      ctx.waitUntil(purgeOldGames(env));
      return;
    }
    // Bots are virtual (synthesized in /matchmaking/run from constants), so
    // the cron no longer seeds queue docs or prunes them. Profile bootstrap
    // is lazy via ensureBotProfilesOnce on first /run per isolate.
    ctx.waitUntil(sweepStaleGames(env));
  }
};
