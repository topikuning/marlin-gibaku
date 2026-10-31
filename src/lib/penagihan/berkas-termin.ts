import "server-only";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";
import { addMonths } from "@/lib/periodic-report";
import { weekDateRange, type WeekPeriodMode } from "@/lib/progress-calc";
import { buatFolder, daftarSubfolder, ensureFolderPath, GDriveError } from "@/lib/gdrive/client";
import { KKP_FOLDERS, kunciNamaFolder, safeFileName } from "@/lib/gdrive/folders";
import { rangkum, type HasilUnggah, type Terhalang, type TidakBerlaku } from "@/lib/gdrive/kirim";
import { namaFolderTermin, polaFolderTermin } from "@/lib/gdrive/struktur";
import { documentItem, uploadBatch, type UploadItem, type UploadTarget } from "@/lib/gdrive/upload";
import { ambangTermin, dataSuratTersimpan } from "@/lib/surat-penyedia/data";
import { kekuranganData, susunSurat } from "@/lib/surat-penyedia/aturan";
import { muatPenagihan } from "./data";
import { butirBerkas } from "./katalog";
import {
  KIND_BERKAS_TERMIN,
  awalanPeriodeTermin,
  labelPekerjaanTermin,
  namaLaporanTermin,
  periodePekerjaanTermin,
  refKeyPekerjaanTermin,
  rencanaBerkasTermin,
  rentangMingguTermin,
  uraiPeriodeTermin,
  type PekerjaanTermin,
  type RentangMinggu,
} from "./berkas-termin-aturan";

/**
 * "SIAPKAN BERKAS TERMIN n" – sisi server (DECISIONS 721).
 *
 * Menekan tombolnya hanya MENGANTRE pekerjaan (satu baris `gdrive_jobs` per
 * berkas). Pembuatan PDF dan unggahnya dikerjakan antrean Drive yang sudah
 * ada (DECISIONS 313): bertahap, berjeda, mundur saat Google menahan laju, dan
 * baris yang sama dipakai ulang saat tombolnya ditekan lagi – berkas di Drive
 * jadi REVISI, bukan kembaran.
 */

const DAY_MS = 86_400_000;

export type HasilAntreTermin =
  /** `dariDrive` = berkas yang ditarik DARI Drive KKP: sudah di sana, tidak diunggah balik. */
  | { ok: true; jumlah: number; rentang: RentangMinggu; dariDrive: number }
  /** `terminKe` = termin yang progres konsultannya perlu diisi (untuk tautan). */
  | { ok: false; error: string; terminKe?: number };

/** Bulan laporan (ke-n sejak SPMK) yang beririsan dengan minggu `rentang`. */
export function bulanBeririsan(mulai: Date, mode: WeekPeriodMode, rentang: RentangMinggu): number[] {
  const awal = weekDateRange(mulai, rentang.awal, mode).start.getTime();
  const akhir = weekDateRange(mulai, rentang.akhir, mode).end.getTime();
  const hasil: number[] = [];
  for (let m = 1; m <= 240; m++) {
    const s = addMonths(mulai, m - 1).getTime();
    if (s > akhir) break;
    if (addMonths(mulai, m).getTime() - DAY_MS >= awal) hasil.push(m);
  }
  return hasil;
}

