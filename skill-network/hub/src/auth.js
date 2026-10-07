// auth.js — password hashing (scrypt), session cookies, and in-memory rate limits.
// No persistence here; db.js stores users/sessions, this module is pure crypto +
// HTTP cookie/limit helpers.

import { scryptSync, randomBytes, timingSafeEqual, randomUUID } from 'node:crypto';

export const SESSION_COOKIE = 'sn_session';
const SCRYPT_KEYLEN = 64;
const SESSION_DAYS = 30;

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(password), salt, SCRYPT_KEYLEN).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false;
  let expected;
  try { expected = Buffer.from(String(hash), 'hex'); } catch { return false; }
  const actual = scryptSync(String(password), String(salt), SCRYPT_KEYLEN);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function newToken() {
  return randomUUID().replace(/-/g, '') + randomBytes(8).toString('hex');
}

export function sessionExpiry(from = Date.now()) {
  return new Date(from + SESSION_DAYS * 24 * 3600 * 1000).toISOString();
}

export function parseCookies(req) {
  const out = {};
  const raw = req.headers && req.headers.cookie;
  if (!raw) return out;
  for (const part of String(raw).split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

// Secure only when the public base URL is https (so http://localhost works).
export function buildSessionCookie(token, { secure }) {
  const bits = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'HttpOnly', 'SameSite=Lax', 'Path=/',
    `Max-Age=${SESSION_DAYS * 24 * 3600}`,
    `Expires=${new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000).toUTCString()}`,
  ];
  if (secure) bits.push('Secure');
  return bits.join('; ');
}

export function clearSessionCookie({ secure }) {
  const bits = [`${SESSION_COOKIE}=`, 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0'];
  if (secure) bits.push('Secure');
  return bits.join('; ');
}

// Sliding-window rate limiter keyed by an arbitrary string. Returns false when the
// caller is over `max` hits within `windowMs`.
export function createRateLimiter({ max, windowMs }) {
  const hits = new Map();
  return {
    check(key) {
      const now = Date.now();
      const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
      if (arr.length >= max) { hits.set(key, arr); return false; }
      arr.push(now);
      hits.set(key, arr);
      // Opportunistic prune so the map does not grow without bound.
      if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
      return true;
    },
    reset(key) { hits.delete(key); },
  };
}
