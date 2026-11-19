/**
 * Irigasi Cerdas — Dasbor Pemantauan & Kontrol Irigasi Lahan
 * Terhubung penuh dengan API sesi bertoken (/api/dashboard, /api/pump, /api/plots),
 * cuaca real-time Open-Meteo, lokasi lahan kustom, serta grafik interaktif.
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

  let activeUserName = 'Pengguna';

  function getInitials(name) {
    const parts = String(name || 'Pengguna').trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  function applyUserProfile(user) {
    if (!user?.fullName) return;
    activeUserName = user.fullName;
    const displayName = activeUserName;
    const displayRole = user.farmName || 'Pemilik Lahan';
    const initials = getInitials(displayName);

    document.title = `Irigasi Cerdas — Dasbor Lahan ${displayName}`;
    if (headerUserName) headerUserName.textContent = displayName;
    if (headerUserRole) headerUserRole.textContent = displayRole;
    if (headerUserInitials) headerUserInitials.textContent = initials;
    if (popoverUserName) popoverUserName.textContent = displayName;
    if (popoverUserRole) popoverUserRole.textContent = displayRole;
    if (popoverUserEmail && user.email) {
      popoverUserEmail.textContent = user.emailVerified ? `✓ ${user.email}` : user.email;
      popoverUserEmail.classList.remove('hidden');
    }
    updateClock();
  }

  // Hydrate immediately from cached user while /api/dashboard loads
  try {
    const rawUser = localStorage.getItem(CURRENT_USER_KEY);
    if (rawUser) {
      applyUserProfile(JSON.parse(rawUser));
    }
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
      const greetingText = `${getTimeGreeting(hour)}, ${activeUserName}! 🌱`;
      if (greetingHeading.textContent !== greetingText) {
        greetingHeading.textContent = greetingText;
      }
    }
    if (liveDateEl) {
      liveDateEl.textContent = dateFormatter.format(now);
    }
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

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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
    const isOpen = sidebar?.classList.contains('is-open');
    setSidebarOpen(!isOpen);
  });
  sidebarCloseBtn?.addEventListener('click', () => setSidebarOpen(false));
  sidebarOverlay?.addEventListener('click', () => setSidebarOpen(false));

  /* =========================================================================
     4. Dashboard State & Database Persistence
     ========================================================================= */
  const state = {
    isPumpOn: false,
    pumpMode: 'otomatis',
    minMoistureThreshold: 45,
    maxMoistureThreshold: 75,
    locationName: 'Semarang, Jawa Tengah',
    latitude: -6.9932,
    longitude: 110.4203,
    plots: [
      { id: 1, code: 'PU', name: 'Petak Utara', crop: 'Cabai', moisture: 75, pumpOn: false, updated: 'Baru saja' },
      { id: 2, code: 'PS', name: 'Petak Selatan', crop: 'Tomat', moisture: 68, pumpOn: false, updated: '5 menit lalu' },
      { id: 3, code: 'G1', name: 'Greenhouse 1', crop: 'Melon', moisture: 42, pumpOn: true, updated: 'Baru saja' },
    ],
    activities: [],
  };

  const pumpSwitch = document.getElementById('pump-switch');
  const pumpSwitchKnob = document.getElementById('pump-switch-knob');
  const pumpStatusBadge = document.getElementById('pump-status-badge');
  const pumpStatusDot = document.getElementById('pump-status-dot');
  const pumpStatusText = document.getElementById('pump-status-text');
  const pumpSubtext = document.getElementById('pump-subtext');
  const pumpCardIcon = document.getElementById('pump-card-icon');
  const modeBtnAuto = document.getElementById('mode-btn-auto');
  const modeBtnManual = document.getElementById('mode-btn-manual');
  const cardSoilValue = document.getElementById('card-soil-value');
  const cardSoilSubtext = document.getElementById('card-soil-subtext');
  const activityListEl = document.getElementById('activity-list');
  const plotsTableBody = document.getElementById('plots-table-body');
  const weatherLocationLabel = document.getElementById('weather-location-label');

  function renderSoilSummaryCard() {
    if (!cardSoilValue || state.plots.length === 0) return;
    const avg = Math.round(
      state.plots.reduce((sum, p) => sum + Number(p.moisture || 0), 0) / state.plots.length
    );

    let condition = 'Lembap';
    let subtext = 'Ideal untuk tanaman';
    if (avg < 45) {
      condition = 'Kering';
      subtext = 'Disarankan menyiram lahan';
    } else if (avg > 82) {
      condition = 'Basah';
      subtext = 'Cukup air, tunda penyiraman';
    }
    cardSoilValue.textContent = `${condition} (${avg}%)`;
    if (cardSoilSubtext) cardSoilSubtext.textContent = subtext;
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

    if (pumpStatusText) {
      pumpStatusText.textContent = `${isOn ? 'NYALA' : 'MATI'} (${modeLabel})`;
    }

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
        pumpSubtext.textContent = `Pompa dinyalakan manual oleh ${activeUserName}`;
      } else if (!isOn && !isAuto) {
        pumpSubtext.textContent = 'Mode manual • Pompa dimatikan';
      } else {
        pumpSubtext.textContent = 'Klik sakelar untuk kontrol manual ON/OFF';
      }
    }
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
        const moistureColor = plot.moisture < 50 ? 'text-amber-600' : 'text-slate-800';
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
      btn.addEventListener('click', () => {
        const plotId = Number(btn.getAttribute('data-quick-toggle-plot'));
        togglePlotPump(plotId);
      });
    });

    plotsTableBody.querySelectorAll('[data-edit-plot]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const plotId = Number(btn.getAttribute('data-edit-plot'));
        const plot = state.plots.find((p) => p.id === plotId);
        if (plot) openPlotModal(plot);
      });
    });

    plotsTableBody.querySelectorAll('[data-delete-plot]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const plotId = Number(btn.getAttribute('data-delete-plot'));
        deletePlotById(plotId);
      });
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
    }
    if (Array.isArray(snapshot.plots)) {
      state.plots = snapshot.plots;
    }
    if (Array.isArray(snapshot.activities)) {
      state.activities = snapshot.activities;
    }

    if (weatherLocationLabel) {
      weatherLocationLabel.textContent = state.locationName;
    }

    renderPumpState();
    renderSoilSummaryCard();
    renderPlotsTable();
    renderActivities();

    if (currentNav !== 'dashboard') {
      renderSecondaryView(currentNav);
    }
  }

  async function persistSettings(payload, toastMessage) {
    try {
      const { ok, data } = await apiRequest('/api/pump', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (!ok || !data.ok) {
        showToast(data.message || 'Gagal menyimpan pengaturan ke database.', 'error');
        return false;
      }
      applyDashboardSnapshot(data);
      if (toastMessage) showToast(toastMessage);
      return true;
    } catch {
      showToast('Koneksi server terganggu saat menyimpan data.', 'error');
      return false;
    }
  }

  async function togglePlotPump(plotId) {
    const target = state.plots.find((p) => p.id === plotId);
    if (!target) return;
    const nextPump = !target.pumpOn;

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

  pumpSwitch?.addEventListener('click', async () => {
    const nextPump = !state.isPumpOn;
    const nextMode = state.pumpMode === 'otomatis' ? 'manual' : state.pumpMode;
    await persistSettings(
      { isPumpOn: nextPump, pumpMode: nextMode, logAction: 'pump-toggle' },
      nextPump ? 'Pompa utama dinyalakan (Mode Manual).' : 'Pompa utama dimatikan (Mode Manual).'
    );
  });

  modeBtnAuto?.addEventListener('click', async () => {
    if (state.pumpMode === 'otomatis') return;
    await persistSettings(
      { isPumpOn: false, pumpMode: 'otomatis', logAction: 'mode-change' },
      'Mode pompa diubah ke Otomatis (tersimpan di database).'
    );
  });

  modeBtnManual?.addEventListener('click', async () => {
    if (state.pumpMode === 'manual') return;
    await persistSettings(
      { pumpMode: 'manual', logAction: 'mode-change' },
      'Mode pompa diubah ke Manual (tersimpan di database).'
    );
  });

  /* =========================================================================
     5. Modal: Tambah / Edit Petak Lahan
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
     6. Modal: Pilih Lokasi Lahan (Open-Meteo Geocoding)
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
            <button
              type="button"
              data-pick-location="${idx}"
              class="w-full text-left p-3 rounded-xl border border-slate-200 hover:border-brand-500 hover:bg-brand-50/50 transition-colors flex items-center justify-between gap-2"
            >
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
          const idx = Number(btn.getAttribute('data-pick-location'));
          const chosen = results[idx];
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
     7. Interactive Dual-Line SVG Chart ("Grafik Kelembapan Tanah")
     ========================================================================= */
  const chartDataSets = {
    'this-week': [
      { day: 'Sen', fullDay: 'Sen, 9 Nov', utara: 58, selatan: 49 },
      { day: 'Sel', fullDay: 'Sel, 10 Nov', utara: 69, selatan: 57 },
      { day: 'Rab', fullDay: 'Rab, 11 Nov', utara: 60, selatan: 50 },
      { day: 'Kam', fullDay: 'Kam, 12 Nov', utara: 68, selatan: 54 },
      { day: 'Jum', fullDay: 'Jum, 13 Nov', utara: 63, selatan: 51 },
      { day: 'Sab', fullDay: 'Sab, 14 Nov', utara: 69, selatan: 56 },
      { day: 'Min', fullDay: 'Min, 15 Nov', utara: 75, selatan: 68 },
    ],
    'last-week': [
      { day: 'Sen', fullDay: 'Sen, 2 Nov', utara: 52, selatan: 45 },
      { day: 'Sel', fullDay: 'Sel, 3 Nov', utara: 61, selatan: 51 },
      { day: 'Rab', fullDay: 'Rab, 4 Nov', utara: 65, selatan: 58 },
      { day: 'Kam', fullDay: 'Kam, 5 Nov', utara: 59, selatan: 47 },
      { day: 'Jum', fullDay: 'Jum, 6 Nov', utara: 66, selatan: 55 },
      { day: 'Sab', fullDay: 'Sab, 7 Nov', utara: 72, selatan: 60 },
      { day: 'Min', fullDay: 'Min, 8 Nov', utara: 70, selatan: 62 },
    ],
  };

  const chartSvg = document.getElementById('moisture-chart-svg');
  const chartContainer = document.getElementById('moisture-chart-container');
  const chartTooltip = document.getElementById('chart-tooltip');
  const tooltipDay = document.getElementById('tooltip-day');
  const tooltipUtara = document.getElementById('tooltip-utara');
  const tooltipSelatan = document.getElementById('tooltip-selatan');
  const chartRangeSelect = document.getElementById('chart-range-select');

  let activeChartRange = 'this-week';
  let activePointIndex = 3;

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
    const data = chartDataSets[activeChartRange];
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
    const maxY = 85;
    const valToY = (val) => padTop + plotH - ((val - minY) / (maxY - minY)) * plotH;
    const idxToX = (i) => padLeft + (i / (data.length - 1)) * plotW;

    const utaraPts = data.map((d, i) => ({ x: idxToX(i), y: valToY(d.utara) }));
    const selatanPts = data.map((d, i) => ({ x: idxToX(i), y: valToY(d.selatan) }));

    const utaraPath = buildSmoothPath(utaraPts);
    const selatanPath = buildSmoothPath(selatanPts);
    const bottomY = padTop + plotH;

    const utaraArea = `${utaraPath} L ${utaraPts[utaraPts.length - 1].x} ${bottomY} L ${utaraPts[0].x} ${bottomY} Z`;
    const selatanArea = `${selatanPath} L ${selatanPts[selatanPts.length - 1].x} ${bottomY} L ${selatanPts[0].x} ${bottomY} Z`;

    const yTicks = [20, 40, 60, 80];
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
        return `
          <text x="${x}" y="${height - 8}" text-anchor="middle" fill="${isActive ? '#16803C' : '#64748B'}" font-size="12" font-weight="${isActive ? '700' : '500'}">${d.day}</text>
        `;
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
    renderMoistureChart();
  });

  renderMoistureChart();

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
     8. Notification Bell Popover
     ========================================================================= */
  const notifBtn = document.getElementById('notif-btn');
  const notifPopover = document.getElementById('notif-popover');
  const notifDot = document.getElementById('notif-dot');
  const notifClearBtn = document.getElementById('notif-clear-btn');

  notifBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = notifPopover?.classList.contains('hidden');
    notifPopover?.classList.toggle('hidden', !isHidden);
    notifBtn.setAttribute('aria-expanded', String(isHidden));
  });

  notifClearBtn?.addEventListener('click', () => {
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
     9. Download Report ("Unduh Laporan")
     ========================================================================= */
  const btnDownloadReport = document.getElementById('btn-download-report');

  function downloadCsvReport() {
    const todayStr = new Date().toLocaleDateString('id-ID');
    const pumpStatusStr = `${state.isPumpOn ? 'NYALA' : 'MATI'} (${state.pumpMode === 'otomatis' ? 'Otomatis' : 'Manual'})`;
    const rows = [
      ['Laporan Harian Irigasi Cerdas', `Tanggal: ${todayStr}`, `Pemilik: ${activeUserName}`],
      ['Lokasi Lahan', state.locationName, `Koordinat: ${state.latitude}, ${state.longitude}`],
      [],
      ['Ringkasan Sistem', 'Nilai', 'Keterangan'],
      ['Kondisi Tanah', cardSoilValue?.textContent || 'Lembap', cardSoilSubtext?.textContent || ''],
      ['Sisa Air Tandon', '85% Penuh', 'Aman dari meluber'],
      ['Pemakaian Listrik', 'Rp 32.000', 'Estimasi bulan ini'],
      ['Status Pompa Utama', pumpStatusStr, 'Kontrol Irigasi'],
      [],
      ['Nama Petak', 'Tanaman', 'Kelembapan', 'Status Pompa', 'Update Terakhir'],
      ...state.plots.map((p) => [
        p.name,
        p.crop,
        `${p.moisture}%`,
        p.pumpOn ? 'Menyiram (ON)' : 'Mati (Cukup Air)',
        p.updated,
      ]),
    ];

    const csvContent = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const safeFileName = activeUserName.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '') || 'Pengguna';
    const link = document.createElement('a');
    link.href = url;
    link.download = `Laporan_Irigasi_Cerdas_${safeFileName}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast('Laporan lahan berhasil diunduh (CSV).');
  }

  btnDownloadReport?.addEventListener('click', downloadCsvReport);

  /* =========================================================================
     10. Sidebar Navigation & Secondary Sub-views
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
      title: 'Kontrol Irigasi & Pompa',
      subtitle: 'Atur mode otomatis, sakelar pompa, dan batas kelembapan tanah.',
    },
    laporan: {
      title: 'Ringkasan Laporan Bulanan',
      subtitle: 'Catatan pemakaian air, listrik, dan hasil penyiraman otomatis.',
    },
    'pengaturan-alat': {
      title: 'Pengaturan Alat & Lokasi',
      subtitle: `Status koneksi sensor tanah, lokasi lahan, dan kontrol akun ${activeUserName}.`,
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
    secondarySubtitle.textContent =
      section === 'pengaturan-alat'
        ? `Status koneksi sensor tanah dan lokasi lahan ${activeUserName}.`
        : meta.subtitle;

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
          const id = Number(btn.getAttribute('data-sub-edit-plot'));
          const plot = state.plots.find((p) => p.id === id);
          if (plot) openPlotModal(plot);
        });
      });
    } else if (section === 'kontrol-irigasi') {
      const isOn = state.isPumpOn;
      const isAuto = state.pumpMode === 'otomatis';
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
        </div>

        <div class="bg-white rounded-2xl border border-[#EEF2EF] p-6 space-y-4 md:col-span-2">
          <h3 class="font-bold text-slate-900 text-base">Batas Kelembapan Otomatis</h3>
          <p class="text-xs text-slate-500">Pompa menyala otomatis jika tanah lebih kering dari batas bawah, dan mati jika sudah cukup lembap.</p>
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
      `;

      document.getElementById('sub-mode-auto')?.addEventListener('click', () => modeBtnAuto?.click());
      document.getElementById('sub-mode-manual')?.addEventListener('click', () => modeBtnManual?.click());
      document.getElementById('sub-pump-toggle')?.addEventListener('click', () => pumpSwitch?.click());

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
          {
            minMoistureThreshold: draftMin,
            maxMoistureThreshold: draftMax,
            logAction: 'threshold-change',
          },
          'Batas kelembapan otomatis disimpan ke database.'
        );
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
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
            ${forecastHtml}
          </div>
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
      secondaryBody.innerHTML = `
        <div class="bg-[#EFF8F1] rounded-2xl border border-[#E1EFE4] p-6">
          <p class="text-xs font-semibold text-brand-700">Penghematan Air Bulan Ini</p>
          <p class="text-2xl font-extrabold text-slate-900 mt-1">1.450 Liter</p>
          <p class="text-xs text-slate-600 mt-2">Berkat penundaan siram otomatis saat hujan.</p>
        </div>
        <div class="bg-[#FEF9EA] rounded-2xl border border-[#F8EED0] p-6">
          <p class="text-xs font-semibold text-amber-700">Estimasi Biaya Listrik</p>
          <p class="text-2xl font-extrabold text-slate-900 mt-1">Rp 32.000</p>
          <p class="text-xs text-slate-600 mt-2">Lebih hemat 12% dibanding penyiraman manual.</p>
        </div>
        <div class="bg-white rounded-2xl border border-[#EEF2EF] p-6 flex flex-col justify-between">
          <div>
            <h3 class="font-bold text-slate-900">Unduh Catatan Lengkap</h3>
            <p class="text-xs text-slate-500 mt-1">Simpan data kelembapan dan status pompa ke komputer atau HP.</p>
          </div>
          <button type="button" id="sub-download-csv" class="mt-4 w-full py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold">Unduh File Laporan (CSV)</button>
        </div>
      `;
      document.getElementById('sub-download-csv')?.addEventListener('click', downloadCsvReport);
    } else if (section === 'pengaturan-alat') {
      secondaryBody.innerHTML = `
        <div class="bg-white rounded-2xl border border-[#EEF2EF] p-6 space-y-3 md:col-span-2">
          <h3 class="font-bold text-slate-900">Pengaturan Lokasi & Sensor Lahan</h3>
          <div class="flex items-center justify-between p-3.5 rounded-xl bg-[#EEF6FD] border border-[#DCEBFA]">
            <div>
              <p class="text-xs font-semibold text-sky-800">Lokasi Prakiraan Cuaca</p>
              <p class="text-sm font-bold text-slate-900 mt-0.5">${escapeHtml(state.locationName)}</p>
            </div>
            <button type="button" id="settings-change-loc" class="px-3.5 py-2 rounded-xl bg-white text-sky-700 text-xs font-bold border border-sky-200 hover:bg-sky-50">Ubah Lokasi</button>
          </div>
          <div class="flex items-center justify-between p-3 rounded-xl bg-[#EFF8F1]"><span class="text-sm font-semibold">Total Petak Terpantau</span><span class="text-xs font-bold text-brand-700">${state.plots.length} Petak Aktif</span></div>
          <div class="flex items-center justify-between p-3 rounded-xl bg-[#EFF8F1]"><span class="text-sm font-semibold">Pelampung Tandon Utama</span><span class="text-xs font-bold text-brand-700">Normal (85% Penuh)</span></div>
        </div>
      `;
      document.getElementById('settings-change-loc')?.addEventListener('click', openLocationModal);
    } else if (section === 'bantuan') {
      secondaryBody.innerHTML = `
        <div class="bg-white rounded-2xl border border-[#EEF2EF] p-6 space-y-3 md:col-span-3">
          <h3 class="font-bold text-slate-900">Cara Mudah Menggunakan Irigasi Cerdas</h3>
          <ul class="space-y-2 text-sm text-slate-600 list-disc pl-5">
            <li><strong>Mode Otomatis & Manual:</strong> Setiap perubahan sakelar pompa atau mode otomatis tersimpan ke database akun Anda.</li>
            <li><strong>Tambah & Edit Petak:</strong> Klik tombol <em>+ Tambah Petak</em> di tabel Status Petak Lahan untuk menambah atau mengubah tanaman.</li>
            <li><strong>Ubah Lokasi Cuaca:</strong> Klik <em>Ubah Lokasi</em> pada kartu cuaca untuk mencari kota atau kecamatan lahan Anda.</li>
            <li><strong>Unduh Laporan:</strong> Tekan tombol hijau di pojok kanan atas untuk menyimpan catatan kondisi lahan harian.</li>
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
      if (isMatch) {
        link.setAttribute('aria-current', 'page');
      } else {
        link.removeAttribute('aria-current');
      }
    });

    if (section === 'dashboard') {
      viewDashboard?.classList.remove('hidden');
      viewSecondary?.classList.add('hidden');
    } else {
      viewDashboard?.classList.add('hidden');
      viewSecondary?.classList.remove('hidden');
      renderSecondaryView(section);
    }

    if (window.innerWidth < 1024) {
      setSidebarOpen(false);
    }
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
     11. Live Weather Integration (Open-Meteo API using user coordinates)
     ========================================================================= */
  const weatherMainIconEl = document.getElementById('weather-main-icon');
  const weatherTempEl = document.getElementById('weather-temp');
  const weatherConditionEl = document.getElementById('weather-condition');
  const weatherHumidityEl = document.getElementById('weather-humidity');
  const weatherWindEl = document.getElementById('weather-wind');
  const weatherRainBannerEl = document.getElementById('weather-rain-banner');
  const weatherRainTextEl = document.getElementById('weather-rain-text');
  const weatherForecastGridEl = document.getElementById('weather-forecast-grid');

  const weatherState = {
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
     12. Bootstrap Dashboard from Server DB
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
        renderPlotsTable();
      }
    } finally {
      fetchLiveWeather();
      setInterval(fetchLiveWeather, 10 * 60 * 1000);
    }
  }

  bootstrapDashboard();
});
