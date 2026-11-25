import "server-only";
import { db } from "@/lib/db";
import { auditIn } from "@/lib/audit";
import { formatTanggal, jakartaDateKey } from "@/lib/format";
import { COUNTED_REPORT_STATUSES } from "@/lib/lifecycle";
import { valueDone as hitungNilai } from "@/lib/money";
import { jalurNodeById } from "@/lib/rab/jalur";
import { akarLineage, kunciSatuan, volumeNol } from "@/lib/rab/padanan-draft-aturan";
import { realisasiTidakTerbobot } from "@/lib/rab/tidak-terbobot";
import { bolehMenyetujui, nilaiPersetujuan } from "@/lib/rab/persetujuan-aturan";
import {
  bagiProporsional,
  barisDiubahSesudah,
  bobotDinolkan,
  keadaanUsulan,
  periksaSasaran,
  rencanaLuarRab,
  satuanSama,
  tentukanMasuk,
  type BarisLuarRab,
  type KeadaanUsulan,
} from "@/lib/rab/padanan-aktif-aturan";
import { usulkanPadanan, type KandidatDraft } from "@/lib/luar-rab/padanan";
import { token } from "@/lib/daily-report/impor-pelaksana/cocok";
import type { Prisma } from "@/generated/prisma/client";
import type { UserRole } from "@/generated/prisma/enums";

/**
 * PEMASANGAN REALISASI SESUDAH AKTIVASI ADENDUM (DECISIONS 777/780/781).
 *
 * Permintaan user 2026-11-25: *"buat bisa dipasangkan sesudah aktivasi, menu
 * khusus. mitigasi semua resiko dan penanganannya"*.
 *
 * Yang dipasangkan ke item RAB aktif:
 * - `hilang`: item yang tidak ada lagi di RAB aktif. Laporannya tetap, volumenya
 *   tidak terhitung (halaman Tidak terbobot, DECISIONS 649).
 * - `dinolkan`: item yang masih ada dengan volume 0. Laporannya diturunkan jadi
 *   0 saat aktivasi (DECISIONS 745/756); angka lamanya ada di jejak audit.
 * - `luar_rab`: catatan pekerjaan di luar RAB (738), DECISIONS 780.
 *
 * TUJUANNYA SEMUA ITEM PEKERJAAN RAB AKTIF (781). Ketetapan user: *"intinya
 * kasih saja semua list pekerjaan di RAB aktif, untuk dipadankan, satuan dsb
 * mengikuti rab aktif, hanya volume saja disesuaikan atau bisa diinput sesuai
 * sisa. mitigasi total masalah pemetaan manual ini."* Beda kategori dan beda
 * satuan disebut, tidak ditolak. Volume yang masuk diisi orang dalam satuan
 * item tujuan, paling banyak sebesar sisanya, lalu dibagi ke baris-baris
 * laporannya sesuai volume asalnya (`bagiProporsional`).
 *
 * CARANYA: baris laporan item lama pindah KUNCI ke item tujuan (tanggal,
 * pelapor, foto tetap); catatan di luar RAB menjadi baris item tujuan pada
 * tanggal aslinya. Laporan yang sudah punya baris item tujuan MENAMPUNG
 * volumenya di baris itu – baris item lamanya menjadi 0. RAB aktif, kurva-S,
 * dan dokumen CCO tidak disentuh.
 *
 * PENGAMAN:
 * - Usulan baru BERLAKU sesudah dua persetujuan (Program Director + AM/PM/SM),
 *   sama dengan aktivasi adendum (DECISIONS 234). Super admin tidak bisa
 *   menyetujui.
 * - Semua syarat diperiksa ULANG saat usulan berlaku, di dalam kunci lokasi
 *   yang sama dengan pengiriman laporan. Sisa yang berkurang sejak diajukan
 *   memotong volumenya, dan disebut.
 * - Ditolak hanya yang memang tidak bisa: laporan item lama yang belum dikirim,
 *   baris draft adendum, item lama yang muncul lagi di draft, revisi aktif yang
 *   sudah berganti, beda satuan tanpa isian volume, isian di atas sisa.
 * - Angka asli tiap baris disimpan (`volumeSebelumPadanan`); Lepas
 *   mengembalikannya – ditolak bila barisnya sudah diubah orang sesudah
 *   dipasangkan, atau revisi aktifnya sudah berganti.
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
const fmt = (v: number) => new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 }).format(v);
const sat = (u: string | null) => (u ? ` ${u}` : "");

export type JenisPadanan = "hilang" | "dinolkan" | "luar_rab";

/** Item pekerjaan RAB aktif – SEMUA bisa menjadi tujuan (781). */
export type CalonAktif = {
  lineageKey: string;
  code: string;
  name: string;
  unit: string | null;
  /** Bentuk baku satuan (`kunciSatuan`); null = tidak diketahui. */
  satuanKunci: string | null;
  jalur: string;
  /** Kode kategori (akar kunci), untuk menyebut "beda kategori". */
  akar: string;
  volume: number;
  /** Sisa volume item ini (volume − semua laporan basis aktif); 0 = hanya bisa dipetakan. */
  sisa: number;
};

