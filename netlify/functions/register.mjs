import { getDb, hashPassword, normalizeIdentifier } from '../../lib/auth.mjs';

export default async (req) => {
  try {
    const body = await req.json();
    const fullName = String(body.fullName || '').trim();
    const rawUsername = String(body.username || '').trim();
    const username = normalizeIdentifier(rawUsername);
    const farmName = String(body.farmName || '').trim() || 'Pemilik Lahan';
    const password = String(body.password || '');

    if (!fullName || !username || !password) {
      return Response.json(
        {
          ok: false,
          message: 'Mohon lengkapi Nama Lengkap, Nomor WhatsApp/Username, dan Kata Sandi.',
        },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return Response.json(
        { ok: false, message: 'Kata Sandi minimal harus 6 karakter.' },
        { status: 400 }
      );
    }

    const db = getDb();

    const existing = await db.sql`
      SELECT id FROM users
      WHERE LOWER(username) = ${username}
         OR (whatsapp IS NOT NULL AND LOWER(whatsapp) = ${username})
      LIMIT 1
    `;

    if (existing.length > 0) {
      return Response.json(
        {
          ok: false,
          message: 'Nomor WhatsApp atau Username sudah terdaftar. Silakan masuk.',
        },
        { status: 409 }
      );
    }

    const isPhone = /^[0-9+\-\s]{8,16}$/.test(rawUsername);
    const whatsappVal = isPhone ? username : null;
    const passwordHash = hashPassword(password);

    const inserted = await db.sql`
      INSERT INTO users (full_name, username, whatsapp, farm_name, password_hash)
      VALUES (${fullName}, ${username}, ${whatsappVal}, ${farmName}, ${passwordHash})
      RETURNING id, full_name, username, farm_name
    `;

    const created = inserted[0];
    return Response.json(
      {
        ok: true,
        message: 'Akun berhasil dibuat dan disimpan ke database Netlify.',
        user: {
          id: created.id,
          fullName: created.full_name,
          username: created.username,
          farmName: created.farm_name,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    console.error('Register error:', err);
    return Response.json(
      { ok: false, message: 'Gagal mendaftarkan akun ke database.' },
      { status: 500 }
    );
  }
};

export const config = {
  path: '/api/register',
  method: 'POST',
};
