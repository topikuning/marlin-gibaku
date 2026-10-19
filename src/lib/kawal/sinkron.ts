import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { cocokkanLokasi, type Keputusan, type LokasiCocok } from "./cocok";
import { ambilLokasiKawal } from "./klien";
import { parseResponsKawal, type BarisKawal } from "./parser";
import { getAkunKawal } from "./setelan";

/**
 * SATU PUTARAN SINKRON KAWAL (DECISIONS 690): masuk → ambil → parse ketat →
 * cocokkan lokasi → simpan snapshot bila isinya berubah.
 *
 * - Satu permintaan data per putaran; putaran yang tumpang tindih ditolak.
 * - Bentuk respons berubah = putaran GAGAL, tidak ada yang disimpan setengah.
 * - Baris tanpa petunjuk lokasi MARLIN dibuang, hanya dihitung.
 * - Isi yang sama dengan snapshot terakhir tidak membuat snapshot baru – aman
 *   dipicu berkali-kali.
 * - Data Kawal tidak menyentuh calculation layer, status, atau keuangan.
 */

export type HasilSinkron = {
  status: "belum_diatur" | "sedang_berjalan" | "berhasil" | "tidak_berubah" | "gagal";
  pesan: string;
  runId?: string;
  diterima?: number;
  berpasangan?: number;
  pasanganBaru?: number;
  antre?: number;
  dibuang?: number;
};

/** Putaran "berjalan" yang lebih tua dari ini dianggap mati di tengah jalan. */
const BATAS_BERJALAN_MS = 10 * 60_000;

function tanggalDb(s: string | null): Date | null {
  return s ? new Date(`${s}T00:00:00.000Z`) : null;
}

