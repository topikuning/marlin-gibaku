import "server-only";
import { after } from "next/server";
import { db } from "@/lib/db";
import { jalankanDiLatar } from "@/lib/auth/latar";
import {
  bagiKelompok,
  hasilKelompokAiSchema,
  normalisasiKelompok,
  petaJadwalAi,
  promptKelompok,
  SKEMA_HINT_JADWAL,
  type JadwalAiItem,
  type KelompokRab,
  type KelompokTernormal,
  type PekerjaanRab,
} from "./jadwal-ai-murni";

/**
 * ANALISA AI URUTAN PELAKSANAAN RAB AKTIF (DECISIONS 667, 669).
 *
 * Saat pengguna menekan "Analisa dengan AI", MARLIN mengirim isi RAB aktif ke
 * AI, satu bangunan per permintaan. TIDAK pernah otomatis saat RAB diimpor
 * atau diaktifkan (ketetapan user 2026-10-11, DECISIONS 669). Hasilnya (urutan, prasyarat, porsi
 * waktu, kritis, peka cuaca) menjadi dasar saran rencana mingguan. Volume
 * target tetap dihitung kode; AI tidak menyentuh angka resmi.
 *
 * Polanya sama dengan pekerjaan AI latar lain: baris antrean dicatat dulu,
 * pekerja latar mengklaimnya lewat `pendingSince`, dan cron 5 menitan
 * mengambil alih yang terhenti (deploy, proses mati, anggaran waktu habis).
 * Setiap bangunan disimpan begitu jadi, jadi kelanjutannya tidak mengulang
 * yang sudah selesai.
 */

/** Klaim yang tidak diperbarui selama ini dianggap ditinggalkan. */
const KLAIM_BASI_MS = 8 * 60_000;
/** Satu bangunan paling lama sekian, termasuk perbaikan JSON dan provider cadangan. */
const TENGGAT_BAGIAN_MS = 4 * 60_000;
/** Bangunan yang gagal dicoba ulang sampai sekian kali sebelum dilepas ke aturan bawaan. */
const PERCOBAAN_MAKS = 2;

export type StatusJadwalAi = "antre" | "jalan" | "selesai" | "sebagian" | "gagal";

type DataRevisi = {
  revisionId: string;
  locationId: string;
  orgId: string;
  lokasi: string;
  kabupaten: string;
  provinsi: string;
  mingguKontrak: number;
  kelompok: KelompokRab[];
  semuaKunci: Set<string>;
};

async function bacaRevisi(revisionId: string): Promise<DataRevisi | null> {
  const rev = await db.rabRevision.findUnique({
    where: { id: revisionId },
    select: {
      id: true,
      status: true,
      locationId: true,
      location: {
        select: {
          name: true,
          regency: true,
          province: true,
          package: { select: { orgId: true, contract: { select: { durationDays: true } } } },
        },
      },
    },
  });
  if (!rev || rev.status !== "aktif") return null;
  const nodes = await db.rabNode.findMany({
    where: { revisionId },
    select: { id: true, parentId: true, kind: true, code: true, name: true, unit: true, volume: true, lineageKey: true },
    orderBy: { sortOrder: "asc" },
  });
  const peta = new Map(nodes.map((n) => [n.id, n]));
  // Jalur = nama induk di antara bangunan dan pekerjaan ("STRUKTUR › Kolom").
  const jalur = (parentId: string | null): string => {
    const nama: string[] = [];
    for (let p = parentId ? peta.get(parentId) : undefined, i = 0; p && i < 10; p = p.parentId ? peta.get(p.parentId) : undefined, i++) {
      if (p.kind === "kategori") break;
      nama.unshift(p.name.replace(/\s+/g, " ").trim());
    }
    return nama.join(" › ");
  };
  const item: PekerjaanRab[] = nodes
    .filter((n) => n.kind === "item" && n.volume != null && Number(n.volume) > 0)
    .map((n) => ({
      lineageKey: n.lineageKey,
      code: n.code,
      name: n.name.replace(/\s+/g, " ").trim(),
      unit: n.unit,
      volume: Number(n.volume),
      jalur: jalur(n.parentId),
    }));
  // Bangunan = node kategori, prefix terpanjang – sama dengan saran & baseline.
  const kategori = nodes.filter((n) => n.kind === "kategori").map((n) => ({ lineageKey: n.lineageKey, name: n.name }));
  const days = rev.location.package.contract?.durationDays ?? 0;
  return {
    revisionId,
    locationId: rev.locationId,
    orgId: rev.location.package.orgId,
    lokasi: rev.location.name,
    kabupaten: rev.location.regency ?? "-",
    provinsi: rev.location.province ?? "-",
    mingguKontrak: Math.max(1, Math.ceil(days / 7)),
    kelompok: bagiKelompok(kategori, item),
    semuaKunci: new Set(item.map((i) => i.lineageKey)),
  };
}

