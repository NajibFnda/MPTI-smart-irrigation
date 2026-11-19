import { getDb, requireAuth } from '../../lib/auth.mjs';
import { addActivityLog, ensureUserDashboardSeeded, getDashboardSnapshot } from '../../lib/dashboard.mjs';

function formatCurrentTimeWib() {
  const parts = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
  return `${parts.replace('.', ':')} WIB`;
}

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
      SELECT is_pump_on, pump_mode, min_moisture, max_moisture, location_name, latitude, longitude
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

    await db.sql`
      UPDATE user_settings
      SET is_pump_on = ${isPumpOn},
          pump_mode = ${pumpMode},
          min_moisture = ${minMoisture},
          max_moisture = ${maxMoisture},
          location_name = ${locationName},
          latitude = ${latitude},
          longitude = ${longitude},
          updated_at = NOW()
      WHERE user_id = ${auth.uid}
    `;

    const timeLabel = formatCurrentTimeWib();
    if (body.logAction === 'pump-toggle') {
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
        title: `Lokasi Cuaca Diperbarui`,
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
