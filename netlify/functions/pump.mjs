import { getDb, requireAuth } from '../../lib/auth.mjs';
import {
  addActivityLog,
  ensureUserDashboardSeeded,
  formatCurrentTimeWib,
  getDashboardSnapshot,
} from '../../lib/dashboard.mjs';

export default async (req) => {
  try {
    const auth = requireAuth(req);
    if (!auth) {
      return Response.json({ ok: false, message: 'Sesi tidak valid.' }, { status: 401 });
    }

    const body = await req.json();
    const db = getDb();
    await ensureUserDashboardSeeded(db, auth.uid);

    const existingRows = await db.sql`
      SELECT
        is_pump_on, pump_mode, min_moisture, max_moisture,
        location_name, latitude, longitude,
        tank_level_pct, water_used_liters, water_saved_liters, energy_kwh
      FROM user_settings
      WHERE user_id = ${auth.uid}
      LIMIT 1
    `;
    const cur = existingRows[0];

    const isPumpOn = typeof body.isPumpOn === 'boolean' ? body.isPumpOn : Boolean(cur.is_pump_on);
    const pumpMode =
      body.pumpMode === 'manual' || body.pumpMode === 'otomatis'
        ? body.pumpMode
        : cur.pump_mode;

    const minMoisture = Number.isFinite(Number(body.minMoistureThreshold))
      ? Math.max(15, Math.min(70, Math.round(Number(body.minMoistureThreshold))))
      : Number(cur.min_moisture);

    const maxMoisture = Number.isFinite(Number(body.maxMoistureThreshold))
      ? Math.max(minMoisture + 5, Math.min(95, Math.round(Number(body.maxMoistureThreshold))))
      : Number(cur.max_moisture);

    const locationName =
      typeof body.locationName === 'string' && body.locationName.trim()
        ? body.locationName.trim()
        : cur.location_name;

    const latitude = Number.isFinite(Number(body.latitude))
      ? Number(body.latitude)
      : Number(cur.latitude);
    const longitude = Number.isFinite(Number(body.longitude))
      ? Number(body.longitude)
      : Number(cur.longitude);

    let tankLevelPct = Number.isFinite(Number(body.tankLevelPct))
      ? Math.max(0, Math.min(100, Math.round(Number(body.tankLevelPct))))
      : Number(cur.tank_level_pct ?? 85);

    if (body.refillTank === true) {
      tankLevelPct = 100;
    }

    const waterUsedLiters = Number.isFinite(Number(body.waterUsedLiters))
      ? Math.max(0, Math.round(Number(body.waterUsedLiters)))
      : Number(cur.water_used_liters ?? 320);

    const waterSavedLiters = Number.isFinite(Number(body.waterSavedLiters))
      ? Math.max(0, Math.round(Number(body.waterSavedLiters)))
      : Number(cur.water_saved_liters ?? 1450);

    const energyKwh = Number.isFinite(Number(body.energyKwh))
      ? Math.max(0, Number(Number(body.energyKwh).toFixed(2)))
      : Number(cur.energy_kwh ?? 22.1);

    await db.sql`
      UPDATE user_settings
      SET is_pump_on = ${isPumpOn},
          pump_mode = ${pumpMode},
          min_moisture = ${minMoisture},
          max_moisture = ${maxMoisture},
          location_name = ${locationName},
          latitude = ${latitude},
          longitude = ${longitude},
          tank_level_pct = ${tankLevelPct},
          water_used_liters = ${waterUsedLiters},
          water_saved_liters = ${waterSavedLiters},
          energy_kwh = ${energyKwh},
          updated_at = NOW()
      WHERE user_id = ${auth.uid}
    `;

    // Optional batch sync of plot moisture/pump states from live auto-irrigation
    if (Array.isArray(body.plotUpdates)) {
      for (const pu of body.plotUpdates) {
        const pid = Number(pu.id);
        if (!Number.isInteger(pid) || pid <= 0) continue;
        const m = Math.max(10, Math.min(99, Math.round(Number(pu.moisture ?? 65))));
        const pOn = Boolean(pu.pumpOn);
        await db.sql`
          UPDATE plots
          SET moisture = ${m},
              pump_on = ${pOn},
              updated_label = 'Baru saja',
              updated_at = NOW()
          WHERE id = ${pid} AND user_id = ${auth.uid}
        `;
      }
    }

    const timeLabel = formatCurrentTimeWib();
    if (body.refillTank === true) {
      await addActivityLog(db, auth.uid, {
        title: 'Pengisian Tandon Air Selesai (100%)',
        subtitle: `Tandon Utama • ${timeLabel}`,
        tag: 'Penuh',
        tone: 'blue',
      });
    } else if (body.customLog && body.customLog.title) {
      await addActivityLog(db, auth.uid, {
        title: String(body.customLog.title).slice(0, 120),
        subtitle: String(body.customLog.subtitle || `Sistem Otomatis • ${timeLabel}`).slice(0, 120),
        tag: String(body.customLog.tag || 'Otomatis').slice(0, 24),
        tone: body.customLog.tone || 'green',
      });
    } else if (body.logAction === 'pump-toggle') {
      await addActivityLog(db, auth.uid, {
        title: isPumpOn ? 'Pompa Utama Dinyalakan Manual' : 'Pompa Utama Dimatikan Manual',
        subtitle: `Mesin Utama • ${timeLabel}`,
        tag: isPumpOn ? 'Aktif' : 'Selesai',
        tone: isPumpOn ? 'green' : 'blue',
      });
    } else if (body.logAction === 'mode-change') {
      await addActivityLog(db, auth.uid, {
        title: `Mode Pompa: ${pumpMode === 'otomatis' ? 'Otomatis' : 'Manual'}`,
        subtitle: `Kontrol Irigasi • ${timeLabel}`,
        tag: pumpMode === 'otomatis' ? 'Otomatis' : 'Manual',
        tone: 'purple',
      });
    } else if (body.logAction === 'location-change') {
      await addActivityLog(db, auth.uid, {
        title: 'Lokasi Cuaca Diperbarui',
        subtitle: `${locationName} • ${timeLabel}`,
        tag: 'Cuaca',
        tone: 'blue',
      });
    } else if (body.logAction === 'threshold-change') {
      await addActivityLog(db, auth.uid, {
        title: `Batas Kelembapan Diatur (${minMoisture}%–${maxMoisture}%)`,
        subtitle: `Sensor Tanah • ${timeLabel}`,
        tag: 'Pengaturan',
        tone: 'amber',
      });
    }

    const snapshot = await getDashboardSnapshot(db, auth.uid);
    return Response.json({ ok: true, ...snapshot });
  } catch (err) {
    console.error('Pump/Settings POST error:', err);
    return Response.json(
      { ok: false, message: 'Gagal menyimpan pengaturan ke database.' },
      { status: 500 }
    );
  }
};

export const config = {
  path: '/api/pump',
  method: 'POST',
};
