import { createSessionToken, getDb, normalizeIdentifier, verifyPassword } from '../../lib/auth.mjs';

export default async (req) => {
  try {
    const body = await req.json();
    const identifier = normalizeIdentifier(body.username);
    const password = String(body.password || '');

    if (!identifier || !password) {
      return Response.json(
        {
          ok: false,
          message: 'Mohon isi Email/WhatsApp/Username dan Kata Sandi terlebih dahulu.',
        },
        { status: 400 }
      );
    }

    const db = getDb();

    const rows = await db.sql`
      SELECT id, full_name, email, username, farm_name, password_hash, email_verified
      FROM users
      WHERE LOWER(username) = ${identifier}
         OR (email IS NOT NULL AND LOWER(email) = ${identifier})
         OR (whatsapp IS NOT NULL AND LOWER(whatsapp) = ${identifier})
      LIMIT 1
    `;

    const user = rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) {
      return Response.json(
        { ok: false, message: 'Email/Username atau Kata Sandi salah.' },
        { status: 401 }
      );
    }

    if (user.email && !user.email_verified) {
      return Response.json(
        {
          ok: false,
          needsVerification: true,
          email: user.email,
          message: 'Email Anda belum diverifikasi. Silakan masukkan kode OTP yang dikirim ke email Anda.',
        },
        { status: 403 }
      );
    }

    const token = createSessionToken(user);

    return Response.json(
      {
        ok: true,
        message: 'Berhasil masuk.',
        token,
        user: {
          id: user.id,
          fullName: user.full_name,
          email: user.email || null,
          username: user.username,
          farmName: user.farm_name,
          emailVerified: Boolean(user.email_verified),
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
