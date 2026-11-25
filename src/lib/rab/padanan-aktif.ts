import "server-only";
import { db } from "@/lib/db";
import { auditIn } from "@/lib/audit";
import { formatTanggal, jakartaDateKey } from "@/lib/format";
import { COUNTED_REPORT_STATUSES } from "@/lib/lifecycle";
import { valueDone as hitungNilai } from "@/lib/money";
import { jalurNodeById } from "@/lib/rab/jalur";
import { volumeNol } from "@/lib/rab/padanan-draft-aturan";
import { realisasiTidakTerbobot } from "@/lib/rab/tidak-terbobot";
import { bolehMenyetujui, nilaiPersetujuan } from "@/lib/rab/persetujuan-aturan";
import {
  bagiMasuk,
  barisDiubahSesudah,
  keadaanUsulan,
  periksaPasanganAktif,
  periksaSasaranLuarRab,
  rencanaLuarRab,
  rencanaPulihNol,
  type BarisLuarRab,
  type ItemSasaran,
  type KeadaanUsulan,
} from "@/lib/rab/padanan-aktif-aturan";
import { kunciSatuan } from "@/lib/rab/padanan-draft-aturan";
import { usulkanPadanan, type KandidatDraft } from "@/lib/luar-rab/padanan";
import { token } from "@/lib/daily-report/impor-pelaksana/cocok";
import type { Prisma } from "@/generated/prisma/client";
import type { UserRole } from "@/generated/prisma/enums";

/**
 * PEMASANGAN REALISASI SESUDAH AKTIVASI ADENDUM (DECISIONS 777).
 *
 * Permintaan user 2026-11-25: *"buat bisa dipasangkan sesudah aktivasi, menu
 * khusus. mitigasi semua resiko dan penanganannya"*.
 *
 * Dua jenis item yang sampai sini tidak punya jalan pulang sesudah aktivasi:
 * - `hilang`: tidak ada lagi di RAB aktif. Laporannya tetap, volumenya tidak
 *   terhitung (halaman Tidak terbobot, DECISIONS 649).
 * - `dinolkan`: masih ada dengan volume 0. Laporannya diturunkan jadi 0 saat
 *   aktivasi (DECISIONS 745/756); angka lamanya hanya ada di jejak audit.
 *
 * CARANYA: kunci baris laporan item lama dipindah ke kunci item RAB aktif.
 * RAB aktif, kurva-S, dan dokumen CCO tidak disentuh. Untuk `dinolkan`, volume
 * yang diturunkan saat aktivasi dipulihkan dari jejak auditnya, hanya bila
 * angkanya belum diubah siapa pun sejak itu.
 *
 * PENGAMAN:
 * - Usulan baru BERLAKU sesudah dua persetujuan (Program Director + AM/PM/SM),
 *   sama dengan aktivasi adendum (DECISIONS 234). Super admin tidak bisa
 *   menyetujui.
 * - Semua syarat diperiksa ULANG saat usulan berlaku, di dalam kunci lokasi
 *   yang sama dengan pengiriman laporan: keadaan bisa berubah di antara
 *   diajukan dan disetujui.
 * - Ditolak, bukan diakali: beda kategori/satuan, satu laporan memuat
 *   keduanya, laporan item lama yang belum dikirim, item lama yang muncul lagi
 *   di draft, revisi aktif yang sudah berganti, item tujuan yang sisanya 0.
 * - Sisa volume item tujuan KURANG: kelebihannya DIPOTONG dibagi rata di
 *   baris pindahan (aturan aktivasi, DECISIONS 745), disebut di usulan dan
 *   kabarnya, dan dikembalikan saat Lepas (DECISIONS 780 – penolakan dulu
 *   membuat pemasangan buntu).
 * - Catatan pekerjaan di luar RAB (738) juga bisa dipasangkan ke item RAB
 *   aktif lewat usulan yang sama (jenis `luar_rab`, DECISIONS 780).
 * - Lepas mengembalikan keadaan persis seperti sesudah aktivasi – ditolak bila
 *   barisnya sudah diubah orang sesudah dipasangkan, atau revisi aktifnya
 *   sudah berganti.
 * - Blanko harian final dibangun ulang sejak tanggal terawal yang berubah.
 */

export class PadananAktifError extends Error {}

type Tx = Prisma.TransactionClient;

