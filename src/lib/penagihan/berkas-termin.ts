import "server-only";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";
import { addMonths } from "@/lib/periodic-report";
import { weekDateRange, type WeekPeriodMode } from "@/lib/progress-calc";
import { buangKeSampah, buatFolder, daftarSubfolder, ensureFolderPath, GDriveError } from "@/lib/gdrive/client";
import { KKP_FOLDERS, kunciNamaFolder, safeFileName } from "@/lib/gdrive/folders";
import { rangkum, type HasilUnggah, type Terhalang, type TidakBerlaku } from "@/lib/gdrive/kirim";
import { namaFolderTermin, polaFolderTermin } from "@/lib/gdrive/struktur";
import { bolehDibuang, documentItem, uploadBatch, type UploadItem, type UploadTarget } from "@/lib/gdrive/upload";
import { ambangTermin, dataSuratTersimpan, muatKontrakSurat } from "@/lib/surat-penyedia/data";
import {
  CARA_RAPAT_BAWAAN,
  JENIS_SURAT_TERSEDIA,
  KEPADA_BAWAAN,
  LABEL_JENIS_SURAT,
  PIMPINAN_RAPAT_BAWAAN,
  TEMPAT_LENGKAPI,
  kekuranganData,
  lampiranBawaan,
  pesertaRapatBawaan,
  susunSurat,
  tautanLengkapi,
} from "@/lib/surat-penyedia/aturan";
import { buatSuratPenyedia, type HasilBuatSurat, type IsianSurat } from "@/lib/surat-penyedia/buat";
import type { JenisSuratPenyedia } from "@/generated/prisma/enums";
import { muatPenagihan } from "./data";
import { butirBerkas } from "./katalog";
import {
  KIND_BERKAS_TERMIN,
  awalanPeriodeTermin,
  kodeSurat,
  labelPekerjaanTermin,
  namaDenganLokasi,
  namaLaporanTermin,
  pekerjaanBuang,
  periodePekerjaanTermin,
  refKeyPekerjaanTermin,
  rencanaBerkasTermin,
  rentangMingguTermin,
  subfolderLokasi,
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
const AWALAN_BUANG = "buang>";

export type HasilAntreTermin =
  /**
   * `dariDrive` = berkas yang ditarik DARI Drive KKP: sudah di sana, tidak
   * diunggah balik. `dibuang` = versi MARLIN di Drive yang akan dibuang karena
   * digantikan (DECISIONS 722).
   */
  | { ok: true; jumlah: number; rentang: RentangMinggu; dariDrive: number; dibuang: number }
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
    baris: d.langkah.flatMap((l) => l.baris).map((b) => ({
      kode: b.butir.kode,
      status: b.status,
      sumber: b.sumber,
      lokasi: b.lokasi?.map((x) => ({ locationId: x.locationId, status: x.status })) ?? null,
    })),
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

  // Versi MARLIN yang sudah naik tapi kini keluar rencana (diganti unggahan
  // sendiri, minggu prestasi dibetulkan, lokasi dinonaktifkan) dibuang dari
  // folder termin lewat antrean – Sampah Drive, bisa dipulihkan.
  const lama = await db.gDriveJob.findMany({
    where: { kind: KIND_BERKAS_TERMIN, packageId, periode: { startsWith: awalanPeriodeTermin(terminKe) } },
    select: { refKey: true, periode: true, locationId: true, status: true },
  });
  const buang = pekerjaanBuang(lama, new Set(rencana.map((p) => refKeyPekerjaanTermin(packageId, p))));

  const sekarang = new Date();
  // Pekerjaan buang selalu SESUDAH salinan dari tekanan yang sama (antrean
  // urut `nextAttemptAt`): berkas yang tertimpa salinan sudah tercatat
  // dipakai saat pembuangnya berjalan.
  const sesudahnya = new Date(sekarang.getTime() + 1);
  const kunci: string[] = [];
  for (const p of [...rencana, ...buang]) {
    const refKey = refKeyPekerjaanTermin(packageId, p);
    const periode = periodePekerjaanTermin(p);
    const kapan = p.jenis === "buang" ? sesudahnya : sekarang;
    kunci.push(refKey);
    await db.gDriveJob.upsert({
      where: { kind_refKey: { kind: KIND_BERKAS_TERMIN, refKey } },
      create: { kind: KIND_BERKAS_TERMIN, refKey, periode, packageId, locationId: p.locationId, nextAttemptAt: kapan },
      // Ditekan ulang = dikerjakan ulang dengan isi terbaru (dokumen diganti,
      // laporan direvisi). Baris yang sedang "jalan" ikut kembali menunggu,
      // sehingga hasil lamanya tidak menutupnya sebagai sukses (DECISIONS 313).
      update: {
        periode,
        locationId: p.locationId,
        status: "menunggu",
        attempts: 0,
        lastError: null,
        nextAttemptAt: kapan,
        claimedAt: null,
        finishedAt: null,
      },
    });
  }
  // Pekerjaan termin ini yang tidak dibutuhkan lagi (lokasi dinonaktifkan,
  // folder laporan kini diisi unggahan orang, minggu prestasi dibetulkan)
  // dibuang, supaya kemajuan di layar menghitung isi berkas yang SEKARANG.
  // Berkas yang terlanjur naik tidak dihapus dari Drive.
  await db.gDriveJob.deleteMany({
    where: {
      kind: KIND_BERKAS_TERMIN,
      packageId,
      periode: { startsWith: awalanPeriodeTermin(terminKe) },
      refKey: { notIn: kunci },
      status: { not: "jalan" },
      // Pekerjaan buang lama tetap disimpan: jejak versi apa yang dibuang.
      NOT: { refKey: { startsWith: AWALAN_BUANG } },
    },
  });
  return { ok: true, jumlah: rencana.length, rentang: r.rentang, dariDrive: dariDrive.size, dibuang: buang.length };
}

