import { getDb, requireAuth } from '../../lib/auth.mjs';

export default async (req) => {
  try {
    const auth = requireAuth(req);
    if (!auth) {
      return Response.json(
        { ok: false, message: 'Sesi tidak valid atau telah berakhir. Silakan masuk kembali.' },
        { status: 401 }
      );
    }

    const db = getDb();
    const rows = await db.sql`
      SELECT id, full_name, email, username, farm_name, email_verified, role
      FROM users
      WHERE id = ${auth.uid}
      LIMIT 1
    `;
    const user = rows[0];
    if (!user) {
      return Response.json({ ok: false, message: 'Akun tidak ditemukan.' }, { status: 401 });
    }

    return Response.json({
      ok: true,
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email || null,
        username: user.username,
        farmName: user.farm_name,
        emailVerified: Boolean(user.email_verified),
        role: user.role || 'user',
      },
    });
  } catch (err) {
    console.error('Me error:', err);
    return Response.json({ ok: false, message: 'Gagal memeriksa sesi.' }, { status: 500 });
  }
};

export const config = {
  path: '/api/me',
  method: 'GET',
};
