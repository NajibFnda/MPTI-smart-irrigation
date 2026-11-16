/**
 * Irigasi Cerdas — Backend Server & Database SQLite (Zero External Dependencies)
 * Menjalankan static file server dan API autentikasi (/api/register, /api/login)
 * menggunakan modul bawaan Node.js (node:http, node:sqlite, node:crypto).
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

// Ensure database directory exists
fs.mkdirSync(DB_DIR, { recursive: true });

// Initialize SQLite database
const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE,
    whatsapp TEXT,
    farm_name TEXT NOT NULL DEFAULT 'Pemilik Lahan',
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
`);

/**
 * Hash password using Node crypto.scryptSync with random 16-byte salt.
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

/**
 * Verify password against stored `${salt}:${hash}` using timingSafeEqual.
 */
function verifyPassword(password, storedHash) {
  const parts = String(storedHash).split(':');
  if (parts.length !== 2) return false;
  const [salt, originalHex] = parts;
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  const originalBuf = Buffer.from(originalHex, 'hex');
  if (derivedBuf.length !== originalBuf.length) return false;
  return crypto.timingSafeEqual(derivedBuf, originalBuf);
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

function normalizeIdentifier(value) {
  return String(value || '').trim().toLowerCase();
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = reqUrl.pathname;

  // API: Register New Account
  if (req.method === 'POST' && pathname === '/api/register') {
    try {
      const body = await readRequestBody(req);
      const fullName = String(body.fullName || '').trim();
      const rawUsername = String(body.username || '').trim();
      const username = normalizeIdentifier(rawUsername);
      const farmName = String(body.farmName || '').trim() || 'Pemilik Lahan';
      const password = String(body.password || '');

      if (!fullName || !username || !password) {
        return sendJson(res, 400, {
          ok: false,
          message: 'Mohon lengkapi Nama Lengkap, Nomor WhatsApp/Username, dan Kata Sandi.',
        });
      }

      if (password.length < 6) {
        return sendJson(res, 400, {
          ok: false,
          message: 'Kata Sandi minimal harus 6 karakter.',
        });
      }

      // Check duplicate username or WhatsApp number
      const duplicate = db
        .prepare('SELECT id FROM users WHERE LOWER(username) = ? OR (whatsapp IS NOT NULL AND LOWER(whatsapp) = ?)')
        .get(username, username);

      if (duplicate) {
        return sendJson(res, 409, {
          ok: false,
          message: 'Nomor WhatsApp atau Username sudah terdaftar. Silakan masuk.',
        });
      }

      const isPhone = /^[0-9+\-\s]{8,16}$/.test(rawUsername);
      const whatsappVal = isPhone ? username : null;
      const passwordHash = hashPassword(password);

      const result = db
        .prepare(
          'INSERT INTO users (full_name, username, whatsapp, farm_name, password_hash) VALUES (?, ?, ?, ?, ?)'
        )
        .run(fullName, username, whatsappVal, farmName, passwordHash);

      return sendJson(res, 201, {
        ok: true,
        message: 'Akun berhasil dibuat dan disimpan ke database.',
        user: {
          id: Number(result.lastInsertRowid),
          fullName,
          username,
          farmName,
        },
      });
    } catch (err) {
      return sendJson(res, 400, {
        ok: false,
        message: err.message === 'Invalid JSON' ? 'Format data tidak valid.' : 'Gagal mendaftarkan akun.',
      });
    }
  }

  // API: Login
  if (req.method === 'POST' && pathname === '/api/login') {
    try {
      const body = await readRequestBody(req);
      const identifier = normalizeIdentifier(body.username);
      const password = String(body.password || '');

      if (!identifier || !password) {
        return sendJson(res, 400, {
          ok: false,
          message: 'Mohon isi Nomor WhatsApp/Username dan Kata Sandi terlebih dahulu.',
        });
      }

      const user = db
        .prepare(
          'SELECT id, full_name, username, farm_name, password_hash FROM users WHERE LOWER(username) = ? OR (whatsapp IS NOT NULL AND LOWER(whatsapp) = ?)'
        )
        .get(identifier, identifier);

      if (!user || !verifyPassword(password, user.password_hash)) {
        return sendJson(res, 401, {
          ok: false,
          message: 'Nomor WhatsApp/Username atau Kata Sandi salah.',
        });
      }

      return sendJson(res, 200, {
        ok: true,
        message: 'Berhasil masuk.',
        user: {
          id: user.id,
          fullName: user.full_name,
          username: user.username,
          farmName: user.farm_name,
        },
      });
    } catch {
      return sendJson(res, 400, {
        ok: false,
        message: 'Permintaan masuk tidak valid.',
      });
    }
  }

  // API: List registered user accounts (safe fields only, for verification)
  if (req.method === 'GET' && pathname === '/api/users') {
    const users = db
      .prepare('SELECT id, full_name, username, whatsapp, farm_name, created_at FROM users ORDER BY id ASC')
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

  // Prevent directory traversal and block access to database folder or server source
  if (
    !resolvedPath.startsWith(ROOT_DIR + path.sep) ||
    resolvedPath.startsWith(DB_DIR) ||
    resolvedPath === path.join(ROOT_DIR, 'server.js')
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