/* ── Lima surat penyedia dari tombol Siapkan berkas (DECISIONS 724) ──────── */

export type HasilSuratTermin = {
  dibuat: { jenis: JenisSuratPenyedia; nomor: string }[];
  /** Surat pertama yang belum bisa dibuat; pembuatan berhenti di situ. */
  gagal: (Extract<HasilBuatSurat, { ok: false }> & { jenis: JenisSuratPenyedia }) | null;
};

/**
 * Buat surat termin `terminKe` yang BELUM ada, berurutan menurut alur KKP
 * (nomor urut naik bersama tanggalnya). Surat yang sudah dibuat, atau yang
 * sudah diganti scan versi sendiri (unggahan butir 9a/9b/10a–c), tidak
 * disentuh. Berhenti di surat pertama yang belum bisa disusun – mis. progres
 * di bawah ambang menahan permohonan pemeriksaan, jadi surat uang sesudahnya
 * juga tidak dibuat. Pemanggil yang memastikan `contract.manage`.
 */
/**
 * Urutan pembuatan = urutan NOMOR surat di berkas yang lolos (TERMIN 1 CV.
 * Putera Fahlevi): BA pembahasan .17 → permohonan pembayaran .18 → kwitansi
 * .19 → invoice .20 (DECISIONS 725).
 */
const URUTAN_NOMOR_SURAT: readonly JenisSuratPenyedia[] = [
  "permohonan_pemeriksaan",
  "ba_pembahasan_kemajuan",
  "permohonan_pembayaran",
  "kwitansi",
  "invoice",
];

