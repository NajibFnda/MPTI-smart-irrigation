import { getDb, requireAdmin } from '../../lib/auth.mjs';

async function fetchAdminUsersPayload(db) {
  const rows = await db.sql`
    SELECT
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
      (SELECT COUNT(*)::int FROM plots p WHERE p.user_id = u.id) AS plot_count,
      (SELECT COUNT(*)::int FROM activity_logs a WHERE a.user_id = u.id) AS activity_count
    FROM users u
    LEFT JOIN user_settings us ON us.user_id = u.id
    ORDER BY u.id DESC
  `;

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

export default async (req) => {
  try {
    const db = getDb();
    const adminCheck = await requireAdmin(req, db);
    if (!adminCheck.ok) {
      return Response.json(
        { ok: false, message: adminCheck.message },
        { status: adminCheck.status }
      );
    }

    const method = req.method.toUpperCase();

    if (method === 'GET') {
      const payload = await fetchAdminUsersPayload(db);
      return Response.json({ ok: true, ...payload }, { status: 200 });
    }

    const body = await req.json();
    const targetId = Number(body.id);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return Response.json({ ok: false, message: 'ID pengguna tidak valid.' }, { status: 400 });
    }

    if (method === 'PATCH') {
      const existing = await db.sql`
        SELECT id, full_name, role, email_verified
        FROM users
        WHERE id = ${targetId}
        LIMIT 1
      `;
      const target = existing[0];
      if (!target) {
        return Response.json({ ok: false, message: 'Pengguna tidak ditemukan.' }, { status: 404 });
      }

      if (target.id === adminCheck.user.id && body.role && body.role !== 'admin') {
        return Response.json(
          { ok: false, message: 'Anda tidak dapat mencabut hak Admin dari akun Anda sendiri.' },
          { status: 400 }
        );
      }

      const nextRole =
        body.role === 'admin' || body.role === 'user' ? body.role : target.role || 'user';
      const nextVerified =
        typeof body.emailVerified === 'boolean'
          ? body.emailVerified
          : Boolean(target.email_verified);

      await db.sql`
        UPDATE users
        SET role = ${nextRole},
            email_verified = ${nextVerified}
        WHERE id = ${targetId}
      `;

      const payload = await fetchAdminUsersPayload(db);
      return Response.json(
        { ok: true, message: `Data akun ${target.full_name} berhasil diperbarui.`, ...payload },
        { status: 200 }
      );
    }

    if (method === 'DELETE') {
      if (targetId === adminCheck.user.id) {
        return Response.json(
          { ok: false, message: 'Anda tidak dapat menghapus akun Anda sendiri.' },
          { status: 400 }
        );
      }

      const deleted = await db.sql`
        DELETE FROM users
        WHERE id = ${targetId}
        RETURNING full_name
      `;
      if (deleted.length === 0) {
        return Response.json({ ok: false, message: 'Pengguna tidak ditemukan.' }, { status: 404 });
      }

      const payload = await fetchAdminUsersPayload(db);
      return Response.json(
        { ok: true, message: `Akun ${deleted[0].full_name} berhasil dihapus.`, ...payload },
        { status: 200 }
      );
    }

    return Response.json({ ok: false, message: 'Method tidak didukung.' }, { status: 405 });
  } catch (err) {
    console.error('Admin users error:', err);
    return Response.json(
      { ok: false, message: 'Gagal memproses data pengguna.' },
      { status: 500 }
    );
  }
};

export const config = {
  path: '/api/users',
  method: ['GET', 'PATCH', 'DELETE'],
};