const terhitung = new Set<string>(COUNTED_REPORT_STATUSES);
const bulat3 = (v: number) => Math.round(v * 1000) / 1000;
const kunciTanggal = (d: Date) => d.toISOString().slice(0, 10);
const tanggalOrang = (k: string) => formatTanggal(new Date(`${k}T00:00:00.000Z`), "d MMMM yyyy");
const daftarTanggal = (ks: Iterable<string>) => [...new Set(ks)].sort().map(tanggalOrang).join(", ");
const labelKategori = (code: string, name: string) => {
  const kode = code.replace(/(?:#\d+)+$/, "").trim().replace(/\.$/, "");
  return kode ? `${kode}. ${name.trim()}` : name.trim();
};

export type JenisPadanan = "hilang" | "dinolkan" | "luar_rab";

export type CalonAktif = {
  lineageKey: string;
  code: string;
  name: string;
  unit: string | null;
  jalur: string;
  volume: number;
  /** Sisa volume item ini (volume − semua laporan basis aktif). */
  sisa: number;
  /** Volume yang akan dipotong bila item ini dipilih (sisa kurang); 0 = muat. */
  dipotong: number;
};

export type ItemBelumAktif = {
  lineageKey: string;
  name: string;
  unit: string | null;
  jalur: string;
  kategori: string;
  jenis: JenisPadanan;
  /** Volume yang akan pindah ke item sasaran (untuk `dinolkan`: volume yang dipulihkan). */
  volume: number;
  jumlahLaporan: number;
  pertama: Date | null;
  terakhir: Date | null;
  /** "Hilang di revisi #3" / "Dinolkan saat revisi #3 diaktifkan". */
  keterangan: string;
  calon: CalonAktif[];
  /** Calon yang sah tetapi sisa volumenya sudah 0 – disebut jumlahnya. */
  calonSisaKurang: number;
  /** Sebab item ini belum bisa diusulkan sekarang (laporan belum dikirim, sudah diusulkan, …). */
  terhalang: string | null;
};

/** Kelompok catatan pekerjaan di luar RAB (uraian + satuan sama) yang menunggu (DECISIONS 780). */
export type KelompokLuarRab = {
  kunci: string;
  uraian: string;
  satuan: string;
  /** Bentuk baku satuan (`kunciSatuan`); null = tidak diketahui, cocok dengan apa pun. */
  satuanKunci: string | null;
  /** Catatan yang bisa dipasangkan sekarang (laporannya sudah dikirim). */
  catatanIds: string[];
  volume: number;
  jumlahLaporan: number;
  pertama: string | null;
  terakhir: string | null;
  /** Catatan di laporan yang belum dikirim: belum ikut, disebut tanggalnya. */
  tertahan: { jumlah: number; tanggal: string } | null;
  /** Ada yang berasal dari draft adendum yang diganti (DECISIONS 755). */
  asalDraft: boolean;
  /** Kunci item yang disarankan, terbaik dulu; `pilihan` = dipilih otomatis (jelas unggul). */
  saran: string[];
  pilihan: string | null;
};

/** Item RAB aktif yang bisa menampung catatan di luar RAB. */
export type CalonLuarRab = {
  lineageKey: string;
  name: string;
  unit: string | null;
  satuanKunci: string | null;
  jalur: string;
  sisa: number;
};

export type UsulanPadanan = {
  id: string;
  keadaan: KeadaanUsulan;
  jenis: JenisPadanan;
  lineageLama: string;
  lineageBaru: string;
  namaLama: string;
  namaBaru: string;
  jalurBaru: string;
  unit: string | null;
  volume: number;
  /** Volume yang dipotong karena sisa item tujuan kurang (DECISIONS 780). */
  dipotong: number;
  baris: number;
  /** Catatan di luar RAB yang ikut (jenis `luar_rab`). */
  luarRabIds: string[];
  alasan: string;
  diajukanOleh: { id: string; nama: string };
  diajukanPada: Date;
  berlakuPada: Date | null;
  ditutupPada: Date | null;
  alasanTutup: string | null;
  dilepasPada: Date | null;
  alasanLepas: string | null;
  suara: { userId: string; nama: string; role: UserRole; approvedAt: Date }[];
  /** Persetujuan yang masih kurang, mis. "persetujuan Program Director". */
  kurang: string[];
  /** Revisi aktif sudah berganti sejak diajukan / berlaku. */
  revisiBerganti: boolean;
};

export type RingkasanUsulan = {
  namaLama: string;
  namaBaru: string;
  jalurBaru: string;
  unit: string | null;
  /** Volume yang MASUK ke item tujuan (sesudah dipotong). */
  volume: number;
  /** Volume yang dipotong karena sisa item tujuan kurang (DECISIONS 780). */
  dipotong?: number;
  baris: number;
  /** Jumlah catatan di luar RAB yang ikut (jenis `luar_rab`). */
  catatan?: number;
  pertama: string | null;
  terakhir: string | null;
};

/* ── Membaca keadaan satu pasangan ─────────────────────────────────────── */

type RencanaPasang = {
  aktif: { id: string; revisionNo: number };
  jenis: JenisPadanan;
  namaLama: string;
  unitLama: string | null;
  sasaran: { id: string; lineageKey: string; code: string; name: string; unit: string | null; volume: number };
  /** Baris item lama, dengan volume sesudah dipasangkan. */
  baris: {
    id: string;
    reportId: string;
    tanggal: string;
    status: string;
    volumeKini: number;
    volumeBaru: number;
    harga: number;
  }[];
  /** Volume yang masuk ke item tujuan, dan yang dipotong karena sisanya kurang. */
  pindahan: number;
  dipotong: number;
  terlapor: number;
};

async function revisiAktif(c: Tx | typeof db, locationId: string) {
  return c.rabRevision.findFirst({
    where: { locationId, status: "aktif" },
    select: { id: true, revisionNo: true },
  });
}

/** Identitas item lama: node terakhir yang memuat kuncinya di revisi yang pernah berlaku. */
async function identitasLama(c: Tx | typeof db, locationId: string, lineageKey: string) {
  return c.rabNode.findFirst({
    where: { lineageKey, revision: { locationId, status: { in: ["aktif", "digantikan"] } } },
    orderBy: { revision: { revisionNo: "desc" } },
    select: { id: true, name: true, unit: true, kind: true, volume: true, revisionId: true },
  });
}

type Jejak = { tanggal: string; dari: number; ke: number }[];

/**
 * Jejak penurunan volume ke 0 saat revisi aktif diaktifkan (DECISIONS 745/756),
 * per kunci item. Dibaca sekali per revisi; yang terbaru menang.
 */
async function semuaJejakNol(c: Tx | typeof db, revisionId: string): Promise<Map<string, Jejak>> {
  const rows = await c.auditLog.findMany({
    where: { action: "rab.adendum_sesuaikan_realisasi", resourceType: "rab_revision", resourceId: revisionId },
    orderBy: { createdAt: "desc" },
    select: { payload: true },
  });
  const peta = new Map<string, Jejak>();
  for (const r of rows) {
    const p = r.payload as {
      lineageKey?: string;
      volumeBaru?: number;
      baris?: { tanggal: string; dari: number; ke: number }[];
    } | null;
    if (!p?.lineageKey || peta.has(p.lineageKey)) continue;
    if (!volumeNol(Number(p.volumeBaru ?? 0)) || !Array.isArray(p.baris)) continue;
    peta.set(
      p.lineageKey,
      p.baris.map((b) => ({ tanggal: b.tanggal, dari: Number(b.dari), ke: Number(b.ke) })),
    );
  }
  return peta;
}

/**
 * Periksa SEMUA syarat satu pasangan dan susun rencananya. Dipakai saat
 * mengajukan DAN saat berlaku (keadaan bisa berubah di antaranya).
 * Melempar `PadananAktifError` dengan kalimat yang menyebut sebabnya.
 */
async function rencanaPasang(
  tx: Tx,
  o: { locationId: string; lineageLama: string; lineageBaru: string; abaikanUsulan?: string },
): Promise<RencanaPasang> {
  const aktif = await revisiAktif(tx, o.locationId);
  if (!aktif) throw new PadananAktifError("Lokasi ini belum punya RAB aktif.");

  const nodeAktif = await tx.rabNode.findMany({
    where: { revisionId: aktif.id },
    select: { id: true, parentId: true, kind: true, code: true, name: true, unit: true, volume: true, lineageKey: true },
  });
  const beranak = new Set(nodeAktif.map((n) => n.parentId).filter((x): x is string => !!x));
  const lineageAktif = new Set(nodeAktif.map((n) => n.lineageKey));

  // Jenis item lama: hilang dari RAB aktif, atau masih ada dengan volume 0.
  const lamaDiAktif = nodeAktif.find((n) => n.lineageKey === o.lineageLama);
  let jenis: JenisPadanan;
  let namaLama: string;
  let unitLama: string | null;
  if (lamaDiAktif) {
    if (!volumeNol(lamaDiAktif.volume == null ? null : Number(lamaDiAktif.volume))) {
      throw new PadananAktifError(`"${lamaDiAktif.name}" masih ada di RAB aktif dan bervolume, jadi realisasinya sudah terhitung.`);
    }
    jenis = "dinolkan";
    namaLama = lamaDiAktif.name;
    unitLama = lamaDiAktif.unit;
  } else {
    const id = await identitasLama(tx, o.locationId, o.lineageLama);
    jenis = "hilang";
    namaLama = id?.name ?? o.lineageLama;
    unitLama = id?.unit ?? null;
  }

  // Satu item lama hanya boleh punya satu usulan yang masih hidup.
  const lain = await tx.rabPadananAktif.findFirst({
    where: {
      locationId: o.locationId,
      lineageLama: o.lineageLama,
      ditutupPada: null,
      dilepasPada: null,
      ...(o.abaikanUsulan ? { id: { not: o.abaikanUsulan } } : {}),
    },
    select: { berlakuPada: true },
  });
  if (lain) {
    throw new PadananAktifError(
      lain.berlakuPada
        ? `"${namaLama}" sudah dipasangkan. Lepas dulu pasangannya bila ingin memindahkannya.`
        : `"${namaLama}" sudah diusulkan dan sedang menunggu persetujuan.`,
    );
  }

  const sasaranNode = nodeAktif.find((n) => n.lineageKey === o.lineageBaru);
  if (!sasaranNode) throw new PadananAktifError("Item tujuan tidak ada di RAB aktif. Muat ulang halaman.");
  const draft = await tx.rabRevision.findFirst({ where: { locationId: o.locationId, status: "draft" }, select: { id: true } });
  const lineageDraft = draft
    ? new Set((await tx.rabNode.findMany({ where: { revisionId: draft.id }, select: { lineageKey: true } })).map((n) => n.lineageKey))
    : null;
  const sasaran: ItemSasaran = {
    lineageKey: sasaranNode.lineageKey,
    kind: sasaranNode.kind,
    name: sasaranNode.name,
    unit: sasaranNode.unit,
    punyaAnak: beranak.has(sasaranNode.id),
    volume: sasaranNode.volume == null ? null : Number(sasaranNode.volume),
  };
  const tolak = periksaPasanganAktif({ lineageKey: o.lineageLama, name: namaLama, unit: unitLama }, sasaran, {
    lineageAktif,
    lineageDraft,
  });
  if (tolak) throw new PadananAktifError(tolak);

  // Baris laporan item lama yang belum dipindah.
  const barisLama = await tx.dailyReportItem.findMany({
    where: { lineageKey: o.lineageLama, report: { locationId: o.locationId } },
    select: {
      id: true,
      reportId: true,
      basis: true,
      volumeDone: true,
      rabNode: { select: { unitPrice: true } },
      report: { select: { reportDate: true, status: true } },
    },
  });
  if (barisLama.length === 0) throw new PadananAktifError(`Tidak ada laporan "${namaLama}" yang bisa dipasangkan.`);
  const belumDikirim = barisLama.filter((b) => !terhitung.has(b.report.status));
  if (belumDikirim.length > 0) {
    throw new PadananAktifError(
      `Laporan tanggal ${daftarTanggal(belumDikirim.map((b) => kunciTanggal(b.report.reportDate)))} memuat "${namaLama}" ` +
        `dan belum dikirim. Kirim atau perbaiki laporan itu dulu, lalu ajukan lagi.`,
    );
  }
  const bukanAktif = barisLama.filter((b) => b.basis !== "aktif");
  if (bukanAktif.length > 0) {
    throw new PadananAktifError(
      `Laporan tanggal ${daftarTanggal(bukanAktif.map((b) => kunciTanggal(b.report.reportDate)))} mencatat "${namaLama}" ` +
        `terhadap draft adendum. Baris itu mengikuti draftnya, bukan RAB aktif.`,
    );
  }

  // Satu laporan yang memuat keduanya: menggabungkan dua baris mengubah isi laporan.
  const barisSasaran = await tx.dailyReportItem.findMany({
    where: { lineageKey: o.lineageBaru, report: { locationId: o.locationId } },
    select: { reportId: true, basis: true, volumeDone: true, report: { select: { reportDate: true } } },
  });
  const laporanSasaran = new Set(barisSasaran.map((b) => b.reportId));
  const bentrok = barisLama.filter((b) => laporanSasaran.has(b.reportId));
  if (bentrok.length > 0) {
    throw new PadananAktifError(
      `Laporan tanggal ${daftarTanggal(bentrok.map((b) => kunciTanggal(b.report.reportDate)))} memuat "${namaLama}" ` +
        `DAN "${sasaranNode.name}" sekaligus. Satu laporan tidak bisa memuat item yang sama dua kali.`,
    );
  }

  // Volume sesudah dipasangkan: apa adanya, atau dipulihkan dari jejak aktivasi.
  const volumeBaru = new Map<string, number>();
  if (jenis === "dinolkan") {
    const jejak = (await semuaJejakNol(tx, aktif.id)).get(o.lineageLama);
    if (!jejak) {
      throw new PadananAktifError(
        `Tidak ada catatan angka "${namaLama}" sebelum dinolkan saat revisi #${aktif.revisionNo} diaktifkan, ` +
          `jadi volumenya tidak bisa dipulihkan.`,
      );
    }
    const r = rencanaPulihNol(
      jejak,
      barisLama.map((b) => ({ id: b.id, tanggal: kunciTanggal(b.report.reportDate), volume: Number(b.volumeDone) })),
    );
    if (!r.ok) {
      throw new PadananAktifError(
        `Angka "${namaLama}" di laporan tanggal ${daftarTanggal(r.tanggal)} sudah berubah sejak diturunkan saat aktivasi. ` +
          `Volumenya tidak dipulihkan supaya angka itu tidak tertimpa.`,
      );
    }
    for (const [id, v] of r.pulih) volumeBaru.set(id, v);
  }
  const baris = barisLama
    .map((b) => {
      const kini = Number(b.volumeDone);
      return {
        id: b.id,
        reportId: b.reportId,
        tanggal: kunciTanggal(b.report.reportDate),
        status: b.report.status,
        volumeKini: kini,
        volumeBaru: volumeBaru.get(b.id) ?? kini,
        harga: Number(b.rabNode.unitPrice ?? 0),
      };
    })
    .sort((a, b) => a.tanggal.localeCompare(b.tanggal));
  const total = bulat3(baris.reduce((t, b) => t + b.volumeBaru, 0));
  if (total <= 0) throw new PadananAktifError(`Tidak ada volume "${namaLama}" yang bisa dipindahkan.`);

  // Realisasi tidak boleh melebihi volume kontrak item tujuan: kelebihannya
  // dipotong dibagi rata di baris pindahan, bukan ditolak (DECISIONS 780).
  const terlapor = bulat3(barisSasaran.filter((b) => b.basis === "aktif").reduce((t, b) => t + Number(b.volumeDone), 0));
  const volume = Number(sasaranNode.volume);
  const bagi = bagiMasuk(
    baris.map((b) => b.volumeBaru),
    { volume, terlapor },
  );
  if (!bagi) {
    const u = sasaranNode.unit ? ` ${sasaranNode.unit}` : "";
    throw new PadananAktifError(
      `"${sasaranNode.name}" sudah dilaporkan penuh (${fmt(terlapor)}${u} dari ${fmt(volume)}${u}), jadi tidak bisa menampung apa pun.`,
    );
  }
  bagi.hasil.forEach((v, i) => (baris[i]!.volumeBaru = v));
  const pindahan = bagi.masuk;

  return {
    aktif,
    jenis,
    namaLama,
    unitLama,
    sasaran: {
      id: sasaranNode.id,
      lineageKey: sasaranNode.lineageKey,
      code: sasaranNode.code,
      name: sasaranNode.name,
      unit: sasaranNode.unit,
      volume,
    },
    baris,
    pindahan,
    dipotong: bagi.dipotong,
    terlapor,
  };
}

const fmt = (v: number) => new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 }).format(v);

