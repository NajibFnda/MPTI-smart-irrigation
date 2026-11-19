import {
  generateOtpCode,
  getDb,
  hashPassword,
  isValidEmail,
  normalizeIdentifier,
} from '../../lib/auth.mjs';
import { sendOtpEmail } from '../../lib/brevo.mjs';

export default async (req) => {
  try {
    const body = await req.json();
    const email = normalizeIdentifier(body.email);

    if (!isValidEmail(email)) {
      return Response.json({ ok: false, message: 'Alamat email tidak valid.' }, { status: 400 });
    }

    const db = getDb();
    const rows = await db.sql`
      SELECT id, full_name, email, email_verified
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
      return Response.json(
        { ok: false, message: 'Email ini sudah terverifikasi. Silakan langsung masuk.' },
        { status: 400 }
      );
    }

    const otp = generateOtpCode();
    const otpHash = hashPassword(otp);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const mailResult = await sendOtpEmail({
      toEmail: user.email,
      toName: user.full_name,
      otp,
    });
    if (!mailResult.ok) {
      return Response.json(
        { ok: false, message: mailResult.message },
        { status: mailResult.status === 401 ? 502 : mailResult.status || 502 }
      );
    }

    await db.sql`
      UPDATE users
      SET otp_hash = ${otpHash},
          otp_expires_at = ${expiresAt},
          otp_attempts = 0
      WHERE id = ${user.id}
    `;

    return Response.json(
      {
        ok: true,
        message: `Kode OTP baru telah dikirim ke ${user.email}.`,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('Resend OTP error:', err);
    return Response.json(
      { ok: false, message: 'Gagal mengirim ulang kode OTP.' },
      { status: 500 }
    );
  }
};

export const config = {
  path: '/api/resend-otp',
  method: 'POST',
};
