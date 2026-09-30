import "server-only";
import { db } from "@/lib/db";
import { ALERT_CHAT_KEY, latestSettings } from "@/lib/ai/config";

/**
 * ALARM KEGAGALAN AI (DECISIONS 635).
 *
 * Gangguan provider 4–27 Sep 2026 berjalan tiga minggu tanpa diketahui siapa
 * pun: tidak ada yang membunyikan apa pun saat run gagal beruntun.
 *
 * ### Kenapa dinilai saat run gagal dicatat, bukan oleh cron
 *
 * Spesifikasi Fase 0 menaruhnya di `api/cron/waha`. Cron itu memang dijadwalkan
 * tiap 5 menit di GitHub Actions, tetapi riwayat jalannya menunjukkan jeda
 * 3–6,5 jam – alarm di sana tidak akan pernah memenuhi "maksimal 1 jam". Jadi
 * setiap penulis run gagal memanggil `periksaAlarmAi` (tanpa ditunggu); cron
 * tetap memanggilnya sebagai jaring cadangan.
 *
 * ### Aturan
 *
 * Jendela 60 menit. Menyala bila 5 run terakhir semuanya gagal, atau lebih dari
 * 20% gagal dari minimal 5 run. Satu WA ke penerima alarm (setelan
 * `ai.alert.chat_id`, kosong = hanya spanduk + audit), satu baris audit, dan
 * spanduk merah di Sistem → AI dan /ai. Kirim ulang paling cepat 6 jam per kode
 * galat. Pemeriksaan & pencatatan dikunci advisory lock supaya dua kegagalan
 * yang tiba bersamaan tidak mengirim dua alarm.
 */

const JENDELA_MS = 60 * 60_000;
const JEDA_ULANG_MS = 6 * 60 * 60_000;
const MIN_RUN = 5;
const AMBANG_PORSI = 0.2;

/**
 * Kode yang BUKAN gangguan provider – pagar sistem sendiri atau masukan yang
 * memang salah. Menghitungnya akan membunyikan alarm untuk kuota harian yang
 * bekerja sebagaimana mestinya.
 */
const BUKAN_GANGGUAN = new Set(["budget_exceeded", "invalid_input", "ai_disabled", "input_too_big", "no_provider"]);

export type RunUntukAlarm = { gagal: boolean; errorCode: string | null };

/** Aturan alarm – MURNI. `runs` urut terbaru dulu. */
export function nilaiAlarm(runs: RunUntukAlarm[]): {
  nyala: boolean;
  errorCode: string | null;
  gagal: number;
  total: number;
} {
  const total = runs.length;
  const gagal = runs.filter((r) => r.gagal).length;
  const limaTerakhirGagal = total >= MIN_RUN && runs.slice(0, MIN_RUN).every((r) => r.gagal);
  const nyala = limaTerakhirGagal || (total >= MIN_RUN && gagal / total > AMBANG_PORSI);
  return { nyala, errorCode: runs.find((r) => r.gagal)?.errorCode ?? null, gagal, total };
}

function gagalSungguhan(r: { status: string; errorCode: string | null }): boolean {
  if (r.errorCode && BUKAN_GANGGUAN.has(r.errorCode)) return false;
  // Paparan tetap "siap" (deck deterministik jadi) walau AI-nya gagal – kodenya yang bicara.
  return r.status === "gagal" || r.errorCode != null;
}

export type HasilPeriksaAlarm = { nyala: boolean; dikirim: boolean; errorCode: string | null };

