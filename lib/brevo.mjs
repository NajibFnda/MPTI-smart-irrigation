/**
 * Brevo Transactional Email Helper for OTP Verification & Password Reset
 */

import { readEnv } from './auth.mjs';

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function sendOtpEmail({ toEmail, toName, otp, purpose = 'register' }) {
  const apiKey = readEnv('BREVO_API_KEY');
  const senderEmail = readEnv('BREVO_SENDER_EMAIL') || 'fnaandd44@gmail.com';
  const senderName = readEnv('BREVO_SENDER_NAME') || 'Irigasi Cerdas';

  if (!apiKey) {
    return {
      ok: false,
      status: 500,
      message: 'Konfigurasi BREVO_API_KEY belum tersedia di server.',
    };
  }

  const safeName = escapeHtml(toName || 'Pengguna');
  const safeOtp = escapeHtml(otp);
  const isReset = purpose === 'reset';

  const subject = isReset
    ? `Kode OTP Reset Kata Sandi Irigasi Cerdas: ${otp}`
    : `Kode OTP Verifikasi Akun Irigasi Cerdas: ${otp}`;
  const heading = isReset ? 'Reset Kata Sandi Akun Anda' : 'Verifikasi Email Akun Anda';
  const intro = isReset
    ? 'Kami menerima permintaan untuk mengatur ulang kata sandi akun Irigasi Cerdas Anda. Masukkan kode OTP berikut:'
    : 'Gunakan kode OTP berikut untuk memverifikasi alamat email akun Irigasi Cerdas Anda:';

  const htmlContent = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; background-color: #F8FAFC; padding: 28px 16px; color: #0F172A;">
      <div style="max-width: 480px; margin: 0 auto; background-color: #FFFFFF; border-radius: 20px; border: 1px solid #E2E8F0; padding: 28px;">
        <div style="display: inline-block; background-color: #EFF8F1; color: #15803D; font-weight: 700; font-size: 13px; padding: 6px 12px; border-radius: 999px; margin-bottom: 16px;">
          Irigasi Cerdas
        </div>
        <h2 style="margin: 0 0 8px; font-size: 20px; color: #0F172A;">${heading}</h2>
        <p style="margin: 0 0 18px; font-size: 14px; line-height: 1.6; color: #475569;">
          Halo <strong>${safeName}</strong>, ${intro}
        </p>
        <div style="background-color: #EFF8F1; border: 1px solid #BBF7D0; border-radius: 14px; padding: 18px; text-align: center; margin-bottom: 18px;">
          <span style="font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #15803D; font-family: monospace;">${safeOtp}</span>
        </div>
        <p style="margin: 0; font-size: 12.5px; line-height: 1.5; color: #64748B;">
          Kode OTP ini berlaku selama <strong>10 menit</strong>. Demi keamanan, jangan bagikan kode ini kepada siapa pun.
        </p>
      </div>
    </div>
  `;

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify({
        sender: { name: senderName, email: senderEmail },
        to: [{ email: toEmail, name: toName || toEmail }],
        subject,
        htmlContent,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      let friendlyMessage = data.message || `Gagal mengirim email OTP melalui Brevo (HTTP ${response.status}).`;
      if (response.status === 401 && String(data.message || '').toLowerCase().includes('authorised_ips')) {
        friendlyMessage =
          'Brevo menolak pengiriman karena pembatasan IP (Authorised IPs) aktif. Nonaktifkan Authorised IPs di https://app.brevo.com/security/authorised_ips agar server bisa mengirim OTP.';
      } else if (
        response.status === 400 &&
        String(data.message || '').toLowerCase().includes('sender')
      ) {
        friendlyMessage = `Email pengirim Brevo (${senderEmail}) belum terverifikasi. Pastikan sender terverifikasi di Brevo dan atur BREVO_SENDER_EMAIL.`;
      }
      return { ok: false, status: response.status, message: friendlyMessage };
    }

    return { ok: true, messageId: data.messageId || null };
  } catch (err) {
    return {
      ok: false,
      status: 502,
      message: `Tidak dapat menghubungi layanan email Brevo: ${err.message}`,
    };
  }
}