export type ItemBelumAktif = {
  lineageKey: string;
  name: string;
  unit: string | null;
  jalur: string;
  kategori: string;
  jenis: JenisPadanan;
  /** Volume asal (satuan item lama); untuk `dinolkan`: angka sebelum diturunkan. */
  volume: number;
  jumlahLaporan: number;
  pertama: Date | null;
  terakhir: Date | null;
  /** "Hilang di revisi #3" / "Dinolkan saat revisi #3 diaktifkan". */
  keterangan: string;
  /** Kunci item yang disarankan, terbaik dulu; `pilihan` = dipilih otomatis (jelas unggul). */
  saran: string[];
  pilihan: string | null;
  /** Sebab item ini belum bisa diusulkan sekarang (laporan belum dikirim, muncul lagi di draft). */
  terhalang: string | null;
};

/** Kelompok catatan pekerjaan di luar RAB (uraian + satuan sama) yang menunggu (DECISIONS 780). */
export type KelompokLuarRab = {
  kunci: string;
  uraian: string;
  satuan: string;
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
  saran: string[];
  pilihan: string | null;
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
  /** Satuan item tujuan. */
  unit: string | null;
  /** Volume yang masuk ke item tujuan, satuan item tujuan. */
  volume: number;
  /** Volume asal dan satuannya (item lama / catatan). */
  volumeAsal: number;
  unitAsal: string | null;
  /** Volume asal yang tidak ikut masuk (hanya bila satuannya sama). */
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
  /** Satuan item tujuan. */
  unit: string | null;
  /** Volume yang MASUK ke item tujuan (satuan item tujuan). */
  volume: number;
  /** Volume asal + satuannya (781). Kosong di usulan sebelum 781 = sama dengan `volume` + `unit`. */
  volumeAsal?: number;
  unitAsal?: string | null;
  /** Volume asal yang tidak ikut masuk (DECISIONS 780); hanya bila satuannya sama. */
  dipotong?: number;
  baris: number;
  /** Jumlah catatan di luar RAB yang ikut (jenis `luar_rab`). */
  catatan?: number;
  pertama: string | null;
  terakhir: string | null;
};

/* ── Bersama ───────────────────────────────────────────────────────────── */

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

type NodeAktif = {
  id: string;
  parentId: string | null;
  kind: string;
  code: string;
  name: string;
  unit: string | null;
  volume: Prisma.Decimal | null;
  unitPrice: Prisma.Decimal | null;
  lineageKey: string;
};

async function nodeRevisi(c: Tx | typeof db, revisionId: string): Promise<NodeAktif[]> {
  return c.rabNode.findMany({
    where: { revisionId },
    select: { id: true, parentId: true, kind: true, code: true, name: true, unit: true, volume: true, unitPrice: true, lineageKey: true },
    orderBy: { sortOrder: "asc" },
  });
}

/** Item tujuan yang sudah diperiksa, dengan sisa volumenya saat ini. */
type Sasaran = {
  id: string;
  lineageKey: string;
  code: string;
  name: string;
  unit: string | null;
  volume: number;
  harga: number;
  terlapor: number;
  sisa: number;
};

/** Periksa item tujuan dan hitung sisanya (semua baris basis aktif, status apa pun). */
async function bacaSasaran(
  tx: Tx,
  o: { locationId: string; nodeAktif: NodeAktif[]; lineageBaru: string; lineageLama: string | null },
): Promise<Sasaran> {
  const n = o.nodeAktif.find((x) => x.lineageKey === o.lineageBaru);
  if (!n) throw new PadananAktifError("Item tujuan tidak ada di RAB aktif. Muat ulang halaman.");
  const tolak = periksaSasaran(
    { lineageKey: n.lineageKey, kind: n.kind, name: n.name, punyaAnak: o.nodeAktif.some((x) => x.parentId === n.id) },
    new Set(o.nodeAktif.map((x) => x.lineageKey)),
    o.lineageLama,
  );
  if (tolak) throw new PadananAktifError(tolak);
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
  const volume = Number(n.volume ?? 0);
  return {
    id: n.id,
    lineageKey: n.lineageKey,
    code: n.code,
    name: n.name,
    unit: n.unit,
    volume,
    harga: Number(n.unitPrice ?? 0),
    terlapor,
    sisa: bulat3(Math.max(0, volume - terlapor)),
  };
}

/** Volume masuk, atau galat yang menyebut angkanya. */
function hitungMasuk(o: {
  asal: number;
  diminta: number | null;
  sasaran: Sasaran;
  unitAsal: string | null;
  namaAsal: string;
  ketat: boolean;
}): { masuk: number; dipotong: number } {
  const sama = satuanSama(o.unitAsal, o.sasaran.unit);
  const r = tentukanMasuk({ asal: o.asal, diminta: o.diminta, sisa: o.sasaran.sisa, satuanSama: sama, ketat: o.ketat });
  if ("galat" in r) {
    const u = sat(o.sasaran.unit);
    if (r.galat === "isi_volume") {
      throw new PadananAktifError(
        `Satuan "${o.namaAsal}" (${o.unitAsal}) berbeda dengan "${o.sasaran.name}" (${o.sasaran.unit}). ` +
          `Isi volume yang masuk dalam ${o.sasaran.unit}.`,
      );
    }
    if (r.galat === "negatif") throw new PadananAktifError("Volume tidak boleh kurang dari 0.");
    throw new PadananAktifError(
      `Volume ${fmt(o.diminta ?? 0)}${u} melebihi sisa "${o.sasaran.name}" (${fmt(o.sasaran.sisa)}${u}).`,
    );
  }
  return r;
}

