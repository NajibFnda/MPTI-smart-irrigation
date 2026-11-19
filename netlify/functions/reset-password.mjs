import {
  getDb,
  hashPassword,
  isValidEmail,
  normalizeIdentifier,
  verifyPassword,
} from '../../lib/auth.mjs';

export default async (req) => {
  try {
    const body = await req.json();
    const email = normalizeIdentifier(body.email);
    const otp = String(body.otp || '').trim();
    const newPassword = String(body.newPassword || '');

    if (!isValidEmail(email)) {
      return Response.json({ ok: false, message: 'Alamat email tidak valid.' }, { status: 400 });
    }

    if (!/^\d{6}$/.test(otp)) {
      return Response.json(
        { ok: false, message: 'Mohon masukkan 6 digit kode OTP angka dari email Anda.' },
        { status: 400 }
      );
    }

    if (newPassword.length < 6) {
      return Response.json(
        { ok: false, message: 'Kata sandi baru minimal harus 6 karakter.' },
        { status: 400 }
      );
    }

    const db = getDb();
    const rows = await db.sql`
      SELECT id, otp_hash, otp_expires_at, otp_attempts
      FROM users
      WHERE LOWER(email) = ${email}
      LIMIT 1
    `;
    const user = rows[0];

    if (!user) {
      return Response.json(
        { ok: false, message: 'Akun dengan email tersebut tidak ditemukan.' },
        { status: 404 }
      );
    }

    if ((user.otp_attempts || 0) >= 5) {
      return Response.json(
        {
          ok: false,
          message: 'Terlalu banyak percobaan OTP salah. Silakan minta kode OTP baru.',
        },
        { status: 429 }
      );
    }

    if (!user.otp_hash || !user.otp_expires_at || new Date(user.otp_expires_at) < new Date()) {
      return Response.json(
        { ok: false, message: 'Kode OTP sudah kedaluwarsa. Silakan minta kode OTP baru.' },
        { status: 400 }
      );
    }

    if (!verifyPassword(otp, user.otp_hash)) {
      await db.sql`
        UPDATE users
        SET otp_attempts = COALESCE(otp_attempts, 0) + 1
        WHERE id = ${user.id}
      `;
      return Response.json(
        { ok: false, message: 'Kode OTP salah. Silakan periksa kembali email Anda.' },
        { status: 400 }
      );
    }

    const newHash = hashPassword(newPassword);
    await db.sql`
      UPDATE users
      SET password_hash = ${newHash},
          email_verified = TRUE,
          otp_hash = NULL,
          otp_expires_at = NULL,
          otp_attempts = 0
      WHERE id = ${user.id}
    `;

    return Response.json({
      ok: true,
      message: 'Kata sandi baru berhasil disimpan! Silakan masuk dengan kata sandi baru.',
    });
  } catch (err) {
    console.error('Reset password error:', err);
    return Response.json(
      { ok: false, message: 'Gagal menyimpan kata sandi baru.' },
      { status: 500 }
    );
  }
};

export const config = {
  path: '/api/reset-password',
  method: 'POST',
};
