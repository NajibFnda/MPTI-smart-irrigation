import crypto from 'node:crypto';
import { getDatabase } from '@netlify/database';

export function getDb() {
  return getDatabase();
}

export function readEnv(key) {
  if (typeof globalThis.Netlify !== 'undefined' && globalThis.Netlify?.env?.get) {
    const val = globalThis.Netlify.env.get(key);
    if (val) return val;
  }
  return process.env[key] || '';
}

export function normalizeIdentifier(value) {
  return String(value || '').trim().toLowerCase();
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || '').trim());
}

export function generateOtpCode() {
  return String(crypto.randomInt(100000, 1000000));
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password, storedHash) {
  const parts = String(storedHash || '').split(':');
  if (parts.length !== 2) return false;
  const [salt, originalHex] = parts;
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  const originalBuf = Buffer.from(originalHex, 'hex');
  if (derivedBuf.length !== originalBuf.length) return false;
  return crypto.timingSafeEqual(derivedBuf, originalBuf);
}

function getSessionSecret() {
  const secret = readEnv('SESSION_SECRET');
  if (!secret) {
    throw new Error('SESSION_SECRET belum dikonfigurasi.');
  }
  return secret;
}

/**
 * Create a signed HMAC-SHA256 session token valid for 7 days.
 */
export function createSessionToken(user) {
  const payload = {
    uid: Number(user.id),
    username: user.username,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

/**
 * Verify session token signature and expiration. Returns payload or null.
 */
export function verifySessionToken(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 2) return null;
    const [encoded, providedSig] = parts;
    const expectedSig = crypto
      .createHmac('sha256', getSessionSecret())
      .update(encoded)
      .digest('base64url');

    const providedBuf = Buffer.from(providedSig, 'utf8');
    const expectedBuf = Buffer.from(expectedSig, 'utf8');
    if (providedBuf.length !== expectedBuf.length) return null;
    if (!crypto.timingSafeEqual(providedBuf, expectedBuf)) return null;

    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload?.uid || !payload?.exp || Date.now() > payload.exp) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function extractBearerToken(req) {
  const header = req.headers?.get
    ? req.headers.get('authorization') || ''
    : req.headers?.authorization || '';
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

export function requireAuth(req) {
  const token = extractBearerToken(req);
  const payload = verifySessionToken(token);
  if (!payload) return null;
  return payload;
}