/* ── Catatan pekerjaan di luar RAB → item RAB aktif (DECISIONS 780) ────── */

/**
 * Kunci `lineageLama` usulan jenis `luar_rab`. Catatan tidak punya kunci item;
 * yang dipasangkan disimpan di `luarRabIds`.
 */
export const LINEAGE_LUAR_RAB = "luar_rab";

type RencanaLuar = {
  aktif: { id: string; revisionNo: number };
  namaLama: string;
  unitLama: string;
  sasaran: { id: string; lineageKey: string; code: string; name: string; unit: string | null; volume: number; harga: number };
  catatan: { id: string; reportId: string; tanggal: string; volume: number; createdById: string; status: string }[];
  baris: (BarisLuarRab & { adaId: string | null; status: string })[];
  pindahan: number;
  dipotong: number;
  terlapor: number;
};

/**
 * Periksa SEMUA syarat pemasangan catatan di luar RAB ke item RAB aktif dan
 * susun rencananya. Dipakai saat mengajukan DAN saat berlaku.
 */
async function rencanaLuar(
  tx: Tx,
  o: { locationId: string; luarRabIds: readonly string[]; lineageBaru: string; abaikanUsulan?: string },
): Promise<RencanaLuar> {
  const aktif = await revisiAktif(tx, o.locationId);
  if (!aktif) throw new PadananAktifError("Lokasi ini belum punya RAB aktif.");
  const ids = [...new Set(o.luarRabIds)];
  if (ids.length === 0) throw new PadananAktifError("Pilih dulu catatan yang akan dipasangkan.");

  const rows = await tx.pekerjaanLuarRab.findMany({
    where: { id: { in: ids }, locationId: o.locationId },
    select: {
      id: true,
      reportId: true,
      uraian: true,
      satuan: true,
      volume: true,
      createdById: true,
      dibatalkanAt: true,
      reportItemId: true,
      report: { select: { reportDate: true, status: true } },
    },
  });
  if (rows.length !== ids.length) throw new PadananAktifError("Sebagian catatan tidak ditemukan lagi. Muat ulang halaman.");
  const tgl = (r: (typeof rows)[number]) => jakartaDateKey(r.report.reportDate);
  const batal = rows.filter((r) => r.dibatalkanAt);
  if (batal.length > 0) {
    throw new PadananAktifError(
      `Catatan tanggal ${daftarTanggal(batal.map(tgl))} sudah dibatalkan. Batalkan usulan ini, lalu ajukan lagi tanpa catatan itu.`,
    );
  }
  const sudah = rows.filter((r) => r.reportItemId);
  if (sudah.length > 0) {
    throw new PadananAktifError(
      `Catatan tanggal ${daftarTanggal(sudah.map(tgl))} sudah dipadankan ke item lain. Batalkan usulan ini, lalu ajukan lagi.`,
    );
  }
  const belumDikirim = rows.filter((r) => !terhitung.has(r.report.status));
  if (belumDikirim.length > 0) {
    throw new PadananAktifError(
      `Laporan tanggal ${daftarTanggal(belumDikirim.map(tgl))} memuat catatan ini dan belum dikirim. Kirim laporan itu dulu.`,
    );
  }

  // Satu catatan hanya boleh ada di satu usulan yang MENUNGGU. Untuk usulan
  // yang sudah berlaku, kebenarannya ada di catatan itu sendiri (`reportItemId`,
  // diperiksa di atas): bila barisnya dihapus lewat koreksi laporan, catatannya
  // kembali menunggu dan harus bisa dipasangkan lagi, bukan buntu.
  const lain = await tx.rabPadananAktif.findFirst({
    where: {
      locationId: o.locationId,
      luarRabIds: { hasSome: ids },
      berlakuPada: null,
      ditutupPada: null,
      dilepasPada: null,
      ...(o.abaikanUsulan ? { id: { not: o.abaikanUsulan } } : {}),
    },
    select: { id: true },
  });
  if (lain) throw new PadananAktifError("Sebagian catatan ini sudah diusulkan dan sedang menunggu persetujuan.");

  const nodeAktif = await tx.rabNode.findMany({
    where: { revisionId: aktif.id },
    select: { id: true, parentId: true, kind: true, code: true, name: true, unit: true, volume: true, unitPrice: true, lineageKey: true },
  });
  const sasaranNode = nodeAktif.find((n) => n.lineageKey === o.lineageBaru);
  if (!sasaranNode) throw new PadananAktifError("Item tujuan tidak ada di RAB aktif. Muat ulang halaman.");
  const tolak = periksaSasaranLuarRab(
    rows,
    {
      lineageKey: sasaranNode.lineageKey,
      kind: sasaranNode.kind,
      name: sasaranNode.name,
      unit: sasaranNode.unit,
      punyaAnak: nodeAktif.some((n) => n.parentId === sasaranNode.id),
      volume: sasaranNode.volume == null ? null : Number(sasaranNode.volume),
    },
    new Set(nodeAktif.map((n) => n.lineageKey)),
  );
  if (tolak) throw new PadananAktifError(tolak);

  // Baris item tujuan yang sudah ada di laporan-laporan catatan ini.
  const reportIds = [...new Set(rows.map((r) => r.reportId))];
  const ada = await tx.dailyReportItem.findMany({
    where: { reportId: { in: reportIds }, lineageKey: o.lineageBaru },
    select: { id: true, reportId: true, basis: true, volumeDone: true, padananAktifId: true, report: { select: { reportDate: true } } },
  });
  const adaDraft = ada.filter((b) => b.basis !== "aktif");
  if (adaDraft.length > 0) {
    throw new PadananAktifError(
      `Laporan tanggal ${daftarTanggal(adaDraft.map((b) => kunciTanggal(b.report.reportDate)))} mencatat "${sasaranNode.name}" ` +
        `terhadap draft adendum. Baris itu mengikuti draftnya, jadi catatan tidak bisa ditambahkan ke sana.`,
    );
  }
  const adaPasangan = ada.filter((b) => b.padananAktifId);
  if (adaPasangan.length > 0) {
    throw new PadananAktifError(
      `Baris "${sasaranNode.name}" di laporan tanggal ${daftarTanggal(adaPasangan.map((b) => kunciTanggal(b.report.reportDate)))} ` +
        `berasal dari pemasangan lain. Lepas dulu pasangan itu, atau pilih item lain.`,
    );
  }
  const adaPer = new Map(ada.map((b) => [b.reportId, b]));

  const terlapor = bulat3(
    Number(
      (
        await tx.dailyReportItem.aggregate({
          where: { lineageKey: o.lineageBaru, basis: "aktif", report: { locationId: o.locationId } },
          _sum: { volumeDone: true },
        })
      )._sum.volumeDone ?? 0,
    ),
  );
  const volume = Number(sasaranNode.volume);
  const catatan = rows.map((r) => ({
    id: r.id,
    reportId: r.reportId,
    tanggal: tgl(r),
    volume: Number(r.volume),
    createdById: r.createdById,
    status: r.report.status,
  }));
  const r = rencanaLuarRab(
    catatan,
    new Map([...adaPer].map(([k, b]) => [k, Number(b.volumeDone)])),
    { volume, terlapor },
  );
  if (!r) {
    const u = sasaranNode.unit ? ` ${sasaranNode.unit}` : "";
    throw new PadananAktifError(
      `"${sasaranNode.name}" sudah dilaporkan penuh (${fmt(terlapor)}${u} dari ${fmt(volume)}${u}), jadi tidak bisa menampung apa pun.`,
    );
  }
  const statusLaporan = new Map(rows.map((x) => [x.reportId, x.report.status]));
  const urut = [...rows].sort((a, b) => tgl(a).localeCompare(tgl(b)));
  return {
    aktif,
    namaLama: urut[0]!.uraian,
    unitLama: urut[0]!.satuan,
    sasaran: {
      id: sasaranNode.id,
      lineageKey: sasaranNode.lineageKey,
      code: sasaranNode.code,
      name: sasaranNode.name,
      unit: sasaranNode.unit,
      volume,
      harga: Number(sasaranNode.unitPrice ?? 0),
    },
    catatan,
    baris: r.baris.map((b) => ({ ...b, adaId: adaPer.get(b.reportId)?.id ?? null, status: statusLaporan.get(b.reportId)! })),
    pindahan: r.masuk,
    dipotong: r.dipotong,
    terlapor,
  };
}

