import { getDb } from '../../lib/auth.mjs';

export default async () => {
  try {
    const db = getDb();

    const users = await db.sql`
      SELECT id, full_name, username, whatsapp, farm_name, created_at
      FROM users
      ORDER BY id ASC
    `;

    return Response.json({ ok: true, users }, { status: 200 });
  } catch (err) {
    console.error('Users list error:', err);
    return Response.json(
      { ok: false, message: 'Gagal mengambil daftar akun.' },
      { status: 500 }
    );
  }
};

export const config = {
  path: '/api/users',
  method: 'GET',
};