/* ── Rencana: item lama (hilang / dinolkan) ────────────────────────────── */

type BarisPasang = {
  id: string;
  reportId: string;
  tanggal: string;
  status: string;
  volumeKini: number;
  /** Volume yang masuk ke item tujuan dari baris ini (satuan item tujuan). */
  volumeBaru: number;
  /**
   * Laporan yang SUDAH punya baris item tujuan: volumenya ditambahkan ke baris
   * itu dan baris item lama menjadi 0 (satu laporan, satu baris per item).
   */
  tampung: { id: string; volume: number } | null;
};

type RencanaPasang = {
  aktif: { id: string; revisionNo: number };
  jenis: JenisPadanan;
  namaLama: string;
  unitLama: string | null;
  sasaran: Sasaran;
  baris: BarisPasang[];
  asal: number;
  pindahan: number;
  dipotong: number;
};

/**
 * Periksa syarat satu pasangan dan susun rencananya. Dipakai saat mengajukan
 * (`ketat`) DAN saat berlaku. Melempar `PadananAktifError` dengan sebabnya.
 */
async function rencanaPasang(
  tx: Tx,
  o: {
    locationId: string;
    lineageLama: string;
    lineageBaru: string;
    volumeDiminta: number | null;
    ketat: boolean;
    abaikanUsulan?: string;
  },
): Promise<RencanaPasang> {
  const aktif = await revisiAktif(tx, o.locationId);
  if (!aktif) throw new PadananAktifError("Lokasi ini belum punya RAB aktif.");
  const nodeAktif = await nodeRevisi(tx, aktif.id);

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

  // Item lama yang muncul lagi di draft tersambung sendiri saat draft itu aktif.
  const draft = await tx.rabRevision.findFirst({ where: { locationId: o.locationId, status: "draft" }, select: { id: true } });
  if (draft && (await tx.rabNode.count({ where: { revisionId: draft.id, lineageKey: o.lineageLama } })) > 0) {
    throw new PadananAktifError(
      `"${namaLama}" muncul lagi di draft adendum yang sedang berjalan. ` +
        `Realisasinya tersambung sendiri saat draft itu aktif, jadi tidak perlu dipasangkan.`,
    );
  }

  const sasaran = await bacaSasaran(tx, { locationId: o.locationId, nodeAktif, lineageBaru: o.lineageBaru, lineageLama: o.lineageLama });

  // Baris laporan item lama.
  const barisLama = await tx.dailyReportItem.findMany({
    where: { lineageKey: o.lineageLama, report: { locationId: o.locationId } },
    select: {
      id: true,
      reportId: true,
      basis: true,
      volumeDone: true,
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

  // Laporan yang memuat keduanya: baris item tujuan menampung volumenya.
  const barisSasaran = await tx.dailyReportItem.findMany({
    where: { lineageKey: o.lineageBaru, reportId: { in: barisLama.map((b) => b.reportId) } },
    select: { id: true, reportId: true, basis: true, volumeDone: true, padananAktifId: true, report: { select: { reportDate: true } } },
  });
  const tampungDraft = barisSasaran.filter((b) => b.basis !== "aktif");
  if (tampungDraft.length > 0) {
    throw new PadananAktifError(
      `Laporan tanggal ${daftarTanggal(tampungDraft.map((b) => kunciTanggal(b.report.reportDate)))} mencatat "${sasaran.name}" ` +
        `terhadap draft adendum. Baris itu mengikuti draftnya, jadi tidak bisa menampung.`,
    );
  }
  const tampungLain = barisSasaran.filter((b) => b.padananAktifId);
  if (tampungLain.length > 0) {
    throw new PadananAktifError(
      `Baris "${sasaran.name}" di laporan tanggal ${daftarTanggal(tampungLain.map((b) => kunciTanggal(b.report.reportDate)))} ` +
        `berasal dari pemasangan lain. Lepas dulu pasangan itu, atau pilih item lain.`,
    );
  }
  const tampungPer = new Map(barisSasaran.map((b) => [b.reportId, b]));

  // Bobot tiap baris (satuan item lama): apa adanya, atau angka sebelum dinolkan.
  const kini = barisLama.map((b) => ({ id: b.id, tanggal: kunciTanggal(b.report.reportDate), volume: Number(b.volumeDone) }));
  let bobot = new Map(kini.map((b) => [b.id, b.volume]));
  if (jenis === "dinolkan") {
    const jejak = (await semuaJejakNol(tx, aktif.id)).get(o.lineageLama);
    if (jejak) bobot = bobotDinolkan(jejak, kini);
  }
  const urut = [...barisLama].sort((a, b) => kunciTanggal(a.report.reportDate).localeCompare(kunciTanggal(b.report.reportDate)));
  const asal = bulat3(urut.reduce((t, b) => t + (bobot.get(b.id) ?? 0), 0));

  const { masuk, dipotong } = hitungMasuk({
    asal,
    diminta: o.volumeDiminta,
    sasaran,
    unitAsal: unitLama,
    namaAsal: namaLama,
    ketat: o.ketat,
  });
  const bagian = bagiProporsional(
    urut.map((b) => bobot.get(b.id) ?? 0),
    masuk,
  );
  const baris: BarisPasang[] = urut.map((b, i) => {
    const t = tampungPer.get(b.reportId);
    return {
      id: b.id,
      reportId: b.reportId,
      tanggal: kunciTanggal(b.report.reportDate),
      status: b.report.status,
      volumeKini: Number(b.volumeDone),
      volumeBaru: bagian[i]!,
      tampung: t ? { id: t.id, volume: Number(t.volumeDone) } : null,
    };
  });
  return { aktif, jenis, namaLama, unitLama, sasaran, baris, asal, pindahan: masuk, dipotong };
}

/** Tulis rencana item lama saat usulannya berlaku. */
async function terapkanPasang(tx: Tx, padananId: string, r: RencanaPasang) {
  for (const b of r.baris) {
    if (b.tampung) {
      // Baris item lama menjadi 0 (kuncinya tetap); baris item tujuan menampung.
      await tx.dailyReportItem.update({
        where: { id: b.id },
        data: { padananAktifId: padananId, volumeSebelumPadanan: b.volumeKini, volumeDone: 0, valueDone: 0n },
      });
      const v = bulat3(b.tampung.volume + b.volumeBaru);
      await tx.dailyReportItem.update({
        where: { id: b.tampung.id },
        data: {
          padananAktifId: padananId,
          volumeSebelumPadanan: b.tampung.volume,
          volumeDone: v,
          valueDone: hitungNilai(v, r.sasaran.harga),
        },
      });
      continue;
    }
    const berubah = Math.abs(b.volumeBaru - b.volumeKini) > 0.0005;
    await tx.dailyReportItem.update({
      where: { id: b.id },
      data: {
        lineageKey: r.sasaran.lineageKey,
        padananAktifId: padananId,
        // Nilai baris mengikuti harga item tujuan; Lepas menghitungnya lagi dari node barisnya.
        valueDone: hitungNilai(b.volumeBaru, r.sasaran.harga),
        ...(berubah ? { volumeSebelumPadanan: b.volumeKini, volumeDone: b.volumeBaru } : {}),
      },
    });
  }
}

/* ── Rencana: catatan pekerjaan di luar RAB (DECISIONS 780) ────────────── */

/**
 * Kunci `lineageLama` usulan jenis `luar_rab`. Catatan tidak punya kunci item;
 * yang dipasangkan disimpan di `luarRabIds`.
 */
export const LINEAGE_LUAR_RAB = "luar_rab";

type RencanaLuar = {
  aktif: { id: string; revisionNo: number };
  namaLama: string;
  unitLama: string;
  sasaran: Sasaran;
  catatan: { id: string; reportId: string; tanggal: string; volume: number; createdById: string; status: string }[];
  baris: (BarisLuarRab & { adaId: string | null; status: string })[];
  asal: number;
  pindahan: number;
  dipotong: number;
};

async function rencanaLuar(
  tx: Tx,
  o: {
    locationId: string;
    luarRabIds: readonly string[];
    lineageBaru: string;
    volumeDiminta: number | null;
    ketat: boolean;
    abaikanUsulan?: string;
  },
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

  const nodeAktif = await nodeRevisi(tx, aktif.id);
  const sasaran = await bacaSasaran(tx, { locationId: o.locationId, nodeAktif, lineageBaru: o.lineageBaru, lineageLama: null });

  // Baris item tujuan yang sudah ada di laporan-laporan catatan ini.
  const reportIds = [...new Set(rows.map((r) => r.reportId))];
  const ada = await tx.dailyReportItem.findMany({
    where: { reportId: { in: reportIds }, lineageKey: o.lineageBaru },
    select: { id: true, reportId: true, basis: true, volumeDone: true, padananAktifId: true, report: { select: { reportDate: true } } },
  });
  const adaDraft = ada.filter((b) => b.basis !== "aktif");
  if (adaDraft.length > 0) {
    throw new PadananAktifError(
      `Laporan tanggal ${daftarTanggal(adaDraft.map((b) => kunciTanggal(b.report.reportDate)))} mencatat "${sasaran.name}" ` +
        `terhadap draft adendum. Baris itu mengikuti draftnya, jadi catatan tidak bisa ditambahkan ke sana.`,
    );
  }
  const adaPasangan = ada.filter((b) => b.padananAktifId);
  if (adaPasangan.length > 0) {
    throw new PadananAktifError(
      `Baris "${sasaran.name}" di laporan tanggal ${daftarTanggal(adaPasangan.map((b) => kunciTanggal(b.report.reportDate)))} ` +
        `berasal dari pemasangan lain. Lepas dulu pasangan itu, atau pilih item lain.`,
    );
  }
  const adaPer = new Map(ada.map((b) => [b.reportId, b]));

  const urut = [...rows].sort((a, b) => tgl(a).localeCompare(tgl(b)));
  const catatan = urut.map((r) => ({
    id: r.id,
    reportId: r.reportId,
    tanggal: tgl(r),
    volume: Number(r.volume),
    createdById: r.createdById,
    status: r.report.status,
  }));
  const asal = bulat3(catatan.reduce((t, c) => t + c.volume, 0));
  // Satuan catatan dalam satu kelompok sama (kelompoknya uraian + satuan); yang
  // berbeda dari item tujuan (bila ada) yang menentukan wajib-isi volumenya.
  const unitLama = urut[0]!.satuan;
  const { masuk, dipotong } = hitungMasuk({
    asal,
    diminta: o.volumeDiminta,
    sasaran,
    unitAsal: urut.find((r) => !satuanSama(r.satuan, sasaran.unit))?.satuan ?? unitLama,
    namaAsal: urut[0]!.uraian,
    ketat: o.ketat,
  });
  const baris = rencanaLuarRab(
    catatan,
    new Map([...adaPer].map(([k, b]) => [k, Number(b.volumeDone)])),
    masuk,
  );
  const statusLaporan = new Map(rows.map((x) => [x.reportId, x.report.status]));
  return {
    aktif,
    namaLama: urut[0]!.uraian,
    unitLama,
    sasaran,
    catatan,
    baris: baris.map((b) => ({ ...b, adaId: adaPer.get(b.reportId)?.id ?? null, status: statusLaporan.get(b.reportId)! })),
    asal,
    pindahan: masuk,
    dipotong,
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

function bacaVolume(v: number | null | undefined): number | null {
  if (v == null) return null;
  if (!Number.isFinite(v)) throw new PadananAktifError("Volume tidak valid.");
  return bulat3(v);
}

async function kunciLokasi(tx: Tx, locationId: string) {
  // Antre dengan pengiriman laporan di lokasi yang sama (pola luar RAB, CALC-02).
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${locationId}::text, 0))`;
}

async function ringkas(
  r: { sasaran: Sasaran; pindahan: number; asal: number; dipotong: number },
  o: { namaLama: string; unitLama: string | null; baris: number; catatan?: number; pertama: string | null; terakhir: string | null },
): Promise<RingkasanUsulan> {
  const jalur = (await jalurNodeById([r.sasaran.id])).get(r.sasaran.id)?.kode ?? r.sasaran.code;
  return {
    namaLama: o.namaLama,
    namaBaru: r.sasaran.name,
    jalurBaru: jalur,
    unit: r.sasaran.unit ?? o.unitLama,
    volume: r.pindahan,
    volumeAsal: r.asal,
    unitAsal: o.unitLama,
    dipotong: r.dipotong,
    baris: o.baris,
    ...(o.catatan != null ? { catatan: o.catatan } : {}),
    pertama: o.pertama,
    terakhir: o.terakhir,
  };
}

export async function ajukanPadananAktif(o: {
  locationId: string;
  lineageLama: string;
  lineageBaru: string;
  /** Volume yang masuk, satuan item tujuan (781). Kosong = volume asalnya (hanya bila satuannya sama). */
  volume?: number | null;
  alasan: string;
  userId: string;
}): Promise<{ id: string; ringkasan: RingkasanUsulan }> {
  const alasan = bacaAlasan(o.alasan, "pemasangannya");
  const volumeDiminta = bacaVolume(o.volume);
  return db.$transaction(
    async (tx) => {
      await kunciLokasi(tx, o.locationId);
      const r = await rencanaPasang(tx, { ...o, volumeDiminta, ketat: true });
      const ringkasan = await ringkas(r, {
        namaLama: r.namaLama,
        unitLama: r.unitLama,
        baris: r.baris.length,
        pertama: r.baris[0]?.tanggal ?? null,
        terakhir: r.baris.at(-1)?.tanggal ?? null,
      });
      const p = await tx.rabPadananAktif.create({
        data: {
          locationId: o.locationId,
          revisionId: r.aktif.id,
          lineageLama: o.lineageLama,
          lineageBaru: o.lineageBaru,
          jenis: r.jenis,
          volumeDiminta: r.pindahan,
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
        volumeDiisi: volumeDiminta,
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
  /** Volume yang masuk, satuan item tujuan (781). Kosong = volume catatannya (hanya bila satuannya sama). */
  volume?: number | null;
  alasan: string;
  userId: string;
}): Promise<{ id: string; ringkasan: RingkasanUsulan }> {
  const alasan = bacaAlasan(o.alasan, "pemasangannya");
  const volumeDiminta = bacaVolume(o.volume);
  return db.$transaction(
    async (tx) => {
      await kunciLokasi(tx, o.locationId);
      const r = await rencanaLuar(tx, { ...o, volumeDiminta, ketat: true });
      const ringkasan = await ringkas(r, {
        namaLama: r.namaLama,
        unitLama: r.unitLama,
        baris: r.baris.length,
        catatan: r.catatan.length,
        pertama: r.baris[0]?.tanggal ?? null,
        terakhir: r.baris.at(-1)?.tanggal ?? null,
      });
      const ids = [...new Set(o.luarRabIds)];
      const p = await tx.rabPadananAktif.create({
        data: {
          locationId: o.locationId,
          revisionId: r.aktif.id,
          lineageLama: LINEAGE_LUAR_RAB,
          lineageBaru: o.lineageBaru,
          jenis: "luar_rab",
          luarRabIds: ids,
          volumeDiminta: r.pindahan,
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
        volumeDiisi: volumeDiminta,
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
          volumeDiminta: true,
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
      // Sisa bisa sudah berkurang sejak diajukan: volumenya dipotong ke sisa, tidak ditolak.
      const volumeDiminta = p.volumeDiminta == null ? null : Number(p.volumeDiminta);
      const sekarang = new Date();
      const penyetuju = suara.map((s) => ({ userId: s.userId, role: s.role }));
      if (p.jenis === "luar_rab") {
        const r = await rencanaLuar(tx, {
          locationId: p.locationId,
          luarRabIds: p.luarRabIds,
          lineageBaru: p.lineageBaru,
          volumeDiminta,
          ketat: false,
          abaikanUsulan: p.id,
        });
        await terapkanLuar(tx, p.id, r, o.user.id, sekarang);
        await tx.rabPadananAktif.update({ where: { id: p.id }, data: { berlakuPada: sekarang } });
        await auditIn(tx, o.user.id, "rab.padanan_aktif_berlaku", "rab_padanan_aktif", p.id, {
          locationId: p.locationId,
          revisionNo: r.aktif.revisionNo,
          jenis: "luar_rab",
          catatan: r.catatan.map((c) => ({ id: c.id, tanggal: c.tanggal, volume: c.volume })),
          itemBaru: { lineageKey: r.sasaran.lineageKey, code: r.sasaran.code, name: r.sasaran.name, unit: r.sasaran.unit },
          volumeDiminta,
          volume: r.pindahan,
          volumeAsal: r.asal,
          unitAsal: r.unitLama,
          dipotong: r.dipotong,
          terlaporSebelum: r.sasaran.terlapor,
          volumeKontrak: r.sasaran.volume,
          baris: r.baris.map((b) => ({
            tanggal: b.tanggal,
            status: b.status,
            baru: b.adaId == null,
            dari: b.adaVolume ?? 0,
            ke: bulat3((b.adaVolume ?? 0) + b.tambah),
          })),
          penyetuju,
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
        volumeDiminta,
        ketat: false,
        abaikanUsulan: p.id,
      });
      await terapkanPasang(tx, p.id, r);
      await tx.rabPadananAktif.update({ where: { id: p.id }, data: { berlakuPada: sekarang } });
      await auditIn(tx, o.user.id, "rab.padanan_aktif_berlaku", "rab_padanan_aktif", p.id, {
        locationId: p.locationId,
        revisionNo: r.aktif.revisionNo,
        jenis: r.jenis,
        itemLama: { lineageKey: p.lineageLama, name: r.namaLama, unit: r.unitLama },
        itemBaru: { lineageKey: r.sasaran.lineageKey, code: r.sasaran.code, name: r.sasaran.name, unit: r.sasaran.unit },
        volumeDiminta,
        volume: r.pindahan,
        volumeAsal: r.asal,
        dipotong: r.dipotong,
        terlaporSebelum: r.sasaran.terlapor,
        volumeKontrak: r.sasaran.volume,
        baris: r.baris.map((b) => ({
          id: b.id,
          tanggal: b.tanggal,
          status: b.status,
          dari: b.volumeKini,
          ke: b.volumeBaru,
          ...(b.tampung ? { ditampung: { id: b.tampung.id, dari: b.tampung.volume, ke: bulat3(b.tampung.volume + b.volumeBaru) } } : {}),
        })),
        penyetuju,
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

type BarisLepas = {
  id: string;
  reportId: string;
  lineageKey: string;
  volumeDone: Prisma.Decimal;
  volumeSebelumPadanan: Prisma.Decimal | null;
  updatedAt: Date;
  rabNode: { unitPrice: Prisma.Decimal | null };
  report: { reportDate: Date };
};

/**
 * Lepas pemasangan yang sudah berlaku: semua baris kembali ke angka dan kunci
 * sebelum dipasangkan. Hanya selama revisi aktifnya masih sama, dan hanya bila
 * barisnya belum diubah orang.
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
      const baris: BarisLepas[] = await tx.dailyReportItem.findMany({
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
      // Baris yang dipasangkan berkunci item tujuan; baris item lama yang
      // dinolkan karena ditampung berkunci item lama.
      const kunciSah = new Set([p.lineageBaru, p.lineageLama]);
      const diubah = baris.filter((b) => !kunciSah.has(b.lineageKey) || barisDiubahSesudah(b.updatedAt, p.berlakuPada!));
      if (diubah.length > 0) {
        throw new PadananAktifError(
          `Laporan tanggal ${daftarTanggal(diubah.map((b) => kunciTanggal(b.report.reportDate)))} sudah diubah sesudah dipasangkan. ` +
            `Melepas akan menimpa perubahan itu, jadi dibatalkan.`,
        );
      }
      if (p.jenis === "luar_rab") await lepasLuar(tx, p.luarRabIds, baris);
      else await lepasPasang(tx, p, baris);
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
      return { baris: new Set(baris.map((b) => b.reportId)).size, locationId: p.locationId, tanggalTerawal: tanggal[0] ?? null };
    },
    { timeout: 60_000, maxWait: 15_000 },
  );
  const snapshotDibangunUlang = await bangunUlang(hasil.locationId, hasil.tanggalTerawal);
  return { baris: hasil.baris, snapshotDibangunUlang };
}

/** Lepas pemasangan item lama: kunci dan angka setiap baris dikembalikan. */
async function lepasPasang(tx: Tx, p: { lineageLama: string; lineageBaru: string }, baris: readonly BarisLepas[]) {
  // Laporan tempat baris item tujuan MENAMPUNG: baris item lamanya ada (dinolkan) di sana.
  const laporanTampung = new Set(baris.filter((b) => b.lineageKey === p.lineageLama).map((b) => b.reportId));
  const pindah = baris.filter((b) => b.lineageKey === p.lineageBaru && !laporanTampung.has(b.reportId));
  // Kunci item lama bisa sudah dipakai lagi di laporan yang sama (item lama dilaporkan ulang).
  const bentrok = await tx.dailyReportItem.findMany({
    where: { lineageKey: p.lineageLama, reportId: { in: pindah.map((b) => b.reportId) } },
    select: { report: { select: { reportDate: true } } },
  });
  if (bentrok.length > 0) {
    throw new PadananAktifError(
      `Laporan tanggal ${daftarTanggal(bentrok.map((b) => kunciTanggal(b.report.reportDate)))} sudah memuat item lamanya lagi. ` +
        `Melepas akan membuat item yang sama dua kali di satu laporan.`,
    );
  }
  for (const b of baris) {
    const kembali = b.volumeSebelumPadanan == null ? Number(b.volumeDone) : Number(b.volumeSebelumPadanan);
    const dipindah = b.lineageKey === p.lineageBaru && !laporanTampung.has(b.reportId);
    await tx.dailyReportItem.update({
      where: { id: b.id },
      data: {
        ...(dipindah ? { lineageKey: p.lineageLama } : {}),
        padananAktifId: null,
        volumeSebelumPadanan: null,
        volumeDone: kembali,
        // Nilai diturunkan lagi dari node baris itu sendiri.
        valueDone: hitungNilai(kembali, Number(b.rabNode.unitPrice ?? 0)),
      },
    });
  }
}

/**
 * Lepas pemasangan catatan di luar RAB: baris yang dibuat dari catatan
 * dihapus, baris yang ditambah kembali ke angka sebelumnya; catatan kembali
 * menunggu dan fotonya kembali ke catatan.
 */
async function lepasLuar(tx: Tx, luarRabIds: readonly string[], baris: readonly BarisLepas[]) {
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
 * Isi menu "Pasangkan realisasi": SEMUA item pekerjaan RAB aktif sebagai
 * tujuan (781), item lama yang belum dipasangkan, catatan di luar RAB yang
 * menunggu, dan semua usulan (menunggu, berlaku, ditutup, dilepas).
 */
export async function dataPadananAktif(locationId: string): Promise<{
  aktif: { id: string; revisionNo: number } | null;
  calon: CalonAktif[];
  belum: ItemBelumAktif[];
  luarRab: KelompokLuarRab[];
  usulan: UsulanPadanan[];
}> {
  const aktif = await revisiAktif(db, locationId);
  const usulan = await daftarUsulan(locationId, aktif?.id ?? null);
  if (!aktif) return { aktif: null, calon: [], belum: [], luarRab: [], usulan };

  const hidup = new Set(usulan.filter((u) => u.keadaan === "diajukan" || u.keadaan === "berlaku").map((u) => u.lineageLama));
  const nodeAktif = await nodeRevisi(db, aktif.id);
  const beranak = new Set(nodeAktif.map((n) => n.parentId).filter((x): x is string => !!x));
  const draft = await db.rabRevision.findFirst({ where: { locationId, status: "draft" }, select: { id: true } });
  const lineageDraft = draft
    ? new Set((await db.rabNode.findMany({ where: { revisionId: draft.id }, select: { lineageKey: true } })).map((n) => n.lineageKey))
    : null;

  // Tujuan: SEMUA item pekerjaan RAB aktif tanpa rincian (781).
  const calonNode = nodeAktif.filter((n) => (n.kind === "item" || n.kind === "grup") && !beranak.has(n.id));
  const terlaporRows = calonNode.length
    ? await db.dailyReportItem.groupBy({
        by: ["lineageKey"],
        where: { lineageKey: { in: calonNode.map((n) => n.lineageKey) }, basis: "aktif", report: { locationId } },
        _sum: { volumeDone: true },
      })
    : [];
  const terlapor = new Map(terlaporRows.map((r) => [r.lineageKey, Number(r._sum.volumeDone ?? 0)]));
  const jalurCalon = await jalurNodeById(calonNode.map((n) => n.id));
  const calon: CalonAktif[] = calonNode.map((n) => ({
    lineageKey: n.lineageKey,
    code: n.code,
    name: n.name,
    unit: n.unit,
    satuanKunci: kunciSatuan(n.unit),
    jalur: jalurCalon.get(n.id)?.kode ?? n.code,
    akar: akarLineage(n.lineageKey),
    volume: Number(n.volume ?? 0),
    sisa: bulat3(Math.max(0, Number(n.volume ?? 0) - (terlapor.get(n.lineageKey) ?? 0))),
  }));
  // Saran: pencocok nama yang sama dengan padanan draft (738). Item yang sisanya
  // 0 tidak disarankan – tetap bisa dipilih.
  const kandidat: KandidatDraft[] = calonNode
    .map((n, i) => ({ n, c: calon[i]! }))
    .filter(({ c }) => c.sisa > 0.0005)
    .map(({ n, c }) => ({
      id: n.lineageKey,
      lineageKey: n.lineageKey,
      kode: n.code,
      nama: n.name,
      jalur: (jalurCalon.get(n.id)?.nama ?? "").split(" › ").filter(Boolean),
      satuan: n.unit,
      volumeDraft: c.volume,
      sisa: c.sisa,
      baru: false,
    }));
  const sarankan = (uraian: string, satuan: string | null, kecuali: string | null) => {
    const u = usulkanPadanan({ uraian, satuan: satuan ?? "" }, kecuali ? kandidat.filter((k) => k.id !== kecuali) : kandidat);
    return { saran: u.saran.map((x) => x.id), pilihan: u.kandidatId };
  };

  // Item lama jenis `hilang`: dari halaman Tidak terbobot (calculation layer kanonik).
  const tidakTerbobot = (await realisasiTidakTerbobot(locationId)).filter((i) => !hidup.has(i.lineageKey));
  // Item lama jenis `dinolkan`: masih di RAB aktif dengan volume 0, berjejak penurunan saat aktivasi.
  const nolAktif = calonNode.filter((n) => volumeNol(n.volume == null ? null : Number(n.volume)) && !hidup.has(n.lineageKey));
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

  const susun = (o: {
    lineageKey: string;
    name: string;
    unit: string | null;
    jalur: string;
    kategori: string;
    jenis: JenisPadanan;
    volume: number;
    keterangan: string;
  }): ItemBelumAktif => {
    const baris = perKunci.get(o.lineageKey) ?? [];
    const tanggal = baris.map((b) => b.report.reportDate).sort((a, b) => a.getTime() - b.getTime());
    const belumDikirim = baris.filter((b) => !terhitung.has(b.report.status));
    let terhalang: string | null = null;
    if (lineageDraft?.has(o.lineageKey)) {
      terhalang =
        "Item ini muncul lagi di draft adendum yang sedang berjalan. Realisasinya tersambung sendiri saat draft itu aktif.";
    } else if (belumDikirim.length > 0) {
      terhalang =
        `Laporan tanggal ${daftarTanggal(belumDikirim.map((b) => kunciTanggal(b.report.reportDate)))} memuat item ini ` +
        `dan belum dikirim. Kirim atau perbaiki laporan itu dulu.`;
    }
    return {
      ...o,
      jumlahLaporan: new Set(baris.map((b) => b.reportId)).size,
      pertama: tanggal[0] ?? null,
      terakhir: tanggal.at(-1) ?? null,
      ...sarankan(o.name, o.unit, o.lineageKey),
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
    }),
  );

  for (const n of nolAktif) {
    const baris = perKunci.get(n.lineageKey) ?? [];
    if (baris.length === 0) continue;
    const jejak = jejakNol.get(n.lineageKey);
    if (!jejak) continue; // tidak diturunkan saat aktivasi ini – tidak ada yang hilang
    const kini = baris.map((b) => ({ id: b.id, tanggal: kunciTanggal(b.report.reportDate), volume: Number(b.volumeDone) }));
    const bobot = bobotDinolkan(jejak, kini);
    const volume = bulat3([...bobot.values()].reduce((t, v) => t + v, 0));
    if (volume <= 0) continue;
    const kategoriNode = nodeAktif.find((x) => x.kind === "kategori" && akarLineage(n.lineageKey) === akarLineage(x.lineageKey));
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
      }),
    );
  }

  // Catatan pekerjaan di luar RAB (DECISIONS 780): yang belum dipadankan, belum
  // dibatalkan, dan tidak sedang menunggu persetujuan. Catatan usulan yang sudah
  // berlaku sudah punya baris; yang barisnya dihapus lewat koreksi laporan
  // muncul lagi di sini.
  const catatanDiUsulan = new Set(usulan.filter((u) => u.keadaan === "diajukan").flatMap((u) => u.luarRabIds));
  const luarRab = await kelompokLuarRab(locationId, catatanDiUsulan, sarankan);

  return { aktif, calon, belum, luarRab, usulan };
}

async function kelompokLuarRab(
  locationId: string,
  kecuali: ReadonlySet<string>,
  sarankan: (uraian: string, satuan: string | null, kecuali: string | null) => { saran: string[]; pilihan: string | null },
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
    hasil.push({
      kunci,
      uraian: isi[0]!.uraian,
      satuan: isi[0]!.satuan,
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
      ...sarankan(isi[0]!.uraian, isi[0]!.satuan, null),
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
      volumeAsal: g.volumeAsal ?? g.volume,
      unitAsal: g.unitAsal !== undefined ? g.unitAsal : g.unit,
      dipotong: g.dipotong ?? 0,
      // Dari ringkasan: satu laporan bisa menyentuh dua baris (baris item lama dan baris yang menampung).
      baris: g.baris,
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