/** Tulis rencana `luar_rab` saat usulannya berlaku. */
async function terapkanLuar(tx: Tx, padananId: string, r: RencanaLuar, userId: string, sekarang: Date) {
  for (const b of r.baris) {
    let rowId: string;
    if (b.adaId && b.adaVolume != null) {
      const v = bulat3(b.adaVolume + b.tambah);
      await tx.dailyReportItem.update({
        where: { id: b.adaId },
        data: {
          padananAktifId: padananId,
          volumeSebelumPadanan: b.adaVolume,
          volumeDone: v,
          valueDone: hitungNilai(v, r.sasaran.harga),
        },
      });
      rowId = b.adaId;
    } else {
      const pertama = r.catatan.find((c) => c.id === b.catatanIds[0])!;
      const baru = await tx.dailyReportItem.create({
        data: {
          reportId: b.reportId,
          rabNodeId: r.sasaran.id,
          lineageKey: r.sasaran.lineageKey,
          basis: "aktif",
          volumeDone: b.tambah,
          valueDone: hitungNilai(b.tambah, r.sasaran.harga),
          notes: "Dari catatan pekerjaan di luar RAB",
          reportedById: pertama.createdById,
          padananAktifId: padananId,
        },
        select: { id: true },
      });
      rowId = baru.id;
    }
    const n = await tx.pekerjaanLuarRab.updateMany({
      where: { id: { in: b.catatanIds }, reportItemId: null, dibatalkanAt: null },
      data: { reportItemId: rowId, dipadankanById: userId, dipadankanAt: sekarang },
    });
    if (n.count !== b.catatanIds.length) throw new PadananAktifError("Catatan berubah saat diproses. Coba lagi.");
    // Foto bukti ikut menjadi foto baris itu; asalnya tetap tercatat di `luarRabId`.
    await tx.photo.updateMany({ where: { luarRabId: { in: b.catatanIds }, reportItemId: null }, data: { reportItemId: rowId } });
  }
}

/* ── Mengajukan ────────────────────────────────────────────────────────── */

const MIN_ALASAN = 10;
const MAKS_ALASAN = 500;

function bacaAlasan(alasan: string, apa: string): string {
  const t = alasan.trim();
  if (t.length < MIN_ALASAN) throw new PadananAktifError(`Tulis alasan ${apa} – minimal ${MIN_ALASAN} huruf.`);
  if (t.length > MAKS_ALASAN) throw new PadananAktifError(`Alasan terlalu panjang – maksimal ${MAKS_ALASAN} huruf.`);
  return t;
}

