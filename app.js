/**
 * Irigasi Cerdas — Dasbor Pemantauan & Kontrol Irigasi Lahan
 * 100% terhubung ke API & database PostgreSQL/SQLite:
 * - Auth Guard & profil pengguna (edit profil & ganti kata sandi)
 * - Pompa, tandon air, pemakaian listrik, batas kelembapan, lokasi cuaca
 * - CRUD petak lahan & jadwal penyiraman harian
 * - Grafik kelembapan 14 hari dari database & notifikasi dinamis
 * - Simulasi sensor & otomatisasi penyiraman berbasis cuaca Open-Meteo
 */

document.addEventListener('DOMContentLoaded', () => {
  /* =========================================================================
     0. Auth Guard, Token Helpers & Profile UI
     ========================================================================= */
  const CURRENT_USER_KEY = 'irigasi_cerdas_current_user';
  const TOKEN_KEY = 'irigasi_cerdas_token';

  const authToken = (() => {
    try {
      return localStorage.getItem(TOKEN_KEY) || '';
    } catch {
      return '';
    }
  })();

  if (!authToken) {
    window.location.replace('login.html?auth=required');
    return;
  }

  function clearSessionAndRedirect(reason = 'expired') {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(CURRENT_USER_KEY);
    } catch {
      // Ignore storage errors
    }
    window.location.replace(`login.html?auth=${reason}`);
  }

  async function apiRequest(url, options = {}) {
    const headers = {
      ...(options.headers || {}),
      Authorization: `Bearer ${authToken}`,
    };
    if (options.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
      clearSessionAndRedirect('expired');
      throw new Error('Unauthorized');
    }
    const contentType = res.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await res.json() : {};
    return { status: res.status, ok: res.ok, data };
  }

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatRupiah(amount) {
    return `Rp ${Math.round(amount).toLocaleString('id-ID')}`;
  }

  function formatDecimalId(val, digits = 1) {
    return Number(val || 0).toLocaleString('id-ID', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  const headerUserName = document.getElementById('header-user-name');
  const headerUserRole = document.getElementById('header-user-role');
  const headerUserInitials = document.getElementById('header-user-initials');
  const popoverUserName = document.getElementById('popover-user-name');
  const popoverUserRole = document.getElementById('popover-user-role');
  const popoverUserEmail = document.getElementById('popover-user-email');
  const greetingHeading = document.getElementById('greeting-heading');
  const userMenuBtn = document.getElementById('user-menu-btn');
  const userMenuPopover = document.getElementById('user-menu-popover');
  const btnLogout = document.getElementById('btn-logout');

  let activeUser = { fullName: 'Pengguna', farmName: 'Pemilik Lahan', email: null, emailVerified: false };

  function getInitials(name) {
    const parts = String(name || 'Pengguna').trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  function applyUserProfile(user) {
    if (!user?.fullName) return;
    activeUser = { ...activeUser, ...user };
    const displayName = activeUser.fullName;
    const displayRole = activeUser.farmName || 'Pemilik Lahan';
    const initials = getInitials(displayName);

    document.title = `Irigasi Cerdas — Dasbor Lahan ${displayName}`;
    if (headerUserName) headerUserName.textContent = displayName;
    if (headerUserRole) headerUserRole.textContent = displayRole;
    if (headerUserInitials) headerUserInitials.textContent = initials;
    if (popoverUserName) popoverUserName.textContent = displayName;
    if (popoverUserRole) popoverUserRole.textContent = displayRole;
    if (popoverUserEmail && activeUser.email) {
      popoverUserEmail.textContent = activeUser.emailVerified
        ? `✓ ${activeUser.email}`
        : activeUser.email;
      popoverUserEmail.classList.remove('hidden');
    }
    updateClock();
  }

  try {
    const rawUser = localStorage.getItem(CURRENT_USER_KEY);
    if (rawUser) applyUserProfile(JSON.parse(rawUser));
  } catch {
    // Ignore storage read errors
  }

  userMenuBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = userMenuPopover?.classList.contains('hidden');
    userMenuPopover?.classList.toggle('hidden', !isHidden);
    userMenuBtn.setAttribute('aria-expanded', String(isHidden));
  });

  document.addEventListener('click', (e) => {
    if (
      userMenuPopover &&
      !userMenuPopover.classList.contains('hidden') &&
      !userMenuPopover.contains(e.target) &&
      !userMenuBtn?.contains(e.target)
    ) {
      userMenuPopover.classList.add('hidden');
      userMenuBtn?.setAttribute('aria-expanded', 'false');
    }
  });

  btnLogout?.addEventListener('click', () => {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(CURRENT_USER_KEY);
    } catch {
      // Ignore storage errors
    }
  });

  /* =========================================================================
     1. Real-time Date, Clock & Dynamic Time Greeting (WIB)
     ========================================================================= */
  const liveDateEl = document.getElementById('live-date');
  const liveClockEl = document.getElementById('live-clock');

  const dateFormatter = new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  function getTimeGreeting(hour) {
    if (hour >= 4 && hour < 11) return 'Selamat Pagi';
    if (hour >= 11 && hour < 15) return 'Selamat Siang';
    if (hour >= 15 && hour < 18) return 'Selamat Sore';
    return 'Selamat Malam';
  }

  function updateClock() {
    const now = new Date();
    const hour = now.getHours();

    if (greetingHeading) {
      const greetingText = `${getTimeGreeting(hour)}, ${activeUser.fullName}! 🌱`;
      if (greetingHeading.textContent !== greetingText) {
        greetingHeading.textContent = greetingText;
      }
    }
    if (liveDateEl) liveDateEl.textContent = dateFormatter.format(now);
    if (liveClockEl) {
      const hh = String(hour).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      const ss = String(now.getSeconds()).padStart(2, '0');
      liveClockEl.textContent = `${hh}:${mm}:${ss} WIB`;
    }
  }

  updateClock();
  setInterval(updateClock, 1000);

  /* =========================================================================
     2. Toast Helper
     ========================================================================= */
  const toastContainer = document.getElementById('toast-container');

  function showToast(message, variant = 'success') {
    if (!toastContainer) return;
    const toast = document.createElement('div');
    const colorClass =
      variant === 'error'
        ? 'bg-rose-600 text-white border-rose-500'
        : variant === 'info'
          ? 'bg-slate-800 text-white border-slate-700'
          : 'bg-brand-700 text-white border-brand-600';

    toast.className = `toast-enter pointer-events-auto flex items-center gap-2.5 px-4 py-3 rounded-xl border shadow-lg text-[13px] font-semibold ${colorClass}`;
    toast.innerHTML = `
      <span class="w-2 h-2 rounded-full bg-white/90 flex-shrink-0"></span>
      <span>${escapeHtml(message)}</span>
    `;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(6px)';
      toast.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
      setTimeout(() => toast.remove(), 220);
    }, 2800);
  }

  /* =========================================================================
     3. Mobile Collapsible Sidebar Drawer
     ========================================================================= */
  const sidebar = document.getElementById('sidebar');
  const sidebarOverlay = document.getElementById('sidebar-overlay');
  const menuToggleBtn = document.getElementById('menu-toggle-btn');
  const sidebarCloseBtn = document.getElementById('sidebar-close-btn');

  function setSidebarOpen(open) {
    if (!sidebar || !sidebarOverlay) return;
    sidebar.classList.toggle('is-open', open);
    sidebarOverlay.classList.toggle('is-open', open);
    menuToggleBtn?.setAttribute('aria-expanded', String(open));
  }

  menuToggleBtn?.addEventListener('click', () => {
    setSidebarOpen(!sidebar?.classList.contains('is-open'));
  });
  sidebarCloseBtn?.addEventListener('click', () => setSidebarOpen(false));
  sidebarOverlay?.addEventListener('click', () => setSidebarOpen(false));

  /* =========================================================================
     4. Core State (Synchronized with PostgreSQL / SQLite)
     ========================================================================= */
  const state = {
    isPumpOn: false,
    pumpMode: 'otomatis',
    minMoistureThreshold: 45,
    maxMoistureThreshold: 75,
    locationName: 'Semarang, Jawa Tengah',
    latitude: -6.9932,
    longitude: 110.4203,
    tankLevelPct: 85,
    tankCapacityLiters: 2000,
    waterUsedLiters: 320,
    waterSavedLiters: 1450,
    energyKwh: 22.1,
    tariffPerKwh: 1445,
    plots: [],
    schedules: [],
    activities: [],
    moistureHistory: [],
  };

  const weatherState = {
    loaded: false,
    temp: '--',
    condition: 'Memuat...',
    iconType: 'partly',
    humidity: '--',
    wind: '--',
    rainChance: 0,
    adviceShort: 'Memuat...',
    adviceLong: 'Mengambil data prakiraan cuaca terbaru untuk lokasi lahan...',
    updatedAt: '-',
    forecast: [],
  };

  let notificationsRead = false;
  let lastNotificationSignature = '';
  let rainDelayLogged = false;
  let simActiveTicks = 0;

  // DOM refs: Summary Cards
  const cardSoilValue = document.getElementById('card-soil-value');
  const cardSoilSubtext = document.getElementById('card-soil-subtext');
  const cardTankLiters = document.getElementById('card-tank-liters');
  const cardTankValue = document.getElementById('card-tank-value');
  const cardTankSubtext = document.getElementById('card-tank-subtext');
  const btnRefillTank = document.getElementById('btn-refill-tank');
  const cardEnergyKwh = document.getElementById('card-energy-kwh');
  const cardEnergyCost = document.getElementById('card-energy-cost');
  const cardEnergySubtext = document.getElementById('card-energy-subtext');

  const pumpSwitch = document.getElementById('pump-switch');
  const pumpSwitchKnob = document.getElementById('pump-switch-knob');
  const pumpStatusBadge = document.getElementById('pump-status-badge');
  const pumpStatusDot = document.getElementById('pump-status-dot');
  const pumpStatusText = document.getElementById('pump-status-text');
  const pumpSubtext = document.getElementById('pump-subtext');
  const pumpCardIcon = document.getElementById('pump-card-icon');
  const modeBtnAuto = document.getElementById('mode-btn-auto');
  const modeBtnManual = document.getElementById('mode-btn-manual');

  const activityListEl = document.getElementById('activity-list');
  const plotsTableBody = document.getElementById('plots-table-body');
  const weatherLocationLabel = document.getElementById('weather-location-label');
  const notifListEl = document.getElementById('notif-list');
  const notifDot = document.getElementById('notif-dot');

  /* =========================================================================
     5. Renderers for Cards, Notifications, Activities, Plots & Chart
     ========================================================================= */
  function renderSoilSummaryCard() {
    if (!cardSoilValue || state.plots.length === 0) return;
    const avg = Math.round(
      state.plots.reduce((sum, p) => sum + Number(p.moisture || 0), 0) / state.plots.length
    );

    let condition = 'Lembap';
    let subtext = 'Ideal untuk tanaman';
    if (avg < state.minMoistureThreshold) {
      condition = 'Kering';
      subtext = 'Di bawah batas • Perlu disiram';
    } else if (avg > state.maxMoistureThreshold + 7) {
      condition = 'Basah';
      subtext = 'Air melimpah • Tunda siram';
    }
    cardSoilValue.textContent = `${condition} (${avg}%)`;
    if (cardSoilSubtext) cardSoilSubtext.textContent = subtext;
  }

  function renderTankAndEnergyCards() {
    const liters = Math.round((state.tankLevelPct / 100) * state.tankCapacityLiters);
    if (cardTankLiters) cardTankLiters.textContent = `${liters.toLocaleString('id-ID')} Liter`;
    if (cardTankValue) cardTankValue.textContent = `${state.tankLevelPct}% Penuh`;
    if (cardTankSubtext) {
      if (state.tankLevelPct <= 25) {
        cardTankSubtext.textContent = 'Air menipis — klik Isi untuk isi ulang';
        cardTankSubtext.className = 'text-[12.5px] font-semibold text-rose-600 mt-2';
      } else if (state.tankLevelPct >= 95) {
        cardTankSubtext.textContent = 'Tandon penuh & siap menyiram';
        cardTankSubtext.className = 'text-[12.5px] font-medium text-sky-700 mt-2';
      } else {
        cardTankSubtext.textContent = 'Aman dari meluber';
        cardTankSubtext.className = 'text-[12.5px] font-medium text-sky-700 mt-2';
      }
    }

    const estCost = Math.round(state.energyKwh * state.tariffPerKwh);
    if (cardEnergyKwh) cardEnergyKwh.textContent = `${formatDecimalId(state.energyKwh, 1)} kWh`;
    if (cardEnergyCost) cardEnergyCost.textContent = formatRupiah(estCost);
    if (cardEnergySubtext) {
      cardEnergySubtext.textContent = `Tarif ${formatRupiah(state.tariffPerKwh)}/kWh • Bulan ini`;
    }
  }

  function renderPumpState() {
    const isOn = state.isPumpOn;
    const isAuto = state.pumpMode === 'otomatis';
    const modeLabel = isAuto ? 'Otomatis' : 'Manual';

    if (pumpSwitch && pumpSwitchKnob) {
      pumpSwitch.setAttribute('aria-checked', String(isOn));
      pumpSwitch.classList.toggle('bg-brand-600', isOn);
      pumpSwitch.classList.toggle('bg-slate-300', !isOn);
      pumpSwitchKnob.style.transform = isOn ? 'translateX(24px)' : 'translateX(0px)';
    }

    if (modeBtnAuto && modeBtnManual) {
      modeBtnAuto.className = isAuto
        ? 'px-2.5 py-1 rounded-full text-[11px] font-bold transition-all bg-purple-600 text-white shadow-sm'
        : 'px-2.5 py-1 rounded-full text-[11px] font-semibold text-slate-600 hover:text-slate-900 transition-all';
      modeBtnManual.className = !isAuto
        ? 'px-2.5 py-1 rounded-full text-[11px] font-bold transition-all bg-purple-600 text-white shadow-sm'
        : 'px-2.5 py-1 rounded-full text-[11px] font-semibold text-slate-600 hover:text-slate-900 transition-all';
      modeBtnAuto.setAttribute('aria-pressed', String(isAuto));
      modeBtnManual.setAttribute('aria-pressed', String(!isAuto));
    }

    if (pumpStatusText) pumpStatusText.textContent = `${isOn ? 'NYALA' : 'MATI'} (${modeLabel})`;

    if (pumpStatusBadge && pumpStatusDot && pumpCardIcon) {
      if (isOn) {
        pumpStatusBadge.className =
          'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[15px] font-extrabold bg-[#DCFCE7] text-[#166534] transition-colors';
        pumpStatusDot.className = 'w-2 h-2 rounded-full bg-brand-600 animate-pulse';
        pumpCardIcon.className =
          'w-10 h-10 rounded-xl bg-[#DCF1E1] text-brand-700 flex items-center justify-center transition-colors';
      } else {
        pumpStatusBadge.className =
          'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[15px] font-extrabold bg-[#E8E0FA] text-purple-900 transition-colors';
        pumpStatusDot.className = 'w-2 h-2 rounded-full bg-slate-500';
        pumpCardIcon.className =
          'w-10 h-10 rounded-xl bg-[#E8E0FA] text-purple-700 flex items-center justify-center transition-colors';
      }
    }

    if (pumpSubtext) {
      if (isOn && isAuto) {
        pumpSubtext.textContent = 'Pompa menyala otomatis menyiram lahan';
      } else if (isOn && !isAuto) {
        pumpSubtext.textContent = `Pompa dinyalakan manual oleh ${activeUser.fullName}`;
      } else if (!isOn && !isAuto) {
        pumpSubtext.textContent = 'Mode manual • Pompa dimatikan';
      } else {
        pumpSubtext.textContent = `Otomatis aktif (siram < ${state.minMoistureThreshold}%)`;
      }
    }
  }

  function renderNotifications() {
    if (!notifListEl) return;
    const alerts = [];

    // 1. Watering plots
    state.plots
      .filter((p) => p.pumpOn)
      .forEach((p) => {
        alerts.push({
          tone: 'bg-brand-50 border-brand-100',
          title: `${p.name} sedang disiram`,
          desc: `Kelembapan ${p.moisture}% (${p.crop}) • target berhenti di ${state.maxMoistureThreshold}%.`,
        });
      });

    // 2. Dry plots
    state.plots
      .filter((p) => !p.pumpOn && p.moisture < state.minMoistureThreshold)
      .forEach((p) => {
        alerts.push({
          tone: 'bg-rose-50 border-rose-100',
          title: `${p.name} tanah mulai kering (${p.moisture}%)`,
          desc:
            weatherState.rainChance >= 60
              ? `Penyiraman ditunda karena peluang hujan ${weatherState.rainChance}%.`
              : `Di bawah batas minimum ${state.minMoistureThreshold}%.`,
        });
      });

    // 3. Real Open-Meteo rain alert
    if (weatherState.loaded) {
      if (weatherState.rainChance >= 60) {
        alerts.push({
          tone: 'bg-amber-50 border-amber-100',
          title: `Peluang hujan ${weatherState.rainChance}% di ${state.locationName}`,
          desc: 'Sistem menunda jadwal siram otomatis untuk menghemat air tandon.',
        });
      } else {
        alerts.push({
          tone: 'bg-sky-50 border-sky-100',
          title: `Cuaca ${state.locationName}: ${weatherState.temp}°C ${weatherState.condition}`,
          desc: `Peluang hujan ${weatherState.rainChance}% • aman untuk penyiraman.`,
        });
      }
    }

    // 4. Tank status
    if (state.tankLevelPct <= 25) {
      alerts.push({
        tone: 'bg-rose-50 border-rose-100',
        title: `Sisa air tandon menipis (${state.tankLevelPct}%)`,
        desc: 'Klik tombol "Isi" pada kartu Sisa Air Tandon untuk mengisi ulang.',
      });
    } else {
      const liters = Math.round((state.tankLevelPct / 100) * state.tankCapacityLiters);
      alerts.push({
        tone: 'bg-sky-50 border-sky-100',
        title: `Tandon air aman (${state.tankLevelPct}% penuh)`,
        desc: `Tersedia sekitar ${liters.toLocaleString('id-ID')} liter untuk penyiraman.`,
      });
    }

    // 5. Active schedule summary
    const enabledSchedules = state.schedules.filter((s) => s.enabled);
    if (enabledSchedules.length > 0) {
      const first = enabledSchedules[0];
      alerts.push({
        tone: 'bg-purple-50 border-purple-100',
        title: `${enabledSchedules.length} jadwal penyiraman harian aktif`,
        desc: `Terdekat: ${first.label} pukul ${first.timeWib} WIB (${first.plotTarget}).`,
      });
    }

    const sig = alerts.map((a) => a.title).join('|');
    if (sig !== lastNotificationSignature) {
      lastNotificationSignature = sig;
      notificationsRead = false;
    }

    notifDot?.classList.toggle('hidden', notificationsRead || alerts.length === 0);

    notifListEl.innerHTML = alerts
      .slice(0, 5)
      .map(
        (a) => `
        <li class="p-2.5 rounded-xl border ${a.tone} text-slate-700">
          <p class="font-semibold text-slate-900">${escapeHtml(a.title)}</p>
          <p class="text-slate-500 mt-0.5">${escapeHtml(a.desc)}</p>
        </li>
      `
      )
      .join('');
  }

  function renderActivities() {
    if (!activityListEl || state.activities.length === 0) return;

    const toneStyles = {
      green: {
        box: 'bg-[#E8F5E9] text-brand-600',
        pill: 'bg-[#E8F5E9] text-brand-700',
        icon: '<svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
      },
      amber: {
        box: 'bg-[#FEF3C7] text-amber-600',
        pill: 'bg-[#FEF3C7] text-amber-700',
        icon: '<svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M16 14v6"/><path d="M8 14v6"/><path d="M12 16v6"/></svg>',
      },
      blue: {
        box: 'bg-[#E0F2FE] text-sky-600',
        pill: 'bg-[#E0F2FE] text-sky-700',
        icon: '<svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>',
      },
      purple: {
        box: 'bg-[#EDE9FE] text-purple-600',
        pill: 'bg-[#EDE9FE] text-purple-700',
        icon: '<svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
      },
    };

    activityListEl.innerHTML = state.activities
      .slice(0, 4)
      .map((item) => {
        const style = toneStyles[item.tone] || toneStyles.green;
        return `
          <li class="flex items-center justify-between gap-3 p-2.5 -mx-2 rounded-xl hover:bg-slate-50/80 transition-colors">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-10 h-10 rounded-xl ${style.box} flex items-center justify-center flex-shrink-0" aria-hidden="true">
                ${style.icon}
              </div>
              <div class="min-w-0">
                <p class="text-[13.5px] font-bold text-slate-900 truncate">${escapeHtml(item.title)}</p>
                <p class="text-[12px] text-slate-500 truncate">${escapeHtml(item.subtitle)}</p>
              </div>
            </div>
            <span class="flex-shrink-0 px-2.5 py-1 rounded-full text-[11px] font-semibold ${style.pill}">
              ${escapeHtml(item.tag)}
            </span>
          </li>
        `;
      })
      .join('');
  }

  function renderPlotsTable() {
    if (!plotsTableBody) return;
    const avatarPalette = [
      'bg-[#E8F5E9] text-brand-700',
      'bg-[#FEF3C7] text-amber-700',
      'bg-[#EDE9FE] text-purple-700',
      'bg-[#E0F2FE] text-sky-700',
    ];

    plotsTableBody.innerHTML = state.plots
      .map((plot, idx) => {
        const avatarClass = avatarPalette[idx % avatarPalette.length];
        const moistureColor = plot.moisture < state.minMoistureThreshold ? 'text-rose-600' : plot.moisture < 55 ? 'text-amber-600' : 'text-slate-800';
        const statusBtn = plot.pumpOn
          ? `<button type="button" data-quick-toggle-plot="${plot.id}" title="Klik untuk mematikan" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-semibold bg-[#E8F5E9] hover:bg-brand-100 text-brand-700 transition-colors"><span class="w-1.5 h-1.5 rounded-full bg-brand-600 animate-pulse"></span>Menyiram (ON)</button>`
          : `<button type="button" data-quick-toggle-plot="${plot.id}" title="Klik untuk menyiram" class="inline-flex items-center px-2.5 py-1 rounded-full text-[12px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors">Mati (Cukup Air)</button>`;

        return `
          <tr class="hover:bg-slate-50/70 transition-colors">
            <td class="py-3.5 pr-4">
              <div class="flex items-center gap-3">
                <span class="w-8 h-8 rounded-full ${avatarClass} text-[11px] font-bold flex items-center justify-center flex-shrink-0">${escapeHtml(plot.code)}</span>
                <span class="font-bold text-slate-900">${escapeHtml(plot.name)}</span>
              </div>
            </td>
            <td class="py-3.5 px-3 font-medium text-slate-600">${escapeHtml(plot.crop)}</td>
            <td class="py-3.5 px-3 font-bold ${moistureColor}">${plot.moisture}%</td>
            <td class="py-3.5 px-3">${statusBtn}</td>
            <td class="py-3.5 px-3 text-right text-slate-500 text-[12.5px]">${escapeHtml(plot.updated)}</td>
            <td class="py-3.5 pl-3 text-right">
              <div class="inline-flex items-center gap-1">
                <button type="button" data-edit-plot="${plot.id}" class="px-2 py-1 rounded-lg text-[11.5px] font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900">Edit</button>
                <button type="button" data-delete-plot="${plot.id}" class="px-2 py-1 rounded-lg text-[11.5px] font-semibold text-rose-600 hover:bg-rose-50">Hapus</button>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');

    plotsTableBody.querySelectorAll('[data-quick-toggle-plot]').forEach((btn) => {
      btn.addEventListener('click', () => togglePlotPump(Number(btn.getAttribute('data-quick-toggle-plot'))));
    });
    plotsTableBody.querySelectorAll('[data-edit-plot]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const plot = state.plots.find((p) => p.id === Number(btn.getAttribute('data-edit-plot')));
        if (plot) openPlotModal(plot);
      });
    });
    plotsTableBody.querySelectorAll('[data-delete-plot]').forEach((btn) => {
      btn.addEventListener('click', () => deletePlotById(Number(btn.getAttribute('data-delete-plot'))));
    });
  }

  function applyDashboardSnapshot(snapshot) {
    if (snapshot.user) {
      applyUserProfile(snapshot.user);
      try {
        localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(snapshot.user));
      } catch {
        // Ignore storage error
      }
    }
    if (snapshot.settings) {
      state.isPumpOn = Boolean(snapshot.settings.isPumpOn);
      state.pumpMode = snapshot.settings.pumpMode || 'otomatis';
      state.minMoistureThreshold = Number(snapshot.settings.minMoistureThreshold ?? 45);
      state.maxMoistureThreshold = Number(snapshot.settings.maxMoistureThreshold ?? 75);
      state.locationName = snapshot.settings.locationName || 'Semarang, Jawa Tengah';
      state.latitude = Number(snapshot.settings.latitude ?? -6.9932);
      state.longitude = Number(snapshot.settings.longitude ?? 110.4203);
      state.tankLevelPct = Number(snapshot.settings.tankLevelPct ?? 85);
      state.tankCapacityLiters = Number(snapshot.settings.tankCapacityLiters ?? 2000);
      state.waterUsedLiters = Number(snapshot.settings.waterUsedLiters ?? 320);
      state.waterSavedLiters = Number(snapshot.settings.waterSavedLiters ?? 1450);
      state.energyKwh = Number(snapshot.settings.energyKwh ?? 22.1);
      state.tariffPerKwh = Number(snapshot.settings.tariffPerKwh ?? 1445);
    }
    if (Array.isArray(snapshot.plots)) state.plots = snapshot.plots;
    if (Array.isArray(snapshot.schedules)) state.schedules = snapshot.schedules;
    if (Array.isArray(snapshot.activities)) state.activities = snapshot.activities;
    if (Array.isArray(snapshot.moistureHistory)) state.moistureHistory = snapshot.moistureHistory;

    if (weatherLocationLabel) weatherLocationLabel.textContent = state.locationName;

    renderPumpState();
    renderSoilSummaryCard();
    renderTankAndEnergyCards();
    renderPlotsTable();
    renderActivities();
    renderMoistureChart();
    renderNotifications();

    if (currentNav !== 'dashboard') renderSecondaryView(currentNav);
  }

  async function persistSettings(payload, toastMessage) {
    try {
      const { ok, data } = await apiRequest('/api/pump', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (!ok || !data.ok) {
        if (toastMessage !== null) showToast(data.message || 'Gagal menyimpan pengaturan.', 'error');
        return false;
      }
      applyDashboardSnapshot(data);
      if (toastMessage) showToast(toastMessage);
      return true;
    } catch {
      if (toastMessage !== null) showToast('Koneksi server terganggu saat menyimpan data.', 'error');
      return false;
    }
  }

  async function togglePlotPump(plotId) {
    const target = state.plots.find((p) => p.id === plotId);
    if (!target) return;
    const nextPump = !target.pumpOn;

    if (nextPump && state.tankLevelPct <= 5) {
      showToast('Air tandon habis! Klik tombol "Isi" pada kartu tandon terlebih dahulu.', 'error');
      return;
    }

    try {
      const { ok, data } = await apiRequest('/api/plots', {
        method: 'PATCH',
        body: JSON.stringify({ id: plotId, pumpOn: nextPump }),
      });
      if (!ok || !data.ok) {
        showToast(data.message || 'Gagal memperbarui status petak.', 'error');
        return;
      }
      applyDashboardSnapshot(data);
      showToast(nextPump ? `Penyiraman ${target.name} dinyalakan.` : `Penyiraman ${target.name} dimatikan.`);
    } catch {
      showToast('Gagal menyimpan status petak.', 'error');
    }
  }

  async function deletePlotById(plotId) {
    const target = state.plots.find((p) => p.id === plotId);
    if (!target) return;
    if (state.plots.length <= 1) {
      showToast('Minimal harus tersisa 1 petak lahan.', 'error');
      return;
    }
    try {
      const { ok, data } = await apiRequest('/api/plots', {
        method: 'DELETE',
        body: JSON.stringify({ id: plotId }),
      });
      if (!ok || !data.ok) {
        showToast(data.message || 'Gagal menghapus petak.', 'error');
        return;
      }
      applyDashboardSnapshot(data);
      showToast(`Petak ${target.name} dihapus.`, 'info');
    } catch {
      showToast('Gagal menghapus petak.', 'error');
    }
  }

  btnRefillTank?.addEventListener('click', async () => {
    if (state.tankLevelPct >= 100) {
      showToast('Tandon air sudah 100% penuh.', 'info');
      return;
    }
    await persistSettings({ refillTank: true }, 'Tandon air berhasil diisi hingga 100% penuh.');
  });

  pumpSwitch?.addEventListener('click', async () => {
    const nextPump = !state.isPumpOn;
    if (nextPump && state.tankLevelPct <= 5) {
      showToast('Air tandon habis! Isi tandon terlebih dahulu sebelum menyalakan pompa.', 'error');
      return;
    }
    const nextMode = state.pumpMode === 'otomatis' ? 'manual' : state.pumpMode;
    await persistSettings(
      { isPumpOn: nextPump, pumpMode: nextMode, logAction: 'pump-toggle' },
      nextPump ? 'Pompa utama dinyalakan (Mode Manual).' : 'Pompa utama dimatikan (Mode Manual).'
    );
  });

  modeBtnAuto?.addEventListener('click', async () => {
    if (state.pumpMode === 'otomatis') return;
    rainDelayLogged = false;
    await persistSettings(
      { isPumpOn: false, pumpMode: 'otomatis', logAction: 'mode-change' },
      'Mode pompa diubah ke Otomatis (mengikuti sensor & cuaca).'
    );
  });

  modeBtnManual?.addEventListener('click', async () => {
    if (state.pumpMode === 'manual') return;
    await persistSettings(
      { pumpMode: 'manual', logAction: 'mode-change' },
      'Mode pompa diubah ke Manual.'
    );
  });

  /* =========================================================================
     6. Live Sensor & Auto-Irrigation Simulation Loop (Every 4 Seconds)
     ========================================================================= */
  function startLiveSimulationLoop() {
    setInterval(async () => {
      if (state.plots.length === 0) return;

      let stateChangedLocally = false;
      let needsImmediateDbSync = false;
      let customLog = null;

      const anyPlotWatering = state.plots.some((p) => p.pumpOn);
      const activeWatering = state.isPumpOn || anyPlotWatering;

      if (activeWatering) {
        if (state.tankLevelPct <= 5) {
          state.isPumpOn = false;
          state.plots.forEach((p) => {
            p.pumpOn = false;
          });
          needsImmediateDbSync = true;
          customLog = {
            title: 'Pompa Dihentikan Otomatis (Tandon Hampir Kosong)',
            subtitle: 'Tandon Utama • Pengaman Pompa',
            tag: 'Peringatan',
            tone: 'amber',
          };
          showToast('Tandon hampir kosong! Semua pompa dimatikan otomatis.', 'error');
        } else {
          // Consume water & energy while watering
          const activeCount = state.isPumpOn
            ? Math.max(1, state.plots.length)
            : state.plots.filter((p) => p.pumpOn).length;

          state.waterUsedLiters += activeCount * 6;
          state.energyKwh = Number((state.energyKwh + activeCount * 0.03).toFixed(2));
          if (simActiveTicks % 2 === 0 && state.tankLevelPct > 5) {
            state.tankLevelPct = Math.max(5, state.tankLevelPct - 1);
          }

          // Raise moisture on watered plots
          for (const p of state.plots) {
            if (state.isPumpOn || p.pumpOn) {
              p.moisture = Math.min(95, p.moisture + 1);
              p.updated = 'Baru saja';
              stateChangedLocally = true;

              // Auto-stop individual plot when reaching maxMoistureThreshold in Otomatis mode
              if (state.pumpMode === 'otomatis' && p.pumpOn && p.moisture >= state.maxMoistureThreshold) {
                p.pumpOn = false;
                needsImmediateDbSync = true;
                customLog = {
                  title: `Penyiraman Otomatis Selesai (${p.name})`,
                  subtitle: `Kelembapan mencapai ${p.moisture}% • ${p.crop}`,
                  tag: 'Selesai',
                  tone: 'green',
                };
                showToast(`Penyiraman otomatis ${p.name} selesai (${p.moisture}%).`);
              }
            }
          }
          simActiveTicks += 1;
        }
      }

      // Automatic start / rain-skip logic in Otomatis mode
      if (state.pumpMode === 'otomatis') {
        const dryPlot = state.plots.find(
          (p) => !p.pumpOn && p.moisture < state.minMoistureThreshold
        );
        if (dryPlot) {
          if (weatherState.loaded && weatherState.rainChance >= 60) {
            if (!rainDelayLogged) {
              rainDelayLogged = true;
              state.waterSavedLiters += 120;
              needsImmediateDbSync = true;
              customLog = {
                title: `Penyiraman Ditunda (Prediksi Hujan ${weatherState.rainChance}%)`,
                subtitle: `${dryPlot.name} (${dryPlot.moisture}%) • Hemat Air`,
                tag: 'Hemat Air',
                tone: 'amber',
              };
              showToast(`Hujan diprediksi (${weatherState.rainChance}%): penyiraman ${dryPlot.name} ditunda.`, 'info');
            }
          } else if (state.tankLevelPct > 15) {
            dryPlot.pumpOn = true;
            dryPlot.updated = 'Baru saja';
            needsImmediateDbSync = true;
            customLog = {
              title: `Penyiraman Otomatis Dimulai (${dryPlot.name})`,
              subtitle: `Tanah kering ${dryPlot.moisture}% (< ${state.minMoistureThreshold}%)`,
              tag: 'Otomatis',
              tone: 'green',
            };
            showToast(`Tanah ${dryPlot.name} kering (${dryPlot.moisture}%): menyiram otomatis!`);
          }
        }
      }

      // Update today's point in local chart history so graph reflects live moisture immediately
      if (stateChangedLocally && state.moistureHistory.length > 0 && state.plots.length > 0) {
        const lastIdx = state.moistureHistory.length - 1;
        state.moistureHistory[lastIdx].seriesA = state.plots[0].moisture;
        if (state.plots[1]) state.moistureHistory[lastIdx].seriesB = state.plots[1].moisture;
      }

      if (stateChangedLocally || needsImmediateDbSync) {
        renderPumpState();
        renderSoilSummaryCard();
        renderTankAndEnergyCards();
        renderPlotsTable();
        renderMoistureChart();
        renderNotifications();
        if (currentNav !== 'dashboard' && currentNav !== 'pengaturan-alat') {
          renderSecondaryView(currentNav);
        }
      }

      // Persist to PostgreSQL/SQLite immediately on state transition or every 5 active ticks (~20s)
      if (needsImmediateDbSync || (activeWatering && simActiveTicks > 0 && simActiveTicks % 5 === 0)) {
        await persistSettings(
          {
            isPumpOn: state.isPumpOn,
            pumpMode: state.pumpMode,
            tankLevelPct: state.tankLevelPct,
            waterUsedLiters: state.waterUsedLiters,
            waterSavedLiters: state.waterSavedLiters,
            energyKwh: state.energyKwh,
            plotUpdates: state.plots.map((p) => ({ id: p.id, moisture: p.moisture, pumpOn: p.pumpOn })),
            customLog,
          },
          null
        );
      }
    }, 4000);
  }

  /* =========================================================================
     7. Modal: Tambah / Edit Petak Lahan
     ========================================================================= */
  const modalPlot = document.getElementById('modal-plot');
  const modalPlotTitle = document.getElementById('modal-plot-title');
  const btnOpenAddPlot = document.getElementById('btn-open-add-plot');
  const btnClosePlotModal = document.getElementById('modal-plot-close');
  const btnCancelPlotModal = document.getElementById('modal-plot-cancel');
  const formPlot = document.getElementById('form-plot');
  const plotEditId = document.getElementById('plot-edit-id');
  const plotInputName = document.getElementById('plot-input-name');
  const plotInputCrop = document.getElementById('plot-input-crop');
  const plotInputMoisture = document.getElementById('plot-input-moisture');
  const plotMoistureVal = document.getElementById('plot-moisture-val');

  function openPlotModal(plot = null) {
    if (!modalPlot) return;
    if (plot) {
      if (modalPlotTitle) modalPlotTitle.textContent = `Edit ${plot.name}`;
      if (plotEditId) plotEditId.value = String(plot.id);
      if (plotInputName) plotInputName.value = plot.name;
      if (plotInputCrop) plotInputCrop.value = plot.crop;
      if (plotInputMoisture) plotInputMoisture.value = String(plot.moisture);
      if (plotMoistureVal) plotMoistureVal.textContent = `${plot.moisture}%`;
    } else {
      if (modalPlotTitle) modalPlotTitle.textContent = 'Tambah Petak Lahan';
      if (plotEditId) plotEditId.value = '';
      if (plotInputName) plotInputName.value = '';
      if (plotInputCrop) plotInputCrop.value = '';
      if (plotInputMoisture) plotInputMoisture.value = '65';
      if (plotMoistureVal) plotMoistureVal.textContent = '65%';
    }
    modalPlot.classList.remove('hidden');
    plotInputName?.focus();
  }

  function closePlotModal() {
    modalPlot?.classList.add('hidden');
  }

  plotInputMoisture?.addEventListener('input', () => {
    if (plotMoistureVal) plotMoistureVal.textContent = `${plotInputMoisture.value}%`;
  });

  btnOpenAddPlot?.addEventListener('click', () => openPlotModal(null));
  btnClosePlotModal?.addEventListener('click', closePlotModal);
  btnCancelPlotModal?.addEventListener('click', closePlotModal);
  modalPlot?.addEventListener('click', (e) => {
    if (e.target === modalPlot) closePlotModal();
  });

  formPlot?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const idVal = plotEditId?.value ? Number(plotEditId.value) : null;
    const name = plotInputName?.value.trim() || '';
    const crop = plotInputCrop?.value.trim() || '';
    const moisture = Number(plotInputMoisture?.value || 65);

    if (!name || !crop) {
      showToast('Nama Petak dan Jenis Tanaman wajib diisi.', 'error');
      return;
    }

    try {
      const { ok, data } = await apiRequest('/api/plots', {
        method: idVal ? 'PATCH' : 'POST',
        body: JSON.stringify(idVal ? { id: idVal, name, crop, moisture } : { name, crop, moisture }),
      });

      if (!ok || !data.ok) {
        showToast(data.message || 'Gagal menyimpan petak lahan.', 'error');
        return;
      }

      applyDashboardSnapshot(data);
      closePlotModal();
      showToast(idVal ? `Petak ${name} diperbarui.` : `Petak ${name} ditambahkan ke database.`);
    } catch {
      showToast('Gagal terhubung ke server saat menyimpan petak.', 'error');
    }
  });

  /* =========================================================================
     8. Modal: Pilih Lokasi Lahan (Open-Meteo Geocoding)
     ========================================================================= */
  const modalLocation = document.getElementById('modal-location');
  const btnOpenLocationModal = document.getElementById('btn-open-location-modal');
  const btnCloseLocationModal = document.getElementById('modal-location-close');
  const formLocationSearch = document.getElementById('form-location-search');
  const locationSearchInput = document.getElementById('location-search-input');
  const locationResultsEl = document.getElementById('location-results');

  function openLocationModal() {
    if (!modalLocation) return;
    modalLocation.classList.remove('hidden');
    if (locationSearchInput) {
      locationSearchInput.value = '';
      locationSearchInput.focus();
    }
  }

  function closeLocationModal() {
    modalLocation?.classList.add('hidden');
  }

  btnOpenLocationModal?.addEventListener('click', openLocationModal);
  btnCloseLocationModal?.addEventListener('click', closeLocationModal);
  modalLocation?.addEventListener('click', (e) => {
    if (e.target === modalLocation) closeLocationModal();
  });

  formLocationSearch?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = locationSearchInput?.value.trim() || '';
    if (!query || !locationResultsEl) return;

    locationResultsEl.innerHTML =
      '<p class="text-xs text-slate-500 text-center py-4">Mencari lokasi...</p>';

    try {
      const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=6&language=id&format=json`;
      const res = await fetch(geoUrl);
      const data = await res.json();
      const results = Array.isArray(data.results) ? data.results : [];

      if (results.length === 0) {
        locationResultsEl.innerHTML =
          '<p class="text-xs text-rose-600 text-center py-4">Lokasi tidak ditemukan. Coba nama kota atau kabupaten lain.</p>';
        return;
      }

      locationResultsEl.innerHTML = results
        .map((item, idx) => {
          const region = [item.admin1, item.country].filter(Boolean).join(', ');
          const displayLabel = item.admin1 ? `${item.name}, ${item.admin1}` : item.name;
          return `
            <button type="button" data-pick-location="${idx}" class="w-full text-left p-3 rounded-xl border border-slate-200 hover:border-brand-500 hover:bg-brand-50/50 transition-colors flex items-center justify-between gap-2">
              <div>
                <p class="font-bold text-slate-900 text-xs">${escapeHtml(displayLabel)}</p>
                <p class="text-[11px] text-slate-500">${escapeHtml(region)}</p>
              </div>
              <span class="text-[11px] font-bold text-brand-700">Pilih</span>
            </button>
          `;
        })
        .join('');

      locationResultsEl.querySelectorAll('[data-pick-location]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const chosen = results[Number(btn.getAttribute('data-pick-location'))];
          if (!chosen) return;
          const label = chosen.admin1 ? `${chosen.name}, ${chosen.admin1}` : chosen.name;
          const saved = await persistSettings(
            {
              locationName: label,
              latitude: chosen.latitude,
              longitude: chosen.longitude,
              logAction: 'location-change',
            },
            `Lokasi cuaca diubah ke ${label}.`
          );
          if (saved) {
            closeLocationModal();
            rainDelayLogged = false;
            fetchLiveWeather();
          }
        });
      });
    } catch {
      locationResultsEl.innerHTML =
        '<p class="text-xs text-rose-600 text-center py-4">Gagal mencari lokasi. Periksa koneksi internet.</p>';
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (sidebar?.classList.contains('is-open')) setSidebarOpen(false);
      if (modalPlot && !modalPlot.classList.contains('hidden')) closePlotModal();
      if (modalLocation && !modalLocation.classList.contains('hidden')) closeLocationModal();
    }
  });

  /* =========================================================================
     9. Dynamic Dual-Line SVG Chart (Real 14-Day DB History + Real Plot Names)
     ========================================================================= */
  const chartSvg = document.getElementById('moisture-chart-svg');
  const chartContainer = document.getElementById('moisture-chart-container');
  const chartTooltip = document.getElementById('chart-tooltip');
  const tooltipDay = document.getElementById('tooltip-day');
  const tooltipUtara = document.getElementById('tooltip-utara');
  const tooltipSelatan = document.getElementById('tooltip-selatan');
  const tooltipLabelA = document.getElementById('tooltip-label-a');
  const tooltipLabelB = document.getElementById('tooltip-label-b');
  const chartLegendA = document.getElementById('chart-legend-a');
  const chartLegendB = document.getElementById('chart-legend-b');
  const chartRangeSelect = document.getElementById('chart-range-select');

  let activeChartRange = 'this-week';
  let activePointIndex = 6; // Highlight today by default

  function formatChartDay(dateStr) {
    const days = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const [y, m, d] = String(dateStr).split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return {
      short: days[dt.getDay()] || '---',
      full: `${days[dt.getDay()]}, ${d} ${months[m - 1] || ''}`,
    };
  }

  function getActiveChartPoints() {
    const hist = state.moistureHistory;
    if (hist.length >= 14) {
      const slice = activeChartRange === 'last-week' ? hist.slice(0, 7) : hist.slice(-7);
      return slice.map((item) => {
        const f = formatChartDay(item.dayDate);
        return { day: f.short, fullDay: f.full, utara: item.seriesA, selatan: item.seriesB };
      });
    }
    if (hist.length > 0) {
      return hist.map((item) => {
        const f = formatChartDay(item.dayDate);
        return { day: f.short, fullDay: f.full, utara: item.seriesA, selatan: item.seriesB };
      });
    }
    return [
      { day: 'Sen', fullDay: 'Sen', utara: 58, selatan: 49 },
      { day: 'Sel', fullDay: 'Sel', utara: 69, selatan: 57 },
      { day: 'Rab', fullDay: 'Rab', utara: 60, selatan: 50 },
      { day: 'Kam', fullDay: 'Kam', utara: 68, selatan: 54 },
      { day: 'Jum', fullDay: 'Jum', utara: 63, selatan: 51 },
      { day: 'Sab', fullDay: 'Sab', utara: 69, selatan: 56 },
      { day: 'Min', fullDay: 'Min', utara: 75, selatan: 68 },
    ];
  }

  function buildSmoothPath(points) {
    if (points.length === 0) return '';
    if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i - 1] || points[i];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2] || p2;

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }
    return d;
  }

  function renderMoistureChart() {
    if (!chartSvg) return;
    const data = getActiveChartPoints();
    if (activePointIndex >= data.length) activePointIndex = data.length - 1;

    const plotAName = state.plots[0]?.name || 'Petak Utara';
    const plotBName = state.plots[1]?.name || 'Petak Selatan';
    if (chartLegendA) chartLegendA.textContent = plotAName;
    if (chartLegendB) chartLegendB.textContent = plotBName;
    if (tooltipLabelA) tooltipLabelA.textContent = plotAName.split(' ').slice(-1)[0];
    if (tooltipLabelB) tooltipLabelB.textContent = plotBName.split(' ').slice(-1)[0];

    const measuredWidth = chartContainer?.clientWidth || 700;
    const width = Math.max(320, measuredWidth);
    const height = 240;
    chartSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const padLeft = 44;
    const padRight = 22;
    const padTop = 24;
    const padBottom = 32;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    const minY = 20;
    const maxY = 100;
    const valToY = (val) => padTop + plotH - ((Math.max(minY, Math.min(maxY, val)) - minY) / (maxY - minY)) * plotH;
    const idxToX = (i) => padLeft + (data.length > 1 ? (i / (data.length - 1)) * plotW : plotW / 2);

    const utaraPts = data.map((d, i) => ({ x: idxToX(i), y: valToY(d.utara) }));
    const selatanPts = data.map((d, i) => ({ x: idxToX(i), y: valToY(d.selatan) }));

    const utaraPath = buildSmoothPath(utaraPts);
    const selatanPath = buildSmoothPath(selatanPts);
    const bottomY = padTop + plotH;

    const utaraArea = `${utaraPath} L ${utaraPts[utaraPts.length - 1].x} ${bottomY} L ${utaraPts[0].x} ${bottomY} Z`;
    const selatanArea = `${selatanPath} L ${selatanPts[selatanPts.length - 1].x} ${bottomY} L ${selatanPts[0].x} ${bottomY} Z`;

    const yTicks = [20, 40, 60, 80, 100];
    const gridLinesSvg = yTicks
      .map((tick) => {
        const y = valToY(tick).toFixed(1);
        return `
          <line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" stroke="#EEF2EF" stroke-width="1" />
          <text x="${padLeft - 10}" y="${Number(y) + 4}" text-anchor="end" fill="#64748B" font-size="11.5" font-weight="500">${tick}%</text>
        `;
      })
      .join('');

    const xLabelsSvg = data
      .map((d, i) => {
        const x = idxToX(i).toFixed(1);
        const isActive = i === activePointIndex;
        return `<text x="${x}" y="${height - 8}" text-anchor="middle" fill="${isActive ? '#16803C' : '#64748B'}" font-size="12" font-weight="${isActive ? '700' : '500'}">${d.day}</text>`;
      })
      .join('');

    const activeX = idxToX(activePointIndex).toFixed(1);

    const pointsSvg = data
      .map((d, i) => {
        const u = utaraPts[i];
        const s = selatanPts[i];
        const isActive = i === activePointIndex;
        return `
          <circle class="chart-dot" cx="${u.x.toFixed(1)}" cy="${u.y.toFixed(1)}" r="${isActive ? 5.5 : 4}" fill="#1B6B3A" stroke="#FFFFFF" stroke-width="${isActive ? 2.5 : 2}" />
          <circle class="chart-dot" cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="${isActive ? 5.5 : 4}" fill="#84CC4A" stroke="#FFFFFF" stroke-width="${isActive ? 2.5 : 2}" />
          <rect class="chart-point-hit" data-index="${i}" x="${(u.x - plotW / 14).toFixed(1)}" y="${padTop}" width="${(plotW / 7).toFixed(1)}" height="${plotH + 24}" fill="transparent" />
        `;
      })
      .join('');

    chartSvg.innerHTML = `
      <defs>
        <linearGradient id="gradUtara" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#1B6B3A" stop-opacity="0.16" />
          <stop offset="100%" stop-color="#1B6B3A" stop-opacity="0.0" />
        </linearGradient>
        <linearGradient id="gradSelatan" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#84CC4A" stop-opacity="0.18" />
          <stop offset="100%" stop-color="#84CC4A" stop-opacity="0.0" />
        </linearGradient>
      </defs>
      ${gridLinesSvg}
      <line x1="${activeX}" y1="${padTop}" x2="${activeX}" y2="${bottomY}" stroke="#CBD5E1" stroke-width="1.2" stroke-dasharray="4 4" />
      <path d="${utaraArea}" fill="url(#gradUtara)" />
      <path d="${selatanArea}" fill="url(#gradSelatan)" />
      <path d="${selatanPath}" fill="none" stroke="#84CC4A" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
      <path d="${utaraPath}" fill="none" stroke="#1B6B3A" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round" />
      ${xLabelsSvg}
      ${pointsSvg}
    `;

    chartSvg.querySelectorAll('.chart-point-hit').forEach((rect) => {
      const idx = Number(rect.getAttribute('data-index'));
      rect.addEventListener('mouseenter', () => {
        activePointIndex = idx;
        renderMoistureChart();
      });
      rect.addEventListener('click', () => {
        activePointIndex = idx;
        renderMoistureChart();
      });
    });

    const activeData = data[activePointIndex];
    if (chartTooltip && tooltipDay && tooltipUtara && tooltipSelatan && chartContainer) {
      tooltipDay.textContent = activeData.fullDay;
      tooltipUtara.textContent = `${activeData.utara}%`;
      tooltipSelatan.textContent = `${activeData.selatan}%`;

      const xPct = (idxToX(activePointIndex) / width) * 100;
      const clampedPct = Math.max(18, Math.min(82, xPct));
      chartTooltip.style.left = `${clampedPct}%`;
    }
  }

  chartRangeSelect?.addEventListener('change', (e) => {
    activeChartRange = e.target.value;
    activePointIndex = 6;
    renderMoistureChart();
  });

  if (chartContainer && typeof ResizeObserver !== 'undefined') {
    let lastChartWidth = chartContainer.clientWidth;
    const chartResizeObserver = new ResizeObserver(() => {
      if (chartContainer.clientWidth && chartContainer.clientWidth !== lastChartWidth) {
        lastChartWidth = chartContainer.clientWidth;
        renderMoistureChart();
      }
    });
    chartResizeObserver.observe(chartContainer);
  }

  /* =========================================================================
     10. Notification Bell Popover
     ========================================================================= */
  const notifBtn = document.getElementById('notif-btn');
  const notifPopover = document.getElementById('notif-popover');
  const notifClearBtn = document.getElementById('notif-clear-btn');

  notifBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = notifPopover?.classList.contains('hidden');
    notifPopover?.classList.toggle('hidden', !isHidden);
    notifBtn.setAttribute('aria-expanded', String(isHidden));
  });

  notifClearBtn?.addEventListener('click', () => {
    notificationsRead = true;
    notifDot?.classList.add('hidden');
    notifPopover?.classList.add('hidden');
    showToast('Semua pemberitahuan ditandai sudah dibaca.', 'info');
  });

  document.addEventListener('click', (e) => {
    if (
      notifPopover &&
      !notifPopover.classList.contains('hidden') &&
      !notifPopover.contains(e.target) &&
      !notifBtn?.contains(e.target)
    ) {
      notifPopover.classList.add('hidden');
      notifBtn?.setAttribute('aria-expanded', 'false');
    }
  });

  /* =========================================================================
     11. Real Data CSV Export ("Unduh Laporan")
     ========================================================================= */
  const btnDownloadReport = document.getElementById('btn-download-report');

  function downloadCsvReport() {
    const todayStr = new Date().toLocaleDateString('id-ID');
    const pumpStatusStr = `${state.isPumpOn ? 'NYALA' : 'MATI'} (${state.pumpMode === 'otomatis' ? 'Otomatis' : 'Manual'})`;
    const tankLiters = Math.round((state.tankLevelPct / 100) * state.tankCapacityLiters);
    const estCost = Math.round(state.energyKwh * state.tariffPerKwh);

    const rows = [
      ['Laporan Harian Irigasi Cerdas', `Tanggal: ${todayStr}`, `Pemilik: ${activeUser.fullName}`],
      ['Kebun / Lahan', activeUser.farmName || 'Pemilik Lahan', `Lokasi Cuaca: ${state.locationName}`],
      [],
      ['Ringkasan Sistem', 'Nilai', 'Keterangan'],
      ['Kondisi Tanah', cardSoilValue?.textContent || 'Lembap', cardSoilSubtext?.textContent || ''],
      ['Sisa Air Tandon', `${state.tankLevelPct}% (${tankLiters} Liter)`, `Kapasitas ${state.tankCapacityLiters} L`],
      ['Air Digunakan', `${state.waterUsedLiters} Liter`, `Air Dihemat: ${state.waterSavedLiters} Liter`],
      ['Pemakaian Listrik', `${state.energyKwh} kWh (${formatRupiah(estCost)})`, `Tarif ${formatRupiah(state.tariffPerKwh)}/kWh`],
      ['Status Pompa Utama', pumpStatusStr, `Batas Otomatis: ${state.minMoistureThreshold}% - ${state.maxMoistureThreshold}%`],
      ['Cuaca Saat Ini', `${weatherState.temp}°C ${weatherState.condition}`, `Peluang Hujan: ${weatherState.rainChance}%`],
      [],
      ['Nama Petak', 'Tanaman', 'Kelembapan', 'Status Pompa', 'Update Terakhir'],
      ...state.plots.map((p) => [
        p.name,
        p.crop,
        `${p.moisture}%`,
        p.pumpOn ? 'Menyiram (ON)' : 'Mati (Cukup Air)',
        p.updated,
      ]),
      [],
      ['Jadwal Penyiraman', 'Target Petak', 'Jam (WIB)', 'Durasi', 'Status'],
      ...state.schedules.map((sc) => [
        sc.label,
        sc.plotTarget,
        `${sc.timeWib} WIB`,
        `${sc.durationMin} menit`,
        sc.enabled ? 'Aktif' : 'Nonaktif',
      ]),
      [],
      ['Riwayat Aktivitas', 'Detail', 'Status'],
      ...state.activities.map((a) => [a.title, a.subtitle, a.tag]),
    ];

    const csvContent = rows
      .map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const safeFileName =
      activeUser.fullName.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '') || 'Pengguna';
    const link = document.createElement('a');
    link.href = url;
    link.download = `Laporan_Irigasi_Cerdas_${safeFileName}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast('Laporan lengkap berhasil diunduh (CSV).');
  }

  btnDownloadReport?.addEventListener('click', downloadCsvReport);

  /* =========================================================================
     12. Sidebar Navigation & Full-Featured Sub-views
     ========================================================================= */
  const navLinks = document.querySelectorAll('[data-nav]');
  const jumpLinks = document.querySelectorAll('[data-jump-nav]');
  const viewDashboard = document.getElementById('view-dashboard');
  const viewSecondary = document.getElementById('view-secondary');
  const secondaryTitle = document.getElementById('secondary-title');
  const secondarySubtitle = document.getElementById('secondary-subtitle');
  const secondaryBody = document.getElementById('secondary-body');
  const btnBackDashboard = document.getElementById('btn-back-dashboard');

  let currentNav = 'dashboard';

  const secondaryMeta = {
    'petak-lahan': {
      title: 'Daftar Petak Lahan',
      subtitle: 'Tambah, ubah, atau nyalakan penyiraman per petak secara langsung.',
    },
    cuaca: {
      title: 'Prakiraan Cuaca Lahan',
      subtitle: 'Informasi cuaca lokal otomatis menyesuaikan lokasi lahan Anda.',
    },
    'kontrol-irigasi': {
      title: 'Kontrol Irigasi & Jadwal Otomatis',
      subtitle: 'Atur mode pompa, batas kelembapan, simulasi otomatis, dan jadwal siram harian.',
    },
    laporan: {
      title: 'Laporan & Riwayat Lengkap',
      subtitle: 'Data pemakaian air, biaya listrik aktual, dan riwayat lengkap dari database.',
    },
    'pengaturan-alat': {
      title: 'Pengaturan Akun & Lahan',
      subtitle: 'Ubah profil, nama kebun, kata sandi, dan lokasi prakiraan cuaca.',
    },
    bantuan: {
      title: 'Bantuan Penggunaan',
      subtitle: 'Panduan singkat memakai aplikasi Irigasi Cerdas.',
    },
  };

  function renderSecondaryView(section) {
    if (!secondaryBody || !secondaryTitle || !secondarySubtitle) return;
    const meta = secondaryMeta[section];
    if (!meta) return;

    secondaryTitle.textContent = meta.title;
    secondarySubtitle.textContent = meta.subtitle;

    if (section === 'petak-lahan') {
      const cardsHtml = state.plots
        .map(
          (plot) => `
          <div class="bg-white rounded-2xl border border-[#EEF2EF] p-5 shadow-sm flex flex-col justify-between gap-4">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-3 min-w-0">
                <span class="w-10 h-10 rounded-full bg-brand-100 text-brand-700 font-bold text-sm flex items-center justify-center flex-shrink-0">${escapeHtml(plot.code)}</span>
                <div class="min-w-0">
                  <h3 class="font-bold text-slate-900 truncate">${escapeHtml(plot.name)}</h3>
                  <p class="text-xs text-slate-500 truncate">Tanaman: ${escapeHtml(plot.crop)}</p>
                </div>
              </div>
              <span class="px-2.5 py-1 rounded-full text-xs font-semibold flex-shrink-0 ${plot.pumpOn ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-600'}">
                ${plot.pumpOn ? 'Menyiram (ON)' : 'Mati (Cukup Air)'}
              </span>
            </div>
            <div class="p-3.5 rounded-xl bg-[#F6F8F7] flex items-center justify-between">
              <span class="text-xs font-medium text-slate-600">Kelembapan Tanah</span>
              <span class="text-lg font-extrabold text-slate-900">${plot.moisture}%</span>
            </div>
            <div class="flex gap-2">
              <button type="button" data-toggle-plot="${plot.id}" class="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
            plot.pumpOn
              ? 'bg-slate-100 hover:bg-slate-200 text-slate-800'
              : 'bg-brand-600 hover:bg-brand-700 text-white'
          }">
                ${plot.pumpOn ? 'Matikan' : 'Siram Petak'}
              </button>
              <button type="button" data-sub-edit-plot="${plot.id}" class="px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50">
                Edit
              </button>
            </div>
          </div>
        `
        )
        .join('');

      secondaryBody.innerHTML = `
        <div class="md:col-span-2 lg:col-span-3 flex items-center justify-between bg-white rounded-2xl border border-[#EEF2EF] p-4">
          <p class="text-sm font-medium text-slate-600">Total petak aktif: <strong class="text-slate-900">${state.plots.length} Petak</strong></p>
          <button type="button" id="sub-add-plot-btn" class="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold">+ Tambah Petak</button>
        </div>
        ${cardsHtml}
      `;

      document.getElementById('sub-add-plot-btn')?.addEventListener('click', () => openPlotModal(null));
      secondaryBody.querySelectorAll('[data-toggle-plot]').forEach((btn) => {
        btn.addEventListener('click', () => togglePlotPump(Number(btn.getAttribute('data-toggle-plot'))));
      });
      secondaryBody.querySelectorAll('[data-sub-edit-plot]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const plot = state.plots.find((p) => p.id === Number(btn.getAttribute('data-sub-edit-plot')));
          if (plot) openPlotModal(plot);
        });
      });
    } else if (section === 'kontrol-irigasi') {
      const isOn = state.isPumpOn;
      const isAuto = state.pumpMode === 'otomatis';
      const plotOptions = ['Semua Petak', ...state.plots.map((p) => p.name)]
        .map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`)
        .join('');

      const schedulesHtml = state.schedules.length
        ? state.schedules
            .map(
              (sc) => `
            <div class="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl border border-slate-100 bg-slate-50/70">
              <div class="min-w-0">
                <p class="text-sm font-bold text-slate-900">${escapeHtml(sc.label)} <span class="text-brand-700 font-extrabold ml-1">${escapeHtml(sc.timeWib)} WIB</span></p>
                <p class="text-xs text-slate-500 mt-0.5">${escapeHtml(sc.plotTarget)} • ${sc.durationMin} menit ${sc.skipOnRain ? '• Tunda saat hujan' : ''}</p>
              </div>
              <div class="flex items-center gap-2">
                <button type="button" data-toggle-schedule="${sc.id}" data-next-enabled="${!sc.enabled}" class="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${sc.enabled ? 'bg-brand-100 text-brand-700 hover:bg-brand-200' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'}">
                  ${sc.enabled ? 'Aktif' : 'Nonaktif'}
                </button>
                <button type="button" data-delete-schedule="${sc.id}" class="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-rose-600 hover:bg-rose-50">Hapus</button>
              </div>
            </div>
          `
            )
            .join('')
        : '<p class="text-xs text-slate-400">Belum ada jadwal penyiraman harian.</p>';

      secondaryBody.innerHTML = `
        <div class="bg-[#F5F2FC] rounded-2xl border border-[#E7E0F8] p-6 space-y-4">
          <h3 class="font-bold text-slate-900 text-base">Kontrol Pompa Utama</h3>
          <p class="text-xs text-slate-600">Status saat ini: <strong>${isOn ? 'NYALA' : 'MATI'} (${isAuto ? 'Otomatis' : 'Manual'})</strong></p>
          <div class="flex gap-2">
            <button type="button" id="sub-mode-auto" class="flex-1 py-2 rounded-xl text-xs font-bold ${isAuto ? 'bg-purple-600 text-white' : 'bg-white text-slate-700 border border-slate-200'}">Mode Otomatis</button>
            <button type="button" id="sub-mode-manual" class="flex-1 py-2 rounded-xl text-xs font-bold ${!isAuto ? 'bg-purple-600 text-white' : 'bg-white text-slate-700 border border-slate-200'}">Mode Manual</button>
          </div>
          <button type="button" id="sub-pump-toggle" class="w-full py-2.5 rounded-xl text-sm font-bold text-white transition-colors ${isOn ? 'bg-rose-600 hover:bg-rose-700' : 'bg-brand-600 hover:bg-brand-700'}">
            ${isOn ? 'Matikan Pompa Sekarang' : 'Nyalakan Pompa Sekarang'}
          </button>
          <div class="pt-2 border-t border-purple-200/60">
            <button type="button" id="btn-sim-dry" class="w-full py-2 rounded-xl bg-white hover:bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold transition-colors">
              Simulasi Tanah Kering (Uji Otomatis)
            </button>
          </div>
        </div>

        <div class="bg-white rounded-2xl border border-[#EEF2EF] p-6 space-y-4 md:col-span-2">
          <h3 class="font-bold text-slate-900 text-base">Batas Kelembapan Otomatis</h3>
          <p class="text-xs text-slate-500">Dalam mode Otomatis, penyiraman otomatis menyala jika tanah kering di bawah batas bawah (kecuali peluang hujan ≥ 60%) dan mati saat mencapai batas atas.</p>
          <div class="space-y-3 pt-1">
            <div>
              <div class="flex justify-between text-xs font-semibold text-slate-700 mb-1">
                <span>Mulai Siram Jika di Bawah</span>
                <span id="sub-min-val">${state.minMoistureThreshold}%</span>
              </div>
              <input id="sub-min-slider" type="range" min="20" max="65" value="${state.minMoistureThreshold}" class="w-full irigasi-slider" />
            </div>
            <div>
              <div class="flex justify-between text-xs font-semibold text-slate-700 mb-1">
                <span>Berhenti Siram Jika Mencapai</span>
                <span id="sub-max-val">${state.maxMoistureThreshold}%</span>
              </div>
              <input id="sub-max-slider" type="range" min="65" max="90" value="${state.maxMoistureThreshold}" class="w-full irigasi-slider" />
            </div>
          </div>
          <button type="button" id="sub-save-thresholds" class="px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold">
            Simpan Batas Otomatis
          </button>
        </div>

        <!-- Daily Watering Schedules Card -->
        <div class="bg-white rounded-2xl border border-[#EEF2EF] p-6 space-y-4 md:col-span-2 lg:col-span-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 class="font-bold text-slate-900 text-base">Jadwal Penyiraman Harian</h3>
              <p class="text-xs text-slate-500">Tersimpan di database per akun — otomatis ditunda jika hujan.</p>
            </div>
          </div>
          <div class="space-y-2.5">${schedulesHtml}</div>
          <form id="form-add-schedule" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 pt-3 border-t border-slate-100">
            <input type="text" id="sched-label" required placeholder="Nama jadwal (mis. Siram Malam)" class="h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-xs font-medium focus:bg-white focus:border-brand-600 focus:outline-none">
            <select id="sched-target" class="h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-xs font-medium focus:bg-white focus:border-brand-600 focus:outline-none">${plotOptions}</select>
            <input type="time" id="sched-time" required value="07:00" class="h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-xs font-medium focus:bg-white focus:border-brand-600 focus:outline-none">
            <input type="number" id="sched-duration" min="5" max="120" value="15" placeholder="Durasi (menit)" class="h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-xs font-medium focus:bg-white focus:border-brand-600 focus:outline-none">
            <button type="submit" class="h-10 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold">+ Tambah Jadwal</button>
          </form>
        </div>
      `;

      document.getElementById('sub-mode-auto')?.addEventListener('click', () => modeBtnAuto?.click());
      document.getElementById('sub-mode-manual')?.addEventListener('click', () => modeBtnManual?.click());
      document.getElementById('sub-pump-toggle')?.addEventListener('click', () => pumpSwitch?.click());

      document.getElementById('btn-sim-dry')?.addEventListener('click', async () => {
        if (state.plots.length === 0) return;
        const firstPlot = state.plots[0];
        const dryVal = Math.max(18, state.minMoistureThreshold - 10);
        rainDelayLogged = false;
        await persistSettings(
          {
            pumpMode: 'otomatis',
            plotUpdates: [{ id: firstPlot.id, moisture: dryVal, pumpOn: false }],
            customLog: {
              title: `Simulasi Sensor: ${firstPlot.name} Kering (${dryVal}%)`,
              subtitle: 'Pengujian Otomatisasi Irigasi',
              tag: 'Simulasi',
              tone: 'amber',
            },
          },
          `${firstPlot.name} diturunkan ke ${dryVal}%. Pantau respons otomatis dalam 4 detik!`
        );
      });

      const minSlider = document.getElementById('sub-min-slider');
      const maxSlider = document.getElementById('sub-max-slider');
      let draftMin = state.minMoistureThreshold;
      let draftMax = state.maxMoistureThreshold;

      minSlider?.addEventListener('input', (e) => {
        draftMin = Number(e.target.value);
        document.getElementById('sub-min-val').textContent = `${draftMin}%`;
      });
      maxSlider?.addEventListener('input', (e) => {
        draftMax = Number(e.target.value);
        document.getElementById('sub-max-val').textContent = `${draftMax}%`;
      });

      document.getElementById('sub-save-thresholds')?.addEventListener('click', async () => {
        await persistSettings(
          { minMoistureThreshold: draftMin, maxMoistureThreshold: draftMax, logAction: 'threshold-change' },
          'Batas kelembapan otomatis disimpan ke database.'
        );
      });

      document.getElementById('form-add-schedule')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const label = document.getElementById('sched-label')?.value.trim() || '';
        const plotTarget = document.getElementById('sched-target')?.value || 'Semua Petak';
        const timeWib = document.getElementById('sched-time')?.value || '';
        const durationMin = Number(document.getElementById('sched-duration')?.value || 15);
        if (!label || !timeWib) return;

        const { ok, data } = await apiRequest('/api/schedules', {
          method: 'POST',
          body: JSON.stringify({ label, plotTarget, timeWib, durationMin, skipOnRain: true }),
        });
        if (!ok || !data.ok) {
          showToast(data.message || 'Gagal menambah jadwal.', 'error');
          return;
        }
        applyDashboardSnapshot(data);
        showToast(`Jadwal "${label}" berhasil ditambahkan.`);
      });

      secondaryBody.querySelectorAll('[data-toggle-schedule]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = Number(btn.getAttribute('data-toggle-schedule'));
          const enabled = btn.getAttribute('data-next-enabled') === 'true';
          const { ok, data } = await apiRequest('/api/schedules', {
            method: 'PATCH',
            body: JSON.stringify({ id, enabled }),
          });
          if (ok && data.ok) {
            applyDashboardSnapshot(data);
            showToast(enabled ? 'Jadwal diaktifkan.' : 'Jadwal dinonaktifkan.', 'info');
          }
        });
      });

      secondaryBody.querySelectorAll('[data-delete-schedule]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = Number(btn.getAttribute('data-delete-schedule'));
          const { ok, data } = await apiRequest('/api/schedules', {
            method: 'DELETE',
            body: JSON.stringify({ id }),
          });
          if (ok && data.ok) {
            applyDashboardSnapshot(data);
            showToast('Jadwal dihapus.', 'info');
          }
        });
      });
    } else if (section === 'cuaca') {
      const w = weatherState;
      const forecastHtml = w.forecast
        .map(
          (f) => `
          <div class="p-3 rounded-xl bg-slate-50 border border-slate-100 text-center">
            <p class="text-xs font-bold text-slate-500">${f.dayName}</p>
            <div class="my-2 flex justify-center">${getSmallWeatherIcon(f.iconType)}</div>
            <p class="text-xs font-bold text-slate-800">${f.max}° / ${f.min}°</p>
            <p class="text-[11px] text-slate-500 mt-0.5 truncate">${f.label}</p>
          </div>
        `
        )
        .join('');

      secondaryBody.innerHTML = `
        <div class="bg-[#EEF6FD] rounded-2xl border border-[#DCEBFA] p-6 space-y-4 md:col-span-2">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p class="text-xs font-bold uppercase text-sky-700">Cuaca Live • ${escapeHtml(state.locationName)}</p>
              <p class="text-3xl font-extrabold text-slate-900 mt-1">${w.temp}°C • ${w.condition}</p>
            </div>
            <button type="button" id="sub-change-location-btn" class="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 text-sky-700 text-xs font-bold border border-sky-200">
              Ubah Lokasi Lahan
            </button>
          </div>
          <p class="text-sm text-slate-600">${w.adviceLong}</p>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">${forecastHtml}</div>
        </div>
        <div class="bg-white rounded-2xl border border-[#EEF2EF] p-6 space-y-2.5">
          <h3 class="font-bold text-slate-900 text-base">Info Cuaca Lahan</h3>
          <div class="flex justify-between text-sm py-1.5 border-b border-slate-100"><span class="text-slate-500">Lokasi</span><span class="font-bold text-right">${escapeHtml(state.locationName)}</span></div>
          <div class="flex justify-between text-sm py-1.5 border-b border-slate-100"><span class="text-slate-500">Kelembapan Udara</span><span class="font-bold">${w.humidity}%</span></div>
          <div class="flex justify-between text-sm py-1.5 border-b border-slate-100"><span class="text-slate-500">Kecepatan Angin</span><span class="font-bold">${w.wind} km/jam</span></div>
          <div class="flex justify-between text-sm py-1.5 border-b border-slate-100"><span class="text-slate-500">Peluang Hujan</span><span class="font-bold text-sky-700">${w.rainChance}% (${w.adviceShort})</span></div>
          <div class="flex justify-between text-sm py-1.5"><span class="text-slate-500">Pembaruan</span><span class="font-semibold text-slate-600">${w.updatedAt}</span></div>
        </div>
      `;
      document.getElementById('sub-change-location-btn')?.addEventListener('click', openLocationModal);
    } else if (section === 'laporan') {
      const estCost = Math.round(state.energyKwh * state.tariffPerKwh);
      const logsRowsHtml = state.activities
        .map(
          (a) => `
          <tr class="border-b border-slate-100 last:border-0">
            <td class="py-3 pr-4 font-bold text-slate-800">${escapeHtml(a.title)}</td>
            <td class="py-3 px-3 text-slate-500">${escapeHtml(a.subtitle)}</td>
            <td class="py-3 pl-3 text-right">
              <span class="inline-flex px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700">${escapeHtml(a.tag)}</span>
            </td>
          </tr>
        `
        )
        .join('');

      secondaryBody.innerHTML = `
        <div class="bg-[#EFF8F1] rounded-2xl border border-[#E1EFE4] p-6">
          <p class="text-xs font-semibold text-brand-700">Air Dihemat (Tunda Hujan)</p>
          <p class="text-2xl font-extrabold text-slate-900 mt-1">${state.waterSavedLiters.toLocaleString('id-ID')} Liter</p>
          <p class="text-xs text-slate-600 mt-2">Total air terpakai tercatat: <strong>${state.waterUsedLiters.toLocaleString('id-ID')} Liter</strong>.</p>
        </div>
        <div class="bg-[#FEF9EA] rounded-2xl border border-[#F8EED0] p-6">
          <p class="text-xs font-semibold text-amber-700">Estimasi Biaya Listrik Aktual</p>
          <p class="text-2xl font-extrabold text-slate-900 mt-1">${formatRupiah(estCost)}</p>
          <p class="text-xs text-slate-600 mt-2">Pemakaian tercatat: <strong>${formatDecimalId(state.energyKwh, 1)} kWh</strong> (${formatRupiah(state.tariffPerKwh)}/kWh).</p>
        </div>
        <div class="bg-white rounded-2xl border border-[#EEF2EF] p-6 flex flex-col justify-between">
          <div>
            <h3 class="font-bold text-slate-900">Unduh Catatan Lengkap</h3>
            <p class="text-xs text-slate-500 mt-1">Ekspor seluruh petak, jadwal, pemakaian air/listrik, dan ${state.activities.length} riwayat aktivitas ke CSV.</p>
          </div>
          <button type="button" id="sub-download-csv" class="mt-4 w-full py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold">Unduh File Laporan (CSV)</button>
        </div>

        <div class="bg-white rounded-2xl border border-[#EEF2EF] p-6 md:col-span-2 lg:col-span-3">
          <div class="flex items-center justify-between mb-4">
            <h3 class="font-bold text-slate-900 text-base">Riwayat Aktivitas Lengkap (${state.activities.length} Catatan)</h3>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs min-w-[520px]">
              <thead>
                <tr class="border-b border-slate-100 text-[11px] uppercase text-slate-400">
                  <th class="pb-2.5 pr-4">AKTIVITAS</th>
                  <th class="pb-2.5 px-3">KETERANGAN</th>
                  <th class="pb-2.5 pl-3 text-right">LABEL</th>
                </tr>
              </thead>
              <tbody>${logsRowsHtml}</tbody>
            </table>
          </div>
        </div>
      `;
      document.getElementById('sub-download-csv')?.addEventListener('click', downloadCsvReport);
    } else if (section === 'pengaturan-alat') {
      secondaryBody.innerHTML = `
        <div class="bg-white rounded-2xl border border-[#EEF2EF] p-6 space-y-4 md:col-span-2">
          <h3 class="font-bold text-slate-900 text-base">Edit Profil &amp; Ganti Kata Sandi</h3>
          <form id="form-edit-profile" class="space-y-4">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label for="prof-fullname" class="block text-xs font-bold text-slate-700 mb-1.5">Nama Lengkap</label>
                <input type="text" id="prof-fullname" required value="${escapeHtml(activeUser.fullName)}" class="w-full h-11 px-3.5 rounded-xl border border-slate-200 bg-slate-50 text-sm font-medium focus:bg-white focus:border-brand-600 focus:outline-none">
              </div>
              <div>
                <label for="prof-farmname" class="block text-xs font-bold text-slate-700 mb-1.5">Nama Lahan / Kebun</label>
                <input type="text" id="prof-farmname" value="${escapeHtml(activeUser.farmName || '')}" class="w-full h-11 px-3.5 rounded-xl border border-slate-200 bg-slate-50 text-sm font-medium focus:bg-white focus:border-brand-600 focus:outline-none">
              </div>
            </div>
            <div class="pt-3 border-t border-slate-100">
              <p class="text-xs font-semibold text-slate-500 mb-3">Ganti Kata Sandi (Opsional — kosongkan jika tidak ingin mengubah)</p>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label for="prof-cur-pass" class="block text-xs font-bold text-slate-700 mb-1.5">Kata Sandi Saat Ini</label>
                  <input type="password" id="prof-cur-pass" placeholder="Masukkan sandi lama" class="w-full h-11 px-3.5 rounded-xl border border-slate-200 bg-slate-50 text-sm font-medium focus:bg-white focus:border-brand-600 focus:outline-none">
                </div>
                <div>
                  <label for="prof-new-pass" class="block text-xs font-bold text-slate-700 mb-1.5">Kata Sandi Baru</label>
                  <input type="password" id="prof-new-pass" placeholder="Minimal 6 karakter" class="w-full h-11 px-3.5 rounded-xl border border-slate-200 bg-slate-50 text-sm font-medium focus:bg-white focus:border-brand-600 focus:outline-none">
                </div>
              </div>
            </div>
            <button type="submit" id="btn-save-profile" class="px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold">
              Simpan Perubahan Profil
            </button>
          </form>
        </div>

        <div class="bg-white rounded-2xl border border-[#EEF2EF] p-6 space-y-3">
          <h3 class="font-bold text-slate-900 text-base">Lokasi &amp; Ringkasan Sistem</h3>
          <div class="p-3.5 rounded-xl bg-[#EEF6FD] border border-[#DCEBFA] space-y-2">
            <p class="text-xs font-semibold text-sky-800">Lokasi Prakiraan Cuaca</p>
            <p class="text-sm font-bold text-slate-900">${escapeHtml(state.locationName)}</p>
            <button type="button" id="settings-change-loc" class="px-3 py-1.5 rounded-lg bg-white text-sky-700 text-xs font-bold border border-sky-200 hover:bg-sky-50">Ubah Lokasi</button>
          </div>
          <div class="flex items-center justify-between p-3 rounded-xl bg-[#EFF8F1]"><span class="text-xs font-semibold">Email Terdaftar</span><span class="text-xs font-bold text-brand-700 truncate max-w-[140px]">${escapeHtml(activeUser.email || 'Belum diisi')}</span></div>
          <div class="flex items-center justify-between p-3 rounded-xl bg-[#EFF8F1]"><span class="text-xs font-semibold">Total Petak Aktif</span><span class="text-xs font-bold text-brand-700">${state.plots.length} Petak</span></div>
          <div class="flex items-center justify-between p-3 rounded-xl bg-[#EFF8F1]"><span class="text-xs font-semibold">Jadwal Aktif</span><span class="text-xs font-bold text-brand-700">${state.schedules.filter((s) => s.enabled).length} Jadwal</span></div>
        </div>
      `;

      document.getElementById('settings-change-loc')?.addEventListener('click', openLocationModal);
      document.getElementById('form-edit-profile')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fullName = document.getElementById('prof-fullname')?.value.trim() || '';
        const farmName = document.getElementById('prof-farmname')?.value.trim() || '';
        const currentPassword = document.getElementById('prof-cur-pass')?.value || '';
        const newPassword = document.getElementById('prof-new-pass')?.value || '';
        if (!fullName) {
          showToast('Nama Lengkap tidak boleh kosong.', 'error');
          return;
        }
        const { ok, data } = await apiRequest('/api/profile', {
          method: 'PATCH',
          body: JSON.stringify({ fullName, farmName, currentPassword, newPassword }),
        });
        if (!ok || !data.ok) {
          showToast(data.message || 'Gagal menyimpan profil.', 'error');
          return;
        }
        applyUserProfile(data.user);
        try {
          localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(data.user));
        } catch {
          // Ignore storage error
        }
        showToast(data.message || 'Profil berhasil diperbarui.');
        const dash = await apiRequest('/api/dashboard');
        if (dash.ok && dash.data.ok) applyDashboardSnapshot(dash.data);
      });
    } else if (section === 'bantuan') {
      secondaryBody.innerHTML = `
        <div class="bg-white rounded-2xl border border-[#EEF2EF] p-6 space-y-3 md:col-span-3">
          <h3 class="font-bold text-slate-900">Cara Mudah Menggunakan Irigasi Cerdas</h3>
          <ul class="space-y-2 text-sm text-slate-600 list-disc pl-5">
            <li><strong>Otomatisasi Real-Time:</strong> Saat tanah kering (&lt; batas minimum) dalam mode <em>Otomatis</em>, sistem menyiram otomatis dan berhenti ketika cukup lembap — atau menunda siram jika peluang hujan Open-Meteo tinggi (≥ 60%).</li>
            <li><strong>Isi Tandon &amp; Biaya Listrik:</strong> Sisa air tandon dan biaya listrik diperbarui sesuai pemakaian penyiraman. Klik tombol <em>Isi</em> pada kartu tandon untuk mengisi ulang hingga 100%.</li>
            <li><strong>Jadwal Harian &amp; Petak Lahan:</strong> Tambah/edit petak tanaman di tabel dashboard atau atur jadwal siram rutin di menu <em>Kontrol Irigasi</em>.</li>
            <li><strong>Profil &amp; Lokasi Cuaca:</strong> Ubah nama kebun, kata sandi, dan kota lokasi kebun di menu <em>Pengaturan Alat</em> atau langsung lewat tombol <em>Ubah Lokasi</em>.</li>
          </ul>
        </div>
      `;
    }
  }

  function navigateTo(section) {
    currentNav = section;
    navLinks.forEach((link) => {
      const isMatch = link.getAttribute('data-nav') === section;
      link.classList.toggle('active', isMatch);
      if (isMatch) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });

    if (section === 'dashboard') {
      viewDashboard?.classList.remove('hidden');
      viewSecondary?.classList.add('hidden');
    } else {
      viewDashboard?.classList.add('hidden');
      viewSecondary?.classList.remove('hidden');
      renderSecondaryView(section);
    }

    if (window.innerWidth < 1024) setSidebarOpen(false);
  }

  navLinks.forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const target = link.getAttribute('data-nav');
      if (target) navigateTo(target);
    });
  });

  jumpLinks.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-jump-nav');
      if (target) navigateTo(target);
    });
  });

  btnBackDashboard?.addEventListener('click', () => navigateTo('dashboard'));

  /* =========================================================================
     13. Live Weather Integration (Open-Meteo API)
     ========================================================================= */
  const weatherMainIconEl = document.getElementById('weather-main-icon');
  const weatherTempEl = document.getElementById('weather-temp');
  const weatherConditionEl = document.getElementById('weather-condition');
  const weatherHumidityEl = document.getElementById('weather-humidity');
  const weatherWindEl = document.getElementById('weather-wind');
  const weatherRainBannerEl = document.getElementById('weather-rain-banner');
  const weatherRainTextEl = document.getElementById('weather-rain-text');
  const weatherForecastGridEl = document.getElementById('weather-forecast-grid');

  function decodeWmoCode(code) {
    if (code === 0) return { label: 'Cerah', iconType: 'sun' };
    if (code === 1 || code === 2) return { label: 'Cerah Berawan', iconType: 'partly' };
    if (code === 3) return { label: 'Berawan', iconType: 'cloud' };
    if (code === 45 || code === 48) return { label: 'Berkabut', iconType: 'cloud' };
    if (code >= 51 && code <= 57) return { label: 'Gerimis', iconType: 'rain' };
    if (code === 61 || code === 80) return { label: 'Hujan Ringan', iconType: 'rain' };
    if (code === 63 || code === 81) return { label: 'Hujan Sedang', iconType: 'rain' };
    if (code === 65 || code === 82 || code === 66 || code === 67) return { label: 'Hujan Lebat', iconType: 'rain' };
    if (code >= 95) return { label: 'Hujan Petir', iconType: 'storm' };
    return { label: 'Berawan', iconType: 'partly' };
  }

  function getMainWeatherIcon(iconType) {
    if (iconType === 'sun') {
      return `
        <svg class="w-14 h-14" viewBox="0 0 64 64" fill="none">
          <circle cx="32" cy="32" r="14" fill="#FBBF24"/>
          <g stroke="#FBBF24" stroke-width="3" stroke-linecap="round">
            <line x1="32" y1="8" x2="32" y2="13"/><line x1="32" y1="51" x2="32" y2="56"/>
            <line x1="8" y1="32" x2="13" y2="32"/><line x1="51" y1="32" x2="56" y2="32"/>
            <line x1="15" y1="15" x2="18.5" y2="18.5"/><line x1="45.5" y1="45.5" x2="49" y2="49"/>
            <line x1="49" y1="15" x2="45.5" y2="18.5"/><line x1="18.5" y1="45.5" x2="15" y2="49"/>
          </g>
        </svg>`;
    }
    if (iconType === 'cloud') {
      return `<svg class="w-14 h-14" viewBox="0 0 64 64" fill="none"><path d="M18 46h28a9 9 0 0 0 1.4-17.9A13 13 0 0 0 22 24a11 11 0 0 0-4 22Z" fill="#CBD5E1" stroke="#94A3B8" stroke-width="1.5"/></svg>`;
    }
    if (iconType === 'rain' || iconType === 'storm') {
      return `
        <svg class="w-14 h-14" viewBox="0 0 64 64" fill="none">
          <path d="M18 40h28a8.5 8.5 0 0 0 1.3-16.9A12.5 12.5 0 0 0 22 19a10.5 10.5 0 0 0-4 21Z" fill="#CBD5E1" stroke="#94A3B8" stroke-width="1.5"/>
          <g stroke="#0284C7" stroke-width="2.6" stroke-linecap="round">
            <line x1="23" y1="45" x2="21" y2="52"/><line x1="32" y1="45" x2="30" y2="52"/><line x1="41" y1="45" x2="39" y2="52"/>
          </g>
        </svg>`;
    }
    return `
      <svg class="w-14 h-14" viewBox="0 0 64 64" fill="none">
        <circle cx="24" cy="24" r="11" fill="#FBBF24"/>
        <g stroke="#FBBF24" stroke-width="2.5" stroke-linecap="round">
          <line x1="24" y1="6" x2="24" y2="9"/><line x1="24" y1="39" x2="24" y2="42"/>
          <line x1="6" y1="24" x2="9" y2="24"/><line x1="11.3" y1="11.3" x2="13.4" y2="13.4"/>
          <line x1="34.6" y1="13.4" x2="36.7" y2="11.3"/>
        </g>
        <path d="M22 44h24a8 8 0 0 0 1.2-15.9A11 11 0 0 0 26 24.5 9.5 9.5 0 0 0 22 44Z" fill="#E2E8F0" stroke="#CBD5E1" stroke-width="1.5"/>
      </svg>`;
  }

  function getSmallWeatherIcon(iconType) {
    if (iconType === 'sun') {
      return `<svg class="w-5 h-5 text-amber-400" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
    }
    if (iconType === 'rain' || iconType === 'storm') {
      return `<svg class="w-5 h-5 text-sky-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M8 19v2"/><path d="M12 19v2"/><path d="M16 19v2"/></svg>`;
    }
    if (iconType === 'cloud') {
      return `<svg class="w-5 h-5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>`;
    }
    return `<svg class="w-5 h-5 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="M20 12h2"/><path d="m19.07 4.93-1.41 1.41"/><path d="M15.947 12.65a4 4 0 0 0-5.925-4.128"/><path d="M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z"/></svg>`;
  }

  function formatShortDayId(dateStr) {
    const days = ['MIN', 'SEN', 'SEL', 'RAB', 'KAM', 'JUM', 'SAB'];
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return days[dt.getDay()] || '---';
  }

  function renderWeatherWidget() {
    const w = weatherState;
    if (weatherMainIconEl) weatherMainIconEl.innerHTML = getMainWeatherIcon(w.iconType);
    if (weatherTempEl) weatherTempEl.textContent = `${w.temp}°C`;
    if (weatherConditionEl) weatherConditionEl.textContent = w.condition;
    if (weatherHumidityEl) weatherHumidityEl.textContent = `${w.humidity}%`;
    if (weatherWindEl) weatherWindEl.textContent = `${w.wind} km/jam`;

    if (weatherRainBannerEl && weatherRainTextEl) {
      weatherRainTextEl.textContent = `${w.rainChance}% - ${w.adviceShort}`;
      if (w.rainChance >= 60) {
        weatherRainBannerEl.className =
          'mt-3 px-3 py-2 rounded-xl bg-[#EEF6FD] border border-[#DCEBFA] flex items-center justify-between gap-2 text-[12px]';
        weatherRainTextEl.className = 'font-bold text-sky-700';
      } else if (w.rainChance >= 35) {
        weatherRainBannerEl.className =
          'mt-3 px-3 py-2 rounded-xl bg-[#FEF9EA] border border-[#F8EED0] flex items-center justify-between gap-2 text-[12px]';
        weatherRainTextEl.className = 'font-bold text-amber-700';
      } else {
        weatherRainBannerEl.className =
          'mt-3 px-3 py-2 rounded-xl bg-[#EFF8F1] border border-[#E1EFE4] flex items-center justify-between gap-2 text-[12px]';
        weatherRainTextEl.className = 'font-bold text-brand-700';
      }
    }

    if (weatherForecastGridEl && w.forecast.length > 0) {
      weatherForecastGridEl.innerHTML = w.forecast
        .map(
          (f) => `
          <div class="p-2 rounded-xl bg-slate-50/70">
            <p class="text-[11px] font-bold text-slate-400">${f.dayName}</p>
            <div class="my-1.5 flex justify-center" aria-hidden="true">${getSmallWeatherIcon(f.iconType)}</div>
            <p class="text-[11.5px] font-bold text-slate-800">${f.max}° / ${f.min}°</p>
          </div>
        `
        )
        .join('');
    }
  }

  async function fetchLiveWeather() {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(state.latitude)}&longitude=${encodeURIComponent(state.longitude)}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&hourly=precipitation_probability&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=Asia%2FJakarta`;

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const current = data.current || {};
      const decoded = decodeWmoCode(Number(current.weather_code));

      let rainChance = 0;
      if (current.time && Array.isArray(data.hourly?.time) && Array.isArray(data.hourly?.precipitation_probability)) {
        const hourKey = `${String(current.time).slice(0, 13)}:00`;
        const idx = data.hourly.time.indexOf(hourKey);
        if (idx !== -1 && data.hourly.precipitation_probability[idx] != null) {
          rainChance = Math.round(data.hourly.precipitation_probability[idx]);
        }
      }

      let adviceShort = 'Aman Menyiram';
      let adviceLong = 'Cuaca cukup cerah dengan peluang hujan rendah. Jadwal penyiraman berjalan normal.';
      if (rainChance >= 60) {
        adviceShort = 'Otomatis Tunda Siram';
        adviceLong = `Peluang hujan saat ini tinggi (${rainChance}%). Sistem otomatis menunda penyiraman untuk menghemat air tandon dan listrik.`;
      } else if (rainChance >= 35) {
        adviceShort = 'Siaga Hujan';
        adviceLong = `Ada potensi hujan ringan hingga sedang (${rainChance}%). Sistem memantau kelembapan tanah sebelum menyalakan pompa.`;
      }

      const daily = data.daily || {};
      const forecast = [];
      const count = Math.min(4, Array.isArray(daily.time) ? daily.time.length : 0);
      for (let i = 0; i < count; i++) {
        const dInfo = decodeWmoCode(Number(daily.weather_code?.[i]));
        forecast.push({
          dayName: formatShortDayId(daily.time[i]),
          max: Math.round(daily.temperature_2m_max?.[i] ?? 0),
          min: Math.round(daily.temperature_2m_min?.[i] ?? 0),
          label: dInfo.label,
          iconType: dInfo.iconType,
        });
      }

      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');

      weatherState.loaded = true;
      weatherState.temp = Math.round(current.temperature_2m ?? 0);
      weatherState.condition = decoded.label;
      weatherState.iconType = decoded.iconType;
      weatherState.humidity = Math.round(current.relative_humidity_2m ?? 0);
      weatherState.wind = Math.round(current.wind_speed_10m ?? 0);
      weatherState.rainChance = rainChance;
      weatherState.adviceShort = adviceShort;
      weatherState.adviceLong = adviceLong;
      weatherState.updatedAt = `${hh}:${mm} WIB`;
      weatherState.forecast = forecast;

      renderWeatherWidget();
      renderNotifications();
      if (currentNav === 'cuaca') renderSecondaryView('cuaca');
    } catch (err) {
      console.warn('Gagal memuat cuaca Open-Meteo:', err);
      if (weatherConditionEl && weatherTempEl?.textContent === '--°C') {
        weatherConditionEl.textContent = 'Gagal memuat cuaca';
      }
      if (weatherRainTextEl && weatherRainTextEl.textContent === 'Memuat data...') {
        weatherRainTextEl.textContent = 'Tidak terhubung';
      }
    }
  }

  /* =========================================================================
     14. Bootstrap Dashboard & Start Live Simulation
     ========================================================================= */
  async function bootstrapDashboard() {
    try {
      const { ok, data } = await apiRequest('/api/dashboard');
      if (ok && data.ok) {
        applyDashboardSnapshot(data);
      }
    } catch (err) {
      if (err.message !== 'Unauthorized') {
        console.warn('Gagal memuat data awal dashboard:', err);
        renderPumpState();
        renderSoilSummaryCard();
        renderTankAndEnergyCards();
        renderPlotsTable();
        renderMoistureChart();
      }
    } finally {
      fetchLiveWeather();
      setInterval(fetchLiveWeather, 10 * 60 * 1000);
      startLiveSimulationLoop();
    }
  }

  bootstrapDashboard();
});
