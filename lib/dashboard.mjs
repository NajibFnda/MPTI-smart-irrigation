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

export async function ensureUserDashboardSeeded(db, userId) {
  const existingSettings = await db.sql`
    SELECT user_id FROM user_settings WHERE user_id = ${userId} LIMIT 1
  `;

  if (existingSettings.length === 0) {
    await db.sql`
      INSERT INTO user_settings (
        user_id, is_pump_on, pump_mode, min_moisture, max_moisture,
        location_name, latitude, longitude
      )
      VALUES (${userId}, FALSE, 'otomatis', 45, 75, 'Semarang, Jawa Tengah', -6.9932, 110.4203)
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

  const existingLogs = await db.sql`
    SELECT id FROM activity_logs WHERE user_id = ${userId} LIMIT 1
  `;

  if (existingLogs.length === 0) {
    // Inserted oldest-to-newest so ORDER BY id DESC displays newest first
    await db.sql`
      INSERT INTO activity_logs (user_id, title, subtitle, tag, tone)
      VALUES
        (${userId}, 'Pengecekan Rutin Pompa', 'Mesin Utama • Besok', 'Pengingat', 'purple'),
        (${userId}, 'Pengisian Tandon Otomatis', 'Tandon Utama • 16:30 WIB', 'Terjadwal', 'blue'),
        (${userId}, 'Penyiraman Ditunda (Prediksi Hujan)', 'Semua Petak • 13:00 WIB', 'Hemat Air', 'amber'),
        (${userId}, 'Penyiraman Otomatis Selesai', 'Petak Utara • 06:00 WIB', 'Selesai', 'green')
    `;
  }
}

export async function addActivityLog(db, userId, { title, subtitle, tag, tone = 'green' }) {
  await db.sql`
    INSERT INTO activity_logs (user_id, title, subtitle, tag, tone)
    VALUES (${userId}, ${title}, ${subtitle}, ${tag}, ${tone})
  `;
}

export async function getDashboardSnapshot(db, userId) {
  await ensureUserDashboardSeeded(db, userId);

  const settingsRows = await db.sql`
    SELECT is_pump_on, pump_mode, min_moisture, max_moisture, location_name, latitude, longitude
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

  const logRows = await db.sql`
    SELECT id, title, subtitle, tag, tone, created_at
    FROM activity_logs
    WHERE user_id = ${userId}
    ORDER BY id DESC
    LIMIT 8
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
    activities: logRows.map((l) => ({
      id: l.id,
      title: l.title,
      subtitle: l.subtitle,
      tag: l.tag,
      tone: l.tone || 'green',
    })),
  };
}