async function kunciLokasi(tx: Tx, locationId: string) {
  // Antre dengan pengiriman laporan di lokasi yang sama (pola luar RAB, CALC-02).
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${locationId}::text, 0))`;
}

export async function ajukanPadananAktif(o: {
  locationId: string;
  lineageLama: string;
  lineageBaru: string;
  alasan: string;
  userId: string;
}): Promise<{ id: string; ringkasan: RingkasanUsulan }> {
  const alasan = bacaAlasan(o.alasan, "pemasangannya");
  return db.$transaction(
    async (tx) => {
      await kunciLokasi(tx, o.locationId);
      const r = await rencanaPasang(tx, o);
      const jalur = (await jalurNodeById([r.sasaran.id])).get(r.sasaran.id)?.kode ?? r.sasaran.code;
      const ringkasan: RingkasanUsulan = {
        namaLama: r.namaLama,
        namaBaru: r.sasaran.name,
        jalurBaru: jalur,
        unit: r.sasaran.unit ?? r.unitLama,
        volume: r.pindahan,
        dipotong: r.dipotong,
        baris: r.baris.length,
        pertama: r.baris[0]?.tanggal ?? null,
        terakhir: r.baris.at(-1)?.tanggal ?? null,
      };
      const p = await tx.rabPadananAktif.create({
        data: {
          locationId: o.locationId,
          revisionId: r.aktif.id,
          lineageLama: o.lineageLama,
          lineageBaru: o.lineageBaru,
          jenis: r.jenis,
          alasan,
          ringkasan,
          diajukanOlehId: o.userId,
        },
        select: { id: true },
      });
      await auditIn(tx, o.userId, "rab.padanan_aktif_ajukan", "rab_padanan_aktif", p.id, {
        locationId: o.locationId,
        revisionNo: r.aktif.revisionNo,
        jenis: r.jenis,
        lineageLama: o.lineageLama,
        lineageBaru: o.lineageBaru,
        alasan,
        ...ringkasan,
      });
      return { id: p.id, ringkasan };
    },
    { timeout: 60_000, maxWait: 15_000 },
  );
}

/** Usulan memasangkan catatan pekerjaan di luar RAB ke item RAB aktif (DECISIONS 780). */
export async function ajukanPadananLuarRab(o: {
  locationId: string;
  luarRabIds: readonly string[];
  lineageBaru: string;
  alasan: string;
  userId: string;
}): Promise<{ id: string; ringkasan: RingkasanUsulan }> {
  const alasan = bacaAlasan(o.alasan, "pemasangannya");
  return db.$transaction(
    async (tx) => {
      await kunciLokasi(tx, o.locationId);
      const r = await rencanaLuar(tx, o);
      const jalur = (await jalurNodeById([r.sasaran.id])).get(r.sasaran.id)?.kode ?? r.sasaran.code;
      const ringkasan: RingkasanUsulan = {
        namaLama: r.namaLama,
        namaBaru: r.sasaran.name,
        jalurBaru: jalur,
        unit: r.sasaran.unit ?? r.unitLama,
        volume: r.pindahan,
        dipotong: r.dipotong,
        baris: r.baris.length,
        catatan: r.catatan.length,
        pertama: r.baris[0]?.tanggal ?? null,
        terakhir: r.baris.at(-1)?.tanggal ?? null,
      };
      const ids = [...new Set(o.luarRabIds)];
      const p = await tx.rabPadananAktif.create({
        data: {
          locationId: o.locationId,
          revisionId: r.aktif.id,
          lineageLama: LINEAGE_LUAR_RAB,
          lineageBaru: o.lineageBaru,
          jenis: "luar_rab",
          luarRabIds: ids,
          alasan,
          ringkasan,
          diajukanOlehId: o.userId,
        },
        select: { id: true },
      });
      await auditIn(tx, o.userId, "rab.padanan_aktif_ajukan", "rab_padanan_aktif", p.id, {
        locationId: o.locationId,
        revisionNo: r.aktif.revisionNo,
        jenis: "luar_rab",
        luarRabIds: ids,
        lineageBaru: o.lineageBaru,
        alasan,
        ...ringkasan,
      });
      return { id: p.id, ringkasan };
    },
    { timeout: 60_000, maxWait: 15_000 },
  );
}

/* ── Menyetujui (dan berlaku saat lengkap) ─────────────────────────────── */

export type HasilSetuju =
  | { berlaku: false; kurang: string[] }
  | { berlaku: true; baris: number; volume: number; dipotong: number; jenis: JenisPadanan; snapshotDibangunUlang: number };

/**
 * Suara persetujuan. Gerbangnya JABATAN, bukan capability – sama dengan
 * aktivasi adendum (DECISIONS 234). Saat dua kursi lengkap, pemasangan
 * berlaku di transaksi yang sama sesudah semua syarat diperiksa ulang. Bila
 * syaratnya tidak lagi terpenuhi, suaranya ikut batal dan sebabnya disebut.
 */
export async function setujuiPadananAktif(o: {
  padananId: string;
  user: { id: string; role: UserRole };
}): Promise<HasilSetuju> {
  if (!bolehMenyetujui(o.user.role)) {
    throw new PadananAktifError(
      "Peran Anda tidak berhak menyetujui pemasangan. Yang berhak: Program Director, Area Manager, Project Manager, atau Site Manager.",
    );
  }
  const hasil = await db.$transaction(
    async (tx) => {
      const p0 = await tx.rabPadananAktif.findUnique({ where: { id: o.padananId }, select: { locationId: true } });
      if (!p0) throw new PadananAktifError("Usulan tidak ditemukan.");
      await kunciLokasi(tx, p0.locationId);
      const p = await tx.rabPadananAktif.findUniqueOrThrow({
        where: { id: o.padananId },
        select: {
          id: true,
          locationId: true,
          revisionId: true,
          lineageLama: true,
          lineageBaru: true,
          jenis: true,
          luarRabIds: true,
          berlakuPada: true,
          ditutupPada: true,
          dilepasPada: true,
        },
      });
      if (keadaanUsulan(p) !== "diajukan") throw new PadananAktifError("Usulan ini sudah tidak menunggu persetujuan.");
      await tx.rabPadananAktifSetuju.upsert({
        where: { padananId_userId: { padananId: p.id, userId: o.user.id } },
        create: { padananId: p.id, userId: o.user.id, role: o.user.role },
        update: { role: o.user.role, approvedAt: new Date() },
      });
      await auditIn(tx, o.user.id, "rab.padanan_aktif_setuju", "rab_padanan_aktif", p.id, {
        locationId: p.locationId,
        role: o.user.role,
      });
      const suara = await tx.rabPadananAktifSetuju.findMany({
        where: { padananId: p.id },
        select: { userId: true, role: true, approvedAt: true },
      });
      const nilai = nilaiPersetujuan(suara);
      if (!nilai.lengkap) return { berlaku: false as const, kurang: nilai.kurang };

      const aktif = await revisiAktif(tx, p.locationId);
      if (!aktif || aktif.id !== p.revisionId) {
        throw new PadananAktifError(
          "RAB aktif sudah berganti sejak usulan ini diajukan. Batalkan usulan ini, lalu ajukan ulang terhadap RAB yang berlaku.",
        );
      }
      if (p.jenis === "luar_rab") {
        const r = await rencanaLuar(tx, {
          locationId: p.locationId,
          luarRabIds: p.luarRabIds,
          lineageBaru: p.lineageBaru,
          abaikanUsulan: p.id,
        });
        const sekarang = new Date();
        await terapkanLuar(tx, p.id, r, o.user.id, sekarang);
        await tx.rabPadananAktif.update({ where: { id: p.id }, data: { berlakuPada: sekarang } });
        await auditIn(tx, o.user.id, "rab.padanan_aktif_berlaku", "rab_padanan_aktif", p.id, {
          locationId: p.locationId,
          revisionNo: r.aktif.revisionNo,
          jenis: "luar_rab",
          catatan: r.catatan.map((c) => ({ id: c.id, tanggal: c.tanggal, volume: c.volume })),
          itemBaru: { lineageKey: r.sasaran.lineageKey, code: r.sasaran.code, name: r.sasaran.name },
          volume: r.pindahan,
          dipotong: r.dipotong,
          terlaporSebelum: r.terlapor,
          volumeKontrak: r.sasaran.volume,
          baris: r.baris.map((b) => ({
            tanggal: b.tanggal,
            status: b.status,
            baru: b.adaId == null,
            dari: b.adaVolume ?? 0,
            ke: bulat3((b.adaVolume ?? 0) + b.tambah),
          })),
          penyetuju: suara.map((s) => ({ userId: s.userId, role: s.role })),
        });
        return {
          berlaku: true as const,
          baris: r.baris.length,
          volume: r.pindahan,
          dipotong: r.dipotong,
          jenis: "luar_rab" as JenisPadanan,
          locationId: p.locationId,
          tanggalTerawal: r.baris.map((b) => b.tanggal).sort()[0] ?? null,
        };
      }
      const r = await rencanaPasang(tx, {
        locationId: p.locationId,
        lineageLama: p.lineageLama,
        lineageBaru: p.lineageBaru,
        abaikanUsulan: p.id,
      });
      const sekarang = new Date();
      for (const b of r.baris) {
        const berubah = Math.abs(b.volumeBaru - b.volumeKini) > 0.0005;
        await tx.dailyReportItem.update({
          where: { id: b.id },
          data: {
            lineageKey: r.sasaran.lineageKey,
            padananAktifId: p.id,
            ...(berubah
              ? { volumeSebelumPadanan: b.volumeKini, volumeDone: b.volumeBaru, valueDone: hitungNilai(b.volumeBaru, b.harga) }
              : {}),
          },
        });
      }
      await tx.rabPadananAktif.update({ where: { id: p.id }, data: { berlakuPada: sekarang } });
      await auditIn(tx, o.user.id, "rab.padanan_aktif_berlaku", "rab_padanan_aktif", p.id, {
        locationId: p.locationId,
        revisionNo: r.aktif.revisionNo,
        jenis: r.jenis,
        itemLama: { lineageKey: p.lineageLama, name: r.namaLama },
        itemBaru: { lineageKey: r.sasaran.lineageKey, code: r.sasaran.code, name: r.sasaran.name },
        volume: r.pindahan,
        dipotong: r.dipotong,
        terlaporSebelum: r.terlapor,
        volumeKontrak: r.sasaran.volume,
        baris: r.baris.map((b) => ({ id: b.id, tanggal: b.tanggal, status: b.status, dari: b.volumeKini, ke: b.volumeBaru })),
        penyetuju: suara.map((s) => ({ userId: s.userId, role: s.role })),
      });
      return {
        berlaku: true as const,
        baris: r.baris.length,
        volume: r.pindahan,
        dipotong: r.dipotong,
        jenis: r.jenis,
        locationId: p.locationId,
        tanggalTerawal: r.baris[0]?.tanggal ?? null,
      };
    },
    { timeout: 60_000, maxWait: 15_000 },
  );
  if (!hasil.berlaku) return hasil;
  const snapshotDibangunUlang = await bangunUlang(hasil.locationId, hasil.tanggalTerawal);
  return {
    berlaku: true,
    baris: hasil.baris,
    volume: hasil.volume,
    dipotong: hasil.dipotong,
    jenis: hasil.jenis,
    snapshotDibangunUlang,
  };
}

/** Blanko harian final sejak tanggal terawal yang berubah (angka "s/d" sesudahnya ikut bergeser). */
async function bangunUlang(locationId: string, sejak: string | null): Promise<number> {
  if (!sejak) return 0;
  const { bangunUlangSnapshotFinal } = await import("@/lib/daily-report/snapshot-rebuild");
  return bangunUlangSnapshotFinal(locationId, { sejak: new Date(`${sejak}T00:00:00.000Z`) });
}

/* ── Menolak / membatalkan ─────────────────────────────────────────────── */

/**
 * Tutup usulan yang belum berlaku. `tolak` hanya oleh peran penyetuju;
 * `batal` oleh pengusul atau pengelola RAB (gerbang capability di aksi).
 */
export async function tutupPadananAktif(o: {
  padananId: string;
  user: { id: string; role: UserRole };
  cara: "tolak" | "batal";
  alasan: string;
}): Promise<void> {
  if (o.cara === "tolak" && !bolehMenyetujui(o.user.role)) {
    throw new PadananAktifError("Peran Anda tidak berhak menolak usulan pemasangan.");
  }
  const alasan = bacaAlasan(o.alasan, o.cara === "tolak" ? "penolakannya" : "pembatalannya");
  await db.$transaction(async (tx) => {
    const p = await tx.rabPadananAktif.findUnique({
      where: { id: o.padananId },
      select: { id: true, locationId: true, berlakuPada: true, ditutupPada: true, dilepasPada: true },
    });
    if (!p) throw new PadananAktifError("Usulan tidak ditemukan.");
    if (keadaanUsulan(p) !== "diajukan") throw new PadananAktifError("Usulan ini sudah tidak menunggu persetujuan.");
    await tx.rabPadananAktif.update({
      where: { id: p.id },
      data: { ditutupPada: new Date(), ditutupOlehId: o.user.id, alasanTutup: `${o.cara === "tolak" ? "Ditolak" : "Dibatalkan"}: ${alasan}` },
    });
    await auditIn(tx, o.user.id, `rab.padanan_aktif_${o.cara}`, "rab_padanan_aktif", p.id, {
      locationId: p.locationId,
      alasan,
    });
  });
}

/* ── Melepas ───────────────────────────────────────────────────────────── */

/**
 * Lepas pemasangan yang sudah berlaku: baris kembali ke kunci item lama dan,
 * bila volumenya dulu dipulihkan, ke angka sesudah aktivasi. Hanya selama
 * revisi aktifnya masih sama, dan hanya bila barisnya belum diubah orang.
 */
export async function lepasPadananAktif(o: {
  padananId: string;
  userId: string;
  alasan: string;
}): Promise<{ baris: number; snapshotDibangunUlang: number }> {
  const alasan = bacaAlasan(o.alasan, "pelepasannya");
  const hasil = await db.$transaction(
    async (tx) => {
      const p0 = await tx.rabPadananAktif.findUnique({ where: { id: o.padananId }, select: { locationId: true } });
      if (!p0) throw new PadananAktifError("Pasangan tidak ditemukan.");
      await kunciLokasi(tx, p0.locationId);
      const p = await tx.rabPadananAktif.findUniqueOrThrow({
        where: { id: o.padananId },
        select: {
          id: true,
          locationId: true,
          revisionId: true,
          lineageLama: true,
          lineageBaru: true,
          jenis: true,
          luarRabIds: true,
          ringkasan: true,
          berlakuPada: true,
          ditutupPada: true,
          dilepasPada: true,
        },
      });
      if (keadaanUsulan(p) !== "berlaku" || !p.berlakuPada) throw new PadananAktifError("Pasangan ini tidak sedang berlaku.");
      const aktif = await revisiAktif(tx, p.locationId);
      if (!aktif || aktif.id !== p.revisionId) {
        throw new PadananAktifError(
          `RAB aktif sudah berganti (revisi #${aktif?.revisionNo ?? "?"}) dan pasangan ini sudah ikut menjadi dasarnya. Pasangan tidak bisa dilepas lagi.`,
        );
      }
      const baris = await tx.dailyReportItem.findMany({
        where: { padananAktifId: p.id },
        select: {
          id: true,
          reportId: true,
          lineageKey: true,
          volumeDone: true,
          volumeSebelumPadanan: true,
          updatedAt: true,
          rabNode: { select: { unitPrice: true } },
          report: { select: { reportDate: true } },
        },
      });
      const diubah = baris.filter((b) => b.lineageKey !== p.lineageBaru || barisDiubahSesudah(b.updatedAt, p.berlakuPada!));
      if (diubah.length > 0) {
        throw new PadananAktifError(
          `Laporan tanggal ${daftarTanggal(diubah.map((b) => kunciTanggal(b.report.reportDate)))} sudah diubah sesudah dipasangkan. ` +
            `Melepas akan menimpa perubahan itu, jadi dibatalkan.`,
        );
      }
      if (p.jenis === "luar_rab") {
        await lepasLuar(tx, p.luarRabIds, baris);
      } else {
        // Kunci item lama bisa sudah dipakai lagi di laporan yang sama (item lama dilaporkan ulang).
        const bentrok = await tx.dailyReportItem.findMany({
          where: { lineageKey: p.lineageLama, reportId: { in: baris.map((b) => b.reportId) } },
          select: { report: { select: { reportDate: true } } },
        });
        if (bentrok.length > 0) {
          throw new PadananAktifError(
            `Laporan tanggal ${daftarTanggal(bentrok.map((b) => kunciTanggal(b.report.reportDate)))} sudah memuat item lamanya lagi. ` +
              `Melepas akan membuat item yang sama dua kali di satu laporan.`,
          );
        }
        for (const b of baris) {
          const kembali = b.volumeSebelumPadanan == null ? null : Number(b.volumeSebelumPadanan);
          await tx.dailyReportItem.update({
            where: { id: b.id },
            data: {
              lineageKey: p.lineageLama,
              padananAktifId: null,
              volumeSebelumPadanan: null,
              ...(kembali == null
                ? {}
                : { volumeDone: kembali, valueDone: hitungNilai(kembali, Number(b.rabNode.unitPrice ?? 0)) }),
            },
          });
        }
      }
      await tx.rabPadananAktif.update({
        where: { id: p.id },
        data: { dilepasPada: new Date(), dilepasOlehId: o.userId, alasanLepas: alasan },
      });
      await auditIn(tx, o.userId, "rab.padanan_aktif_lepas", "rab_padanan_aktif", p.id, {
        locationId: p.locationId,
        jenis: p.jenis,
        lineageLama: p.lineageLama,
        lineageBaru: p.lineageBaru,
        ...(p.jenis === "luar_rab" ? { luarRabIds: p.luarRabIds } : {}),
        alasan,
        baris: baris.map((b) => ({
          id: b.id,
          tanggal: kunciTanggal(b.report.reportDate),
          dari: Number(b.volumeDone),
          ke:
            b.volumeSebelumPadanan != null
              ? Number(b.volumeSebelumPadanan)
              : p.jenis === "luar_rab"
                ? 0 // baris dari catatan dihapus
                : Number(b.volumeDone),
        })),
      });
      const tanggal = baris.map((b) => kunciTanggal(b.report.reportDate)).sort();
      return { baris: baris.length, locationId: p.locationId, tanggalTerawal: tanggal[0] ?? null };
    },
    { timeout: 60_000, maxWait: 15_000 },
  );
  const snapshotDibangunUlang = await bangunUlang(hasil.locationId, hasil.tanggalTerawal);
  return { baris: hasil.baris, snapshotDibangunUlang };
}

