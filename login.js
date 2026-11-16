/**
 * Irigasi Cerdas — Halaman Masuk & Buat Akun
 * Mendukung autentikasi & pendaftaran akun ke database SQLite (/api/register, /api/login)
 * dengan fallback otomatis ke IndexedDB browser apabila dibuka tanpa server backend.
 */

document.addEventListener('DOMContentLoaded', () => {
  /* =========================================================================
     DOM References
     ========================================================================= */
  const tabLogin = document.getElementById('tab-login');
  const tabRegister = document.getElementById('tab-register');
  const panelLogin = document.getElementById('panel-login');
  const panelRegister = document.getElementById('panel-register');
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
  const regUsernameInput = document.getElementById('reg-username');
  const regFarmInput = document.getElementById('reg-farm');
  const regPasswordInput = document.getElementById('reg-password');
  const regConfirmInput = document.getElementById('reg-confirm-password');
  const submitRegisterBtn = document.getElementById('btn-submit-register');
  const submitRegisterLabel = document.getElementById('btn-register-label');

  // Forgot password modal elements
  const forgotBtn = document.getElementById('forgot-password-btn');
  const forgotModal = document.getElementById('forgot-modal');
  const forgotCloseX = document.getElementById('forgot-modal-close-x');
  const forgotOkBtn = document.getElementById('forgot-modal-ok');

  const REMEMBER_STORAGE_KEY = 'irigasi_cerdas_remembered_user';
  const CURRENT_USER_KEY = 'irigasi_cerdas_current_user';

  /* =========================================================================
     1. Restore "Ingat Saya" username
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
     2. UI Mode Switching (Masuk vs Buat Akun)
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
      regUsernameInput,
      regFarmInput,
      regPasswordInput,
      regConfirmInput,
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
    const isRegister = mode === 'register';
    clearMessagesAndHighlights();

    panelLogin?.classList.toggle('hidden', isRegister);
    panelRegister?.classList.toggle('hidden', !isRegister);

    if (tabLogin && tabRegister) {
      tabLogin.className = !isRegister
        ? 'py-2.5 rounded-xl text-[13.5px] font-bold transition-all bg-white text-agri-700 shadow-sm'
        : 'py-2.5 rounded-xl text-[13.5px] font-semibold text-slate-600 hover:text-slate-900 transition-all';
      tabRegister.className = isRegister
        ? 'py-2.5 rounded-xl text-[13.5px] font-bold transition-all bg-white text-agri-700 shadow-sm'
        : 'py-2.5 rounded-xl text-[13.5px] font-semibold text-slate-600 hover:text-slate-900 transition-all';
      tabLogin.setAttribute('aria-selected', String(!isRegister));
      tabRegister.setAttribute('aria-selected', String(isRegister));
    }

    if (authHeading && authSubheading) {
      if (isRegister) {
        authHeading.textContent = 'Buat Akun Baru 🌱';
        authSubheading.textContent = 'Daftarkan diri Anda untuk mulai memantau kondisi lahan.';
      } else {
        authHeading.textContent = 'Selamat Datang Kembali! 🌱';
        authSubheading.textContent = 'Silakan masuk untuk memantau kondisi lahan Anda.';
      }
    }
  }

  tabLogin?.addEventListener('click', () => switchAuthMode('login'));
  tabRegister?.addEventListener('click', () => switchAuthMode('register'));
  goToRegisterBtn?.addEventListener('click', () => switchAuthMode('register'));
  goToLoginBtn?.addEventListener('click', () => switchAuthMode('login'));

  /* =========================================================================
     3. Show / Hide Password Toggle (Shared across Login & Register)
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

  // Clear error highlight while typing
  [
    usernameInput,
    passwordInput,
    regFullnameInput,
    regUsernameInput,
    regFarmInput,
    regPasswordInput,
    regConfirmInput,
  ].forEach((input) => {
    input?.addEventListener('input', () => {
      errorBox?.classList.add('hidden');
      setFieldErrorState(input, false);
    });
  });

  /* =========================================================================
     4. Database Layer (Backend SQLite API + IndexedDB Fallback)
     ========================================================================= */
  async function sha256Hex(text) {
    if (window.crypto?.subtle) {
      const data = new TextEncoder().encode(text);
      const digest = await window.crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
    return btoa(unescape(encodeURIComponent(text)));
  }

  function openFallbackDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('IrigasiCerdasDB', 1);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('users')) {
          const store = db.createObjectStore('users', { keyPath: 'username' });
          store.createIndex('whatsapp', 'whatsapp', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function fallbackRegister(payload) {
    const db = await openFallbackDb();
    const identifier = payload.username.trim().toLowerCase();

    const allUsers = await new Promise((resolve, reject) => {
      const tx = db.transaction('users', 'readonly');
      const req = tx.objectStore('users').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });

    const duplicate = allUsers.find(
      (u) => u.username === identifier || (u.whatsapp && u.whatsapp === identifier)
    );
    if (duplicate) {
      return {
        ok: false,
        message: 'Nomor WhatsApp atau Username sudah terdaftar. Silakan masuk.',
      };
    }

    const isPhone = /^[0-9+\-\s]{8,16}$/.test(payload.username.trim());
    const passwordHash = await sha256Hex(payload.password);
    const userRecord = {
      fullName: payload.fullName.trim(),
      username: identifier,
      whatsapp: isPhone ? identifier : null,
      farmName: payload.farmName.trim() || 'Pemilik Lahan',
      passwordHash,
      createdAt: new Date().toISOString(),
    };

    await new Promise((resolve, reject) => {
      const tx = db.transaction('users', 'readwrite');
      tx.objectStore('users').add(userRecord);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    return {
      ok: true,
      message: 'Akun berhasil dibuat dan disimpan ke database lokal.',
      user: {
        fullName: userRecord.fullName,
        username: userRecord.username,
        farmName: userRecord.farmName,
      },
    };
  }

  async function fallbackLogin(username, password) {
    const db = await openFallbackDb();
    const identifier = username.trim().toLowerCase();

    const allUsers = await new Promise((resolve, reject) => {
      const tx = db.transaction('users', 'readonly');
      const req = tx.objectStore('users').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });

    const matched = allUsers.find(
      (u) => u.username === identifier || (u.whatsapp && u.whatsapp === identifier)
    );
    const passwordHash = await sha256Hex(password);

    if (!matched || matched.passwordHash !== passwordHash) {
      return { ok: false, message: 'Nomor WhatsApp/Username atau Kata Sandi salah.' };
    }

    return {
      ok: true,
      message: 'Berhasil masuk.',
      user: {
        fullName: matched.fullName,
        username: matched.username,
        farmName: matched.farmName,
      },
    };
  }

  async function apiRegister(payload) {
    if (window.location.protocol !== 'file:') {
      try {
        const res = await fetch('/api/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          return await res.json();
        }
      } catch {
        // Backend unreachable; fall through to IndexedDB
      }
    }
    return fallbackRegister(payload);
  }

  async function apiLogin(username, password) {
    if (window.location.protocol !== 'file:') {
      try {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          return await res.json();
        }
      } catch {
        // Backend unreachable; fall through to IndexedDB
      }
    }
    return fallbackLogin(username, password);
  }

  /* =========================================================================
     5. Complete Auth & Redirect to Dashboard
     ========================================================================= */
  function completeLoginAndRedirect(user, welcomeMessage, rememberUsername) {
    try {
      localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user));
      if (rememberUsername) {
        localStorage.setItem(REMEMBER_STORAGE_KEY, user.username);
      } else {
        localStorage.removeItem(REMEMBER_STORAGE_KEY);
      }
    } catch {
      // Ignore storage errors
    }

    showSuccess(welcomeMessage);

    if (submitLoginBtn) submitLoginBtn.disabled = true;
    if (submitRegisterBtn) submitRegisterBtn.disabled = true;
    if (submitLoginLabel) submitLoginLabel.textContent = 'Membuka Dashboard...';
    if (submitRegisterLabel) submitRegisterLabel.textContent = 'Menyimpan Akun...';

    setTimeout(() => {
      window.location.href = 'index.html';
    }, 750);
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
      showError('Mohon isi Nomor WhatsApp/Username dan Kata Sandi terlebih dahulu.');
      usernameInput?.focus();
      return;
    }

    if (!userVal) {
      setFieldErrorState(usernameInput, true);
      setFieldErrorState(passwordInput, false);
      showError('Mohon isi Nomor WhatsApp atau Username terlebih dahulu.');
      usernameInput?.focus();
      return;
    }

    if (!passVal) {
      setFieldErrorState(usernameInput, false);
      setFieldErrorState(passwordInput, true);
      showError('Mohon isi Kata Sandi terlebih dahulu.');
      passwordInput?.focus();
      return;
    }

    if (submitLoginBtn) submitLoginBtn.disabled = true;
    if (submitLoginLabel) submitLoginLabel.textContent = 'Memeriksa Akun...';

    const result = await apiLogin(userVal, passVal);
    if (!result.ok) {
      if (submitLoginBtn) submitLoginBtn.disabled = false;
      if (submitLoginLabel) submitLoginLabel.textContent = 'Masuk ke Dashboard';
      setFieldErrorState(usernameInput, true);
      setFieldErrorState(passwordInput, true);
      showError(result.message || 'Nomor WhatsApp/Username atau Kata Sandi salah.');
      return;
    }

    completeLoginAndRedirect(
      result.user,
      `Berhasil masuk sebagai ${result.user.fullName}! Membuka Dashboard...`,
      Boolean(rememberCheckbox?.checked)
    );
  });

  /* =========================================================================
     7. Create Account ("Buat Akun") Form Submission
     ========================================================================= */
  registerForm?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const fullName = regFullnameInput?.value.trim() || '';
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
    if (submitRegisterLabel) submitRegisterLabel.textContent = 'Menyimpan ke Database...';

    const result = await apiRegister({ fullName, username, farmName, password });
    if (!result.ok) {
      if (submitRegisterBtn) submitRegisterBtn.disabled = false;
      if (submitRegisterLabel) submitRegisterLabel.textContent = 'Daftar & Simpan Akun';
      setFieldErrorState(regUsernameInput, true);
      showError(result.message || 'Gagal membuat akun. Silakan coba lagi.');
      return;
    }

    completeLoginAndRedirect(
      result.user,
      `Akun ${result.user.fullName} berhasil dibuat & tersimpan di database! Membuka Dashboard...`,
      true
    );
  });

  /* =========================================================================
     8. "Lupa Kata Sandi?" Friendly Modal
     ========================================================================= */
  function openForgotModal() {
    forgotModal?.classList.remove('hidden');
    forgotOkBtn?.focus();
  }

  function closeForgotModal() {
    forgotModal?.classList.add('hidden');
    forgotBtn?.focus();
  }

  forgotBtn?.addEventListener('click', openForgotModal);
  forgotCloseX?.addEventListener('click', closeForgotModal);
  forgotOkBtn?.addEventListener('click', closeForgotModal);

  forgotModal?.addEventListener('click', (e) => {
    if (e.target === forgotModal) {
      closeForgotModal();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && forgotModal && !forgotModal.classList.contains('hidden')) {
      closeForgotModal();
    }
  });
});
