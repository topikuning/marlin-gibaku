import "server-only";
import { db } from "@/lib/db";
import { COUNTED_REPORT_STATUSES } from "@/lib/progress";
import type { DailyReportStatus } from "@/generated/prisma/enums";

/**
 * RIWAYAT INPUT PER ITEM PEKERJAAN — "pekerjaan ini diinput kapan saja?"
 *
 * **Permintaan user 2026-09-21**, saat pratinjau impor adendum melaporkan
 * *"7 item volumenya turun DI BAWAH yang sudah dikerjakan"*:
 *
 *   *"untuk kasus seperti ini, bagaimana user tau kapan pekerjaan itu diinput?
 *   akan konyol kalau harus cek hari per hari. kamu seharusnya ada fitur cari
 *   item pekerjaan diinputnya kapan saja"*
 *
 * Angka "sudah dikerjakan 51,6" itu hasil penjumlahan lintas laporan harian,
 * dan sampai sekarang satu-satunya cara melacaknya adalah membuka laporan hari
 * per hari sampai ketemu. Pada kontrak 150 hari itu bukan pemeriksaan.
 *
 * ### Dua tanggal, dan keduanya dibutuhkan
 *
 * - `tanggal`     — TANGGAL KERJA (`reportDate`, kolom `@db.Date`).
 * - `diinputPada` — kapan barisnya benar-benar diketik (`createdAt`).
 *
 * Menyamakan keduanya menyembunyikan justru kasus yang paling perlu dilihat:
 * baris bertanggal minggu lalu yang baru diketik hari ini, tepat sebelum
 * adendum diajukan. User menanyakan "diinput kapan" dengan kata-katanya
 * sendiri — jadi yang dijawab harus tanggal INPUT, bukan hanya tanggal kerja.
 *
 * ### Saringan status & basis
 *
 * Sama persis dengan `cumulativeVolumeByLineage`: hanya laporan ber-status
 * terhitung. Kalau saringannya berbeda, layar ini akan menampilkan jejak yang
 * jumlahnya TIDAK sama dengan angka yang bikin orang datang ke sini — dan
 * riwayat yang tidak menjumlah ke angka yang dipersoalkan justru menambah
 * kebingungan, bukan menghapusnya.
 *
 * `basis` TIDAK disaring: baris `draft_adendum` ikut tampil dengan penandanya,
 * karena "kenapa angkanya begitu" kerap terjawab justru oleh baris yang tidak
 * masuk hitungan resmi. Totalnya tetap dihitung dari basis `aktif` saja.
 */

export type BarisInput = {
  reportId: string;
  /** Tanggal KERJA. */
  tanggal: Date;
  /** Kapan barisnya diketik — beda dari tanggal kerja, dan itu intinya. */
  diinputPada: Date;
  status: DailyReportStatus;
  volume: number;
  nilai: bigint;
  basis: string;
  pelapor: string | null;
  catatan: string | null;
};

export type RiwayatItem = {
  lineageKey: string;
  code: string;
  name: string;
  /** Kode item BESERTA induknya, mis. `"II · 2.b"` (keluhan user 2026-09-05). */
  jalur: string;
  unit: string | null;
  volumeKontrak: number | null;
  /** Σ volume basis `aktif` — angka yang sama dengan yang dipakai pratinjau. */
  total: number;
  input: BarisInput[];
};

/** Satu entri hasil pencarian item. */
export type RingkasItemBerealisasi = {
  lineageKey: string;
  code: string;
  name: string;
  jalur: string;
  unit: string | null;
  total: number;
  jumlahInput: number;
  /** Tanggal KERJA terakhir yang tercatat untuk item ini. */
  terakhir: Date | null;
};