export async function buatSuratTermin(input: {
  userId: string;
  orgId: string;
  contractId: string;
  terminKe: number;
  tanggal: Partial<Record<JenisSuratPenyedia, Date>>;
}): Promise<HasilSuratTermin> {
  const hasil: HasilSuratTermin = { dibuat: [], gagal: null };
  const kontrak = await muatKontrakSurat(input.contractId, input.orgId);
  if (!kontrak) return { ...hasil, gagal: { ok: false, jenis: "permohonan_pemeriksaan", error: "Kontrak tidak ditemukan." } };

  const [ada, diganti] = await Promise.all([
    db.suratPenyedia.findMany({ where: { contractId: kontrak.id, terminKe: input.terminKe }, select: { jenis: true } }),
    db.document.findMany({
      where: {
        packageId: kontrak.package.id,
        status: "aktif",
        terminKe: input.terminKe,
        butirTermin: { in: JENIS_SURAT_TERSEDIA.map(kodeSurat) },
      },
      select: { butirTermin: true },
    }),
  ]);
  const sudah = new Set<string>([...ada.map((x) => kodeSurat(x.jenis)), ...diganti.map((x) => x.butirTermin!)]);

  for (const jenis of URUTAN_NOMOR_SURAT) {
    if (sudah.has(kodeSurat(jenis))) continue;
    const tanggal = input.tanggal[jenis];
    if (!tanggal) {
      hasil.gagal = { ok: false, jenis, error: `Tanggal ${LABEL_JENIS_SURAT[jenis]} belum diisi.` };
      break;
    }
    const kota = kontrak.vendor.kotaSurat?.trim() ?? "";
    if (!kota) {
      hasil.gagal = {
        ok: false,
        jenis,
        error: "Kota penulisan surat perusahaan belum diatur.",
        kurang: [
          {
            teks: "kota penulisan surat",
            tempat: TEMPAT_LENGKAPI.rekening,
            href: tautanLengkapi("rekening", { packageId: kontrak.package.id, vendorId: kontrak.vendor.id, terminKe: input.terminKe }),
          },
        ],
      };
      break;
    }
    // Isian bawaan yang sama dengan formulir "Buat surat".
    const isian: IsianSurat =
      jenis === "ba_pembahasan_kemajuan"
        ? {
            kepada: [],
            lampiran: [],
            pimpinan: PIMPINAN_RAPAT_BAWAAN,
            peserta: pesertaRapatBawaan(kontrak.vendor.name, kontrak.supervisorFirm),
            cara: CARA_RAPAT_BAWAAN,
          }
        : { kepada: [...KEPADA_BAWAAN], lampiran: lampiranBawaan(jenis, input.terminKe) };
    const r = await buatSuratPenyedia(input.userId, kontrak, { jenis, terminKe: input.terminKe, tanggal, kota, nomor: "", isian });
    if (!r.ok) {
      hasil.gagal = { ...r, jenis };
      break;
    }
    hasil.dibuat.push({ jenis, nomor: r.nomor });
  }
  return hasil;
}

/* ── Mengerjakan satu pekerjaan ─────────────────────────────────────────── */

const PDF_MIME = "application/pdf";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type PaketTermin = { id: string; name: string; orgId: string; driveFolderId: string };
type LokasiTermin = { name: string; slug: string } | null;

/**
 * Susun berkas satu pekerjaan; `batal` = sumbernya sudah tidak ada/tidak bisa
 * disusun. `lokasi` = desa pemilik berkas (untuk subfolder & nama), bila ada.
 */
type BerkasTersusun = { items: UploadItem[]; lokasi: string | null };