/**
 * Lepas pemasangan catatan di luar RAB: baris yang dibuat dari catatan
 * dihapus, baris yang ditambah kembali ke angka sebelumnya; catatan kembali
 * menunggu dan fotonya kembali ke catatan.
 */
async function lepasLuar(
  tx: Tx,
  luarRabIds: readonly string[],
  baris: readonly { id: string; volumeSebelumPadanan: Prisma.Decimal | null; rabNode: { unitPrice: Prisma.Decimal | null } }[],
) {
  const ids = [...luarRabIds];
  for (const b of baris) {
    await tx.photo.updateMany({ where: { reportItemId: b.id, luarRabId: { in: ids } }, data: { reportItemId: null } });
    await tx.pekerjaanLuarRab.updateMany({
      where: { reportItemId: b.id, id: { in: ids } },
      data: { reportItemId: null, dipadankanById: null, dipadankanAt: null },
    });
    if (b.volumeSebelumPadanan != null) {
      const kembali = Number(b.volumeSebelumPadanan);
      await tx.dailyReportItem.update({
        where: { id: b.id },
        data: {
          padananAktifId: null,
          volumeSebelumPadanan: null,
          volumeDone: kembali,
          valueDone: hitungNilai(kembali, Number(b.rabNode.unitPrice ?? 0)),
        },
      });
    } else {
      // Foto lain yang menempel sesudahnya tetap di laporannya.
      await tx.photo.updateMany({ where: { reportItemId: b.id }, data: { reportItemId: null } });
      await tx.dailyReportItem.delete({ where: { id: b.id } });
    }
  }
}

