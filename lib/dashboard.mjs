/**
 * Dashboard persistence helpers for PostgreSQL (@netlify/database)
 */

export function computePlotCode(name) {
  const words = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return 'PT';
}

export function getJakartaDateString(offsetDays = 0) {
  const now = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

export function formatCurrentTimeWib() {
  const parts = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
  return `${parts.replace('.', ':')} WIB`;
}

export async function ensureUserDashboardSeeded(db, userId) {
  const existingSettings = await db.sql`
    SELECT user_id FROM user_settings WHERE user_id = ${userId} LIMIT 1
  `;

  if (existingSettings.length === 0) {
    await db.sql`
      INSERT INTO user_settings (
        user_id, is_pump_on, pump_mode, min_moisture, max_moisture,
        location_name, latitude, longitude,
        tank_level_pct, tank_capacity_liters, water_used_liters, water_saved_liters, energy_kwh, tariff_per_kwh
      )
      VALUES (
        ${userId}, FALSE, 'otomatis', 45, 75,
        'Semarang, Jawa Tengah', -6.9932, 110.4203,
        85, 2000, 320, 1450, 22.1, 1445
      )
      ON CONFLICT (user_id) DO NOTHING
    `;
  }

  const existingPlots = await db.sql`
    SELECT id FROM plots WHERE user_id = ${userId} LIMIT 1
  `;

  if (existingPlots.length === 0) {
    await db.sql`
      INSERT INTO plots (user_id, code, name, crop, moisture, pump_on, updated_label)
      VALUES
        (${userId}, 'PU', 'Petak Utara', 'Cabai', 75, FALSE, 'Baru saja'),
        (${userId}, 'PS', 'Petak Selatan', 'Tomat', 68, FALSE, '5 menit lalu'),
        (${userId}, 'G1', 'Greenhouse 1', 'Melon', 42, TRUE, 'Baru saja')
    `;
  }

  const existingSchedules = await db.sql`
    SELECT id FROM schedules WHERE user_id = ${userId} LIMIT 1
  `;

  if (existingSchedules.length === 0) {
    await db.sql`
      INSERT INTO schedules (user_id, label, plot_target, time_wib, duration_min, skip_on_rain, enabled)
      VALUES
        (${userId}, 'Siram Pagi Rutin', 'Semua Petak', '06:00', 15, TRUE, TRUE),
        (${userId}, 'Siram Siang (Hemat Air)', 'Greenhouse 1', '13:00', 10, TRUE, TRUE),
        (${userId}, 'Siram Sore & Cek Tandon', 'Semua Petak', '16:30', 15, TRUE, TRUE)
    `;
  }

  const existingLogs = await db.sql`
    SELECT id FROM activity_logs WHERE user_id = ${userId} LIMIT 1
  `;

  if (existingLogs.length === 0) {
    await db.sql`
      INSERT INTO activity_logs (user_id, title, subtitle, tag, tone)
      VALUES
        (${userId}, 'Pengecekan Rutin Pompa', 'Mesin Utama • Terjadwal', 'Pengingat', 'purple'),
        (${userId}, 'Pengisian Tandon Otomatis', 'Tandon Utama • 16:30 WIB', 'Terjadwal', 'blue'),
        (${userId}, 'Penyiraman Ditunda (Prediksi Hujan)', 'Semua Petak • 13:00 WIB', 'Hemat Air', 'amber'),
        (${userId}, 'Penyiraman Otomatis Selesai', 'Petak Utara • 06:00 WIB', 'Selesai', 'green')
    `;
  }

  const existingHistory = await db.sql`
    SELECT COUNT(*)::int AS total FROM moisture_history WHERE user_id = ${userId}
  `;

  if ((existingHistory[0]?.total || 0) < 14) {
    const sampleA = [52, 61, 65, 59, 66, 72, 70, 58, 69, 60, 68, 63, 69, 75];
    const sampleB = [45, 51, 58, 47, 55, 60, 62, 49, 57, 50, 54, 51, 56, 68];
    for (let i = 0; i < 14; i++) {
      const dateStr = getJakartaDateString(i - 13);
      await db.sql`
        INSERT INTO moisture_history (user_id, day_date, series_a, series_b)
        VALUES (${userId}, ${dateStr}, ${sampleA[i]}, ${sampleB[i]})
        ON CONFLICT (user_id, day_date) DO NOTHING
      `;
    }
  }
}

export async function syncTodayMoistureHistory(db, userId) {
  const topPlots = await db.sql`
    SELECT moisture FROM plots WHERE user_id = ${userId} ORDER BY id ASC LIMIT 2
  `;
  if (topPlots.length === 0) return;

  const seriesA = Number(topPlots[0].moisture ?? 65);
  const seriesB = Number(topPlots[1]?.moisture ?? Math.max(25, seriesA - 8));
  const todayStr = getJakartaDateString(0);

  await db.sql`
    INSERT INTO moisture_history (user_id, day_date, series_a, series_b)
    VALUES (${userId}, ${todayStr}, ${seriesA}, ${seriesB})
    ON CONFLICT (user_id, day_date)
    DO UPDATE SET series_a = EXCLUDED.series_a, series_b = EXCLUDED.series_b
  `;
}

export async function addActivityLog(db, userId, { title, subtitle, tag, tone = 'green' }) {
  await db.sql`
    INSERT INTO activity_logs (user_id, title, subtitle, tag, tone)
    VALUES (${userId}, ${title}, ${subtitle}, ${tag}, ${tone})
  `;
}

export async function getDashboardSnapshot(db, userId) {
  await ensureUserDashboardSeeded(db, userId);
  await syncTodayMoistureHistory(db, userId);

  const settingsRows = await db.sql`
    SELECT
      is_pump_on, pump_mode, min_moisture, max_moisture,
      location_name, latitude, longitude,
      tank_level_pct, tank_capacity_liters, water_used_liters,
      water_saved_liters, energy_kwh, tariff_per_kwh
    FROM user_settings
    WHERE user_id = ${userId}
    LIMIT 1
  `;
  const s = settingsRows[0];

  const plotRows = await db.sql`
    SELECT id, code, name, crop, moisture, pump_on, updated_label
    FROM plots
    WHERE user_id = ${userId}
    ORDER BY id ASC
  `;

  const scheduleRows = await db.sql`
    SELECT id, label, plot_target, time_wib, duration_min, skip_on_rain, enabled
    FROM schedules
    WHERE user_id = ${userId}
    ORDER BY time_wib ASC, id ASC
  `;

  const logRows = await db.sql`
    SELECT id, title, subtitle, tag, tone, created_at
    FROM activity_logs
    WHERE user_id = ${userId}
    ORDER BY id DESC
    LIMIT 30
  `;

  const historyRows = await db.sql`
    SELECT day_date, series_a, series_b
    FROM (
      SELECT day_date, series_a, series_b
      FROM moisture_history
      WHERE user_id = ${userId}
      ORDER BY day_date DESC
      LIMIT 14
    ) sub
    ORDER BY day_date ASC
  `;

  return {
    settings: {
      isPumpOn: Boolean(s.is_pump_on),
      pumpMode: s.pump_mode || 'otomatis',
      minMoistureThreshold: Number(s.min_moisture ?? 45),
      maxMoistureThreshold: Number(s.max_moisture ?? 75),
      locationName: s.location_name || 'Semarang, Jawa Tengah',
      latitude: Number(s.latitude ?? -6.9932),
      longitude: Number(s.longitude ?? 110.4203),
      tankLevelPct: Number(s.tank_level_pct ?? 85),
      tankCapacityLiters: Number(s.tank_capacity_liters ?? 2000),
      waterUsedLiters: Number(s.water_used_liters ?? 320),
      waterSavedLiters: Number(s.water_saved_liters ?? 1450),
      energyKwh: Number(Number(s.energy_kwh ?? 22.1).toFixed(2)),
      tariffPerKwh: Number(s.tariff_per_kwh ?? 1445),
    },
    plots: plotRows.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      crop: p.crop,
      moisture: Number(p.moisture),
      pumpOn: Boolean(p.pump_on),
      updated: p.updated_label || 'Baru saja',
    })),
    schedules: scheduleRows.map((sc) => ({
      id: sc.id,
      label: sc.label,
      plotTarget: sc.plot_target,
      timeWib: sc.time_wib,
      durationMin: Number(sc.duration_min ?? 15),
      skipOnRain: Boolean(sc.skip_on_rain),
      enabled: Boolean(sc.enabled),
    })),
    activities: logRows.map((l) => ({
      id: l.id,
      title: l.title,
      subtitle: l.subtitle,
      tag: l.tag,
      tone: l.tone || 'green',
      createdAt: l.created_at,
    })),
    moistureHistory: historyRows.map((h) => ({
      dayDate: h.day_date,
      seriesA: Number(h.series_a),
      seriesB: Number(h.series_b),
    })),
  };
}
