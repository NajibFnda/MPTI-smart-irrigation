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
    const fullName = String(body.fullName || '').trim();
    const email = normalizeIdentifier(body.email);
    const rawUsername = String(body.username || '').trim();
    const username = normalizeIdentifier(rawUsername);
    const farmName = String(body.farmName || '').trim() || 'Pemilik Lahan';
    const password = String(body.password || '');

    if (!fullName || !email || !username || !password) {
      return Response.json(
        {
          ok: false,
          message: 'Mohon lengkapi Nama Lengkap, Email, Nomor WhatsApp/Username, dan Kata Sandi.',
        },
        { status: 400 }
      );
    }

    if (!isValidEmail(email)) {
      return Response.json(
        { ok: false, message: 'Format alamat email tidak valid.' },
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

    const emailRows = await db.sql`
      SELECT id, email_verified
      FROM users
      WHERE LOWER(email) = ${email}
      LIMIT 1
    `;
    const existingByEmail = emailRows[0];

    if (existingByEmail && existingByEmail.email_verified) {
      return Response.json(
        {
          ok: false,
          message: 'Email sudah terdaftar dan terverifikasi. Silakan masuk.',
        },
        { status: 409 }
      );
    }

    const excludeId = existingByEmail ? existingByEmail.id : -1;
    const usernameConflict = await db.sql`
      SELECT id FROM users
      WHERE id <> ${excludeId}
        AND (LOWER(username) = ${username} OR (whatsapp IS NOT NULL AND LOWER(whatsapp) = ${username}))
      LIMIT 1
    `;

    if (usernameConflict.length > 0) {
      return Response.json(
        {
          ok: false,
          message: 'Nomor WhatsApp atau Username sudah terdaftar. Silakan gunakan yang lain.',
        },
        { status: 409 }
      );
    }

    const otp = generateOtpCode();
    const otpHash = hashPassword(otp);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const mailResult = await sendOtpEmail({ toEmail: email, toName: fullName, otp });
    if (!mailResult.ok) {
      return Response.json(
        { ok: false, message: mailResult.message },
        { status: mailResult.status === 401 ? 502 : mailResult.status || 502 }
      );
    }

    const isPhone = /^[0-9+\-\s]{8,16}$/.test(rawUsername);
    const whatsappVal = isPhone ? username : null;
    const passwordHash = hashPassword(password);

    if (existingByEmail) {
      await db.sql`
        UPDATE users
        SET full_name = ${fullName},
            username = ${username},
            whatsapp = ${whatsappVal},
            farm_name = ${farmName},
            password_hash = ${passwordHash},
            email_verified = FALSE,
            otp_hash = ${otpHash},
            otp_expires_at = ${expiresAt},
            otp_attempts = 0
        WHERE id = ${existingByEmail.id}
      `;
    } else {
      await db.sql`
        INSERT INTO users (
          full_name, email, username, whatsapp, farm_name, password_hash,
          email_verified, otp_hash, otp_expires_at, otp_attempts
        )
        VALUES (
          ${fullName}, ${email}, ${username}, ${whatsappVal}, ${farmName}, ${passwordHash},
          FALSE, ${otpHash}, ${expiresAt}, 0
        )
      `;
    }

    return Response.json(
      {
        ok: true,
        needsVerification: true,
        email,
        message: `Kode OTP 6 digit telah dikirim ke ${email}. Silakan cek kotak masuk atau folder spam.`,
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