/**
 * Catat analisa baru untuk revisi aktif ini – baris lama (kalau ada) disetel
 * ulang. Hanya dari tombol pengguna (DECISIONS 669).
 */
export async function antrekanJadwalAi(revisionId: string, dimintaOlehId: string | null): Promise<string | null> {
  const data = await bacaRevisi(revisionId);
  if (!data) return null;
  return db.$transaction(async (tx) => {
    const a = await tx.rabJadwalAi.upsert({
      where: { revisionId },
      create: { revisionId, locationId: data.locationId, dimintaOlehId },
      update: {
        status: "antre",
        pendingSince: null,
        runId: null,
        provider: null,
        model: null,
        galat: null,
        selesaiAt: null,
        dimintaOlehId,
      },
      select: { id: true },
    });
    await tx.rabJadwalAiKelompok.deleteMany({ where: { analisaId: a.id } });
    if (data.kelompok.length > 0) {
      await tx.rabJadwalAiKelompok.createMany({
        data: data.kelompok.map((k) => ({ analisaId: a.id, kategoriKey: k.kategoriKey, bagian: k.bagian, nama: k.nama })),
      });
    } else {
      await tx.rabJadwalAi.update({
        where: { id: a.id },
        data: { status: "gagal", galat: "RAB ini tidak punya pekerjaan bervolume untuk dianalisa.", selesaiAt: new Date() },
      });
    }
    return a.id;
  });
}

/**
 * Jalankan di latar SESUDAH respons terkirim. Di luar request (uji, skrip)
 * `after()` tidak tersedia – barisnya tetap di antrean dan cron yang
 * mengambilnya.
 */
export function dorongJadwalAi(analisaId: string): void {
  try {
    after(() => jalankanDiLatar(() => jalankanJadwalAi(analisaId, { batasMs: 25 * 60_000 })).then(() => undefined));
  } catch (err) {
    console.warn("[plan/jadwal-ai] tidak bisa menjadwalkan di latar, menunggu cron:", err instanceof Error ? err.message : err);
  }
}

type HasilJalan = { status: StatusJadwalAi | "dilewati"; dikerjakan: number };

/**
 * Kerjakan bangunan yang belum selesai sampai anggaran waktu habis.
 * TIDAK MELEMPAR: setiap galat berakhir di baris analisanya.
 */