/* ── Data menu ─────────────────────────────────────────────────────────── */

/** Jumlah usulan yang menunggu persetujuan di lokasi ini (untuk penanda di halaman RAB). */
export async function jumlahUsulanMenunggu(locationId: string): Promise<number> {
  return db.rabPadananAktif.count({ where: { locationId, berlakuPada: null, ditutupPada: null } });
}

/**
 * Isi menu "Pasangkan realisasi": item yang belum dipasangkan beserta calon
 * tujuannya, dan semua usulan (menunggu, berlaku, ditutup, dilepas).
 */
export async function dataPadananAktif(locationId: string): Promise<{
  aktif: { id: string; revisionNo: number } | null;
  belum: ItemBelumAktif[];
  luarRab: KelompokLuarRab[];
  calonLuarRab: CalonLuarRab[];
  usulan: UsulanPadanan[];
}> {
  const aktif = await revisiAktif(db, locationId);
  const usulan = await daftarUsulan(locationId, aktif?.id ?? null);
  if (!aktif) return { aktif: null, belum: [], luarRab: [], calonLuarRab: [], usulan };

  const hidup = new Set(usulan.filter((u) => u.keadaan === "diajukan" || u.keadaan === "berlaku").map((u) => u.lineageLama));
  const nodeAktif = await db.rabNode.findMany({
    where: { revisionId: aktif.id },
    select: { id: true, parentId: true, kind: true, code: true, name: true, unit: true, volume: true, lineageKey: true },
    orderBy: { sortOrder: "asc" },
  });
  const beranak = new Set(nodeAktif.map((n) => n.parentId).filter((x): x is string => !!x));
  const lineageAktif = new Set(nodeAktif.map((n) => n.lineageKey));
  const draft = await db.rabRevision.findFirst({ where: { locationId, status: "draft" }, select: { id: true } });
  const lineageDraft = draft
    ? new Set((await db.rabNode.findMany({ where: { revisionId: draft.id }, select: { lineageKey: true } })).map((n) => n.lineageKey))
    : null;

  // Calon tujuan: item pekerjaan RAB aktif tanpa rincian, bervolume.
  const calonNode = nodeAktif.filter(
    (n) => (n.kind === "item" || n.kind === "grup") && !beranak.has(n.id) && !volumeNol(n.volume == null ? null : Number(n.volume)),
  );
  const terlaporRows = calonNode.length
    ? await db.dailyReportItem.groupBy({
        by: ["lineageKey"],
        where: { lineageKey: { in: calonNode.map((n) => n.lineageKey) }, basis: "aktif", report: { locationId } },
        _sum: { volumeDone: true },
      })
    : [];
  const terlapor = new Map(terlaporRows.map((r) => [r.lineageKey, Number(r._sum.volumeDone ?? 0)]));
  const sisaCalon = new Map(
    calonNode.map((n) => [n.lineageKey, bulat3(Math.max(0, Number(n.volume) - (terlapor.get(n.lineageKey) ?? 0)))]),
  );
  const jalurCalon = await jalurNodeById(calonNode.map((n) => n.id));

  // Item lama jenis `hilang`: dari halaman Tidak terbobot (calculation layer kanonik).
  const tidakTerbobot = (await realisasiTidakTerbobot(locationId)).filter((i) => !hidup.has(i.lineageKey));
  // Item lama jenis `dinolkan`: masih di RAB aktif dengan volume 0, berjejak penurunan saat aktivasi.
  const nolAktif = nodeAktif.filter(
    (n) =>
      (n.kind === "item" || n.kind === "grup") &&
      !beranak.has(n.id) &&
      volumeNol(n.volume == null ? null : Number(n.volume)) &&
      !hidup.has(n.lineageKey),
  );
  const jalurNol = await jalurNodeById(nolAktif.map((n) => n.id));
  const jejakNol = nolAktif.length ? await semuaJejakNol(db, aktif.id) : new Map<string, Jejak>();

  const semuaKunciLama = [...tidakTerbobot.map((i) => i.lineageKey), ...nolAktif.map((n) => n.lineageKey)];
  const barisLama = semuaKunciLama.length
    ? await db.dailyReportItem.findMany({
        where: { lineageKey: { in: semuaKunciLama }, report: { locationId } },
        select: { id: true, lineageKey: true, reportId: true, volumeDone: true, report: { select: { reportDate: true, status: true } } },
      })
    : [];
  const perKunci = new Map<string, typeof barisLama>();
  for (const b of barisLama) perKunci.set(b.lineageKey, [...(perKunci.get(b.lineageKey) ?? []), b]);
  const laporanPerKunci = new Map<string, Set<string>>();
  const semuaBaris = calonNode.length
    ? await db.dailyReportItem.findMany({
        where: { lineageKey: { in: calonNode.map((n) => n.lineageKey) }, report: { locationId } },
        select: { lineageKey: true, reportId: true },
      })
    : [];
  for (const b of semuaBaris) {
    const s = laporanPerKunci.get(b.lineageKey) ?? new Set<string>();
    s.add(b.reportId);
    laporanPerKunci.set(b.lineageKey, s);
  }

  const susun = (o: {
    lineageKey: string;
    name: string;
    unit: string | null;
    jalur: string;
    kategori: string;
    jenis: JenisPadanan;
    volume: number;
    keterangan: string;
    terhalangAwal: string | null;
  }): ItemBelumAktif => {
    const baris = perKunci.get(o.lineageKey) ?? [];
    const tanggal = baris.map((b) => b.report.reportDate).sort((a, b) => a.getTime() - b.getTime());
    const laporanLama = new Set(baris.map((b) => b.reportId));
    const belumDikirim = baris.filter((b) => !terhitung.has(b.report.status));
    let terhalang = o.terhalangAwal;
    if (!terhalang && belumDikirim.length > 0) {
      terhalang =
        `Laporan tanggal ${daftarTanggal(belumDikirim.map((b) => kunciTanggal(b.report.reportDate)))} memuat item ini ` +
        `dan belum dikirim. Kirim atau perbaiki laporan itu dulu.`;
    }
    let sisaKurang = 0;
    const calon: CalonAktif[] = [];
    for (const n of calonNode) {
      const sasaran: ItemSasaran = {
        lineageKey: n.lineageKey,
        kind: n.kind,
        name: n.name,
        unit: n.unit,
        punyaAnak: false,
        volume: Number(n.volume),
      };
      if (periksaPasanganAktif({ lineageKey: o.lineageKey, name: o.name, unit: o.unit }, sasaran, { lineageAktif, lineageDraft })) {
        continue;
      }
      // Satu laporan yang memuat keduanya tidak bisa dipasangkan – bukan calon.
      const lap = laporanPerKunci.get(n.lineageKey);
      if (lap && [...laporanLama].some((id) => lap.has(id))) continue;
      // Sisa kurang tidak menghalangi: kelebihannya dipotong saat berlaku
      // (DECISIONS 780). Hanya item yang sisanya 0 yang tidak ditawarkan.
      const sisa = sisaCalon.get(n.lineageKey) ?? 0;
      if (sisa <= 0.0005) {
        sisaKurang++;
        continue;
      }
      calon.push({
        lineageKey: n.lineageKey,
        code: n.code,
        name: n.name,
        unit: n.unit,
        jalur: jalurCalon.get(n.id)?.kode ?? n.code,
        volume: Number(n.volume),
        sisa,
        dipotong: bulat3(Math.max(0, o.volume - sisa)),
      });
    }
    return {
      lineageKey: o.lineageKey,
      name: o.name,
      unit: o.unit,
      jalur: o.jalur,
      kategori: o.kategori,
      jenis: o.jenis,
      volume: o.volume,
      jumlahLaporan: laporanLama.size,
      pertama: tanggal[0] ?? null,
      terakhir: tanggal.at(-1) ?? null,
      keterangan: o.keterangan,
      calon,
      calonSisaKurang: sisaKurang,
      terhalang,
    };
  };

  const belum: ItemBelumAktif[] = tidakTerbobot.map((i) =>
    susun({
      lineageKey: i.lineageKey,
      name: i.name,
      unit: i.unit,
      jalur: i.jalur,
      kategori: i.kategori,
      jenis: "hilang",
      volume: i.volume,
      keterangan: i.hilangDiRevisi ? `Hilang dari RAB di revisi #${i.hilangDiRevisi}` : "Tidak ada di RAB aktif",
      terhalangAwal: null,
    }),
  );

  for (const n of nolAktif) {
    const baris = perKunci.get(n.lineageKey) ?? [];
    if (baris.length === 0) continue;
    const jejak = jejakNol.get(n.lineageKey);
    if (!jejak) continue; // tidak diturunkan saat aktivasi ini – tidak ada yang hilang
    const r = rencanaPulihNol(
      jejak,
      baris.map((b) => ({ id: b.id, tanggal: kunciTanggal(b.report.reportDate), volume: Number(b.volumeDone) })),
    );
    const volume = bulat3(
      baris.reduce((t, b) => t + (r.ok ? (r.pulih.get(b.id) ?? Number(b.volumeDone)) : Number(b.volumeDone)), 0),
    );
    if (r.ok && volume <= 0) continue;
    const kategoriNode = nodeAktif.find((x) => x.kind === "kategori" && n.lineageKey.split("#")[0] === x.lineageKey.split("#")[0]);
    belum.push(
      susun({
        lineageKey: n.lineageKey,
        name: n.name,
        unit: n.unit,
        jalur: jalurNol.get(n.id)?.kode ?? n.code,
        // Format sama dengan halaman Tidak terbobot: "I. PEKERJAAN PONDASI".
        kategori: kategoriNode ? labelKategori(kategoriNode.code, kategoriNode.name) : "Tanpa kategori",
        jenis: "dinolkan",
        volume,
        keterangan: `Volumenya 0 sejak revisi #${aktif.revisionNo}; laporannya diturunkan jadi 0 saat aktivasi`,
        terhalangAwal: r.ok
          ? null
          : `Angka di laporan tanggal ${daftarTanggal(r.tanggal)} sudah berubah sejak aktivasi, jadi volumenya tidak bisa dipulihkan otomatis.`,
      }),
    );
  }

  // Catatan pekerjaan di luar RAB (DECISIONS 780): yang belum dipadankan, belum
  // dibatalkan, dan tidak sedang menunggu persetujuan. Catatan usulan yang sudah
  // berlaku sudah punya baris; yang barisnya dihapus lewat koreksi laporan
  // muncul lagi di sini.
  const catatanDiUsulan = new Set(usulan.filter((u) => u.keadaan === "diajukan").flatMap((u) => u.luarRabIds));
  const calonLuarRab: CalonLuarRab[] = calonNode
    .map((n) => ({
      lineageKey: n.lineageKey,
      name: n.name,
      unit: n.unit,
      satuanKunci: kunciSatuan(n.unit),
      jalur: jalurCalon.get(n.id)?.kode ?? n.code,
      sisa: sisaCalon.get(n.lineageKey) ?? 0,
    }))
    .filter((c) => c.sisa > 0.0005);
  const luarRab = await kelompokLuarRab(locationId, catatanDiUsulan, calonLuarRab, calonNode, jalurCalon);

  return { aktif, belum, luarRab, calonLuarRab, usulan };
}

