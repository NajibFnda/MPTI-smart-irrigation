/**
 * Irigasi Cerdas — Backend Server & Database SQLite (Zero External Dependencies)
 * Mendukung autentikasi bertoken, verifikasi & reset password OTP via Brevo,
 * serta persistensi status pompa, petak lahan, lokasi cuaca, dan log aktivitas.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT) || 3000;
const ROOT_DIR = __dirname;
const DB_DIR = path.join(ROOT_DIR, 'database');
const DB_PATH = path.join(DB_DIR, 'irigasi.db');

// Load local .env file if present
const ENV_PATH = path.join(ROOT_DIR, '.env');
if (fs.existsSync(ENV_PATH)) {
  const lines = fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = val;
    }
  }
}

fs.mkdirSync(DB_DIR, { recursive: true });
const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    email TEXT,
    username TEXT NOT NULL UNIQUE,
    whatsapp TEXT,
    farm_name TEXT NOT NULL DEFAULT 'Pemilik Lahan',
    password_hash TEXT NOT NULL,
    email_verified INTEGER NOT NULL DEFAULT 0,
    otp_hash TEXT,
    otp_expires_at TEXT,
    otp_attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    is_pump_on INTEGER NOT NULL DEFAULT 0,
    pump_mode TEXT NOT NULL DEFAULT 'otomatis',
    min_moisture INTEGER NOT NULL DEFAULT 45,
    max_moisture INTEGER NOT NULL DEFAULT 75,
    location_name TEXT NOT NULL DEFAULT 'Semarang, Jawa Tengah',
    latitude REAL NOT NULL DEFAULT -6.9932,
    longitude REAL NOT NULL DEFAULT 110.4203,
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS plots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    crop TEXT NOT NULL,
    moisture INTEGER NOT NULL DEFAULT 65,
    pump_on INTEGER NOT NULL DEFAULT 0,
    updated_label TEXT NOT NULL DEFAULT 'Baru saja',
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    subtitle TEXT NOT NULL,
    tag TEXT NOT NULL,
    tone TEXT NOT NULL DEFAULT 'green',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
`);

const existingCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
const alterStatements = [
  ['email', 'ALTER TABLE users ADD COLUMN email TEXT'],
  ['email_verified', 'ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0'],
  ['otp_hash', 'ALTER TABLE users ADD COLUMN otp_hash TEXT'],
  ['otp_expires_at', 'ALTER TABLE users ADD COLUMN otp_expires_at TEXT'],
  ['otp_attempts', 'ALTER TABLE users ADD COLUMN otp_attempts INTEGER NOT NULL DEFAULT 0'],
];
for (const [col, sql] of alterStatements) {
  if (!existingCols.includes(col)) db.exec(sql);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, storedHash) {
  const parts = String(storedHash || '').split(':');
  if (parts.length !== 2) return false;
  const [salt, originalHex] = parts;
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  const originalBuf = Buffer.from(originalHex, 'hex');
  if (derivedBuf.length !== originalBuf.length) return false;
  return crypto.timingSafeEqual(derivedBuf, originalBuf);
}

function getSessionSecret() {
  return process.env.SESSION_SECRET || 'local-dev-session-secret';
}

function createSessionToken(user) {
  const payload = {
    uid: Number(user.id),
    username: user.username,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', getSessionSecret()).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifySessionToken(token) {
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
    if (!payload?.uid || !payload?.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function requireAuth(req) {
  const header = req.headers.authorization || '';
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  return verifySessionToken(match[1].trim());
}

function normalizeIdentifier(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || '').trim());
}

function generateOtpCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function computePlotCode(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return 'PT';
}

function formatCurrentTimeWib() {
  const parts = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
  return `${parts.replace('.', ':')} WIB`;
}

function ensureUserDashboardSeeded(userId) {
  const s = db.prepare('SELECT user_id FROM user_settings WHERE user_id = ?').get(userId);
  if (!s) {
    db.prepare(
      `INSERT INTO user_settings (user_id, is_pump_on, pump_mode, min_moisture, max_moisture, location_name, latitude, longitude)
       VALUES (?, 0, 'otomatis', 45, 75, 'Semarang, Jawa Tengah', -6.9932, 110.4203)`
    ).run(userId);
  }

  const p = db.prepare('SELECT id FROM plots WHERE user_id = ? LIMIT 1').get(userId);
  if (!p) {
    const insPlot = db.prepare(
      'INSERT INTO plots (user_id, code, name, crop, moisture, pump_on, updated_label) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    insPlot.run(userId, 'PU', 'Petak Utara', 'Cabai', 75, 0, 'Baru saja');
    insPlot.run(userId, 'PS', 'Petak Selatan', 'Tomat', 68, 0, '5 menit lalu');
    insPlot.run(userId, 'G1', 'Greenhouse 1', 'Melon', 42, 1, 'Baru saja');
  }

  const l = db.prepare('SELECT id FROM activity_logs WHERE user_id = ? LIMIT 1').get(userId);
  if (!l) {
    const insLog = db.prepare(
      'INSERT INTO activity_logs (user_id, title, subtitle, tag, tone) VALUES (?, ?, ?, ?, ?)'
    );
    insLog.run(userId, 'Pengecekan Rutin Pompa', 'Mesin Utama • Besok', 'Pengingat', 'purple');
    insLog.run(userId, 'Pengisian Tandon Otomatis', 'Tandon Utama • 16:30 WIB', 'Terjadwal', 'blue');
    insLog.run(userId, 'Penyiraman Ditunda (Prediksi Hujan)', 'Semua Petak • 13:00 WIB', 'Hemat Air', 'amber');
    insLog.run(userId, 'Penyiraman Otomatis Selesai', 'Petak Utara • 06:00 WIB', 'Selesai', 'green');
  }
}

function addActivityLog(userId, { title, subtitle, tag, tone = 'green' }) {
  db.prepare(
    'INSERT INTO activity_logs (user_id, title, subtitle, tag, tone) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, title, subtitle, tag, tone);
}

function getDashboardSnapshot(userId) {
  ensureUserDashboardSeeded(userId);
  const s = db
    .prepare(
      'SELECT is_pump_on, pump_mode, min_moisture, max_moisture, location_name, latitude, longitude FROM user_settings WHERE user_id = ?'
    )
    .get(userId);
  const plots = db
    .prepare('SELECT id, code, name, crop, moisture, pump_on, updated_label FROM plots WHERE user_id = ? ORDER BY id ASC')
    .all(userId);
  const activities = db
    .prepare('SELECT id, title, subtitle, tag, tone FROM activity_logs WHERE user_id = ? ORDER BY id DESC LIMIT 8')
    .all(userId);

  return {
    settings: {
      isPumpOn: Boolean(s.is_pump_on),
      pumpMode: s.pump_mode || 'otomatis',
      minMoistureThreshold: Number(s.min_moisture ?? 45),
      maxMoistureThreshold: Number(s.max_moisture ?? 75),
      locationName: s.location_name || 'Semarang, Jawa Tengah',
      latitude: Number(s.latitude ?? -6.9932),
      longitude: Number(s.longitude ?? 110.4203),
    },
    plots: plots.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      crop: p.crop,
      moisture: Number(p.moisture),
      pumpOn: Boolean(p.pump_on),
      updated: p.updated_label || 'Baru saja',
    })),
    activities: activities.map((l) => ({
      id: l.id,
      title: l.title,
      subtitle: l.subtitle,
      tag: l.tag,
      tone: l.tone || 'green',
    })),
  };
}

async function sendOtpViaBrevo(params) {
  const mod = await import('./lib/brevo.mjs');
  return mod.sendOtpEmail(params);
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 64) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = reqUrl.pathname;

  // API: Register + Send OTP
  if (req.method === 'POST' && pathname === '/api/register') {
    try {
      const body = await readRequestBody(req);
      const fullName = String(body.fullName || '').trim();
      const email = normalizeIdentifier(body.email);
      const rawUsername = String(body.username || '').trim();
      const username = normalizeIdentifier(rawUsername);
      const farmName = String(body.farmName || '').trim() || 'Pemilik Lahan';
      const password = String(body.password || '');

      if (!fullName || !email || !username || !password) {
        return sendJson(res, 400, {
          ok: false,
          message: 'Mohon lengkapi Nama Lengkap, Email, Nomor WhatsApp/Username, dan Kata Sandi.',
        });
      }
      if (!isValidEmail(email)) {
        return sendJson(res, 400, { ok: false, message: 'Format alamat email tidak valid.' });
      }
      if (password.length < 6) {
        return sendJson(res, 400, { ok: false, message: 'Kata Sandi minimal harus 6 karakter.' });
      }

      const existingByEmail = db
        .prepare('SELECT id, email_verified FROM users WHERE LOWER(email) = ?')
        .get(email);

      if (existingByEmail && existingByEmail.email_verified) {
        return sendJson(res, 409, {
          ok: false,
          message: 'Email sudah terdaftar dan terverifikasi. Silakan masuk.',
        });
      }

      const excludeId = existingByEmail ? existingByEmail.id : -1;
      const usernameConflict = db
        .prepare(
          'SELECT id FROM users WHERE id <> ? AND (LOWER(username) = ? OR (whatsapp IS NOT NULL AND LOWER(whatsapp) = ?))'
        )
        .get(excludeId, username, username);

      if (usernameConflict) {
        return sendJson(res, 409, {
          ok: false,
          message: 'Nomor WhatsApp atau Username sudah terdaftar. Silakan gunakan yang lain.',
        });
      }

      const otp = generateOtpCode();
      const otpHash = hashPassword(otp);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

      const mailResult = await sendOtpViaBrevo({ toEmail: email, toName: fullName, otp });
      if (!mailResult.ok) {
        return sendJson(res, mailResult.status === 401 ? 502 : mailResult.status || 502, {
          ok: false,
          message: mailResult.message,
        });
      }

      const isPhone = /^[0-9+\-\s]{8,16}$/.test(rawUsername);
      const whatsappVal = isPhone ? username : null;
      const passwordHash = hashPassword(password);

      if (existingByEmail) {
        db.prepare(
          `UPDATE users
           SET full_name = ?, username = ?, whatsapp = ?, farm_name = ?, password_hash = ?,
               email_verified = 0, otp_hash = ?, otp_expires_at = ?, otp_attempts = 0
           WHERE id = ?`
        ).run(fullName, username, whatsappVal, farmName, passwordHash, otpHash, expiresAt, existingByEmail.id);
      } else {
        db.prepare(
          `INSERT INTO users (full_name, email, username, whatsapp, farm_name, password_hash, email_verified, otp_hash, otp_expires_at, otp_attempts)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 0)`
        ).run(fullName, email, username, whatsappVal, farmName, passwordHash, otpHash, expiresAt);
      }

      return sendJson(res, 201, {
        ok: true,
        needsVerification: true,
        email,
        message: `Kode OTP 6 digit telah dikirim ke ${email}. Silakan cek kotak masuk atau folder spam.`,
      });
    } catch (err) {
      return sendJson(res, 400, {
        ok: false,
        message: err.message === 'Invalid JSON' ? 'Format data tidak valid.' : 'Gagal mendaftarkan akun.',
      });
    }
  }

  // API: Verify Email OTP
  if (req.method === 'POST' && pathname === '/api/verify-otp') {
    try {
      const body = await readRequestBody(req);
      const email = normalizeIdentifier(body.email);
      const otp = String(body.otp || '').trim();

      if (!isValidEmail(email)) return sendJson(res, 400, { ok: false, message: 'Alamat email tidak valid.' });
      if (!/^\d{6}$/.test(otp)) {
        return sendJson(res, 400, { ok: false, message: 'Mohon masukkan 6 digit kode OTP angka.' });
      }

      const user = db
        .prepare('SELECT id, full_name, email, username, farm_name, email_verified, otp_hash, otp_expires_at, otp_attempts FROM users WHERE LOWER(email) = ?')
        .get(email);
      if (!user) return sendJson(res, 404, { ok: false, message: 'Akun dengan email tersebut tidak ditemukan.' });

      if (user.email_verified) {
        const token = createSessionToken(user);
        return sendJson(res, 200, {
          ok: true,
          token,
          message: 'Email sudah terverifikasi sebelumnya.',
          user: { id: user.id, fullName: user.full_name, email: user.email, username: user.username, farmName: user.farm_name, emailVerified: true },
        });
      }

      if ((user.otp_attempts || 0) >= 5) {
        return sendJson(res, 429, { ok: false, message: 'Terlalu banyak percobaan OTP salah. Silakan tekan Kirim Ulang OTP.' });
      }
      if (!user.otp_hash || !user.otp_expires_at || new Date(user.otp_expires_at) < new Date()) {
        return sendJson(res, 400, { ok: false, message: 'Kode OTP sudah kedaluwarsa. Silakan tekan Kirim Ulang OTP.' });
      }
      if (!verifyPassword(otp, user.otp_hash)) {
        db.prepare('UPDATE users SET otp_attempts = COALESCE(otp_attempts, 0) + 1 WHERE id = ?').run(user.id);
        return sendJson(res, 400, { ok: false, message: 'Kode OTP salah. Silakan periksa kembali email Anda.' });
      }

      db.prepare('UPDATE users SET email_verified = 1, otp_hash = NULL, otp_expires_at = NULL, otp_attempts = 0 WHERE id = ?').run(user.id);
      const token = createSessionToken(user);
      return sendJson(res, 200, {
        ok: true,
        token,
        message: 'Email berhasil diverifikasi! Membuka Dashboard...',
        user: { id: user.id, fullName: user.full_name, email: user.email, username: user.username, farmName: user.farm_name, emailVerified: true },
      });
    } catch {
      return sendJson(res, 400, { ok: false, message: 'Permintaan verifikasi tidak valid.' });
    }
  }

  // API: Resend OTP
  if (req.method === 'POST' && pathname === '/api/resend-otp') {
    try {
      const body = await readRequestBody(req);
      const email = normalizeIdentifier(body.email);
      if (!isValidEmail(email)) return sendJson(res, 400, { ok: false, message: 'Alamat email tidak valid.' });

      const user = db.prepare('SELECT id, full_name, email, email_verified FROM users WHERE LOWER(email) = ?').get(email);
      if (!user) return sendJson(res, 404, { ok: false, message: 'Akun dengan email tersebut tidak ditemukan.' });
      if (user.email_verified) return sendJson(res, 400, { ok: false, message: 'Email ini sudah terverifikasi. Silakan masuk.' });

      const otp = generateOtpCode();
      const otpHash = hashPassword(otp);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const mailResult = await sendOtpViaBrevo({ toEmail: user.email, toName: user.full_name, otp });
      if (!mailResult.ok) return sendJson(res, mailResult.status || 502, { ok: false, message: mailResult.message });

      db.prepare('UPDATE users SET otp_hash = ?, otp_expires_at = ?, otp_attempts = 0 WHERE id = ?').run(otpHash, expiresAt, user.id);
      return sendJson(res, 200, { ok: true, message: `Kode OTP baru telah dikirim ke ${user.email}.` });
    } catch {
      return sendJson(res, 400, { ok: false, message: 'Permintaan kirim ulang OTP tidak valid.' });
    }
  }

  // API: Forgot Password (Send Reset OTP)
  if (req.method === 'POST' && pathname === '/api/forgot-password') {
    try {
      const body = await readRequestBody(req);
      const email = normalizeIdentifier(body.email);
      if (!isValidEmail(email)) return sendJson(res, 400, { ok: false, message: 'Mohon masukkan alamat email yang valid.' });

      const user = db.prepare('SELECT id, full_name, email FROM users WHERE LOWER(email) = ?').get(email);
      if (!user) return sendJson(res, 404, { ok: false, message: 'Email tersebut belum terdaftar di sistem.' });

      const otp = generateOtpCode();
      const otpHash = hashPassword(otp);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const mailResult = await sendOtpViaBrevo({ toEmail: user.email, toName: user.full_name, otp, purpose: 'reset' });
      if (!mailResult.ok) return sendJson(res, mailResult.status || 502, { ok: false, message: mailResult.message });

      db.prepare('UPDATE users SET otp_hash = ?, otp_expires_at = ?, otp_attempts = 0 WHERE id = ?').run(otpHash, expiresAt, user.id);
      return sendJson(res, 200, { ok: true, email: user.email, message: `Kode OTP reset kata sandi telah dikirim ke ${user.email}.` });
    } catch {
      return sendJson(res, 400, { ok: false, message: 'Permintaan reset sandi tidak valid.' });
    }
  }

  // API: Reset Password with OTP
  if (req.method === 'POST' && pathname === '/api/reset-password') {
    try {
      const body = await readRequestBody(req);
      const email = normalizeIdentifier(body.email);
      const otp = String(body.otp || '').trim();
      const newPassword = String(body.newPassword || '');

      if (!isValidEmail(email)) return sendJson(res, 400, { ok: false, message: 'Alamat email tidak valid.' });
      if (!/^\d{6}$/.test(otp)) return sendJson(res, 400, { ok: false, message: 'Mohon masukkan 6 digit kode OTP angka.' });
      if (newPassword.length < 6) return sendJson(res, 400, { ok: false, message: 'Kata sandi baru minimal harus 6 karakter.' });

      const user = db.prepare('SELECT id, otp_hash, otp_expires_at, otp_attempts FROM users WHERE LOWER(email) = ?').get(email);
      if (!user) return sendJson(res, 404, { ok: false, message: 'Akun dengan email tersebut tidak ditemukan.' });
      if ((user.otp_attempts || 0) >= 5) return sendJson(res, 429, { ok: false, message: 'Terlalu banyak percobaan OTP salah. Silakan minta kode baru.' });
      if (!user.otp_hash || !user.otp_expires_at || new Date(user.otp_expires_at) < new Date()) {
        return sendJson(res, 400, { ok: false, message: 'Kode OTP sudah kedaluwarsa. Silakan minta kode baru.' });
      }
      if (!verifyPassword(otp, user.otp_hash)) {
        db.prepare('UPDATE users SET otp_attempts = COALESCE(otp_attempts, 0) + 1 WHERE id = ?').run(user.id);
        return sendJson(res, 400, { ok: false, message: 'Kode OTP salah. Silakan periksa kembali email Anda.' });
      }

      db.prepare('UPDATE users SET password_hash = ?, email_verified = 1, otp_hash = NULL, otp_expires_at = NULL, otp_attempts = 0 WHERE id = ?').run(hashPassword(newPassword), user.id);
      return sendJson(res, 200, { ok: true, message: 'Kata sandi baru berhasil disimpan! Silakan masuk.' });
    } catch {
      return sendJson(res, 400, { ok: false, message: 'Gagal mereset kata sandi.' });
    }
  }

  // API: Login
  if (req.method === 'POST' && pathname === '/api/login') {
    try {
      const body = await readRequestBody(req);
      const identifier = normalizeIdentifier(body.username);
      const password = String(body.password || '');
      if (!identifier || !password) {
        return sendJson(res, 400, { ok: false, message: 'Mohon isi Email/WhatsApp/Username dan Kata Sandi terlebih dahulu.' });
      }

      const user = db
        .prepare(
          `SELECT id, full_name, email, username, farm_name, password_hash, email_verified
           FROM users
           WHERE LOWER(username) = ? OR (email IS NOT NULL AND LOWER(email) = ?) OR (whatsapp IS NOT NULL AND LOWER(whatsapp) = ?)`
        )
        .get(identifier, identifier, identifier);

      if (!user || !verifyPassword(password, user.password_hash)) {
        return sendJson(res, 401, { ok: false, message: 'Email/Username atau Kata Sandi salah.' });
      }
      if (user.email && !user.email_verified) {
        return sendJson(res, 403, {
          ok: false,
          needsVerification: true,
          email: user.email,
          message: 'Email Anda belum diverifikasi. Silakan masukkan kode OTP yang dikirim ke email Anda.',
        });
      }

      const token = createSessionToken(user);
      return sendJson(res, 200, {
        ok: true,
        token,
        message: 'Berhasil masuk.',
        user: {
          id: user.id,
          fullName: user.full_name,
          email: user.email || null,
          username: user.username,
          farmName: user.farm_name,
          emailVerified: Boolean(user.email_verified),
        },
      });
    } catch {
      return sendJson(res, 400, { ok: false, message: 'Permintaan masuk tidak valid.' });
    }
  }

  // API: Current User Session (/api/me)
  if (req.method === 'GET' && pathname === '/api/me') {
    const auth = requireAuth(req);
    if (!auth) return sendJson(res, 401, { ok: false, message: 'Sesi tidak valid.' });
    const user = db.prepare('SELECT id, full_name, email, username, farm_name, email_verified FROM users WHERE id = ?').get(auth.uid);
    if (!user) return sendJson(res, 401, { ok: false, message: 'Akun tidak ditemukan.' });
    return sendJson(res, 200, {
      ok: true,
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email || null,
        username: user.username,
        farmName: user.farm_name,
        emailVerified: Boolean(user.email_verified),
      },
    });
  }

  // API: Dashboard State (GET /api/dashboard)
  if (req.method === 'GET' && pathname === '/api/dashboard') {
    const auth = requireAuth(req);
    if (!auth) return sendJson(res, 401, { ok: false, message: 'Sesi tidak valid. Silakan masuk terlebih dahulu.' });
    const user = db.prepare('SELECT id, full_name, email, username, farm_name, email_verified FROM users WHERE id = ?').get(auth.uid);
    if (!user) return sendJson(res, 401, { ok: false, message: 'Akun tidak ditemukan.' });
    return sendJson(res, 200, {
      ok: true,
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email || null,
        username: user.username,
        farmName: user.farm_name,
        emailVerified: Boolean(user.email_verified),
      },
      ...getDashboardSnapshot(user.id),
    });
  }

  // API: Pump & Settings Update (POST /api/pump)
  if (req.method === 'POST' && pathname === '/api/pump') {
    const auth = requireAuth(req);
    if (!auth) return sendJson(res, 401, { ok: false, message: 'Sesi tidak valid.' });
    const body = await readRequestBody(req);
    ensureUserDashboardSeeded(auth.uid);
    const cur = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(auth.uid);

    const isPumpOn = typeof body.isPumpOn === 'boolean' ? (body.isPumpOn ? 1 : 0) : cur.is_pump_on;
    const pumpMode = body.pumpMode === 'manual' || body.pumpMode === 'otomatis' ? body.pumpMode : cur.pump_mode;
    const minMoisture = Number.isFinite(Number(body.minMoistureThreshold))
      ? Math.max(15, Math.min(70, Math.round(Number(body.minMoistureThreshold))))
      : cur.min_moisture;
    const maxMoisture = Number.isFinite(Number(body.maxMoistureThreshold))
      ? Math.max(minMoisture + 5, Math.min(95, Math.round(Number(body.maxMoistureThreshold))))
      : cur.max_moisture;
    const locationName =
      typeof body.locationName === 'string' && body.locationName.trim() ? body.locationName.trim() : cur.location_name;
    const latitude = Number.isFinite(Number(body.latitude)) ? Number(body.latitude) : cur.latitude;
    const longitude = Number.isFinite(Number(body.longitude)) ? Number(body.longitude) : cur.longitude;

    db.prepare(
      `UPDATE user_settings
       SET is_pump_on = ?, pump_mode = ?, min_moisture = ?, max_moisture = ?, location_name = ?, latitude = ?, longitude = ?, updated_at = datetime('now', 'localtime')
       WHERE user_id = ?`
    ).run(isPumpOn, pumpMode, minMoisture, maxMoisture, locationName, latitude, longitude, auth.uid);

    const timeLabel = formatCurrentTimeWib();
    if (body.logAction === 'pump-toggle') {
      addActivityLog(auth.uid, {
        title: isPumpOn ? 'Pompa Utama Dinyalakan Manual' : 'Pompa Utama Dimatikan Manual',
        subtitle: `Mesin Utama • ${timeLabel}`,
        tag: isPumpOn ? 'Aktif' : 'Selesai',
        tone: isPumpOn ? 'green' : 'blue',
      });
    } else if (body.logAction === 'mode-change') {
      addActivityLog(auth.uid, {
        title: `Mode Pompa: ${pumpMode === 'otomatis' ? 'Otomatis' : 'Manual'}`,
        subtitle: `Kontrol Irigasi • ${timeLabel}`,
        tag: pumpMode === 'otomatis' ? 'Otomatis' : 'Manual',
        tone: 'purple',
      });
    } else if (body.logAction === 'location-change') {
      addActivityLog(auth.uid, {
        title: 'Lokasi Cuaca Diperbarui',
        subtitle: `${locationName} • ${timeLabel}`,
        tag: 'Cuaca',
        tone: 'blue',
      });
    } else if (body.logAction === 'threshold-change') {
      addActivityLog(auth.uid, {
        title: `Batas Kelembapan Diatur (${minMoisture}%–${maxMoisture}%)`,
        subtitle: `Sensor Tanah • ${timeLabel}`,
        tag: 'Pengaturan',
        tone: 'amber',
      });
    }

    return sendJson(res, 200, { ok: true, ...getDashboardSnapshot(auth.uid) });
  }

  // API: Plots CRUD (/api/plots)
  if (pathname === '/api/plots' && ['POST', 'PATCH', 'DELETE'].includes(req.method)) {
    const auth = requireAuth(req);
    if (!auth) return sendJson(res, 401, { ok: false, message: 'Sesi tidak valid.' });
    const body = await readRequestBody(req);
    ensureUserDashboardSeeded(auth.uid);
    const timeLabel = formatCurrentTimeWib();

    if (req.method === 'POST') {
      const name = String(body.name || '').trim();
      const crop = String(body.crop || '').trim();
      const moisture = Math.max(10, Math.min(99, Math.round(Number(body.moisture ?? 65))));
      if (!name || !crop) return sendJson(res, 400, { ok: false, message: 'Nama Petak dan Jenis Tanaman wajib diisi.' });
      db.prepare('INSERT INTO plots (user_id, code, name, crop, moisture, pump_on, updated_label) VALUES (?, ?, ?, ?, ?, 0, ?)').run(
        auth.uid,
        computePlotCode(name),
        name,
        crop,
        moisture,
        'Baru saja'
      );
      addActivityLog(auth.uid, {
        title: `Petak Baru Ditambahkan: ${name}`,
        subtitle: `Tanaman ${crop} • ${timeLabel}`,
        tag: 'Petak Baru',
        tone: 'green',
      });
      return sendJson(res, 201, { ok: true, ...getDashboardSnapshot(auth.uid) });
    }

    if (req.method === 'PATCH') {
      const plotId = Number(body.id);
      const cur = db.prepare('SELECT * FROM plots WHERE id = ? AND user_id = ?').get(plotId, auth.uid);
      if (!cur) return sendJson(res, 404, { ok: false, message: 'Petak tidak ditemukan.' });
      const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : cur.name;
      const crop = typeof body.crop === 'string' && body.crop.trim() ? body.crop.trim() : cur.crop;
      const moisture = Number.isFinite(Number(body.moisture)) ? Math.max(10, Math.min(99, Math.round(Number(body.moisture)))) : cur.moisture;
      const pumpOn = typeof body.pumpOn === 'boolean' ? (body.pumpOn ? 1 : 0) : cur.pump_on;
      db.prepare(
        `UPDATE plots SET code = ?, name = ?, crop = ?, moisture = ?, pump_on = ?, updated_label = 'Baru saja', updated_at = datetime('now', 'localtime') WHERE id = ? AND user_id = ?`
      ).run(computePlotCode(name), name, crop, moisture, pumpOn, plotId, auth.uid);

      if (typeof body.pumpOn === 'boolean' && pumpOn !== cur.pump_on) {
        addActivityLog(auth.uid, {
          title: pumpOn ? `Menyiram ${name}` : `Penyiraman ${name} Dihentikan`,
          subtitle: `${crop} • ${timeLabel}`,
          tag: pumpOn ? 'Aktif' : 'Selesai',
          tone: pumpOn ? 'green' : 'blue',
        });
      } else if (body.name || body.crop || body.moisture !== undefined) {
        addActivityLog(auth.uid, {
          title: `Data ${name} Diperbarui`,
          subtitle: `${crop} (${moisture}%) • ${timeLabel}`,
          tag: 'Diperbarui',
          tone: 'amber',
        });
      }
      return sendJson(res, 200, { ok: true, ...getDashboardSnapshot(auth.uid) });
    }

    if (req.method === 'DELETE') {
      const plotId = Number(body.id);
      const total = db.prepare('SELECT COUNT(*) AS cnt FROM plots WHERE user_id = ?').get(auth.uid).cnt;
      if (total <= 1) return sendJson(res, 400, { ok: false, message: 'Minimal harus tersisa 1 petak lahan.' });
      const cur = db.prepare('SELECT name FROM plots WHERE id = ? AND user_id = ?').get(plotId, auth.uid);
      if (!cur) return sendJson(res, 404, { ok: false, message: 'Petak tidak ditemukan.' });
      db.prepare('DELETE FROM plots WHERE id = ? AND user_id = ?').run(plotId, auth.uid);
      addActivityLog(auth.uid, {
        title: `Petak Dihapus: ${cur.name}`,
        subtitle: `Manajemen Lahan • ${timeLabel}`,
        tag: 'Dihapus',
        tone: 'purple',
      });
      return sendJson(res, 200, { ok: true, ...getDashboardSnapshot(auth.uid) });
    }
  }

  // API: List registered user accounts (safe fields only)
  if (req.method === 'GET' && pathname === '/api/users') {
    const users = db
      .prepare('SELECT id, full_name, email, username, whatsapp, farm_name, email_verified, created_at FROM users ORDER BY id ASC')
      .all();
    return sendJson(res, 200, { ok: true, users });
  }

  // Static File Serving
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Method Not Allowed');
  }

  const targetRelative = pathname === '/' ? 'login.html' : pathname.replace(/^\/+/, '');
  const resolvedPath = path.resolve(ROOT_DIR, targetRelative);

  const blockedPrefixes = [DB_DIR, path.join(ROOT_DIR, 'lib'), path.join(ROOT_DIR, 'netlify')];
  const blockedFiles = [path.join(ROOT_DIR, 'server.js'), path.join(ROOT_DIR, '.env')];

  if (
    !resolvedPath.startsWith(ROOT_DIR + path.sep) ||
    blockedPrefixes.some((p) => resolvedPath.startsWith(p)) ||
    blockedFiles.includes(resolvedPath)
  ) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Forbidden');
  }

  fs.readFile(resolvedPath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Halaman tidak ditemukan');
    }
    const ext = path.extname(resolvedPath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    return res.end(req.method === 'HEAD' ? undefined : content);
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Server Irigasi Cerdas berjalan di http://localhost:${PORT}`);
    console.log(`Database SQLite tersimpan di: ${DB_PATH}`);
  });
}

module.exports = { server, db };