export async function jalankanJadwalAi(analisaId: string, opts: { batasMs: number }): Promise<HasilJalan> {
  const mulai = Date.now();
  let penanda = new Date();
  const klaim = await db.rabJadwalAi.updateMany({
    where: {
      id: analisaId,
      status: { in: ["antre", "jalan"] },
      OR: [{ pendingSince: null }, { pendingSince: { lt: new Date(Date.now() - KLAIM_BASI_MS) } }],
    },
    data: { pendingSince: penanda, status: "jalan" },
  });
  if (klaim.count === 0) return { status: "dilewati", dikerjakan: 0 };

  /** Perbarui klaim; false = proses lain sudah mengambil alih. */
  const perbaruiKlaim = async (): Promise<boolean> => {
    const baru = new Date();
    const r = await db.rabJadwalAi.updateMany({ where: { id: analisaId, pendingSince: penanda }, data: { pendingSince: baru } });
    if (r.count === 0) return false;
    penanda = baru;
    return true;
  };
  const tutup = (data: { status: StatusJadwalAi; galat?: string | null; provider?: string | null; model?: string | null }) =>
    db.rabJadwalAi.updateMany({
      where: { id: analisaId, pendingSince: penanda },
      data: {
        ...data,
        pendingSince: null,
        ...(data.status === "selesai" || data.status === "sebagian" || data.status === "gagal" ? { selesaiAt: new Date() } : {}),
      },
    });

  let dikerjakan = 0;
  try {
    const a = await db.rabJadwalAi.findUniqueOrThrow({
      where: { id: analisaId },
      select: { revisionId: true, runId: true, dimintaOlehId: true, kelompok: true },
    });
    const data = await bacaRevisi(a.revisionId);
    if (!data) {
      await tutup({ status: "gagal", galat: "Revisi RAB ini sudah tidak aktif." });
      return { status: "gagal", dikerjakan };
    }

    const { getActiveAiConfig } = await import("@/lib/ai/config");
    if (!(await getActiveAiConfig())) {
      await tutup({ status: "gagal", galat: "AI belum disetel di Sistem → AI." });
      return { status: "gagal", dikerjakan };
    }

    const perKunci = new Map(data.kelompok.map((k) => [`${k.kategoriKey}|${k.bagian}`, k]));
    const totalBagian = new Map<string, number>();
    for (const k of data.kelompok) totalBagian.set(k.kategoriKey, Math.max(totalBagian.get(k.kategoriKey) ?? 0, k.bagian));
    const ctx = { lokasi: data.lokasi, kabupaten: data.kabupaten, provinsi: data.provinsi, mingguKontrak: data.mingguKontrak };
    const antre = a.kelompok
      .filter((k) => k.status === "antre" && perKunci.has(`${k.kategoriKey}|${k.bagian}`))
      .sort((x, y) => x.kategoriKey.localeCompare(y.kategoriKey, "id", { numeric: true }) || x.bagian - y.bagian);

    // Satu AiRun untuk seluruh analisa: kuota & audit menghitung satu pekerjaan.
    let runId = a.runId;
    if (!runId && antre.length > 0) {
      const { checkAiGuard, AiGuardError } = await import("@/lib/ai-hub/guard");
      const pemakai = { jenis: "grup" as const, orgId: data.orgId, chatId: `jadwal-rab:${data.locationId}` };
      const terpanjang = Math.max(
        0,
        ...antre.map((k) => promptKelompok(perKunci.get(`${k.kategoriKey}|${k.bagian}`)!, ctx, 1).length),
      );
      try {
        await checkAiGuard(pemakai, { kind: "rencana.jadwal_rab", locationCount: 1, inputChars: terpanjang });
      } catch (err) {
        if (!(err instanceof AiGuardError)) throw err;
        await tutup({ status: "gagal", galat: err.message });
        return { status: "gagal", dikerjakan };
      }
      const hari = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
      const run = await db.aiRun.create({
        data: {
          userId: a.dimintaOlehId,
          orgId: data.orgId,
          waChatId: pemakai.chatId,
          runKind: "jadwal_rab",
          status: "berjalan",
          scopeType: "location",
          scopeIds: [data.locationId],
          periodStart: hari,
          periodEnd: hari,
          promptVersion: "jadwal-rab-v1",
          inputHash: data.revisionId,
          inputTokens: 0,
          outputTokens: 0,
        },
        select: { id: true },
      });
      runId = run.id;
      await db.rabJadwalAi.update({ where: { id: analisaId }, data: { runId } });
    }

    const { aiStructured } = await import("@/lib/ai/structured");
    const { resolvePrompt } = await import("@/lib/ai/prompts");
    const system = await resolvePrompt("rencana.jadwal.system");
    let provider: string | null = null;
    let model: string | null = null;
    let tokIn = 0;
    let tokOut = 0;

    for (const k of antre) {
      const sisa = opts.batasMs - (Date.now() - mulai);
      if (sisa < 60_000) break;
      if (!(await perbaruiKlaim())) return { status: "dilewati", dikerjakan };
      const kel = perKunci.get(`${k.kategoriKey}|${k.bagian}`)!;
      const res = await aiStructured(hasilKelompokAiSchema, {
        system,
        prompt: promptKelompok(kel, ctx, totalBagian.get(k.kategoriKey) ?? 1),
        schemaHint: SKEMA_HINT_JADWAL,
        maxTokens: 8000,
        timeoutMs: 150_000,
        tenggatTotalMs: Math.min(TENGGAT_BAGIAN_MS, sisa - 30_000),
      });
      dikerjakan++;
      const meta = res.ok ? res.meta : res.meta?.ok ? res.meta : null;
      if (res.meta) provider = res.meta.provider ?? provider;
      if (meta) {
        model = meta.model;
        tokIn += meta.usage.inputTokens ?? 0;
        tokOut += meta.usage.outputTokens ?? 0;
      }
      if (res.ok) {
        const norm = normalisasiKelompok(kel, data.semuaKunci, res.data);
        if (Object.keys(norm.item).length > 0) {
          const hasil: KelompokTernormal = { catatan: norm.catatan, item: norm.item };
          await db.rabJadwalAiKelompok.update({
            where: { id: k.id },
            data: { status: "selesai", hasil, galat: null, percobaan: { increment: 1 } },
          });
          continue;
        }
      }
      const galat = res.ok ? "Jawaban AI tidak memuat pekerjaan bangunan ini." : res.error.slice(0, 300);
      await db.rabJadwalAiKelompok.update({
        where: { id: k.id },
        data: { status: k.percobaan + 1 >= PERCOBAAN_MAKS ? "gagal" : "antre", galat, percobaan: { increment: 1 } },
      });
    }

    const akhir = await db.rabJadwalAiKelompok.groupBy({ by: ["status"], where: { analisaId }, _count: true });
    const n = (s: string) => akhir.find((x) => x.status === s)?._count ?? 0;
    const status: StatusJadwalAi =
      n("antre") > 0 ? "jalan" : n("gagal") === 0 ? "selesai" : n("selesai") > 0 ? "sebagian" : "gagal";
    const galatPertama =
      status === "sebagian" || status === "gagal"
        ? ((await db.rabJadwalAiKelompok.findFirst({ where: { analisaId, status: "gagal" }, select: { galat: true } }))?.galat ?? null)
        : null;
    await tutup({ status, galat: galatPertama, ...(provider ? { provider } : {}), ...(model ? { model } : {}) });
    if (runId) {
      await db.aiRun.updateMany({
        where: { id: runId },
        data: {
          ...(status === "jalan" ? {} : { status: status === "gagal" ? "gagal" : "siap", finishedAt: new Date() }),
          ...(provider ? { provider } : {}),
          ...(model ? { model } : {}),
          inputTokens: { increment: tokIn },
          outputTokens: { increment: tokOut },
          ...(galatPertama ? { errorMessage: galatPertama.slice(0, 500) } : {}),
        },
      });
    }
    return { status, dikerjakan };
  } catch (err) {
    console.error("[plan/jadwal-ai] analisa gagal:", err);
    await tutup({ status: "gagal", galat: err instanceof Error ? err.message.slice(0, 300) : "Analisa AI gagal." }).catch(() => {});
    return { status: "gagal", dikerjakan };
  }
}

