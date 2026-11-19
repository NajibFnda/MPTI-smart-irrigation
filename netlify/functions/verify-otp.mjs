import {
  createSessionToken,
  getDb,
  isValidEmail,
  normalizeIdentifier,
  verifyPassword,
} from '../../lib/auth.mjs';

export default async (req) => {
  try {
    const body = await req.json();
    const email = normalizeIdentifier(body.email);
    const otp = String(body.otp || '').trim();

    if (!isValidEmail(email)) {
      return Response.json({ ok: false, message: 'Alamat email tidak valid.' }, { status: 400 });
    }

    if (!/^\d{6}$/.test(otp)) {
      return Response.json(
        { ok: false, message: 'Mohon masukkan 6 digit kode OTP angka yang dikirim ke email Anda.' },
        { status: 400 }
      );
    }

    const db = getDb();
    const rows = await db.sql`
      SELECT id, full_name, email, username, farm_name, email_verified, otp_hash, otp_expires_at, otp_attempts
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

    if (user.email_verified) {
      const token = createSessionToken(user);
      return Response.json(
        {
          ok: true,
          message: 'Email sudah terverifikasi sebelumnya.',
          token,
          user: {
            id: user.id,
            fullName: user.full_name,
            email: user.email,
            username: user.username,
            farmName: user.farm_name,
            emailVerified: true,
          },
        },
        { status: 200 }
      );
    }

    if ((user.otp_attempts || 0) >= 5) {
      return Response.json(
        {
          ok: false,
          message: 'Terlalu banyak percobaan OTP salah. Silakan tekan Kirim Ulang OTP.',
        },
        { status: 429 }
      );
    }

    if (!user.otp_hash || !user.otp_expires_at || new Date(user.otp_expires_at) < new Date()) {
      return Response.json(
        {
          ok: false,
          message: 'Kode OTP sudah kedaluwarsa. Silakan tekan Kirim Ulang OTP.',
        },
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

    await db.sql`
      UPDATE users
      SET email_verified = TRUE,
          otp_hash = NULL,
          otp_expires_at = NULL,
          otp_attempts = 0
      WHERE id = ${user.id}
    `;

    const token = createSessionToken(user);

    return Response.json(
      {
        ok: true,
        message: 'Email berhasil diverifikasi! Membuka Dashboard...',
        token,
        user: {
          id: user.id,
          fullName: user.full_name,
          email: user.email,
          username: user.username,
          farmName: user.farm_name,
          emailVerified: true,
        },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('Verify OTP error:', err);
    return Response.json(
      { ok: false, message: 'Gagal memverifikasi kode OTP.' },
      { status: 500 }
    );
  }
};

export const config = {
  path: '/api/verify-otp',
  method: 'POST',
};
