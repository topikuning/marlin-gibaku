import "server-only";
import { db } from "@/lib/db";
import { auditIn } from "@/lib/audit";
import { formatTanggal } from "@/lib/format";
import { COUNTED_REPORT_STATUSES } from "@/lib/lifecycle";
import { valueDone as hitungNilai } from "@/lib/money";
import { jalurNodeById } from "@/lib/rab/jalur";
import { volumeNol } from "@/lib/rab/padanan-draft-aturan";
import { realisasiTidakTerbobot } from "@/lib/rab/tidak-terbobot";
import { bolehMenyetujui, nilaiPersetujuan } from "@/lib/rab/persetujuan-aturan";
import {
  barisDiubahSesudah,
  keadaanUsulan,
  periksaPasanganAktif,
  rencanaPulihNol,
  ruangVolume,
  type ItemSasaran,
  type KeadaanUsulan,
} from "@/lib/rab/padanan-aktif-aturan";
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
 * - Ditolak, bukan diakali: beda kategori/satuan, sisa volume tidak cukup,
 *   satu laporan memuat keduanya, laporan item lama yang belum dikirim, item
 *   lama yang muncul lagi di draft, revisi aktif yang sudah berganti.
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

export type JenisPadanan = "hilang" | "dinolkan";

export type CalonAktif = {
  lineageKey: string;
  code: string;
  name: string;
  unit: string | null;
  jalur: string;
  volume: number;
  /** Sisa volume item ini (volume − semua laporan basis aktif). */
  sisa: number;
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
  /** Calon yang sah tetapi sisa volumenya tidak cukup – disebut jumlahnya. */
  calonSisaKurang: number;
  /** Sebab item ini belum bisa diusulkan sekarang (laporan belum dikirim, sudah diusulkan, …). */
  terhalang: string | null;
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
  baris: number;
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
  volume: number;
  baris: number;
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
  pindahan: number;
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
  const pindahan = bulat3(baris.reduce((t, b) => t + b.volumeBaru, 0));
  if (pindahan <= 0) throw new PadananAktifError(`Tidak ada volume "${namaLama}" yang bisa dipindahkan.`);

  // Realisasi tidak boleh melebihi volume kontrak item tujuan.
  const terlapor = bulat3(barisSasaran.filter((b) => b.basis === "aktif").reduce((t, b) => t + Number(b.volumeDone), 0));
  const volume = Number(sasaranNode.volume);
  const ruang = ruangVolume({ volume, terlapor, pindahan });
  if (!ruang.cukup) {
    const u = sasaranNode.unit ? ` ${sasaranNode.unit}` : "";
    const f = (v: number) => new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 }).format(v);
    throw new PadananAktifError(
      `Sisa volume "${sasaranNode.name}" tidak cukup: volumenya ${f(volume)}${u}, sudah dilaporkan ${f(terlapor)}${u}, ` +
        `pindahan ${f(pindahan)}${u}, lebih ${f(ruang.kelebihan)}${u}.`,
    );
  }

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
    terlapor,
  };
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

/* ── Menyetujui (dan berlaku saat lengkap) ─────────────────────────────── */

export type HasilSetuju =
  | { berlaku: false; kurang: string[] }
  | { berlaku: true; baris: number; volume: number; jenis: JenisPadanan; snapshotDibangunUlang: number };

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
        terlaporSebelum: r.terlapor,
        volumeKontrak: r.sasaran.volume,
        baris: r.baris.map((b) => ({ id: b.id, tanggal: b.tanggal, status: b.status, dari: b.volumeKini, ke: b.volumeBaru })),
        penyetuju: suara.map((s) => ({ userId: s.userId, role: s.role })),
      });
      return {
        berlaku: true as const,
        baris: r.baris.length,
        volume: r.pindahan,
        jenis: r.jenis,
        locationId: p.locationId,
        tanggalTerawal: r.baris[0]?.tanggal ?? null,
      };
    },
    { timeout: 60_000, maxWait: 15_000 },
  );
  if (!hasil.berlaku) return hasil;
  const snapshotDibangunUlang = await bangunUlang(hasil.locationId, hasil.tanggalTerawal);
  return { berlaku: true, baris: hasil.baris, volume: hasil.volume, jenis: hasil.jenis, snapshotDibangunUlang };
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
      await tx.rabPadananAktif.update({
        where: { id: p.id },
        data: { dilepasPada: new Date(), dilepasOlehId: o.userId, alasanLepas: alasan },
      });
      await auditIn(tx, o.userId, "rab.padanan_aktif_lepas", "rab_padanan_aktif", p.id, {
        locationId: p.locationId,
        lineageLama: p.lineageLama,
        lineageBaru: p.lineageBaru,
        alasan,
        baris: baris.map((b) => ({
          id: b.id,
          tanggal: kunciTanggal(b.report.reportDate),
          dari: Number(b.volumeDone),
          ke: b.volumeSebelumPadanan == null ? Number(b.volumeDone) : Number(b.volumeSebelumPadanan),
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
  usulan: UsulanPadanan[];
}> {
  const aktif = await revisiAktif(db, locationId);
  const usulan = await daftarUsulan(locationId, aktif?.id ?? null);
  if (!aktif) return { aktif: null, belum: [], usulan };

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
      const r = ruangVolume({ volume: Number(n.volume), terlapor: terlapor.get(n.lineageKey) ?? 0, pindahan: o.volume });
      if (!r.cukup) {
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
        sisa: r.sisa,
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

  return { aktif, belum, usulan };
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
      baris: keadaan === "berlaku" ? r._count.baris : g.baris,
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