/** Ada proses yang sedang mengerjakan analisa revisi ini (klaimnya masih segar)? */
export async function sedangDianalisa(revisionId: string): Promise<boolean> {
  const a = await db.rabJadwalAi.findUnique({ where: { revisionId }, select: { status: true, pendingSince: true } });
  return !!a?.pendingSince && a.status === "jalan" && Date.now() - a.pendingSince.getTime() < KLAIM_BASI_MS;
}

/** Cron: lanjutkan analisa yang antre atau terhenti. */
export async function jemputJadwalAi(opts: { batasMs: number }): Promise<{ analisa: number }> {
  const mulai = Date.now();
  const calon = await db.rabJadwalAi.findMany({
    where: {
      status: { in: ["antre", "jalan"] },
      revision: { status: "aktif" },
      OR: [{ pendingSince: null }, { pendingSince: { lt: new Date(Date.now() - KLAIM_BASI_MS) } }],
    },
    orderBy: { updatedAt: "asc" },
    take: 5,
    select: { id: true },
  });
  let analisa = 0;
  for (const c of calon) {
    const sisa = opts.batasMs - (Date.now() - mulai);
    if (sisa < 90_000) break;
    const h = await jalankanJadwalAi(c.id, { batasMs: sisa });
    if (h.status !== "dilewati") analisa++;
  }
  return { analisa };
}

export type RingkasJadwalAi = {
  status: StatusJadwalAi;
  model: string | null;
  galat: string | null;
  selesaiAt: Date | null;
  diperbarui: Date;
  bangunan: { total: number; selesai: number; gagal: number };
  catatan: { nama: string; catatan: string }[];
};

/** Hasil analisa revisi aktif: peta per pekerjaan + ringkasan untuk layar. */
export async function bacaJadwalAi(
  revisionId: string,
): Promise<{ peta: Map<string, JadwalAiItem>; ringkas: RingkasJadwalAi } | null> {
  const a = await db.rabJadwalAi.findUnique({
    where: { revisionId },
    select: {
      status: true,
      model: true,
      galat: true,
      selesaiAt: true,
      updatedAt: true,
      kelompok: { select: { nama: true, bagian: true, kategoriKey: true, status: true, hasil: true } },
    },
  });
  if (!a) return null;
  const kel = [...a.kelompok].sort(
    (x, y) => x.kategoriKey.localeCompare(y.kategoriKey, "id", { numeric: true }) || x.bagian - y.bagian,
  );
  const selesai = kel.filter((k) => k.status === "selesai" && k.hasil);
  const bagian = selesai.map((k) => k.hasil as unknown as KelompokTernormal);
  const bangunan = new Map<string, { selesai: boolean; gagal: boolean }>();
  for (const k of kel) {
    const b = bangunan.get(k.kategoriKey) ?? { selesai: true, gagal: false };
    if (k.status !== "selesai") b.selesai = false;
    if (k.status === "gagal") b.gagal = true;
    bangunan.set(k.kategoriKey, b);
  }
  return {
    peta: petaJadwalAi(bagian),
    ringkas: {
      status: a.status as StatusJadwalAi,
      model: a.model,
      galat: a.galat,
      selesaiAt: a.selesaiAt,
      diperbarui: a.updatedAt,
      bangunan: {
        total: bangunan.size,
        selesai: [...bangunan.values()].filter((b) => b.selesai).length,
        gagal: [...bangunan.values()].filter((b) => b.gagal).length,
      },
      catatan: selesai
        .filter((k) => k.bagian === 1 && (k.hasil as unknown as KelompokTernormal).catatan)
        .map((k) => ({ nama: k.nama, catatan: (k.hasil as unknown as KelompokTernormal).catatan })),
    },
  };
}
