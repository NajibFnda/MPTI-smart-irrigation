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

    const db = getDb();
    await ensureUserDashboardSeeded(db, auth.uid);
    const body = await req.json();
    const method = req.method.toUpperCase();
    const timeLabel = formatCurrentTimeWib();

    if (method === 'POST') {
      const label = String(body.label || '').trim();
      const plotTarget = String(body.plotTarget || 'Semua Petak').trim() || 'Semua Petak';
      const timeWib = String(body.timeWib || '').trim();
      const durationMin = Math.max(5, Math.min(120, Math.round(Number(body.durationMin || 15))));
      const skipOnRain = body.skipOnRain !== false;

      if (!label || !/^\d{2}:\d{2}$/.test(timeWib)) {
        return Response.json(
          { ok: false, message: 'Nama jadwal dan jam penyiraman (HH:MM) wajib diisi.' },
          { status: 400 }
        );
      }

      await db.sql`
        INSERT INTO schedules (user_id, label, plot_target, time_wib, duration_min, skip_on_rain, enabled)
        VALUES (${auth.uid}, ${label}, ${plotTarget}, ${timeWib}, ${durationMin}, ${skipOnRain}, TRUE)
      `;

      await addActivityLog(db, auth.uid, {
        title: `Jadwal Baru: ${label}`,
        subtitle: `${plotTarget} • ${timeWib} WIB (${durationMin} mnt)`,
        tag: 'Terjadwal',
        tone: 'blue',
      });

      const snapshot = await getDashboardSnapshot(db, auth.uid);
      return Response.json({ ok: true, ...snapshot }, { status: 201 });
    }

    if (method === 'PATCH') {
      const id = Number(body.id);
      if (!Number.isInteger(id) || id <= 0) {
        return Response.json({ ok: false, message: 'ID jadwal tidak valid.' }, { status: 400 });
      }

      const existing = await db.sql`
        SELECT id, label, time_wib, enabled, skip_on_rain
        FROM schedules
        WHERE id = ${id} AND user_id = ${auth.uid}
        LIMIT 1
      `;
      const cur = existing[0];
      if (!cur) {
        return Response.json({ ok: false, message: 'Jadwal tidak ditemukan.' }, { status: 404 });
      }

      const enabled = typeof body.enabled === 'boolean' ? body.enabled : Boolean(cur.enabled);
      const skipOnRain =
        typeof body.skipOnRain === 'boolean' ? body.skipOnRain : Boolean(cur.skip_on_rain);

      await db.sql`
        UPDATE schedules
        SET enabled = ${enabled}, skip_on_rain = ${skipOnRain}
        WHERE id = ${id} AND user_id = ${auth.uid}
      `;

      await addActivityLog(db, auth.uid, {
        title: `Jadwal ${cur.label} ${enabled ? 'Diaktifkan' : 'Dinonaktifkan'}`,
        subtitle: `Pukul ${cur.time_wib} WIB • ${timeLabel}`,
        tag: enabled ? 'Aktif' : 'Nonaktif',
        tone: enabled ? 'green' : 'purple',
      });

      const snapshot = await getDashboardSnapshot(db, auth.uid);
      return Response.json({ ok: true, ...snapshot }, { status: 200 });
    }

    if (method === 'DELETE') {
      const id = Number(body.id);
      if (!Number.isInteger(id) || id <= 0) {
        return Response.json({ ok: false, message: 'ID jadwal tidak valid.' }, { status: 400 });
      }

      const deleted = await db.sql`
        DELETE FROM schedules
        WHERE id = ${id} AND user_id = ${auth.uid}
        RETURNING label
      `;
      if (deleted.length === 0) {
        return Response.json({ ok: false, message: 'Jadwal tidak ditemukan.' }, { status: 404 });
      }

      await addActivityLog(db, auth.uid, {
        title: `Jadwal Dihapus: ${deleted[0].label}`,
        subtitle: `Kontrol Irigasi • ${timeLabel}`,
        tag: 'Dihapus',
        tone: 'purple',
      });

      const snapshot = await getDashboardSnapshot(db, auth.uid);
      return Response.json({ ok: true, ...snapshot }, { status: 200 });
    }

    return Response.json({ ok: false, message: 'Method tidak didukung.' }, { status: 405 });
  } catch (err) {
    console.error('Schedules error:', err);
    return Response.json({ ok: false, message: 'Gagal memproses jadwal penyiraman.' }, { status: 500 });
  }
};

export const config = {
  path: '/api/schedules',
  method: ['POST', 'PATCH', 'DELETE'],
};