/** Rantai kode induk → `"II · 2.b"`. Tanpa ini "2.b" tidak menunjuk apa pun. */
async function jalurKode(revisionId: string, node: { parentId: string | null; code: string }): Promise<string> {
  const simpul = await db.rabNode.findMany({
    where: { revisionId },
    select: { id: true, parentId: true, code: true },
  });
  const byId = new Map(simpul.map((s) => [s.id, s]));
  const bagian: string[] = [];
  let kini = node.parentId ? byId.get(node.parentId) : undefined;
  let pagar = 0;
  while (kini && pagar++ < 20) {
    const kode = bersih(kini.code);
    if (kode) bagian.unshift(kode);
    kini = kini.parentId ? byId.get(kini.parentId) : undefined;
  }
  bagian.push(bersih(node.code));
  return bagian.filter(Boolean).join(" · ");
}

/** Sufiks dedup internal (`VI#2`) artefak teknis — dilarang tampil ke user. */
const bersih = (code: string) => code.replace(/(?:#\d+)+$/, "").trim();

export async function riwayatInputItem(locationId: string, lineageKey: string): Promise<RiwayatItem | null> {
  const revisi = await db.rabRevision.findFirst({
    where: { locationId, status: "aktif" },
    select: { id: true },
  });

  /*
   * Identitas item dicari di RAB AKTIF dulu. Kalau tidak ada di sana — item
   * yang sudah dihapus lewat adendum, padahal realisasinya ada — jejaknya
   * TETAP dilaporkan, memakai nama yang tercatat di laporan hariannya. Itu
   * justru kasus yang paling perlu dilihat: pekerjaan yang sudah dikerjakan
   * lalu hilang dari kontrak.
   */
  const node = revisi
    ? await db.rabNode.findFirst({
        where: { revisionId: revisi.id, lineageKey },
        select: { parentId: true, code: true, name: true, unit: true, volume: true },
      })
    : null;

  const baris = await db.dailyReportItem.findMany({
    where: {
      lineageKey,
      report: { locationId, status: { in: [...COUNTED_REPORT_STATUSES] } },
    },
    select: {
      reportId: true,
      volumeDone: true,
      valueDone: true,
      basis: true,
      notes: true,
      createdAt: true,
      reportedById: true,
      rabNode: { select: { code: true, name: true, unit: true } },
      /* `DailyReport` menyimpan id pelapor tanpa relasi ke `User`, jadi namanya
         diambil terpisah di bawah — bukan lewat `include` yang tidak ada. */
      report: { select: { reportDate: true, status: true, submittedById: true, createdById: true } },
    },
    // Terbaru dulu: yang dicari orang hampir selalu input terakhir.
    orderBy: [{ report: { reportDate: "desc" } }, { createdAt: "desc" }],
  });

  if (!node && baris.length === 0) return null;

  /*
   * Nama pelapor: `DailyReportItem.reportedById` DULU — itu yang mengetik baris
   * ini — baru pengirim/pembuat laporannya. Satu laporan harian bisa diisi
   * beberapa orang, jadi memakai pengirim laporan untuk semua barisnya akan
   * menyebut nama yang salah pada baris yang bukan miliknya.
   */
  const idPelapor = new Set<string>();
  for (const b of baris) {
    for (const id of [b.reportedById, b.report.submittedById, b.report.createdById]) {
      if (id) idPelapor.add(id);
    }
  }
  const namaPelapor = new Map(
    (await db.user.findMany({ where: { id: { in: [...idPelapor] } }, select: { id: true, fullName: true } }))
      .map((u) => [u.id, u.fullName]),
  );
  const nama = (id: string | null) => (id ? (namaPelapor.get(id) ?? null) : null);

  const input: BarisInput[] = baris.map((b) => ({
    reportId: b.reportId,
    tanggal: b.report.reportDate,
    diinputPada: b.createdAt,
    status: b.report.status,
    volume: Number(b.volumeDone),
    nilai: b.valueDone,
    basis: b.basis,
    pelapor: nama(b.reportedById) ?? nama(b.report.submittedById) ?? nama(b.report.createdById),
    catatan: b.notes,
  }));

  const total = input
    .filter((b) => b.basis === "aktif")
    .reduce((t, b) => t + b.volume, 0);

  const dariLaporan = baris[0]?.rabNode;
  return {
    lineageKey,
    code: bersih(node?.code ?? dariLaporan?.code ?? lineageKey),
    name: node?.name ?? dariLaporan?.name ?? lineageKey,
    jalur: node && revisi ? await jalurKode(revisi.id, node) : bersih(dariLaporan?.code ?? lineageKey),
    unit: node?.unit ?? dariLaporan?.unit ?? null,
    volumeKontrak: node?.volume == null ? null : Number(node.volume),
    total,
    input,
  };
}

/**
 * Pintu masuknya: cari item menurut KODE atau NAMA.
 *
 * Tanpa kata kunci, yang keluar item yang PUNYA realisasi, urut input terbaru —
 * itu jawaban yang paling sering dicari ("apa saja yang terakhir masuk"), dan
 * daftar kosong pada layar pencarian hanya menyuruh orang menebak kata kunci.
 */
export async function cariItemBerealisasi(
  locationId: string,
  q: string,
  batas = 50,
): Promise<RingkasItemBerealisasi[]> {
  const kata = q.trim();

  const agregat = await db.dailyReportItem.groupBy({
    by: ["lineageKey"],
    where: {
      basis: "aktif",
      report: { locationId, status: { in: [...COUNTED_REPORT_STATUSES] } },
    },
    _sum: { volumeDone: true },
    _count: { _all: true },
    _max: { createdAt: true },
  });
  if (agregat.length === 0) return [];

  const revisi = await db.rabRevision.findFirst({
    where: { locationId, status: "aktif" },
    select: { id: true },
  });
  const simpul = revisi
    ? await db.rabNode.findMany({
        where: { revisionId: revisi.id },
        select: { id: true, parentId: true, lineageKey: true, code: true, name: true, unit: true },
      })
    : [];
  const byId = new Map(simpul.map((s) => [s.id, s]));
  const byKey = new Map(simpul.map((s) => [s.lineageKey, s]));

  const jalurDari = (s: (typeof simpul)[number]): string => {
    const bagian: string[] = [];
    let kini = s.parentId ? byId.get(s.parentId) : undefined;
    let pagar = 0;
    while (kini && pagar++ < 20) {
      const kode = bersih(kini.code);
      if (kode) bagian.unshift(kode);
      kini = kini.parentId ? byId.get(kini.parentId) : undefined;
    }
    bagian.push(bersih(s.code));
    return bagian.filter(Boolean).join(" · ");
  };

  /*
   * Tanggal KERJA terakhir per item.
   *
   * `_max.createdAt` pada agregat di atas menjawab pertanyaan LAIN (kapan
   * barisnya diketik). Keduanya memang tidak sama, dan yang dipakai mengurutkan
   * daftar ini adalah tanggal kerja — itu yang dicari orang saat melacak
   * "pekerjaan ini terakhir dilaporkan kapan".
   */
  const tanggalKerja = new Map<string, Date>();
  for (const b of await db.dailyReportItem.findMany({
    where: {
      basis: "aktif",
      report: { locationId, status: { in: [...COUNTED_REPORT_STATUSES] } },
    },
    select: { lineageKey: true, report: { select: { reportDate: true } } },
  })) {
    const ada = tanggalKerja.get(b.lineageKey);
    if (!ada || b.report.reportDate > ada) tanggalKerja.set(b.lineageKey, b.report.reportDate);
  }

  const cocok = kata.toLowerCase();
  const hasil: RingkasItemBerealisasi[] = [];
  for (const a of agregat) {
    const s = byKey.get(a.lineageKey);
    const code = bersih(s?.code ?? a.lineageKey);
    const name = s?.name ?? a.lineageKey;
    if (cocok && !`${code} ${name}`.toLowerCase().includes(cocok)) continue;
    hasil.push({
      lineageKey: a.lineageKey,
      code,
      name,
      jalur: s ? jalurDari(s) : code,
      unit: s?.unit ?? null,
      total: Number(a._sum.volumeDone ?? 0),
      jumlahInput: a._count._all,
      terakhir: tanggalKerja.get(a.lineageKey) ?? null,
    });
  }

  hasil.sort((x, y) => (y.terakhir?.getTime() ?? 0) - (x.terakhir?.getTime() ?? 0));
  return hasil.slice(0, batas);
}