/** sha256 isi yang akan disimpan, urut id Kawal – urutan respons tidak mengubahnya. */
export function hashIsi(baris: BarisKawal[]): string {
  const urut = [...baris].sort((a, b) => a.kawalId - b.kawalId);
  const json = JSON.stringify(urut, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  return createHash("sha256").update(json).digest("hex");
}

function dataLokasi(b: BarisKawal) {
  return {
    kawalId: b.kawalId,
    namaKnmp: b.namaKnmp,
    desa: b.desa,
    kecamatan: b.kecamatan,
    kabupaten: b.kabupaten,
    provinsi: b.provinsi,
    tahap: b.tahap,
    kategori: b.kategori,
    penyedia: b.penyedia,
    noKontrak: b.noKontrak,
    tglKontrak: tanggalDb(b.tglKontrak),
    noSpmk: b.noSpmk,
    mulai: tanggalDb(b.mulai),
    selesai: tanggalDb(b.selesai),
    estimasiHari: b.estimasiHari,
    nilaiKontrak: b.nilaiKontrak,
    nilaiLokasi: b.nilaiLokasi,
    nilaiAdd1: b.nilaiAdd1,
    nilaiAdd2: b.nilaiAdd2,
    nilaiAdd3: b.nilaiAdd3,
    statusKontrak: b.statusKontrak,
    latitude: b.latitude,
    longitude: b.longitude,
    actualPct: b.actualPct,
    pelaksanaPct: b.pelaksanaPct,
    targetPct: b.targetPct,
    deviasiPct: b.deviasiPct,
    realisasiPengawasPct: b.realisasiPengawasPct,
    realisasiPelaksanaPct: b.realisasiPelaksanaPct,
    weekNo: b.weekNo,
    maxWeeks: b.maxWeeks,
    lastActualWeek: b.lastActualWeek,
    lastPelaksanaWeek: b.lastPelaksanaWeek,
    kurva: b.kurva,
    remarkKondisiUmum: b.remarkKondisiUmum,
    remarkHambatan: b.remarkHambatan,
    remarkSaranInstruksi: b.remarkSaranInstruksi,
    sarana: { createMany: { data: b.sarana } },
  };
}

/** Lokasi MARLIN dalam bentuk yang dibaca pencocok. */
export async function lokasiUntukCocok(): Promise<LokasiCocok[]> {
  const rows = await db.location.findMany({
    select: {
      id: true,
      name: true,
      village: true,
      regency: true,
      packageId: true,
      gpsLat: true,
      gpsLng: true,
      package: { select: { contract: { select: { contractNumber: true } } } },
    },
  });
  return rows.map((l) => ({
    id: l.id,
    name: l.name,
    village: l.village,
    regency: l.regency,
    packageId: l.packageId,
    contractNumber: l.package.contract?.contractNumber ?? null,
    gpsLat: l.gpsLat == null ? null : Number(l.gpsLat),
    gpsLng: l.gpsLng == null ? null : Number(l.gpsLng),
  }));
}

/** Keputusan pencocokan untuk baris yang sudah ter-parse – dipakai juga oleh layar pencocokan. */
export async function putuskanPencocokan(baris: BarisKawal[]): Promise<Keputusan[]> {
  const [lokasi, peta] = await Promise.all([
    lokasiUntukCocok(),
    db.kawalLocationMap.findMany({ select: { kawalId: true, locationId: true, status: true } }),
  ]);
  return cocokkanLokasi(baris, lokasi, peta);
}

export async function sinkronKawal(opsi: {
  pemicu: "cron" | "manual";
  olehId?: string | null;
  fetchFn?: typeof fetch;
  now?: Date;
}): Promise<HasilSinkron> {
  const now = opsi.now ?? new Date();
  const akun = await getAkunKawal();
  if (!akun) return { status: "belum_diatur", pesan: "Akun Kawal belum diisi di Sistem › Integrasi." };

  // Putaran yang mati di tengah jalan (proses dihentikan, deploy) ditutup
  // dengan sebab yang jujur, bukan dibiarkan "berjalan" selamanya.
  const basi = new Date(now.getTime() - BATAS_BERJALAN_MS);
  await db.kawalSyncRun.updateMany({
    where: { outcome: "berjalan", startedAt: { lt: basi } },
    data: { outcome: "gagal", finishedAt: now, error: "Putaran terhenti sebelum selesai." },
  });
  const jalan = await db.kawalSyncRun.findFirst({ where: { outcome: "berjalan" }, select: { id: true } });
  if (jalan) return { status: "sedang_berjalan", pesan: "Sinkron Kawal sedang berjalan. Tunggu sampai selesai." };

  const run = await db.kawalSyncRun.create({
    data: { outcome: "berjalan", trigger: opsi.pemicu, byId: opsi.olehId ?? null, startedAt: now },
  });
  const gagal = async (pesan: string, rowCount?: number): Promise<HasilSinkron> => {
    await db.kawalSyncRun.update({
      where: { id: run.id },
      data: { outcome: "gagal", finishedAt: new Date(), error: pesan, rowCount: rowCount ?? null },
    });
    return { status: "gagal", pesan, runId: run.id };
  };

  try {
    const { body } = await ambilLokasiKawal(akun, opsi.fetchFn);
    const parse = parseResponsKawal(body);
    if (!parse.ok) {
      const jumlah =
        body && typeof body === "object" && Array.isArray((body as { data?: unknown }).data)
          ? (body as { data: unknown[] }).data.length
          : undefined;
      return await gagal(
        `Bentuk data Kawal berubah – tidak ada yang disimpan. ${parse.masalah.join(" ")}`.slice(0, 2000),
        jumlah,
      );
    }

    const keputusan = await putuskanPencocokan(parse.baris);
    const perId = new Map(parse.baris.map((b) => [b.kawalId, b]));
    const baruOtomatis = keputusan.filter(
      (k): k is Extract<Keputusan, { jenis: "berpasangan" }> => k.jenis === "berpasangan" && k.baru !== null,
    );
    const disimpan = keputusan.filter((k) => k.jenis === "berpasangan" || k.jenis === "antre");
    const berpasangan = keputusan.filter((k) => k.jenis === "berpasangan").length;
    const antre = keputusan.filter((k) => k.jenis === "antre").length;
    const dibuang = keputusan.length - disimpan.length;
    const barisDisimpan = disimpan.map((k) => perId.get(k.kawalId)!);
    const hash = hashIsi(barisDisimpan);

    const terakhir = await db.kawalSnapshot.findFirst({
      orderBy: { capturedAt: "desc" },
      select: { contentHash: true },
    });
    const berubah = terakhir?.contentHash !== hash;

    const snapshotId = await db.$transaction(
      async (tx) => {
        // Pasangan otomatis disimpan walau isinya tidak berubah: lokasi MARLIN
        // yang baru dibuat bisa membuat baris antrean jadi berpasangan tanpa
        // satu angka Kawal pun bergeser.
        if (baruOtomatis.length) {
          await tx.kawalLocationMap.createMany({
            data: baruOtomatis.map((k) => ({
              kawalId: k.kawalId,
              locationId: k.locationId,
              status: "otomatis",
              basis: k.baru!.basis,
            })),
          });
        }
        if (!berubah) return null;
        const snap = await tx.kawalSnapshot.create({
          data: { capturedAt: now, rowCount: parse.baris.length, storedCount: barisDisimpan.length, contentHash: hash },
        });
        for (const b of barisDisimpan) {
          await tx.kawalLocationSnapshot.create({ data: { snapshotId: snap.id, ...dataLokasi(b) } });
        }
        return snap.id;
      },
      { timeout: 60_000 },
    );

    const outcome = snapshotId ? "berhasil" : "tidak_berubah";
    await db.kawalSyncRun.update({
      where: { id: run.id },
      data: {
        outcome,
        finishedAt: new Date(),
        rowCount: parse.baris.length,
        matchedCount: berpasangan,
        queueCount: antre,
        discardedCount: dibuang,
        snapshotId,
      },
    });
    const ringkas =
      `${parse.baris.length} lokasi diterima dari Kawal: ${berpasangan} berpasangan` +
      (baruOtomatis.length ? ` (${baruOtomatis.length} baru, otomatis)` : "") +
      `, ${antre} menunggu konfirmasi, ${dibuang} dibuang.`;
    return {
      status: outcome,
      pesan: snapshotId ? ringkas : `Data Kawal tidak berubah sejak tarikan terakhir. ${ringkas}`,
      runId: run.id,
      diterima: parse.baris.length,
      berpasangan,
      pasanganBaru: baruOtomatis.length,
      antre,
      dibuang,
    };
  } catch (err) {
    return gagal(err instanceof Error ? err.message : "Sinkron Kawal gagal.");
  }
}