export async function antrekanBerkasTermin(
  packageId: string,
  terminKe: number,
  user: SessionUser,
): Promise<HasilAntreTermin> {
  const d = await muatPenagihan(packageId, user, terminKe);
  if (!d) return { ok: false, error: "Paket atau kontraknya tidak ditemukan." };
  if (d.terminKe !== terminKe) return { ok: false, error: `Termin ${terminKe} tidak ada di jadwal kontrak ini.` };

  const r = rentangMingguTermin(terminKe, d.mingguPrestasi);
  if (!r.ok) return { ok: false, error: r.alasan, terminKe: r.terminKe };
  const kontrak = await db.contract.findUnique({
    where: { id: d.kontrak.id },
    select: { startDate: true, weekMode: true },
  });
  if (!kontrak?.startDate) {
    return { ok: false, error: "Kontrak belum punya tanggal SPMK, jadi minggu laporannya belum punya tanggal." };
  }

  const semua = rencanaBerkasTermin({
    terminKe,
    baris: d.langkah.flatMap((l) => l.baris).map((b) => ({ kode: b.butir.kode, status: b.status, sumber: b.sumber })),
    lokasi: d.lokasiAktif,
    rentang: r.rentang,
    bulan: bulanBeririsan(kontrak.startDate, kontrak.weekMode, r.rentang),
  });
  // Berkas yang DITARIK dari Drive KKP tidak diunggah balik ke Drive KKP
  // (DECISIONS 197) – berkasnya sudah ada di sana.
  const idDokumen = semua.flatMap((p) => (p.jenis === "berkas" && p.sumber?.startsWith("d") ? [p.sumber.slice(1)] : []));
  const dariDrive = new Set(
    (
      await db.document.findMany({ where: { id: { in: idDokumen }, source: "drive_kkp" }, select: { id: true } })
    ).map((x) => x.id),
  );
  const rencana = semua.filter((p) => !(p.jenis === "berkas" && p.sumber && dariDrive.has(p.sumber.slice(1))));

  const sekarang = new Date();
  const kunci: string[] = [];
  for (const p of rencana) {
    const refKey = refKeyPekerjaanTermin(packageId, p);
    const periode = periodePekerjaanTermin(p);
    kunci.push(refKey);
    await db.gDriveJob.upsert({
      where: { kind_refKey: { kind: KIND_BERKAS_TERMIN, refKey } },
      create: { kind: KIND_BERKAS_TERMIN, refKey, periode, packageId, locationId: p.locationId },
      // Ditekan ulang = dikerjakan ulang dengan isi terbaru (dokumen diganti,
      // laporan direvisi). Baris yang sedang "jalan" ikut kembali menunggu,
      // sehingga hasil lamanya tidak menutupnya sebagai sukses (DECISIONS 313).
      update: {
        periode,
        locationId: p.locationId,
        status: "menunggu",
        attempts: 0,
        lastError: null,
        nextAttemptAt: sekarang,
        claimedAt: null,
        finishedAt: null,
      },
    });
  }
  // Pekerjaan termin ini yang tidak dibutuhkan lagi (lokasi dinonaktifkan,
  // folder laporan kini diisi unggahan orang) dibuang selama belum selesai.
  await db.gDriveJob.deleteMany({
    where: {
      kind: KIND_BERKAS_TERMIN,
      packageId,
      periode: { startsWith: awalanPeriodeTermin(terminKe) },
      refKey: { notIn: kunci },
      status: { in: ["menunggu", "menyerah", "batal"] },
    },
  });
  return { ok: true, jumlah: rencana.length, rentang: r.rentang, dariDrive: dariDrive.size };
}

/* ── Mengerjakan satu pekerjaan ─────────────────────────────────────────── */

const PDF_MIME = "application/pdf";

type PaketTermin = { id: string; name: string; orgId: string; driveFolderId: string };
type LokasiTermin = { name: string; slug: string } | null;

