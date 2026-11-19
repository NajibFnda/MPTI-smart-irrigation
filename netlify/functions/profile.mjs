import { getDb, hashPassword, requireAuth, verifyPassword } from '../../lib/auth.mjs';
import { addActivityLog, formatCurrentTimeWib } from '../../lib/dashboard.mjs';

export default async (req) => {
  try {
    const auth = requireAuth(req);
    if (!auth) {
      return Response.json({ ok: false, message: 'Sesi tidak valid.' }, { status: 401 });
    }

    const body = await req.json();
    const fullName = String(body.fullName || '').trim();
    const farmName = String(body.farmName || '').trim() || 'Pemilik Lahan';
    const currentPassword = String(body.currentPassword || '');
    const newPassword = String(body.newPassword || '');

    if (!fullName) {
      return Response.json({ ok: false, message: 'Nama Lengkap tidak boleh kosong.' }, { status: 400 });
    }

    const db = getDb();
    const rows = await db.sql`
      SELECT id, full_name, email, username, farm_name, password_hash, email_verified, role
      FROM users
      WHERE id = ${auth.uid}
      LIMIT 1
    `;
    const user = rows[0];
    if (!user) {
      return Response.json({ ok: false, message: 'Akun tidak ditemukan.' }, { status: 404 });
    }

    let nextPasswordHash = user.password_hash;
    let passwordChanged = false;

    if (newPassword || currentPassword) {
      if (!currentPassword) {
        return Response.json(
          { ok: false, message: 'Masukkan kata sandi saat ini untuk mengganti sandi.' },
          { status: 400 }
        );
      }
      if (!verifyPassword(currentPassword, user.password_hash)) {
        return Response.json(
          { ok: false, message: 'Kata sandi saat ini tidak sesuai.' },
          { status: 400 }
        );
      }
      if (newPassword.length < 6) {
        return Response.json(
          { ok: false, message: 'Kata sandi baru minimal harus 6 karakter.' },
          { status: 400 }
        );
      }
      nextPasswordHash = hashPassword(newPassword);
      passwordChanged = true;
    }

    await db.sql`
      UPDATE users
      SET full_name = ${fullName},
          farm_name = ${farmName},
          password_hash = ${nextPasswordHash}
      WHERE id = ${auth.uid}
    `;

    await addActivityLog(db, auth.uid, {
      title: passwordChanged ? 'Profil & Kata Sandi Diperbarui' : 'Profil Lahan Diperbarui',
      subtitle: `${fullName} (${farmName}) • ${formatCurrentTimeWib()}`,
      tag: 'Profil',
      tone: 'purple',
    });

    return Response.json({
      ok: true,
      message: passwordChanged
        ? 'Profil dan kata sandi berhasil diperbarui!'
        : 'Profil dan nama kebun berhasil disimpan!',
      user: {
        id: user.id,
        fullName,
        email: user.email || null,
        username: user.username,
        farmName,
        emailVerified: Boolean(user.email_verified),
        role: user.role || 'user',
      },
    });
  } catch (err) {
    console.error('Profile PATCH error:', err);
    return Response.json({ ok: false, message: 'Gagal memperbarui profil.' }, { status: 500 });
  }
};

export const config = {
  path: '/api/profile',
  method: 'PATCH',
};
