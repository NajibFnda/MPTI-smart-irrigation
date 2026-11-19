/**
 * Irigasi Cerdas — Halaman Masuk, Buat Akun, Verifikasi OTP & Reset Kata Sandi
 * Terhubung ke Netlify Functions + PostgreSQL serta server lokal SQLite (server.js).
 */

document.addEventListener('DOMContentLoaded', () => {
  /* =========================================================================
     DOM References
     ========================================================================= */
  const authTabs = document.querySelector('[role="tablist"]');
  const tabLogin = document.getElementById('tab-login');
  const tabRegister = document.getElementById('tab-register');
  const panelLogin = document.getElementById('panel-login');
  const panelRegister = document.getElementById('panel-register');
  const panelVerifyOtp = document.getElementById('panel-verify-otp');
  const panelForgot = document.getElementById('panel-forgot');
  const authHeading = document.getElementById('auth-heading');
  const authSubheading = document.getElementById('auth-subheading');

  const goToRegisterBtn = document.getElementById('go-to-register-btn');
  const goToLoginBtn = document.getElementById('go-to-login-btn');

  const errorBox = document.getElementById('auth-error-box');
  const errorText = document.getElementById('auth-error-text');
  const successBox = document.getElementById('auth-success-box');
  const successText = document.getElementById('auth-success-text');

  // Login elements
  const loginForm = document.getElementById('login-form');
  const usernameInput = document.getElementById('input-username');
  const passwordInput = document.getElementById('input-password');
  const rememberCheckbox = document.getElementById('remember-me');
  const submitLoginBtn = document.getElementById('btn-submit-login');
  const submitLoginLabel = document.getElementById('btn-submit-label');

  // Register elements
  const registerForm = document.getElementById('register-form');
  const regFullnameInput = document.getElementById('reg-fullname');
  const regEmailInput = document.getElementById('reg-email');
  const regUsernameInput = document.getElementById('reg-username');
  const regFarmInput = document.getElementById('reg-farm');
  const regPasswordInput = document.getElementById('reg-password');
  const regConfirmInput = document.getElementById('reg-confirm-password');
  const submitRegisterBtn = document.getElementById('btn-submit-register');
  const submitRegisterLabel = document.getElementById('btn-register-label');

  // OTP Verification elements
  const otpForm = document.getElementById('otp-form');
  const otpTargetEmailEl = document.getElementById('otp-target-email');
  const otpInput = document.getElementById('input-otp');
  const submitOtpBtn = document.getElementById('btn-submit-otp');
  const submitOtpLabel = document.getElementById('btn-otp-label');
  const resendOtpBtn = document.getElementById('btn-resend-otp');
  const otpBackBtn = document.getElementById('btn-otp-back');

  // Forgot Password & Reset elements
  const forgotBtn = document.getElementById('forgot-password-btn');
  const forgotEmailForm = document.getElementById('forgot-email-form');
  const forgotEmailInput = document.getElementById('forgot-email');
  const forgotSendBtn = document.getElementById('btn-forgot-send');
  const forgotSendLabel = document.getElementById('btn-forgot-send-label');
  const resetPasswordForm = document.getElementById('reset-password-form');
  const resetTargetEmailEl = document.getElementById('reset-target-email');
  const resetOtpInput = document.getElementById('reset-otp');
  const resetNewPasswordInput = document.getElementById('reset-new-password');
  const resetConfirmPasswordInput = document.getElementById('reset-confirm-password');
  const resetSaveBtn = document.getElementById('btn-reset-save');
  const resetSaveLabel = document.getElementById('btn-reset-save-label');
  const forgotBackBtn = document.getElementById('btn-forgot-back');

  const REMEMBER_STORAGE_KEY = 'irigasi_cerdas_remembered_user';
  const CURRENT_USER_KEY = 'irigasi_cerdas_current_user';
  const TOKEN_KEY = 'irigasi_cerdas_token';

  let pendingVerificationEmail = '';
  let pendingResetEmail = '';
  let resendTimerId = null;

  /* =========================================================================
     1. Restore "Ingat Saya" username & Check Redirect Query Params
     ========================================================================= */
  try {
    const savedUser = localStorage.getItem(REMEMBER_STORAGE_KEY);
    if (savedUser && usernameInput && rememberCheckbox) {
      usernameInput.value = savedUser;
      rememberCheckbox.checked = true;
    }
  } catch {
    // Ignore storage issues
  }

  /* =========================================================================
     2. UI Mode Switching (Masuk / Buat Akun / Verifikasi OTP / Lupa Sandi)
     ========================================================================= */
  function setFieldErrorState(inputEl, hasError) {
    if (!inputEl) return;
    inputEl.classList.toggle('border-rose-400', hasError);
    inputEl.classList.toggle('bg-rose-50/40', hasError);
    inputEl.classList.toggle('border-slate-200', !hasError);
    inputEl.classList.toggle('bg-[#F8FAFC]', !hasError);
  }

  function clearMessagesAndHighlights() {
    errorBox?.classList.add('hidden');
    successBox?.classList.add('hidden');
    [
      usernameInput,
      passwordInput,
      regFullnameInput,
      regEmailInput,
      regUsernameInput,
      regFarmInput,
      regPasswordInput,
      regConfirmInput,
      otpInput,
      forgotEmailInput,
      resetOtpInput,
      resetNewPasswordInput,
      resetConfirmPasswordInput,
    ].forEach((el) => setFieldErrorState(el, false));
  }

  function showError(message) {
    successBox?.classList.add('hidden');
    if (errorText) errorText.textContent = message;
    errorBox?.classList.remove('hidden');
  }

  function showSuccess(message) {
    errorBox?.classList.add('hidden');
    if (successText) successText.textContent = message;
    successBox?.classList.remove('hidden');
  }

  function switchAuthMode(mode) {
    clearMessagesAndHighlights();
    const isLogin = mode === 'login';
    const isRegister = mode === 'register';
    const isOtp = mode === 'otp';
    const isForgot = mode === 'forgot';

    authTabs?.classList.toggle('hidden', isOtp || isForgot);
    panelLogin?.classList.toggle('hidden', !isLogin);
    panelRegister?.classList.toggle('hidden', !isRegister);
    panelVerifyOtp?.classList.toggle('hidden', !isOtp);
    panelForgot?.classList.toggle('hidden', !isForgot);

    if (isForgot) {
      forgotEmailForm?.classList.remove('hidden');
      resetPasswordForm?.classList.add('hidden');
    }

    if (tabLogin && tabRegister && !isOtp && !isForgot) {
      tabLogin.className = isLogin
        ? 'py-2.5 rounded-xl text-[13.5px] font-bold transition-all bg-white text-agri-700 shadow-sm'
        : 'py-2.5 rounded-xl text-[13.5px] font-semibold text-slate-600 hover:text-slate-900 transition-all';
      tabRegister.className = isRegister
        ? 'py-2.5 rounded-xl text-[13.5px] font-bold transition-all bg-white text-agri-700 shadow-sm'
        : 'py-2.5 rounded-xl text-[13.5px] font-semibold text-slate-600 hover:text-slate-900 transition-all';
      tabLogin.setAttribute('aria-selected', String(isLogin));
      tabRegister.setAttribute('aria-selected', String(isRegister));
    }

    if (authHeading && authSubheading) {
      if (isOtp) {
        authHeading.textContent = 'Verifikasi Email Anda ✉️';
        authSubheading.textContent = 'Masukkan kode OTP 6 digit untuk mengaktifkan akun.';
      } else if (isForgot) {
        authHeading.textContent = 'Reset Kata Sandi 🔑';
        authSubheading.textContent = 'Atur ulang kata sandi menggunakan kode OTP yang dikirim ke email Anda.';
      } else if (isRegister) {
        authHeading.textContent = 'Buat Akun Baru 🌱';
        authSubheading.textContent = 'Daftarkan diri Anda untuk mulai memantau kondisi lahan.';
      } else {
        authHeading.textContent = 'Selamat Datang Kembali! 🌱';
        authSubheading.textContent = 'Silakan masuk untuk memantau kondisi lahan Anda.';
      }
    }
  }

  // Show session notice if redirected from protected dashboard
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('auth') === 'required') {
    showError('Silakan masuk terlebih dahulu untuk membuka Dashboard.');
  } else if (urlParams.get('auth') === 'expired') {
    showError('Sesi Anda telah berakhir. Silakan masuk kembali.');
  }

  function startResendCooldown(seconds = 60) {
    if (!resendOtpBtn) return;
    if (resendTimerId) clearInterval(resendTimerId);

    let remaining = seconds;
    resendOtpBtn.disabled = true;
    resendOtpBtn.textContent = `Kirim Ulang (${remaining} dtk)`;

    resendTimerId = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(resendTimerId);
        resendTimerId = null;
        resendOtpBtn.disabled = false;
        resendOtpBtn.textContent = 'Kirim Ulang Kode OTP';
      } else {
        resendOtpBtn.textContent = `Kirim Ulang (${remaining} dtk)`;
      }
    }, 1000);
  }

  function openOtpStep(email, infoMessage, startCooldown = true) {
    pendingVerificationEmail = email;
    switchAuthMode('otp');
    if (otpTargetEmailEl) otpTargetEmailEl.textContent = email;
    if (otpInput) {
      otpInput.value = '';
      otpInput.focus();
    }
    if (infoMessage) showSuccess(infoMessage);
    if (startCooldown) startResendCooldown(60);
  }

  tabLogin?.addEventListener('click', () => switchAuthMode('login'));
  tabRegister?.addEventListener('click', () => switchAuthMode('register'));
  goToRegisterBtn?.addEventListener('click', () => switchAuthMode('register'));
  goToLoginBtn?.addEventListener('click', () => switchAuthMode('login'));
  otpBackBtn?.addEventListener('click', () => switchAuthMode('register'));
  forgotBtn?.addEventListener('click', () => {
    switchAuthMode('forgot');
    forgotEmailInput?.focus();
  });
  forgotBackBtn?.addEventListener('click', () => switchAuthMode('login'));

  /* =========================================================================
     3. Show / Hide Password Toggle & Numeric OTP Cleanup
     ========================================================================= */
  document.querySelectorAll('[data-toggle-password]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-toggle-password');
      const input = targetId ? document.getElementById(targetId) : null;
      if (!input) return;

      const isHidden = input.type === 'password';
      input.type = isHidden ? 'text' : 'password';

      const eyeOpen = btn.querySelector('[data-eye-open]');
      const eyeClosed = btn.querySelector('[data-eye-closed]');
      eyeOpen?.classList.toggle('hidden', isHidden);
      eyeClosed?.classList.toggle('hidden', !isHidden);

      btn.setAttribute('aria-pressed', String(isHidden));
      btn.setAttribute('aria-label', isHidden ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi');
    });
  });

  [otpInput, resetOtpInput].forEach((el) => {
    el?.addEventListener('input', () => {
      el.value = el.value.replace(/\D/g, '').slice(0, 6);
      errorBox?.classList.add('hidden');
      setFieldErrorState(el, false);
    });
  });

  [
    usernameInput,
    passwordInput,
    regFullnameInput,
    regEmailInput,
    regUsernameInput,
    regFarmInput,
    regPasswordInput,
    regConfirmInput,
    forgotEmailInput,
    resetNewPasswordInput,
    resetConfirmPasswordInput,
  ].forEach((input) => {
    input?.addEventListener('input', () => {
      errorBox?.classList.add('hidden');
      setFieldErrorState(input, false);
    });
  });

  /* =========================================================================
     4. API Helpers
     ========================================================================= */
  async function postJson(url, payload) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error('Server API tidak merespons format JSON.');
    }
    return { status: res.status, data: await res.json() };
  }

  function isValidEmailFormat(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || '').trim());
  }

  /* =========================================================================
     5. Complete Auth & Redirect to Dashboard
     ========================================================================= */
  function completeLoginAndRedirect(user, token, welcomeMessage, rememberUsername) {
    try {
      localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user));
      if (token) {
        localStorage.setItem(TOKEN_KEY, token);
      }
      if (rememberUsername) {
        localStorage.setItem(REMEMBER_STORAGE_KEY, user.email || user.username);
      } else {
        localStorage.removeItem(REMEMBER_STORAGE_KEY);
      }
    } catch {
      // Ignore storage errors
    }

    showSuccess(welcomeMessage);

    if (submitLoginBtn) submitLoginBtn.disabled = true;
    if (submitRegisterBtn) submitRegisterBtn.disabled = true;
    if (submitOtpBtn) submitOtpBtn.disabled = true;
    if (submitLoginLabel) submitLoginLabel.textContent = 'Membuka Dashboard...';
    if (submitOtpLabel) submitOtpLabel.textContent = 'Membuka Dashboard...';

    setTimeout(() => {
      window.location.href = 'index.html';
    }, 650);
  }

  /* =========================================================================
     6. Login Form Submission
     ========================================================================= */
  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const userVal = usernameInput?.value.trim() || '';
    const passVal = passwordInput?.value.trim() || '';

    if (!userVal && !passVal) {
      setFieldErrorState(usernameInput, true);
      setFieldErrorState(passwordInput, true);
      showError('Mohon isi Email/WhatsApp/Username dan Kata Sandi terlebih dahulu.');
      usernameInput?.focus();
      return;
    }

    if (!userVal) {
      setFieldErrorState(usernameInput, true);
      showError('Mohon isi Email, Nomor WhatsApp, atau Username terlebih dahulu.');
      usernameInput?.focus();
      return;
    }

    if (!passVal) {
      setFieldErrorState(passwordInput, true);
      showError('Mohon isi Kata Sandi terlebih dahulu.');
      passwordInput?.focus();
      return;
    }

    if (submitLoginBtn) submitLoginBtn.disabled = true;
    if (submitLoginLabel) submitLoginLabel.textContent = 'Memeriksa Akun...';

    try {
      const { data } = await postJson('/api/login', { username: userVal, password: passVal });
      if (!data.ok) {
        if (submitLoginBtn) submitLoginBtn.disabled = false;
        if (submitLoginLabel) submitLoginLabel.textContent = 'Masuk ke Dashboard';

        if (data.needsVerification && data.email) {
          openOtpStep(data.email, '', false);
          showError(data.message);
          return;
        }

        setFieldErrorState(usernameInput, true);
        setFieldErrorState(passwordInput, true);
        showError(data.message || 'Email/Username atau Kata Sandi salah.');
        return;
      }

      completeLoginAndRedirect(
        data.user,
        data.token,
        `Berhasil masuk sebagai ${data.user.fullName}! Membuka Dashboard...`,
        Boolean(rememberCheckbox?.checked)
      );
    } catch {
      if (submitLoginBtn) submitLoginBtn.disabled = false;
      if (submitLoginLabel) submitLoginLabel.textContent = 'Masuk ke Dashboard';
      showError('Tidak dapat terhubung ke server. Pastikan server aktif atau koneksi internet stabil.');
    }
  });

  /* =========================================================================
     7. Create Account ("Buat Akun") + Send OTP via Brevo
     ========================================================================= */
  registerForm?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const fullName = regFullnameInput?.value.trim() || '';
    const email = regEmailInput?.value.trim().toLowerCase() || '';
    const username = regUsernameInput?.value.trim() || '';
    const farmName = regFarmInput?.value.trim() || '';
    const password = regPasswordInput?.value || '';
    const confirmPassword = regConfirmInput?.value || '';

    if (!fullName) {
      setFieldErrorState(regFullnameInput, true);
      showError('Mohon isi Nama Lengkap Anda terlebih dahulu.');
      regFullnameInput?.focus();
      return;
    }

    if (!email || !isValidEmailFormat(email)) {
      setFieldErrorState(regEmailInput, true);
      showError('Mohon masukkan alamat Email yang valid untuk menerima kode OTP.');
      regEmailInput?.focus();
      return;
    }

    if (!username) {
      setFieldErrorState(regUsernameInput, true);
      showError('Mohon isi Nomor WhatsApp atau Username terlebih dahulu.');
      regUsernameInput?.focus();
      return;
    }

    if (password.length < 6) {
      setFieldErrorState(regPasswordInput, true);
      showError('Kata Sandi minimal harus 6 karakter.');
      regPasswordInput?.focus();
      return;
    }

    if (password !== confirmPassword) {
      setFieldErrorState(regConfirmInput, true);
      showError('Ulangi Kata Sandi tidak cocok. Mohon periksa kembali.');
      regConfirmInput?.focus();
      return;
    }

    if (submitRegisterBtn) submitRegisterBtn.disabled = true;
    if (submitRegisterLabel) submitRegisterLabel.textContent = 'Mengirim Kode OTP...';

    try {
      const { data } = await postJson('/api/register', {
        fullName,
        email,
        username,
        farmName,
        password,
      });

      if (submitRegisterBtn) submitRegisterBtn.disabled = false;
      if (submitRegisterLabel) submitRegisterLabel.textContent = 'Daftar & Kirim Kode OTP';

      if (!data.ok) {
        showError(data.message || 'Gagal mendaftar atau mengirim kode OTP.');
        return;
      }

      openOtpStep(data.email || email, data.message, true);
    } catch {
      if (submitRegisterBtn) submitRegisterBtn.disabled = false;
      if (submitRegisterLabel) submitRegisterLabel.textContent = 'Daftar & Kirim Kode OTP';
      showError('Gagal terhubung ke server pendaftaran. Silakan coba lagi.');
    }
  });

  /* =========================================================================
     8. OTP Verification & Resend
     ========================================================================= */
  otpForm?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const otp = otpInput?.value.trim() || '';
    if (!/^\d{6}$/.test(otp)) {
      setFieldErrorState(otpInput, true);
      showError('Mohon masukkan 6 digit kode OTP angka dari email Anda.');
      otpInput?.focus();
      return;
    }

    if (submitOtpBtn) submitOtpBtn.disabled = true;
    if (submitOtpLabel) submitOtpLabel.textContent = 'Memverifikasi OTP...';

    try {
      const { data } = await postJson('/api/verify-otp', {
        email: pendingVerificationEmail,
        otp,
      });

      if (!data.ok) {
        if (submitOtpBtn) submitOtpBtn.disabled = false;
        if (submitOtpLabel) submitOtpLabel.textContent = 'Verifikasi & Masuk';
        setFieldErrorState(otpInput, true);
        showError(data.message || 'Kode OTP salah atau sudah kedaluwarsa.');
        return;
      }

      completeLoginAndRedirect(
        data.user,
        data.token,
        `Email ${data.user.email} berhasil diverifikasi! Membuka Dashboard...`,
        true
      );
    } catch {
      if (submitOtpBtn) submitOtpBtn.disabled = false;
      if (submitOtpLabel) submitOtpLabel.textContent = 'Verifikasi & Masuk';
      showError('Gagal memverifikasi kode OTP ke server.');
    }
  });

  resendOtpBtn?.addEventListener('click', async () => {
    if (!pendingVerificationEmail || resendOtpBtn.disabled) return;

    resendOtpBtn.disabled = true;
    resendOtpBtn.textContent = 'Mengirim ulang...';

    try {
      const { data } = await postJson('/api/resend-otp', { email: pendingVerificationEmail });
      if (!data.ok) {
        resendOtpBtn.disabled = false;
        resendOtpBtn.textContent = 'Kirim Ulang Kode OTP';
        showError(data.message || 'Gagal mengirim ulang kode OTP.');
        return;
      }
      showSuccess(data.message);
      startResendCooldown(60);
    } catch {
      resendOtpBtn.disabled = false;
      resendOtpBtn.textContent = 'Kirim Ulang Kode OTP';
      showError('Gagal mengirim ulang kode OTP. Silakan coba beberapa saat lagi.');
    }
  });

  /* =========================================================================
     9. Forgot Password & Reset via OTP Email Brevo
     ========================================================================= */
  forgotEmailForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = forgotEmailInput?.value.trim().toLowerCase() || '';

    if (!email || !isValidEmailFormat(email)) {
      setFieldErrorState(forgotEmailInput, true);
      showError('Mohon masukkan alamat email terdaftar yang valid.');
      forgotEmailInput?.focus();
      return;
    }

    if (forgotSendBtn) forgotSendBtn.disabled = true;
    if (forgotSendLabel) forgotSendLabel.textContent = 'Mengirim Kode OTP...';

    try {
      const { data } = await postJson('/api/forgot-password', { email });
      if (forgotSendBtn) forgotSendBtn.disabled = false;
      if (forgotSendLabel) forgotSendLabel.textContent = 'Kirim Kode OTP Reset';

      if (!data.ok) {
        setFieldErrorState(forgotEmailInput, true);
        showError(data.message || 'Gagal mengirim kode OTP reset.');
        return;
      }

      pendingResetEmail = data.email || email;
      if (resetTargetEmailEl) resetTargetEmailEl.textContent = pendingResetEmail;
      forgotEmailForm.classList.add('hidden');
      resetPasswordForm?.classList.remove('hidden');
      if (resetOtpInput) resetOtpInput.value = '';
      if (resetNewPasswordInput) resetNewPasswordInput.value = '';
      if (resetConfirmPasswordInput) resetConfirmPasswordInput.value = '';
      showSuccess(data.message);
      resetOtpInput?.focus();
    } catch {
      if (forgotSendBtn) forgotSendBtn.disabled = false;
      if (forgotSendLabel) forgotSendLabel.textContent = 'Kirim Kode OTP Reset';
      showError('Gagal terhubung ke server reset sandi.');
    }
  });

  resetPasswordForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const otp = resetOtpInput?.value.trim() || '';
    const newPassword = resetNewPasswordInput?.value || '';
    const confirmPassword = resetConfirmPasswordInput?.value || '';

    if (!/^\d{6}$/.test(otp)) {
      setFieldErrorState(resetOtpInput, true);
      showError('Mohon masukkan 6 digit kode OTP angka dari email Anda.');
      resetOtpInput?.focus();
      return;
    }

    if (newPassword.length < 6) {
      setFieldErrorState(resetNewPasswordInput, true);
      showError('Kata sandi baru minimal harus 6 karakter.');
      resetNewPasswordInput?.focus();
      return;
    }

    if (newPassword !== confirmPassword) {
      setFieldErrorState(resetConfirmPasswordInput, true);
      showError('Ulangi Kata Sandi Baru tidak cocok.');
      resetConfirmPasswordInput?.focus();
      return;
    }

    if (resetSaveBtn) resetSaveBtn.disabled = true;
    if (resetSaveLabel) resetSaveLabel.textContent = 'Menyimpan Sandi...';

    try {
      const { data } = await postJson('/api/reset-password', {
        email: pendingResetEmail,
        otp,
        newPassword,
      });

      if (resetSaveBtn) resetSaveBtn.disabled = false;
      if (resetSaveLabel) resetSaveLabel.textContent = 'Simpan Kata Sandi Baru';

      if (!data.ok) {
        setFieldErrorState(resetOtpInput, true);
        showError(data.message || 'Gagal mereset kata sandi.');
        return;
      }

      switchAuthMode('login');
      if (usernameInput) usernameInput.value = pendingResetEmail;
      showSuccess(data.message);
      passwordInput?.focus();
    } catch {
      if (resetSaveBtn) resetSaveBtn.disabled = false;
      if (resetSaveLabel) resetSaveLabel.textContent = 'Simpan Kata Sandi Baru';
      showError('Gagal menghubungi server untuk menyimpan sandi baru.');
    }
  });
});