/** Susun berkas satu pekerjaan; `batal` = sumbernya sudah tidak ada/tidak bisa disusun. */
async function susunBerkas(
  p: PekerjaanTermin,
  pkg: PaketTermin,
  lokasi: LokasiTermin,
  baseUrl: string | null,
): Promise<UploadItem | TidakBerlaku> {
  const pdf = (data: Buffer): UploadItem => ({
    fileName: safeFileName(namaLaporanTermin(p, { lokasi: lokasi?.name ?? null, paket: pkg.name }), "laporan.pdf"),
    mime: PDF_MIME,
    data,
  });
  switch (p.jenis) {
    case "berkas": {
      const id = p.sumber?.slice(1) ?? "";
      if (p.sumber?.startsWith("d")) {
        const doc = await db.document.findFirst({
          where: { id, orgId: pkg.orgId, status: "aktif" },
          select: { r2Key: true, fileName: true, mimeType: true },
        });
        if (!doc) return { batal: "Dokumennya sudah dihapus atau diganti. Tekan Siapkan berkas lagi." };
        return documentItem(doc);
      }
      const s = await dataSuratTersimpan(id, pkg.orgId);
      if (!s) return { batal: "Suratnya sudah dihapus. Tekan Siapkan berkas lagi." };
      const kurang = kekuranganData(s.data);
      if (kurang.length) return { batal: `Surat belum bisa disusun. Lengkapi dulu: ${kurang.join("; ")}.` };
      const surat = susunSurat(s.data);
      const { buatPdfSurat } = await import("@/lib/pdf/surat-penyedia");
      return {
        fileName: safeFileName(`${surat.judulBerkas}.pdf`, "surat.pdf"),
        mime: PDF_MIME,
        data: await buatPdfSurat(surat, s.kop),
      };
    }
    case "kurva_s": {
      const [{ susunKurvaPaket }, { renderKurvaPaketPdf }] = await Promise.all([
        import("@/lib/laporan/kurva-paket"),
        import("@/lib/pdf/periodik-kkp"),
      ]);
      const dok = await susunKurvaPaket(pkg.id, null);
      if (dok === "tidak_ada") return { batal: "Paketnya sudah tidak ada." };
      if (dok === "kosong") return { batal: "Kurva S belum bisa dibuat: belum ada lokasi dengan baseline kurva-S dan RAB aktif." };
      return pdf((await renderKurvaPaketPdf(dok)).buffer);
    }
    case "mingguan":
    case "bulanan": {
      const { renderPeriodikKkpPdf } = await import("@/lib/pdf/periodik-kkp");
      const hasil = await renderPeriodikKkpPdf(p.locationId!, p.jenis, p.nomor!);
      if (!hasil) return { batal: `${labelPekerjaanTermin(p)} belum bisa disusun.` };
      return pdf(hasil.buffer);
    }
    case "harian": {
      const { renderMingguanKkpPdf } = await import("@/lib/pdf/mingguan-kkp");
      const hasil = await renderMingguanKkpPdf(lokasi!.slug, p.nomor!, { baseUrl });
      if (!hasil) return { batal: "Laporan harian belum bisa disusun karena kontraknya belum punya tanggal SPMK." };
      return pdf(hasil.buffer);
    }
    case "dokumentasi": {
      const { renderDokumentasiSarprasPdf } = await import("@/lib/pdf/dokumentasi-sarpras");
      const hasil = await renderDokumentasiSarprasPdf(p.locationId!);
      if (!hasil) return { batal: "Belum ada foto sarana prasarana untuk lokasi ini." };
      return pdf(hasil.buffer);
    }
  }
}

/**
 * Folder `7. BERKAS TERMIN / TERMIN n …` yang SUDAH ADA dipakai, apa pun persen
 * dan nama penyedia di namanya – sama dengan tombol Siapkan folder Drive
 * (DECISIONS 715). Baru dibuat bila memang belum ada.
 */
async function folderTermin(rootId: string, terminKe: number, ambang: number, penyedia: string): Promise<string> {
  const induk = await ensureFolderPath(rootId, [KKP_FOLDERS[6]]);
  const pola = polaFolderTermin(terminKe);
  const ada = (await daftarSubfolder(induk)).find((f) => pola.test(kunciNamaFolder(f.name)));
  return ada?.id ?? buatFolder(induk, namaFolderTermin(terminKe, ambang, penyedia));
}

