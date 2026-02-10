// Simple in-memory rate limiter for failed login attempts
// - Keeps per-IP and per-email counters and locks after threshold

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOCK_MS = 15 * 60 * 1000; // 15 minutes

const store = new Map();

function _key(type, identifier) {
  return `${type}:${identifier}`;
}

function _now() {
  return Date.now();
}

function recordFailed(type, identifier) {
  const key = _key(type, identifier);
  const rec = store.get(key) || { count: 0, firstAt: _now(), lockedUntil: 0 };

  // Reset window if window expired
  if (_now() - rec.firstAt > WINDOW_MS) {
    rec.count = 0;
    rec.firstAt = _now();
    rec.lockedUntil = 0;
  }

  rec.count += 1;

  if (rec.count >= MAX_ATTEMPTS) {
    rec.lockedUntil = _now() + LOCK_MS;
  }

  store.set(key, rec);
  return rec;
}

function isBlocked(type, identifier) {
  const key = _key(type, identifier);
  const rec = store.get(key);
  if (!rec) return { blocked: false };
  if (rec.lockedUntil && _now() < rec.lockedUntil) {
    return { blocked: true, retryAfter: rec.lockedUntil - _now() };
  }
  return { blocked: false };
}

function reset(type, identifier) {
  const key = _key(type, identifier);
  store.delete(key);
}

module.exports = {
  recordFailed,
  isBlocked,
  reset
};