async function kelompokLuarRab(
  locationId: string,
  kecuali: ReadonlySet<string>,
  calon: readonly CalonLuarRab[],
  calonNode: readonly { id: string; lineageKey: string; code: string; name: string; unit: string | null; volume: Prisma.Decimal | null }[],
  jalurCalon: Map<string, { kode: string; nama: string }>,
): Promise<KelompokLuarRab[]> {
  const rows = (
    await db.pekerjaanLuarRab.findMany({
      where: { locationId, dibatalkanAt: null, reportItemId: null },
      select: {
        id: true,
        reportId: true,
        uraian: true,
        satuan: true,
        volume: true,
        asalDraftNo: true,
        report: { select: { reportDate: true, status: true } },
      },
      orderBy: [{ report: { reportDate: "asc" } }, { createdAt: "asc" }],
    })
  ).filter((r) => !kecuali.has(r.id));
  if (rows.length === 0) return [];

  // Kandidat untuk saran: item yang masih bersisa, dinilai seperti padanan draft (738).
  const masihAda = new Set(calon.map((c) => c.lineageKey));
  const kandidat: KandidatDraft[] = calonNode
    .filter((n) => masihAda.has(n.lineageKey))
    .map((n) => ({
      id: n.lineageKey,
      lineageKey: n.lineageKey,
      kode: n.code,
      nama: n.name,
      jalur: (jalurCalon.get(n.id)?.nama ?? "").split(" › ").filter(Boolean),
      satuan: n.unit,
      volumeDraft: Number(n.volume),
      sisa: calon.find((c) => c.lineageKey === n.lineageKey)?.sisa ?? null,
      baru: false,
    }));

  const grup = new Map<string, (typeof rows)[number][]>();
  for (const r of rows) {
    const kunci = `${token(r.uraian).join(" ")}|${kunciSatuan(r.satuan) ?? "-"}`;
    grup.set(kunci, [...(grup.get(kunci) ?? []), r]);
  }
  const hasil: KelompokLuarRab[] = [];
  for (const [kunci, isi] of grup) {
    const siap = isi.filter((r) => terhitung.has(r.report.status));
    const tahan = isi.filter((r) => !terhitung.has(r.report.status));
    const tanggal = siap.map((r) => jakartaDateKey(r.report.reportDate)).sort();
    const usul = usulkanPadanan({ uraian: isi[0]!.uraian, satuan: isi[0]!.satuan }, kandidat);
    hasil.push({
      kunci,
      uraian: isi[0]!.uraian,
      satuan: isi[0]!.satuan,
      satuanKunci: kunciSatuan(isi[0]!.satuan),
      catatanIds: siap.map((r) => r.id),
      volume: bulat3(siap.reduce((t, r) => t + Number(r.volume), 0)),
      jumlahLaporan: new Set(siap.map((r) => r.reportId)).size,
      pertama: tanggal[0] ?? null,
      terakhir: tanggal.at(-1) ?? null,
      tertahan:
        tahan.length > 0
          ? { jumlah: tahan.length, tanggal: daftarTanggal(tahan.map((r) => jakartaDateKey(r.report.reportDate))) }
          : null,
      asalDraft: isi.some((r) => r.asalDraftNo != null),
      saran: usul.saran.map((x) => x.id),
      pilihan: usul.kandidatId,
    });
  }
  return hasil.sort((a, b) => a.uraian.localeCompare(b.uraian, "id"));
}

async function daftarUsulan(locationId: string, aktifId: string | null): Promise<UsulanPadanan[]> {
  const rows = await db.rabPadananAktif.findMany({
    where: { locationId },
    orderBy: { diajukanPada: "desc" },
    select: {
      id: true,
      revisionId: true,
      jenis: true,
      lineageLama: true,
      lineageBaru: true,
      luarRabIds: true,
      alasan: true,
      ringkasan: true,
      diajukanPada: true,
      berlakuPada: true,
      ditutupPada: true,
      alasanTutup: true,
      dilepasPada: true,
      alasanLepas: true,
      diajukanOleh: { select: { id: true, fullName: true } },
      persetujuan: {
        orderBy: { approvedAt: "asc" },
        select: { userId: true, role: true, approvedAt: true, user: { select: { fullName: true } } },
      },
      _count: { select: { baris: true } },
    },
  });
  return rows.map((r) => {
    const g = r.ringkasan as unknown as RingkasanUsulan;
    const keadaan = keadaanUsulan(r);
    const suara = r.persetujuan.map((s) => ({ userId: s.userId, nama: s.user.fullName, role: s.role, approvedAt: s.approvedAt }));
    return {
      id: r.id,
      keadaan,
      jenis: r.jenis as JenisPadanan,
      lineageLama: r.lineageLama,
      lineageBaru: r.lineageBaru,
      namaLama: g.namaLama,
      namaBaru: g.namaBaru,
      jalurBaru: g.jalurBaru,
      unit: g.unit,
      volume: g.volume,
      dipotong: g.dipotong ?? 0,
      baris: keadaan === "berlaku" ? r._count.baris : g.baris,
      luarRabIds: r.luarRabIds,
      alasan: r.alasan,
      diajukanOleh: { id: r.diajukanOleh.id, nama: r.diajukanOleh.fullName },
      diajukanPada: r.diajukanPada,
      berlakuPada: r.berlakuPada,
      ditutupPada: r.ditutupPada,
      alasanTutup: r.alasanTutup,
      dilepasPada: r.dilepasPada,
      alasanLepas: r.alasanLepas,
      suara,
      kurang: keadaan === "diajukan" ? nilaiPersetujuan(suara).kurang : [],
      revisiBerganti: aktifId !== null && r.revisionId !== aktifId,
    };
  });
}
