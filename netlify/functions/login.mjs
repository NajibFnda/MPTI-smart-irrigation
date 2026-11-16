import { getDb, normalizeIdentifier, verifyPassword } from '../../lib/auth.mjs';

export default async (req) => {
  try {
    const body = await req.json();
    const identifier = normalizeIdentifier(body.username);
    const password = String(body.password || '');

    if (!identifier || !password) {
      return Response.json(
        {
          ok: false,
          message: 'Mohon isi Nomor WhatsApp/Username dan Kata Sandi terlebih dahulu.',
        },
        { status: 400 }
      );
    }

    const db = getDb();

    const rows = await db.sql`
      SELECT id, full_name, username, farm_name, password_hash
      FROM users
      WHERE LOWER(username) = ${identifier}
         OR (whatsapp IS NOT NULL AND LOWER(whatsapp) = ${identifier})
      LIMIT 1
    `;

    const user = rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) {
      return Response.json(
        { ok: false, message: 'Nomor WhatsApp/Username atau Kata Sandi salah.' },
        { status: 401 }
      );
    }

    return Response.json(
      {
        ok: true,
        message: 'Berhasil masuk.',
        user: {
          id: user.id,
          fullName: user.full_name,
          username: user.username,
          farmName: user.farm_name,
        },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('Login error:', err);
    return Response.json(
      { ok: false, message: 'Gagal memeriksa akun di database.' },
      { status: 500 }
    );
  }
};

export const config = {
  path: '/api/login',
  method: 'POST',
};