/** Nilai jendela 60 menit satu organisasi; bunyikan alarm bila perlu. Aman dipanggil sering. */
export async function periksaAlarmAi({ orgId, now = new Date() }: { orgId: string; now?: Date }): Promise<HasilPeriksaAlarm> {
  const rows = await db.aiRun.findMany({
    where: { orgId, finishedAt: { gte: new Date(now.getTime() - JENDELA_MS) } },
    select: { status: true, errorCode: true },
    orderBy: { finishedAt: "desc" },
    take: 200,
  });
  const nilai = nilaiAlarm(rows.map((r) => ({ gagal: gagalSungguhan(r), errorCode: r.errorCode })));
  if (!nilai.nyala) return { nyala: false, dikirim: false, errorCode: nilai.errorCode };
  const kode = nilai.errorCode ?? "unknown";

  const auditId = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('marlin-ai-alarm'))`;
    const sudah = await tx.auditLog.findFirst({
      where: {
        action: "ai.alarm",
        resourceId: orgId,
        createdAt: { gte: new Date(now.getTime() - JEDA_ULANG_MS) },
        payload: { path: ["errorCode"], equals: kode },
      },
      select: { id: true },
    });
    if (sudah) return null;
    // Ditulis langsung (bukan `auditIn`): alarm berjalan di latar, di luar
    // lingkup permintaan, dan `auditIn` membaca IP dari header permintaan.
    const baru = await tx.auditLog.create({
      data: {
        userId: null,
        action: "ai.alarm",
        resourceType: "organization",
        resourceId: orgId,
        ip: null,
        payload: { errorCode: kode, gagal: nilai.gagal, total: nilai.total },
      },
      select: { id: true },
    });
    return baru?.id ?? null;
  });
  if (!auditId) return { nyala: true, dikirim: false, errorCode: kode };

  const tujuan = (await latestSettings([ALERT_CHAT_KEY])).get(ALERT_CHAT_KEY)?.trim();
  if (!tujuan) return { nyala: true, dikirim: false, errorCode: kode };
  const { sendWaMessage } = await import("@/lib/waha/gateway");
  const r = await sendWaMessage({
    kind: "teks",
    destination: tujuan,
    payload: {
      teks:
        `⚠️ *AI MARLIN gagal beruntun*\n` +
        `${nilai.gagal} dari ${nilai.total} permintaan AI dalam 60 menit terakhir gagal.\n` +
        `Kode galat terakhir: *${kode}*.\n` +
        `Periksa Sistem → AI (tombol Tes koneksi) dan Riwayat AI.`,
    },
    idempotencyKey: `ai-alarm:${auditId}`,
    sourceType: "ai_alarm",
    sourceId: auditId,
  });
  return { nyala: true, dikirim: !r.error, errorCode: kode };
}

/** Jalankan tanpa menunggu dari jalur yang baru mencatat run gagal – kegagalannya tidak boleh menelan jawaban. */
export function periksaAlarmAiLatar(orgId: string | null | undefined): void {
  if (!orgId) return;
  void periksaAlarmAi({ orgId }).catch((err) =>
    console.error("[ai-alarm] pemeriksaan alarm gagal:", err instanceof Error ? err.message : err),
  );
}

export type StatusAlarmAi = { sejak: Date; errorCode: string; gagal: number; total: number };

/**
 * Alarm yang MASIH berlaku untuk spanduk: berbunyi dalam 6 jam terakhir dan
 * belum ada satu pun run berhasil sesudahnya. Padam sendiri begitu AI pulih.
 */
export async function statusAlarmAi(orgId: string): Promise<StatusAlarmAi | null> {
  const alarm = await db.auditLog.findFirst({
    where: { action: "ai.alarm", resourceId: orgId, createdAt: { gte: new Date(Date.now() - JEDA_ULANG_MS) } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, payload: true },
  });
  if (!alarm) return null;
  const pulih = await db.aiRun.count({
    where: { orgId, status: "siap", errorCode: null, finishedAt: { gt: alarm.createdAt } },
  });
  if (pulih > 0) return null;
  const p = (alarm.payload ?? {}) as { errorCode?: string; gagal?: number; total?: number };
  return { sejak: alarm.createdAt, errorCode: p.errorCode ?? "unknown", gagal: p.gagal ?? 0, total: p.total ?? 0 };
}