async function susunBerkas(
  p: PekerjaanTermin,
  pkg: PaketTermin,
  lokasi: LokasiTermin,
  baseUrl: string | null,
): Promise<BerkasTersusun | TidakBerlaku> {
  const namaLokasi = lokasi?.name ?? null;
  const pdf = (data: Buffer): BerkasTersusun => ({
    items: [
      {
        fileName: safeFileName(namaLaporanTermin(p, { lokasi: namaLokasi, paket: pkg.name }), "laporan.pdf"),
        mime: PDF_MIME,
        data,
      },
    ],
    lokasi: namaLokasi,
  });
  switch (p.jenis) {
    case "berkas": {
      const id = p.sumber?.slice(1) ?? "";
      if (p.sumber?.startsWith("d")) {
        const doc = await db.document.findFirst({
          where: { id, orgId: pkg.orgId, status: "aktif" },
          select: {
            r2Key: true,
            fileName: true,
            mimeType: true,
            packageId: true,
            butirTermin: true,
            terminKe: true,
            location: { select: { name: true } },
          },
        });
        if (!doc) return { batal: "Dokumennya sudah dihapus atau diganti. Tekan Siapkan berkas lagi." };
        const desa = doc.location?.name ?? null;
        // Beberapa scan bisa bernama sama ("scan.pdf" dari HP): nama yang
        // sama di satu folder Drive akan saling menimpa, jadi diberi pembeda.
        const kembar = doc.butirTermin
          ? await db.document.count({
              where: { id: { not: id }, status: "aktif", packageId: doc.packageId, butirTermin: doc.butirTermin, terminKe: doc.terminKe, fileName: doc.fileName },
            })
          : 0;
        const item = await documentItem(doc);
        let nama = item.fileName;
        if (kembar) {
          const titik = nama.lastIndexOf(".");
          const [dasar, ext] = titik > 0 ? [nama.slice(0, titik), nama.slice(titik)] : [nama, ""];
          nama = `${dasar} (${id.slice(0, 8)})${ext}`;
        }
        // Berkas satu desa diberi nama desanya bila belum (berkas lolos: "… ASEMDOYONG.pdf").
        return { items: [{ ...item, fileName: safeFileName(namaDenganLokasi(nama, desa), "dokumen") }], lokasi: desa };
      }
      const s = await dataSuratTersimpan(id, pkg.orgId);
      if (!s) return { batal: "Suratnya sudah dihapus. Tekan Siapkan berkas lagi." };
      const kurang = kekuranganData(s.data);
      if (kurang.length) return { batal: `Surat belum bisa disusun. Lengkapi dulu: ${kurang.join("; ")}.` };
      const surat = susunSurat(s.data);
      const { buatPdfSurat } = await import("@/lib/pdf/surat-penyedia");
      return {
        items: [{ fileName: safeFileName(`${surat.judulBerkas}.pdf`, "surat.pdf"), mime: PDF_MIME, data: await buatPdfSurat(surat, s.kop) }],
        lokasi: null,
      };
    }
    case "kurva_s": {
      // Kurva S PER LOKASI s.d. minggu prestasi – berkas lolos: "TS MINGGU 1-7 <DESA>".
      const [{ susunKurvaPaket }, { renderKurvaPaketPdf }] = await Promise.all([
        import("@/lib/laporan/kurva-paket"),
        import("@/lib/pdf/periodik-kkp"),
      ]);
      const dok = await susunKurvaPaket(pkg.id, null, {
        sampaiMinggu: p.nomor ?? undefined,
        lokasiIds: p.locationId ? [p.locationId] : undefined,
      });
      if (dok === "tidak_ada") return { batal: "Paketnya sudah tidak ada." };
      if (dok === "kosong") return { batal: "Kurva S belum bisa dibuat: lokasi ini belum punya baseline kurva-S dan RAB aktif." };
      return pdf((await renderKurvaPaketPdf(dok)).buffer);
    }
    case "mingguan": {
      // Minggu prestasi saja, PDF + Excel – seperti berkas yang lolos.
      const [{ renderPeriodikKkpPdf }, { getPeriodReport }, { buildPeriodReportXlsx }, { muatLogoLaporan }] = await Promise.all([
        import("@/lib/pdf/periodik-kkp"),
        import("@/lib/periodic-report"),
        import("@/lib/export/xlsx"),
        import("@/lib/export/logo-laporan"),
      ]);
      const [hasil, report] = await Promise.all([
        renderPeriodikKkpPdf(p.locationId!, "mingguan", p.nomor!),
        getPeriodReport(p.locationId!, "mingguan", p.nomor!),
      ]);
      if (!hasil || !report) return { batal: `${labelPekerjaanTermin(p)} belum bisa disusun.` };
      const xlsx = await buildPeriodReportXlsx(report, { logo: await muatLogoLaporan(p.locationId!) });
      const dasar = pdf(hasil.buffer);
      const namaPdf = dasar.items[0].fileName;
      dasar.items.push({ fileName: namaPdf.replace(/\.pdf$/i, ".xlsx"), mime: XLSX_MIME, data: xlsx });
      return dasar;
    }
    case "bulanan": {
      const { renderPeriodikKkpPdf } = await import("@/lib/pdf/periodik-kkp");
      const hasil = await renderPeriodikKkpPdf(p.locationId!, "bulanan", p.nomor!);
      if (!hasil) return { batal: `${labelPekerjaanTermin(p)} belum bisa disusun.` };
      return pdf(hasil.buffer);
    }
    case "harian": {
      const { renderMingguanKkpPdf } = await import("@/lib/pdf/mingguan-kkp");
      const hasil = await renderMingguanKkpPdf(lokasi!.slug, p.nomor!, { baseUrl });
      if (!hasil) return { batal: "Laporan harian belum bisa disusun karena kontraknya belum punya tanggal SPMK." };
      return pdf(hasil.buffer);
    }
    case "buang":
      return { batal: "Pekerjaan buang tidak membuat berkas." };
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
  if (p.jenis === "buang") return buangVersiMarlin(job.packageId, p);
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
  const sebelum = new Set(
    (await db.gDriveUpload.findMany({ where: { kind: "berkas_termin", refKey: job.refKey }, select: { id: true } })).map((r) => r.id),
  );
  const outcomes = [];
  for (const kode of p.kode) {
    const jalur = [...butirBerkas(kode)!.jalur, ...subfolderLokasi(kode, berkas.lokasi)];
    outcomes.push(await uploadBatch(target, jalur, berkas.items, { jedaMs: opts.jedaMs }));
  }
  const hasil = rangkum(labelPekerjaanTermin(p), outcomes, 0);
  // Berlaku juga untuk salinan versi sendiri: dokumennya SAMA dan salinan
  // barunya sudah naik, jadi tidak ada yang hilang. Salinan yang dokumennya
  // dicabut tetap tidak dibuang otomatis (DECISIONS 722).
  if (hasil.galat) return hasil;
  try {
    const n = await buangVersiLama(job, p.terminKe, sebelum);
    return n ? { ...hasil, ringkas: `${hasil.ringkas} ${n} versi lama dibuang ke Sampah Drive.` } : hasil;
  } catch (err) {
    // Unggahannya sudah naik; diulang = ditimpa berkas yang sama, lalu dicoba lagi.
    return { ...hasil, galat: galatDrive(err, "Versi lama gagal dibuang.") };
  }
}

/**
 * Berkas Drive yang dipakai pekerjaan termin `terminKe` yang masih aktif
 * (selain pekerjaan `kecuali`). Nama yang sama di folder yang sama menunjuk
 * berkas Drive yang sama, jadi berkas ini tidak boleh ikut terbuang.
 */
async function berkasDipakai(packageId: string, terminKe: number, kecuali?: string): Promise<Set<string>> {
  const aktif = await db.gDriveJob.findMany({
    where: {
      kind: KIND_BERKAS_TERMIN,
      packageId,
      periode: { startsWith: awalanPeriodeTermin(terminKe) },
      NOT: [{ refKey: { startsWith: AWALAN_BUANG } }, ...(kecuali ? [{ refKey: kecuali }] : [])],
    },
    select: { refKey: true },
  });
  const rows = await db.gDriveUpload.findMany({
    where: { kind: "berkas_termin", refKey: { in: aktif.map((a) => a.refKey) }, status: "sukses", fileId: { not: null } },
    select: { fileId: true },
  });
  return new Set(rows.map((u) => u.fileId!));
}

/**
 * Pindahkan ke Sampah Drive berkas `calon` yang tercatat di bawah `refKey`.
 * Hanya berkas buatan MARLIN yang tidak diubah orang (DECISIONS 723).
 */
async function buangMilikMarlin(refKey: string, calon: readonly string[]): Promise<number> {
  let n = 0;
  for (const id of calon) {
    if (!(await bolehDibuang(id))) continue;
    await buangKeSampah(id);
    await db.gDriveUpload.updateMany({ where: { kind: "berkas_termin", refKey, fileId: id }, data: { status: "dibuang" } });
    n++;
  }
  return n;
}

function galatDrive(err: unknown, cadangan: string): NonNullable<HasilUnggah["galat"]> {
  return err instanceof GDriveError
    ? { pesan: err.message, status: err.status, retryAfter: err.retryAfter }
    : { pesan: err instanceof Error ? err.message : cadangan, status: null, retryAfter: null };
}

/**
 * Buang ke Sampah Drive berkas yang diunggah pekerjaan lama `p.sumber`.
 * Berkas yang MASIH dipakai pekerjaan lain termin ini tidak ikut terbuang.
 */
async function buangVersiMarlin(packageId: string, p: PekerjaanTermin): Promise<HasilUnggah> {
  const lamaKey = p.sumber ?? "";
  const kosong = (ringkas: string): HasilUnggah => ({ ringkas, outcomes: [], berkas: 0, skipped: 0, galat: null });
  // Termasuk bila pekerjaan lamanya dibuat lagi (unggahan sendiri dicabut):
  // refKey-nya aktif lagi, jadi berkasnya terhitung dipakai.
  const dipakai = await berkasDipakai(packageId, p.terminKe);
  const target = await db.gDriveUpload.findMany({
    where: { kind: "berkas_termin", refKey: lamaKey, status: "sukses", fileId: { not: null } },
    select: { fileId: true },
  });
  const calon = [...new Set(target.map((t) => t.fileId!))].filter((id) => !dipakai.has(id));
  try {
    const n = await buangMilikMarlin(lamaKey, calon);
    return { ...kosong(`${n} berkas versi MARLIN dibuang ke Sampah Drive.`), berkas: n };
  } catch (err) {
    return { ...kosong(`${labelPekerjaanTermin(p)}: gagal dibuang.`), galat: galatDrive(err, "Gagal membuang berkas.") };
  }
}

/**
 * Versi lama berkas yang SAMA yang kini bernama atau berfolder lain – Kurva
 * S memuat minggu prestasinya, laporan mingguan pindah ke subfolder desa,
 * salinan dokumen satu desa diberi nama desanya, folder duplikat BERKAS
 * DOKUMEN TEKNIS tidak diisi lagi (DECISIONS 725).
 * Tanpa ini versi lama tertinggal di samping yang baru. `sebelum` = id catatan
 * unggah pekerjaan ini sebelum dijalankan (bukan jam: jam aplikasi dan
 * database bisa berbeda).
 */
async function buangVersiLama(job: { refKey: string; packageId: string }, terminKe: number, sebelum: ReadonlySet<string>) {
  const rows = await db.gDriveUpload.findMany({
    where: { kind: "berkas_termin", refKey: job.refKey, status: "sukses", fileId: { not: null } },
    select: { id: true, fileId: true },
  });
  const baru = new Set(rows.filter((r) => !sebelum.has(r.id)).map((r) => r.fileId!));
  const lama = [...new Set(rows.filter((r) => sebelum.has(r.id)).map((r) => r.fileId!))].filter((id) => !baru.has(id));
  if (!lama.length) return 0;
  const dipakai = await berkasDipakai(job.packageId, terminKe, job.refKey);
  return buangMilikMarlin(
    job.refKey,
    lama.filter((id) => !dipakai.has(id)),
  );
}

/* ── Ringkasan untuk layar Penagihan ────────────────────────────────────── */

export type RingkasBerkasTermin = {
  total: number;
  sukses: number;
  menunggu: number;
  gagal: number;
  batal: number;
  /** Berkas versi MARLIN yang sudah dipindah ke Sampah Drive karena digantikan. */
  berkasDibuang: number;
  /** Yang perlu dilihat orang: gagal berulang / menyerah / tidak bisa disusun. */
  masalah: { label: string; lokasi: string | null; pesan: string; menyerah: boolean }[];
  terakhir: Date | null;
  /** Alamat folder Drive paket; null = paket belum punya folder Drive. */
  folderDrive: string | null;
};

export async function ringkasBerkasTermin(packageId: string, terminKe: number): Promise<RingkasBerkasTermin> {
  const pkg = await db.package.findUnique({ where: { id: packageId }, select: { driveFolderId: true } });
  const semuaBaris = await db.gDriveJob.findMany({
    where: { kind: KIND_BERKAS_TERMIN, packageId, periode: { startsWith: awalanPeriodeTermin(terminKe) } },
    orderBy: { createdAt: "asc" },
    select: {
      refKey: true,
      status: true,
      periode: true,
      locationId: true,
      lastError: true,
      finishedAt: true,
      location: { select: { name: true } },
    },
  });
  const buang = semuaBaris.filter((b) => b.refKey.startsWith(AWALAN_BUANG));
  // Dihitung dari berkas Drive yang benar-benar dibuang, bukan dari pekerjaan
  // buang (yang bisa batal membuang karena laporannya dipakai lagi).
  const berkasDibuang = new Set(
    (
      await db.gDriveUpload.findMany({
        where: { packageId, kind: "berkas_termin", status: "dibuang", refKey: { startsWith: `${packageId}:t${terminKe}:` } },
        select: { fileId: true },
      })
    ).map((u) => u.fileId),
  ).size;
  const baris = semuaBaris.filter((b) => !b.refKey.startsWith(AWALAN_BUANG));
  const masalah: RingkasBerkasTermin["masalah"] = [];
  for (const b of [...baris, ...buang]) {
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
    berkasDibuang,
    masalah,
    terakhir: selesai.length ? new Date(Math.max(...selesai)) : null,
    folderDrive: pkg?.driveFolderId ? `https://drive.google.com/drive/folders/${pkg.driveFolderId}` : null,
  };
}