export async function jalankanPekerjaanTermin(
  job: { refKey: string; periode: string; packageId: string; locationId: string | null },
  opts: { baseUrl: string | null; jedaMs: number },
): Promise<HasilUnggah | Terhalang | TidakBerlaku> {
  const p = uraiPeriodeTermin(job.periode, job.locationId);
  if (!p) return { batal: `Pekerjaan berkas termin tidak dikenali (${job.periode}).` };
  const pkg = await db.package.findUnique({
    where: { id: job.packageId },
    select: {
      id: true,
      name: true,
      orgId: true,
      driveFolderId: true,
      contract: { select: { id: true, vendor: { select: { name: true } } } },
    },
  });
  if (!pkg?.contract) return { batal: "Paket atau kontraknya sudah tidak ada." };
  if (!pkg.driveFolderId) return { error: "Paket ini belum punya folder Google Drive. Atur dulu di halaman paket." };
  const ambang = await ambangTermin(pkg.contract.id, p.terminKe);
  if (ambang === null) return { batal: `Termin ${p.terminKe} sudah tidak ada di jadwal kontrak.` };
  const lokasi = p.locationId
    ? await db.location.findUnique({ where: { id: p.locationId }, select: { name: true, slug: true } })
    : null;
  if (p.locationId && !lokasi) return { batal: "Lokasinya sudah tidak ada." };

  const berkas = await susunBerkas(p, { ...pkg, driveFolderId: pkg.driveFolderId }, lokasi, opts.baseUrl);
  if ("batal" in berkas) return berkas;

  let akar: string;
  try {
    akar = await folderTermin(pkg.driveFolderId, p.terminKe, ambang, pkg.contract.vendor.name);
  } catch (err) {
    return {
      ringkas: `${labelPekerjaanTermin(p)}: folder termin tidak bisa disiapkan.`,
      outcomes: [],
      berkas: 0,
      skipped: 0,
      galat:
        err instanceof GDriveError
          ? { pesan: err.message, status: err.status, retryAfter: err.retryAfter }
          : { pesan: err instanceof Error ? err.message : "Folder termin gagal disiapkan.", status: null, retryAfter: null },
    };
  }
  // Akar unggahan = folder TERMIN n; jalurnya persis nama folder di katalog.
  const target: UploadTarget = {
    packageId: pkg.id,
    locationId: p.locationId,
    rootFolderId: akar,
    kind: "berkas_termin",
    refKey: job.refKey,
    byId: null,
  };
  const outcomes = [];
  for (const kode of p.kode) {
    outcomes.push(await uploadBatch(target, [...butirBerkas(kode)!.jalur], [berkas], { jedaMs: opts.jedaMs }));
  }
  return rangkum(labelPekerjaanTermin(p), outcomes, 0);
}

/* ── Ringkasan untuk layar Penagihan ────────────────────────────────────── */

export type RingkasBerkasTermin = {
  total: number;
  sukses: number;
  menunggu: number;
  gagal: number;
  batal: number;
  /** Yang perlu dilihat orang: gagal berulang / menyerah / tidak bisa disusun. */
  masalah: { label: string; lokasi: string | null; pesan: string; menyerah: boolean }[];
  terakhir: Date | null;
  /** Alamat folder Drive paket; null = paket belum punya folder Drive. */
  folderDrive: string | null;
};

export async function ringkasBerkasTermin(packageId: string, terminKe: number): Promise<RingkasBerkasTermin> {
  const pkg = await db.package.findUnique({ where: { id: packageId }, select: { driveFolderId: true } });
  const baris = await db.gDriveJob.findMany({
    where: { kind: KIND_BERKAS_TERMIN, packageId, periode: { startsWith: awalanPeriodeTermin(terminKe) } },
    orderBy: { createdAt: "asc" },
    select: {
      status: true,
      periode: true,
      locationId: true,
      lastError: true,
      finishedAt: true,
      location: { select: { name: true } },
    },
  });
  const masalah: RingkasBerkasTermin["masalah"] = [];
  for (const b of baris) {
    if (!b.lastError || b.status === "sukses") continue;
    const p = uraiPeriodeTermin(b.periode, b.locationId);
    masalah.push({
      label: p ? labelPekerjaanTermin(p) : b.periode,
      lokasi: b.location?.name ?? null,
      pesan: b.lastError,
      menyerah: b.status === "menyerah",
    });
  }
  const selesai = baris.map((b) => b.finishedAt?.getTime() ?? 0).filter((t) => t > 0);
  return {
    total: baris.length,
    sukses: baris.filter((b) => b.status === "sukses").length,
    menunggu: baris.filter((b) => b.status === "menunggu" || b.status === "jalan").length,
    gagal: baris.filter((b) => b.status === "menyerah").length,
    batal: baris.filter((b) => b.status === "batal").length,
    masalah,
    terakhir: selesai.length ? new Date(Math.max(...selesai)) : null,
    folderDrive: pkg?.driveFolderId ? `https://drive.google.com/drive/folders/${pkg.driveFolderId}` : null,
  };
}
