import { getDb, requireAuth } from '../../lib/auth.mjs';
import { getDashboardSnapshot } from '../../lib/dashboard.mjs';

export default async (req) => {
  try {
    const auth = requireAuth(req);
    if (!auth) {
      return Response.json(
        { ok: false, message: 'Sesi tidak valid. Silakan masuk terlebih dahulu.' },
        { status: 401 }
      );
    }

    const db = getDb();
    const userRows = await db.sql`
      SELECT id, full_name, email, username, farm_name, email_verified, role
      FROM users
      WHERE id = ${auth.uid}
      LIMIT 1
    `;
    const user = userRows[0];
    if (!user) {
      return Response.json({ ok: false, message: 'Akun tidak ditemukan.' }, { status: 401 });
    }

    const snapshot = await getDashboardSnapshot(db, user.id);

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
      ...snapshot,
    });
  } catch (err) {
    console.error('Dashboard GET error:', err);
    return Response.json(
      { ok: false, message: 'Gagal memuat data dashboard dari database.' },
      { status: 500 }
    );
  }
};

export const config = {
  path: '/api/dashboard',
  method: 'GET',
};
