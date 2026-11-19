import { getDb, requireAuth } from '../../lib/auth.mjs';
import {
  addActivityLog,
  computePlotCode,
  ensureUserDashboardSeeded,
  getDashboardSnapshot,
} from '../../lib/dashboard.mjs';

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

    const db = getDb();
    await ensureUserDashboardSeeded(db, auth.uid);

    const method = req.method.toUpperCase();
    const body = await req.json();
    const timeLabel = formatCurrentTimeWib();

    if (method === 'POST') {
      const name = String(body.name || '').trim();
      const crop = String(body.crop || '').trim();
      const moisture = Math.max(10, Math.min(99, Math.round(Number(body.moisture ?? 65))));

      if (!name || !crop) {
        return Response.json(
          { ok: false, message: 'Nama Petak dan Jenis Tanaman wajib diisi.' },
          { status: 400 }
        );
      }

      const code = computePlotCode(name);
      await db.sql`
        INSERT INTO plots (user_id, code, name, crop, moisture, pump_on, updated_label)
        VALUES (${auth.uid}, ${code}, ${name}, ${crop}, ${moisture}, FALSE, 'Baru saja')
      `;

      await addActivityLog(db, auth.uid, {
        title: `Petak Baru Ditambahkan: ${name}`,
        subtitle: `Tanaman ${crop} • ${timeLabel}`,
        tag: 'Petak Baru',
        tone: 'green',
      });

      const snapshot = await getDashboardSnapshot(db, auth.uid);
      return Response.json({ ok: true, ...snapshot }, { status: 201 });
    }

    if (method === 'PATCH') {
      const plotId = Number(body.id);
      if (!Number.isInteger(plotId) || plotId <= 0) {
        return Response.json({ ok: false, message: 'ID petak tidak valid.' }, { status: 400 });
      }

      const existingRows = await db.sql`
        SELECT id, name, crop, moisture, pump_on
        FROM plots
        WHERE id = ${plotId} AND user_id = ${auth.uid}
        LIMIT 1
      `;
      const cur = existingRows[0];
      if (!cur) {
        return Response.json({ ok: false, message: 'Petak tidak ditemukan.' }, { status: 404 });
      }

      const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : cur.name;
      const crop = typeof body.crop === 'string' && body.crop.trim() ? body.crop.trim() : cur.crop;
      const moisture = Number.isFinite(Number(body.moisture))
        ? Math.max(10, Math.min(99, Math.round(Number(body.moisture))))
        : Number(cur.moisture);
      const pumpOn = typeof body.pumpOn === 'boolean' ? body.pumpOn : Boolean(cur.pump_on);
      const code = computePlotCode(name);

      await db.sql`
        UPDATE plots
        SET code = ${code},
            name = ${name},
            crop = ${crop},
            moisture = ${moisture},
            pump_on = ${pumpOn},
            updated_label = 'Baru saja',
            updated_at = NOW()
        WHERE id = ${plotId} AND user_id = ${auth.uid}
      `;

      if (typeof body.pumpOn === 'boolean' && body.pumpOn !== Boolean(cur.pump_on)) {
        await addActivityLog(db, auth.uid, {
          title: pumpOn ? `Menyiram ${name}` : `Penyiraman ${name} Dihentikan`,
          subtitle: `${crop} • ${timeLabel}`,
          tag: pumpOn ? 'Aktif' : 'Selesai',
          tone: pumpOn ? 'green' : 'blue',
        });
      } else if (body.name || body.crop || body.moisture !== undefined) {
        await addActivityLog(db, auth.uid, {
          title: `Data ${name} Diperbarui`,
          subtitle: `${crop} (${moisture}%) • ${timeLabel}`,
          tag: 'Diperbarui',
          tone: 'amber',
        });
      }

      const snapshot = await getDashboardSnapshot(db, auth.uid);
      return Response.json({ ok: true, ...snapshot }, { status: 200 });
    }

    if (method === 'DELETE') {
      const plotId = Number(body.id);
      if (!Number.isInteger(plotId) || plotId <= 0) {
        return Response.json({ ok: false, message: 'ID petak tidak valid.' }, { status: 400 });
      }

      const countRows = await db.sql`
        SELECT COUNT(*)::int AS total FROM plots WHERE user_id = ${auth.uid}
      `;
      if ((countRows[0]?.total || 0) <= 1) {
        return Response.json(
          { ok: false, message: 'Minimal harus tersisa 1 petak lahan.' },
          { status: 400 }
        );
      }

      const deletedRows = await db.sql`
        DELETE FROM plots
        WHERE id = ${plotId} AND user_id = ${auth.uid}
        RETURNING name
      `;
      if (deletedRows.length === 0) {
        return Response.json({ ok: false, message: 'Petak tidak ditemukan.' }, { status: 404 });
      }

      await addActivityLog(db, auth.uid, {
        title: `Petak Dihapus: ${deletedRows[0].name}`,
        subtitle: `Manajemen Lahan • ${timeLabel}`,
        tag: 'Dihapus',
        tone: 'purple',
      });

      const snapshot = await getDashboardSnapshot(db, auth.uid);
      return Response.json({ ok: true, ...snapshot }, { status: 200 });
    }

    return Response.json({ ok: false, message: 'Method tidak didukung.' }, { status: 405 });
  } catch (err) {
    console.error('Plots error:', err);
    return Response.json(
      { ok: false, message: 'Gagal memproses data petak lahan.' },
      { status: 500 }
    );
  }
};

export const config = {
  path: '/api/plots',
  method: ['POST', 'PATCH', 'DELETE'],
};
