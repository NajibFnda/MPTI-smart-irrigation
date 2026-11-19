/**
 * Irigasi Cerdas — Backend Server & Database SQLite (Zero External Dependencies)
 * Mendukung autentikasi bertoken, verifikasi & reset password OTP via Brevo,
 * serta persistensi status pompa, tandon, listrik, jadwal, riwayat kelembapan,
 * petak lahan, lokasi cuaca, profil, dan log aktivitas.
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
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    email TEXT,
    username TEXT NOT NULL UNIQUE,
    whatsapp TEXT,
    farm_name TEXT NOT NULL DEFAULT 'Pemilik Lahan',
    role TEXT NOT NULL DEFAULT 'user',
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
    tank_level_pct INTEGER NOT NULL DEFAULT 85,
    tank_capacity_liters INTEGER NOT NULL DEFAULT 2000,
    water_used_liters INTEGER NOT NULL DEFAULT 320,
    water_saved_liters INTEGER NOT NULL DEFAULT 1450,
    energy_kwh REAL NOT NULL DEFAULT 22.1,
    tariff_per_kwh INTEGER NOT NULL DEFAULT 1445,
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

  CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    plot_target TEXT NOT NULL DEFAULT 'Semua Petak',
    time_wib TEXT NOT NULL,
    duration_min INTEGER NOT NULL DEFAULT 15,
    skip_on_rain INTEGER NOT NULL DEFAULT 1,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS moisture_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day_date TEXT NOT NULL,
    series_a INTEGER NOT NULL,
    series_b INTEGER NOT NULL,
    UNIQUE (user_id, day_date)
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

// Safe migrations for existing local SQLite tables
const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
for (const [col, sql] of [
  ['email', 'ALTER TABLE users ADD COLUMN email TEXT'],
  ['role', "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'"],
  ['email_verified', 'ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0'],
  ['otp_hash', 'ALTER TABLE users ADD COLUMN otp_hash TEXT'],
  ['otp_expires_at', 'ALTER TABLE users ADD COLUMN otp_expires_at TEXT'],
  ['otp_attempts', 'ALTER TABLE users ADD COLUMN otp_attempts INTEGER NOT NULL DEFAULT 0'],
]) {
  if (!userCols.includes(col)) db.exec(sql);
}

db.exec(`
  UPDATE users
  SET role = 'admin'
  WHERE LOWER(email) = 'fnaandd44@gmail.com'
     OR LOWER(username) = 'fnaandd44'
`);

const settingsCols = db.prepare('PRAGMA table_info(user_settings)').all().map((c) => c.name);
for (const [col, sql] of [
  ['tank_level_pct', 'ALTER TABLE user_settings ADD COLUMN tank_level_pct INTEGER NOT NULL DEFAULT 85'],
  ['tank_capacity_liters', 'ALTER TABLE user_settings ADD COLUMN tank_capacity_liters INTEGER NOT NULL DEFAULT 2000'],
  ['water_used_liters', 'ALTER TABLE user_settings ADD COLUMN water_used_liters INTEGER NOT NULL DEFAULT 320'],
  ['water_saved_liters', 'ALTER TABLE user_settings ADD COLUMN water_saved_liters INTEGER NOT NULL DEFAULT 1450'],
  ['energy_kwh', 'ALTER TABLE user_settings ADD COLUMN energy_kwh REAL NOT NULL DEFAULT 22.1'],
  ['tariff_per_kwh', 'ALTER TABLE user_settings ADD COLUMN tariff_per_kwh INTEGER NOT NULL DEFAULT 1445'],
]) {
  if (!settingsCols.includes(col)) db.exec(sql);
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
    role: user.role || 'user',
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

function requireAdmin(req) {
  const auth = requireAuth(req);
  if (!auth) return { ok: false, status: 401, message: 'Sesi tidak valid. Silakan masuk kembali.' };
  const user = db.prepare('SELECT id, full_name, email, username, role FROM users WHERE id = ?').get(auth.uid);
  if (!user) return { ok: false, status: 401, message: 'Akun tidak ditemukan.' };
  if (user.role !== 'admin') {
    return { ok: false, status: 403, message: 'Akses ditolak. Halaman ini hanya untuk akun Admin.' };
  }
  return { ok: true, user };
}

function fetchAdminUsersPayload() {
  const rows = db
    .prepare(
      `SELECT
         u.id,
         u.full_name,
         u.email,
         u.username,
         u.whatsapp,
         u.farm_name,
         u.role,
         u.email_verified,
         u.created_at,
         COALESCE(us.location_name, '-') AS location_name,
         (SELECT COUNT(*) FROM plots p WHERE p.user_id = u.id) AS plot_count,
         (SELECT COUNT(*) FROM activity_logs a WHERE a.user_id = u.id) AS activity_count
       FROM users u
       LEFT JOIN user_settings us ON us.user_id = u.id
       ORDER BY u.id DESC`
    )
    .all();

  const users = rows.map((r) => ({
    id: r.id,
    fullName: r.full_name,
    email: r.email || null,
    username: r.username,
    whatsapp: r.whatsapp || null,
    farmName: r.farm_name || 'Pemilik Lahan',
    role: r.role || 'user',
    emailVerified: Boolean(r.email_verified),
    locationName: r.location_name || '-',
    plotCount: Number(r.plot_count || 0),
    activityCount: Number(r.activity_count || 0),
    createdAt: r.created_at,
  }));

  const stats = {
    totalUsers: users.length,
    verifiedUsers: users.filter((u) => u.emailVerified).length,
    unverifiedUsers: users.filter((u) => !u.emailVerified).length,
    adminCount: users.filter((u) => u.role === 'admin').length,
  };

  return { users, stats };
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

function getJakartaDateString(offsetDays = 0) {
  const now = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
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
      `INSERT INTO user_settings (
        user_id, is_pump_on, pump_mode, min_moisture, max_moisture,
        location_name, latitude, longitude,
        tank_level_pct, tank_capacity_liters, water_used_liters, water_saved_liters, energy_kwh, tariff_per_kwh
      )
      VALUES (?, 0, 'otomatis', 45, 75, 'Semarang, Jawa Tengah', -6.9932, 110.4203, 85, 2000, 320, 1450, 22.1, 1445)`
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

  const sc = db.prepare('SELECT id FROM schedules WHERE user_id = ? LIMIT 1').get(userId);
  if (!sc) {
    const insSc = db.prepare(
      'INSERT INTO schedules (user_id, label, plot_target, time_wib, duration_min, skip_on_rain, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    insSc.run(userId, 'Siram Pagi Rutin', 'Semua Petak', '06:00', 15, 1, 1);
    insSc.run(userId, 'Siram Siang (Hemat Air)', 'Greenhouse 1', '13:00', 10, 1, 1);
    insSc.run(userId, 'Siram Sore & Cek Tandon', 'Semua Petak', '16:30', 15, 1, 1);
  }

  const l = db.prepare('SELECT id FROM activity_logs WHERE user_id = ? LIMIT 1').get(userId);
  if (!l) {
    const insLog = db.prepare(
      'INSERT INTO activity_logs (user_id, title, subtitle, tag, tone) VALUES (?, ?, ?, ?, ?)'
    );
    insLog.run(userId, 'Pengecekan Rutin Pompa', 'Mesin Utama • Terjadwal', 'Pengingat', 'purple');
    insLog.run(userId, 'Pengisian Tandon Otomatis', 'Tandon Utama • 16:30 WIB', 'Terjadwal', 'blue');
    insLog.run(userId, 'Penyiraman Ditunda (Prediksi Hujan)', 'Semua Petak • 13:00 WIB', 'Hemat Air', 'amber');
    insLog.run(userId, 'Penyiraman Otomatis Selesai', 'Petak Utara • 06:00 WIB', 'Selesai', 'green');
  }

  const histCount = db.prepare('SELECT COUNT(*) AS cnt FROM moisture_history WHERE user_id = ?').get(userId).cnt;
  if (histCount < 14) {
    const sampleA = [52, 61, 65, 59, 66, 72, 70, 58, 69, 60, 68, 63, 69, 75];
    const sampleB = [45, 51, 58, 47, 55, 60, 62, 49, 57, 50, 54, 51, 56, 68];
    const insHist = db.prepare(
      'INSERT OR IGNORE INTO moisture_history (user_id, day_date, series_a, series_b) VALUES (?, ?, ?, ?)'
    );
    for (let i = 0; i < 14; i++) {
      insHist.run(userId, getJakartaDateString(i - 13), sampleA[i], sampleB[i]);
    }
  }
}

function syncTodayMoistureHistory(userId) {
  const topPlots = db.prepare('SELECT moisture FROM plots WHERE user_id = ? ORDER BY id ASC LIMIT 2').all(userId);
  if (topPlots.length === 0) return;
  const seriesA = Number(topPlots[0].moisture ?? 65);
  const seriesB = Number(topPlots[1]?.moisture ?? Math.max(25, seriesA - 8));
  const todayStr = getJakartaDateString(0);
  db.prepare(
    `INSERT INTO moisture_history (user_id, day_date, series_a, series_b)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, day_date) DO UPDATE SET series_a = excluded.series_a, series_b = excluded.series_b`
  ).run(userId, todayStr, seriesA, seriesB);
}

function addActivityLog(userId, { title, subtitle, tag, tone = 'green' }) {
  db.prepare(
    'INSERT INTO activity_logs (user_id, title, subtitle, tag, tone) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, title, subtitle, tag, tone);
}

function getDashboardSnapshot(userId) {
  ensureUserDashboardSeeded(userId);
  syncTodayMoistureHistory(userId);

  const s = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId);
  const plots = db
    .prepare('SELECT id, code, name, crop, moisture, pump_on, updated_label FROM plots WHERE user_id = ? ORDER BY id ASC')
    .all(userId);
  const schedules = db
    .prepare('SELECT id, label, plot_target, time_wib, duration_min, skip_on_rain, enabled FROM schedules WHERE user_id = ? ORDER BY time_wib ASC, id ASC')
    .all(userId);
  const activities = db
    .prepare('SELECT id, title, subtitle, tag, tone, created_at FROM activity_logs WHERE user_id = ? ORDER BY id DESC LIMIT 30')
    .all(userId);
  const historyRows = db
    .prepare(
      `SELECT day_date, series_a, series_b FROM (
         SELECT day_date, series_a, series_b FROM moisture_history WHERE user_id = ? ORDER BY day_date DESC LIMIT 14
       ) ORDER BY day_date ASC`
    )
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
      tankLevelPct: Number(s.tank_level_pct ?? 85),
      tankCapacityLiters: Number(s.tank_capacity_liters ?? 2000),
      waterUsedLiters: Number(s.water_used_liters ?? 320),
      waterSavedLiters: Number(s.water_saved_liters ?? 1450),
      energyKwh: Number(Number(s.energy_kwh ?? 22.1).toFixed(2)),
      tariffPerKwh: Number(s.tariff_per_kwh ?? 1445),
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
    schedules: schedules.map((sc) => ({
      id: sc.id,
      label: sc.label,
      plotTarget: sc.plot_target,
      timeWib: sc.time_wib,
      durationMin: Number(sc.duration_min ?? 15),
      skipOnRain: Boolean(sc.skip_on_rain),
      enabled: Boolean(sc.enabled),
    })),
    activities: activities.map((l) => ({
      id: l.id,
      title: l.title,
      subtitle: l.subtitle,
      tag: l.tag,
      tone: l.tone || 'green',
      createdAt: l.created_at,
    })),
    moistureHistory: historyRows.map((h) => ({
      dayDate: h.day_date,
      seriesA: Number(h.series_a),
      seriesB: Number(h.series_b),
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
      if (!isValidEmail(email)) return sendJson(res, 400, { ok: false, message: 'Format alamat email tidak valid.' });
      if (password.length < 6) return sendJson(res, 400, { ok: false, message: 'Kata Sandi minimal harus 6 karakter.' });

      const existingByEmail = db.prepare('SELECT id, email_verified FROM users WHERE LOWER(email) = ?').get(email);
      if (existingByEmail && existingByEmail.email_verified) {
        return sendJson(res, 409, { ok: false, message: 'Email sudah terdaftar dan terverifikasi. Silakan masuk.' });
      }

      const excludeId = existingByEmail ? existingByEmail.id : -1;
      const usernameConflict = db
        .prepare('SELECT id FROM users WHERE id <> ? AND (LOWER(username) = ? OR (whatsapp IS NOT NULL AND LOWER(whatsapp) = ?))')
        .get(excludeId, username, username);
      if (usernameConflict) {
        return sendJson(res, 409, { ok: false, message: 'Nomor WhatsApp atau Username sudah terdaftar.' });
      }

      const otp = generateOtpCode();
      const otpHash = hashPassword(otp);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

      const mailResult = await sendOtpViaBrevo({ toEmail: email, toName: fullName, otp });
      if (!mailResult.ok) return sendJson(res, mailResult.status || 502, { ok: false, message: mailResult.message });

      const isPhone = /^[0-9+\-\s]{8,16}$/.test(rawUsername);
      const whatsappVal = isPhone ? username : null;
      const passwordHash = hashPassword(password);

      if (existingByEmail) {
        db.prepare(
          `UPDATE users SET full_name = ?, username = ?, whatsapp = ?, farm_name = ?, password_hash = ?,
           email_verified = 0, otp_hash = ?, otp_expires_at = ?, otp_attempts = 0 WHERE id = ?`
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
    } catch {
      return sendJson(res, 400, { ok: false, message: 'Gagal mendaftarkan akun.' });
    }
  }

  // API: Verify Email OTP
  if (req.method === 'POST' && pathname === '/api/verify-otp') {
    try {
      const body = await readRequestBody(req);
      const email = normalizeIdentifier(body.email);
      const otp = String(body.otp || '').trim();
      if (!isValidEmail(email)) return sendJson(res, 400, { ok: false, message: 'Alamat email tidak valid.' });
      if (!/^\d{6}$/.test(otp)) return sendJson(res, 400, { ok: false, message: 'Mohon masukkan 6 digit kode OTP angka.' });

      const user = db
        .prepare('SELECT id, full_name, email, username, farm_name, role, email_verified, otp_hash, otp_expires_at, otp_attempts FROM users WHERE LOWER(email) = ?')
        .get(email);
      if (!user) return sendJson(res, 404, { ok: false, message: 'Akun tidak ditemukan.' });
      if (user.email_verified) {
        return sendJson(res, 200, {
          ok: true,
          token: createSessionToken(user),
          message: 'Email sudah terverifikasi sebelumnya.',
          user: { id: user.id, fullName: user.full_name, email: user.email, username: user.username, farmName: user.farm_name, role: user.role || 'user', emailVerified: true },
        });
      }
      if ((user.otp_attempts || 0) >= 5) return sendJson(res, 429, { ok: false, message: 'Terlalu banyak percobaan OTP salah.' });
      if (!user.otp_hash || !user.otp_expires_at || new Date(user.otp_expires_at) < new Date()) {
        return sendJson(res, 400, { ok: false, message: 'Kode OTP sudah kedaluwarsa.' });
      }
      if (!verifyPassword(otp, user.otp_hash)) {
        db.prepare('UPDATE users SET otp_attempts = COALESCE(otp_attempts, 0) + 1 WHERE id = ?').run(user.id);
        return sendJson(res, 400, { ok: false, message: 'Kode OTP salah.' });
      }

      db.prepare('UPDATE users SET email_verified = 1, otp_hash = NULL, otp_expires_at = NULL, otp_attempts = 0 WHERE id = ?').run(user.id);
      return sendJson(res, 200, {
        ok: true,
        token: createSessionToken(user),
        message: 'Email berhasil diverifikasi! Membuka Dashboard...',
        user: { id: user.id, fullName: user.full_name, email: user.email, username: user.username, farmName: user.farm_name, role: user.role || 'user', emailVerified: true },
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
      if (!user) return sendJson(res, 404, { ok: false, message: 'Akun tidak ditemukan.' });
      if (user.email_verified) return sendJson(res, 400, { ok: false, message: 'Email ini sudah terverifikasi.' });

      const otp = generateOtpCode();
      const otpHash = hashPassword(otp);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const mailResult = await sendOtpViaBrevo({ toEmail: user.email, toName: user.full_name, otp });
      if (!mailResult.ok) return sendJson(res, mailResult.status || 502, { ok: false, message: mailResult.message });

      db.prepare('UPDATE users SET otp_hash = ?, otp_expires_at = ?, otp_attempts = 0 WHERE id = ?').run(otpHash, expiresAt, user.id);
      return sendJson(res, 200, { ok: true, message: `Kode OTP baru telah dikirim ke ${user.email}.` });
    } catch {
      return sendJson(res, 400, { ok: false, message: 'Gagal mengirim ulang OTP.' });
    }
  }

  // API: Forgot Password & Reset Password
  if (req.method === 'POST' && pathname === '/api/forgot-password') {
    try {
      const body = await readRequestBody(req);
      const email = normalizeIdentifier(body.email);
      if (!isValidEmail(email)) return sendJson(res, 400, { ok: false, message: 'Alamat email tidak valid.' });
      const user = db.prepare('SELECT id, full_name, email FROM users WHERE LOWER(email) = ?').get(email);
      if (!user) return sendJson(res, 404, { ok: false, message: 'Email tersebut belum terdaftar.' });

      const otp = generateOtpCode();
      const otpHash = hashPassword(otp);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const mailResult = await sendOtpViaBrevo({ toEmail: user.email, toName: user.full_name, otp, purpose: 'reset' });
      if (!mailResult.ok) return sendJson(res, mailResult.status || 502, { ok: false, message: mailResult.message });

      db.prepare('UPDATE users SET otp_hash = ?, otp_expires_at = ?, otp_attempts = 0 WHERE id = ?').run(otpHash, expiresAt, user.id);
      return sendJson(res, 200, { ok: true, email: user.email, message: `Kode OTP reset sandi telah dikirim ke ${user.email}.` });
    } catch {
      return sendJson(res, 400, { ok: false, message: 'Gagal memproses lupa kata sandi.' });
    }
  }

  if (req.method === 'POST' && pathname === '/api/reset-password') {
    try {
      const body = await readRequestBody(req);
      const email = normalizeIdentifier(body.email);
      const otp = String(body.otp || '').trim();
      const newPassword = String(body.newPassword || '');
      if (!isValidEmail(email)) return sendJson(res, 400, { ok: false, message: 'Alamat email tidak valid.' });
      if (!/^\d{6}$/.test(otp)) return sendJson(res, 400, { ok: false, message: 'Kode OTP harus 6 digit angka.' });
      if (newPassword.length < 6) return sendJson(res, 400, { ok: false, message: 'Kata sandi baru minimal 6 karakter.' });

      const user = db.prepare('SELECT id, otp_hash, otp_expires_at, otp_attempts FROM users WHERE LOWER(email) = ?').get(email);
      if (!user) return sendJson(res, 404, { ok: false, message: 'Akun tidak ditemukan.' });
      if ((user.otp_attempts || 0) >= 5) return sendJson(res, 429, { ok: false, message: 'Terlalu banyak percobaan OTP salah.' });
      if (!user.otp_hash || !user.otp_expires_at || new Date(user.otp_expires_at) < new Date()) {
        return sendJson(res, 400, { ok: false, message: 'Kode OTP sudah kedaluwarsa.' });
      }
      if (!verifyPassword(otp, user.otp_hash)) {
        db.prepare('UPDATE users SET otp_attempts = COALESCE(otp_attempts, 0) + 1 WHERE id = ?').run(user.id);
        return sendJson(res, 400, { ok: false, message: 'Kode OTP salah.' });
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
      if (!identifier || !password) return sendJson(res, 400, { ok: false, message: 'Mohon isi Email/Username dan Kata Sandi.' });

      const user = db
        .prepare(
          `SELECT id, full_name, email, username, farm_name, role, password_hash, email_verified
           FROM users
           WHERE LOWER(username) = ? OR (email IS NOT NULL AND LOWER(email) = ?) OR (whatsapp IS NOT NULL AND LOWER(whatsapp) = ?)`
        )
        .get(identifier, identifier, identifier);

      if (!user || !verifyPassword(password, user.password_hash)) {
        return sendJson(res, 401, { ok: false, message: 'Email/Username atau Kata Sandi salah.' });
      }
      if (user.email && !user.email_verified) {
        return sendJson(res, 403, { ok: false, needsVerification: true, email: user.email, message: 'Email Anda belum diverifikasi.' });
      }
      return sendJson(res, 200, {
        ok: true,
        token: createSessionToken(user),
        message: 'Berhasil masuk.',
        user: {
          id: user.id,
          fullName: user.full_name,
          email: user.email || null,
          username: user.username,
          farmName: user.farm_name,
          role: user.role || 'user',
          emailVerified: Boolean(user.email_verified),
        },
      });
    } catch {
      return sendJson(res, 400, { ok: false, message: 'Permintaan masuk tidak valid.' });
    }
  }

  // API: Current User (/api/me)
  if (req.method === 'GET' && pathname === '/api/me') {
    const auth = requireAuth(req);
    if (!auth) return sendJson(res, 401, { ok: false, message: 'Sesi tidak valid.' });
    const user = db.prepare('SELECT id, full_name, email, username, farm_name, role, email_verified FROM users WHERE id = ?').get(auth.uid);
    if (!user) return sendJson(res, 401, { ok: false, message: 'Akun tidak ditemukan.' });
    return sendJson(res, 200, {
      ok: true,
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email || null,
        username: user.username,
        farmName: user.farm_name,
        role: user.role || 'user',
        emailVerified: Boolean(user.email_verified),
      },
    });
  }

  // API: Profile Update (PATCH /api/profile)
  if (req.method === 'PATCH' && pathname === '/api/profile') {
    const auth = requireAuth(req);
    if (!auth) return sendJson(res, 401, { ok: false, message: 'Sesi tidak valid.' });
    const body = await readRequestBody(req);
    const fullName = String(body.fullName || '').trim();
    const farmName = String(body.farmName || '').trim() || 'Pemilik Lahan';
    const currentPassword = String(body.currentPassword || '');
    const newPassword = String(body.newPassword || '');
    if (!fullName) return sendJson(res, 400, { ok: false, message: 'Nama Lengkap tidak boleh kosong.' });

    const user = db.prepare('SELECT id, full_name, email, username, farm_name, role, password_hash, email_verified FROM users WHERE id = ?').get(auth.uid);
    if (!user) return sendJson(res, 404, { ok: false, message: 'Akun tidak ditemukan.' });

    let nextPasswordHash = user.password_hash;
    let passwordChanged = false;
    if (newPassword || currentPassword) {
      if (!currentPassword) return sendJson(res, 400, { ok: false, message: 'Masukkan kata sandi saat ini.' });
      if (!verifyPassword(currentPassword, user.password_hash)) return sendJson(res, 400, { ok: false, message: 'Kata sandi saat ini salah.' });
      if (newPassword.length < 6) return sendJson(res, 400, { ok: false, message: 'Kata sandi baru minimal 6 karakter.' });
      nextPasswordHash = hashPassword(newPassword);
      passwordChanged = true;
    }

    db.prepare('UPDATE users SET full_name = ?, farm_name = ?, password_hash = ? WHERE id = ?').run(fullName, farmName, nextPasswordHash, auth.uid);
    addActivityLog(auth.uid, {
      title: passwordChanged ? 'Profil & Kata Sandi Diperbarui' : 'Profil Lahan Diperbarui',
      subtitle: `${fullName} (${farmName}) • ${formatCurrentTimeWib()}`,
      tag: 'Profil',
      tone: 'purple',
    });

    return sendJson(res, 200, {
      ok: true,
      message: passwordChanged ? 'Profil dan kata sandi berhasil diperbarui!' : 'Profil berhasil disimpan!',
      user: {
        id: user.id,
        fullName,
        email: user.email || null,
        username: user.username,
        farmName,
        role: user.role || 'user',
        emailVerified: Boolean(user.email_verified),
      },
    });
  }

  // API: Dashboard Snapshot (GET /api/dashboard)
  if (req.method === 'GET' && pathname === '/api/dashboard') {
    const auth = requireAuth(req);
    if (!auth) return sendJson(res, 401, { ok: false, message: 'Sesi tidak valid.' });
    const user = db.prepare('SELECT id, full_name, email, username, farm_name, role, email_verified FROM users WHERE id = ?').get(auth.uid);
    if (!user) return sendJson(res, 401, { ok: false, message: 'Akun tidak ditemukan.' });
    return sendJson(res, 200, {
      ok: true,
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email || null,
        username: user.username,
        farmName: user.farm_name,
        role: user.role || 'user',
        emailVerified: Boolean(user.email_verified),
      },
      ...getDashboardSnapshot(user.id),
    });
  }

  // API: Pump, Tank, Energy, Location & Live Sync (POST /api/pump)
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
    let tankLevelPct = Number.isFinite(Number(body.tankLevelPct))
      ? Math.max(0, Math.min(100, Math.round(Number(body.tankLevelPct))))
      : cur.tank_level_pct;
    if (body.refillTank === true) tankLevelPct = 100;
    const waterUsedLiters = Number.isFinite(Number(body.waterUsedLiters))
      ? Math.max(0, Math.round(Number(body.waterUsedLiters)))
      : cur.water_used_liters;
    const waterSavedLiters = Number.isFinite(Number(body.waterSavedLiters))
      ? Math.max(0, Math.round(Number(body.waterSavedLiters)))
      : cur.water_saved_liters;
    const energyKwh = Number.isFinite(Number(body.energyKwh))
      ? Math.max(0, Number(Number(body.energyKwh).toFixed(2)))
      : cur.energy_kwh;

    db.prepare(
      `UPDATE user_settings
       SET is_pump_on = ?, pump_mode = ?, min_moisture = ?, max_moisture = ?,
           location_name = ?, latitude = ?, longitude = ?,
           tank_level_pct = ?, water_used_liters = ?, water_saved_liters = ?, energy_kwh = ?,
           updated_at = datetime('now', 'localtime')
       WHERE user_id = ?`
    ).run(isPumpOn, pumpMode, minMoisture, maxMoisture, locationName, latitude, longitude, tankLevelPct, waterUsedLiters, waterSavedLiters, energyKwh, auth.uid);

    if (Array.isArray(body.plotUpdates)) {
      const updPlot = db.prepare(
        `UPDATE plots SET moisture = ?, pump_on = ?, updated_label = 'Baru saja', updated_at = datetime('now', 'localtime') WHERE id = ? AND user_id = ?`
      );
      for (const pu of body.plotUpdates) {
        const pid = Number(pu.id);
        if (!Number.isInteger(pid) || pid <= 0) continue;
        updPlot.run(Math.max(10, Math.min(99, Math.round(Number(pu.moisture ?? 65)))), pu.pumpOn ? 1 : 0, pid, auth.uid);
      }
    }

    const timeLabel = formatCurrentTimeWib();
    if (body.refillTank === true) {
      addActivityLog(auth.uid, { title: 'Pengisian Tandon Air Selesai (100%)', subtitle: `Tandon Utama • ${timeLabel}`, tag: 'Penuh', tone: 'blue' });
    } else if (body.customLog && body.customLog.title) {
      addActivityLog(auth.uid, {
        title: String(body.customLog.title).slice(0, 120),
        subtitle: String(body.customLog.subtitle || `Sistem Otomatis • ${timeLabel}`).slice(0, 120),
        tag: String(body.customLog.tag || 'Otomatis').slice(0, 24),
        tone: body.customLog.tone || 'green',
      });
    } else if (body.logAction === 'pump-toggle') {
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
      addActivityLog(auth.uid, { title: 'Lokasi Cuaca Diperbarui', subtitle: `${locationName} • ${timeLabel}`, tag: 'Cuaca', tone: 'blue' });
    } else if (body.logAction === 'threshold-change') {
      addActivityLog(auth.uid, { title: `Batas Kelembapan Diatur (${minMoisture}%–${maxMoisture}%)`, subtitle: `Sensor Tanah • ${timeLabel}`, tag: 'Pengaturan', tone: 'amber' });
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
        auth.uid, computePlotCode(name), name, crop, moisture, 'Baru saja'
      );
      addActivityLog(auth.uid, { title: `Petak Baru Ditambahkan: ${name}`, subtitle: `Tanaman ${crop} • ${timeLabel}`, tag: 'Petak Baru', tone: 'green' });
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
        addActivityLog(auth.uid, { title: pumpOn ? `Menyiram ${name}` : `Penyiraman ${name} Dihentikan`, subtitle: `${crop} • ${timeLabel}`, tag: pumpOn ? 'Aktif' : 'Selesai', tone: pumpOn ? 'green' : 'blue' });
      } else if (body.name || body.crop || body.moisture !== undefined) {
        addActivityLog(auth.uid, { title: `Data ${name} Diperbarui`, subtitle: `${crop} (${moisture}%) • ${timeLabel}`, tag: 'Diperbarui', tone: 'amber' });
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
      addActivityLog(auth.uid, { title: `Petak Dihapus: ${cur.name}`, subtitle: `Manajemen Lahan • ${timeLabel}`, tag: 'Dihapus', tone: 'purple' });
      return sendJson(res, 200, { ok: true, ...getDashboardSnapshot(auth.uid) });
    }
  }

  // API: Schedules CRUD (/api/schedules)
  if (pathname === '/api/schedules' && ['POST', 'PATCH', 'DELETE'].includes(req.method)) {
    const auth = requireAuth(req);
    if (!auth) return sendJson(res, 401, { ok: false, message: 'Sesi tidak valid.' });
    const body = await readRequestBody(req);
    ensureUserDashboardSeeded(auth.uid);
    const timeLabel = formatCurrentTimeWib();

    if (req.method === 'POST') {
      const label = String(body.label || '').trim();
      const plotTarget = String(body.plotTarget || 'Semua Petak').trim() || 'Semua Petak';
      const timeWib = String(body.timeWib || '').trim();
      const durationMin = Math.max(5, Math.min(120, Math.round(Number(body.durationMin || 15))));
      const skipOnRain = body.skipOnRain !== false ? 1 : 0;
      if (!label || !/^\d{2}:\d{2}$/.test(timeWib)) {
        return sendJson(res, 400, { ok: false, message: 'Nama jadwal dan jam penyiraman (HH:MM) wajib diisi.' });
      }
      db.prepare(
        'INSERT INTO schedules (user_id, label, plot_target, time_wib, duration_min, skip_on_rain, enabled) VALUES (?, ?, ?, ?, ?, ?, 1)'
      ).run(auth.uid, label, plotTarget, timeWib, durationMin, skipOnRain);
      addActivityLog(auth.uid, { title: `Jadwal Baru: ${label}`, subtitle: `${plotTarget} • ${timeWib} WIB (${durationMin} mnt)`, tag: 'Terjadwal', tone: 'blue' });
      return sendJson(res, 201, { ok: true, ...getDashboardSnapshot(auth.uid) });
    }

    if (req.method === 'PATCH') {
      const id = Number(body.id);
      const cur = db.prepare('SELECT * FROM schedules WHERE id = ? AND user_id = ?').get(id, auth.uid);
      if (!cur) return sendJson(res, 404, { ok: false, message: 'Jadwal tidak ditemukan.' });
      const enabled = typeof body.enabled === 'boolean' ? (body.enabled ? 1 : 0) : cur.enabled;
      const skipOnRain = typeof body.skipOnRain === 'boolean' ? (body.skipOnRain ? 1 : 0) : cur.skip_on_rain;
      db.prepare('UPDATE schedules SET enabled = ?, skip_on_rain = ? WHERE id = ? AND user_id = ?').run(enabled, skipOnRain, id, auth.uid);
      addActivityLog(auth.uid, { title: `Jadwal ${cur.label} ${enabled ? 'Diaktifkan' : 'Dinonaktifkan'}`, subtitle: `Pukul ${cur.time_wib} WIB • ${timeLabel}`, tag: enabled ? 'Aktif' : 'Nonaktif', tone: enabled ? 'green' : 'purple' });
      return sendJson(res, 200, { ok: true, ...getDashboardSnapshot(auth.uid) });
    }

    if (req.method === 'DELETE') {
      const id = Number(body.id);
      const cur = db.prepare('SELECT label FROM schedules WHERE id = ? AND user_id = ?').get(id, auth.uid);
      if (!cur) return sendJson(res, 404, { ok: false, message: 'Jadwal tidak ditemukan.' });
      db.prepare('DELETE FROM schedules WHERE id = ? AND user_id = ?').run(id, auth.uid);
      addActivityLog(auth.uid, { title: `Jadwal Dihapus: ${cur.label}`, subtitle: `Kontrol Irigasi • ${timeLabel}`, tag: 'Dihapus', tone: 'purple' });
      return sendJson(res, 200, { ok: true, ...getDashboardSnapshot(auth.uid) });
    }
  }

  // API: Admin Users Management (GET, PATCH, DELETE /api/users)
  if (pathname === '/api/users' && ['GET', 'PATCH', 'DELETE'].includes(req.method)) {
    const adminCheck = requireAdmin(req);
    if (!adminCheck.ok) {
      return sendJson(res, adminCheck.status, { ok: false, message: adminCheck.message });
    }

    if (req.method === 'GET') {
      return sendJson(res, 200, { ok: true, ...fetchAdminUsersPayload() });
    }

    try {
      const body = await readRequestBody(req);
      const targetId = Number(body.id);
      if (!Number.isInteger(targetId) || targetId <= 0) {
        return sendJson(res, 400, { ok: false, message: 'ID pengguna tidak valid.' });
      }

      if (req.method === 'PATCH') {
        const target = db
          .prepare('SELECT id, full_name, role, email_verified FROM users WHERE id = ?')
          .get(targetId);
        if (!target) {
          return sendJson(res, 404, { ok: false, message: 'Pengguna tidak ditemukan.' });
        }
        if (target.id === adminCheck.user.id && body.role && body.role !== 'admin') {
          return sendJson(res, 400, {
            ok: false,
            message: 'Anda tidak dapat mencabut hak Admin dari akun Anda sendiri.',
          });
        }

        const nextRole =
          body.role === 'admin' || body.role === 'user' ? body.role : target.role || 'user';
        const nextVerified =
          typeof body.emailVerified === 'boolean'
            ? body.emailVerified
              ? 1
              : 0
            : target.email_verified
              ? 1
              : 0;

        db.prepare('UPDATE users SET role = ?, email_verified = ? WHERE id = ?').run(
          nextRole,
          nextVerified,
          targetId
        );

        return sendJson(res, 200, {
          ok: true,
          message: `Data akun ${target.full_name} berhasil diperbarui.`,
          ...fetchAdminUsersPayload(),
        });
      }

      if (req.method === 'DELETE') {
        if (targetId === adminCheck.user.id) {
          return sendJson(res, 400, {
            ok: false,
            message: 'Anda tidak dapat menghapus akun Anda sendiri.',
          });
        }
        const target = db.prepare('SELECT full_name FROM users WHERE id = ?').get(targetId);
        if (!target) {
          return sendJson(res, 404, { ok: false, message: 'Pengguna tidak ditemukan.' });
        }
        db.prepare('DELETE FROM users WHERE id = ?').run(targetId);

        return sendJson(res, 200, {
          ok: true,
          message: `Akun ${target.full_name} berhasil dihapus.`,
          ...fetchAdminUsersPayload(),
        });
      }
    } catch {
      return sendJson(res, 400, { ok: false, message: 'Gagal memproses data pengguna.' });
    }
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
