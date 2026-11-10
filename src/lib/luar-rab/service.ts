import "server-only";
import { db } from "@/lib/db";
import { audit, auditIn } from "@/lib/audit";
import { valueDone as hitungNilai } from "@/lib/money";
import { jakartaDateKey } from "@/lib/format";
import type { Prisma } from "@/generated/prisma/client";
import { EDITABLE_STATUSES, VOLUME_EPSILON } from "@/lib/daily-report/constants";
import {
  kunciBaris,
  rencanaGabung,
  statusPadanan,
  usulkanPadanan,
  type BarisAda,
  type CatatanPadan,
  type KandidatDraft,
  type PilihanPadan,
  type StatusPadan,
  type UsulanCatatan,
} from "./padanan";

/**
 * PEKERJAAN DI LUAR RAB (DECISIONS 738).
 *
 * Ketetapan user 2026-11-04: pekerjaan yang sudah dikerjakan tetapi itemnya
 * belum ada di RAB maupun draft adendum dicatat pelaksana di laporan harian –
 * uraian, satuan, volume, foto wajib, tanpa harga. Catatan bukan angka resmi:
 * tidak masuk progres, kurva-S, termin, maupun blanko KKP.
 *
 * Site Manager memadankannya ke item draft adendum. Padanan menulis baris
 * laporan ber-`basis = "draft_adendum"` pada TANGGAL ASLINYA, juga bila
 * laporannya sudah final: baris draft memang tidak menyentuh angka resmi
 * (DECISIONS 210) dan tidak dicetak di blanko (DECISIONS 215), jadi laporan
 * yang sudah ditandatangani tetap berbunyi sama. Begitu adendumnya diaktifkan,
 * baris itu naik menjadi resmi bersama baris draft lainnya.
 *
 * Otorisasi (requireCapability / requireLocationAccess) di lapisan aksi; file
 * ini menerima userId eksplisit supaya bisa diuji langsung.
 */

export class LuarRabError extends Error {}

export const MAKS_URAIAN = 300;
export const MAKS_CATATAN = 500;
export const MAKS_ALASAN = 500;

export type StatusCatatan = "tercatat" | "dipadankan" | "dibatalkan";

export function statusCatatan(c: { dibatalkanAt: Date | null; reportItemId: string | null }): StatusCatatan {
  if (c.dibatalkanAt) return "dibatalkan";
  return c.reportItemId ? "dipadankan" : "tercatat";
}

export type IsiCatatan = { uraian: string; satuan: string; volume: number; catatan?: string | null };

function rapikanIsi(isi: IsiCatatan): { uraian: string; satuan: string; volume: number; catatan: string | null } {
  const uraian = isi.uraian.replace(/\s+/g, " ").trim();
  const satuan = isi.satuan.replace(/\s+/g, " ").trim();
  if (uraian.length < 3) throw new LuarRabError("Tulis uraian pekerjaannya – minimal 3 huruf.");
  if (uraian.length > MAKS_URAIAN) throw new LuarRabError(`Uraian terlalu panjang – maksimal ${MAKS_URAIAN} huruf.`);
  if (!satuan) throw new LuarRabError("Isi satuannya (mis. m3, m2, m', bh).");
  if (satuan.length > 20) throw new LuarRabError("Satuan terlalu panjang.");
  if (!Number.isFinite(isi.volume) || isi.volume <= 0) throw new LuarRabError("Volume harus lebih dari 0.");
  const catatan = isi.catatan?.trim() || null;
  if (catatan && catatan.length > MAKS_CATATAN) throw new LuarRabError(`Catatan terlalu panjang – maksimal ${MAKS_CATATAN} huruf.`);
  // Presisi kolom Decimal(15,3), sama dengan baris laporan.
  return { uraian, satuan, volume: Math.round(isi.volume * 1000) / 1000, catatan };
}

const PESAN_NIHIL =
  "Hari ini sudah dinyatakan tidak ada kegiatan – batalkan pernyataannya dulu sebelum mencatat pekerjaan.";

async function laporanBisaDiisi(reportId: string) {
  const r = await db.dailyReport.findUnique({
    where: { id: reportId },
    select: { id: true, locationId: true, status: true, noActivity: true, reportDate: true },
  });
  if (!r) throw new LuarRabError("Laporan tidak ditemukan.");
  if (!EDITABLE_STATUSES.includes(r.status)) {
    throw new LuarRabError("Catatan hanya bisa diubah saat laporan berstatus Draft atau Perlu Koreksi.");
  }
  if (r.noActivity) throw new LuarRabError(PESAN_NIHIL);
  return r;
}

/* ── Sisi pelaksana: catat, ubah, hapus (selama laporan masih bisa diisi) ── */

export async function catatLuarRab(reportId: string, isi: IsiCatatan, userId: string) {
  const r = await laporanBisaDiisi(reportId);
  const d = rapikanIsi(isi);
  const c = await db.pekerjaanLuarRab.create({
    data: { locationId: r.locationId, reportId: r.id, ...d, createdById: userId },
  });
  await audit(userId, "luar_rab.catat", "pekerjaan_luar_rab", c.id, { reportId, ...d });
  return c;
}

async function catatanMilikLaporan(id: string, reportId: string) {
  const c = await db.pekerjaanLuarRab.findUnique({ where: { id } });
  if (!c || c.reportId !== reportId) throw new LuarRabError("Catatan tidak ditemukan di laporan ini.");
  return c;
}

export async function ubahLuarRab(reportId: string, id: string, isi: IsiCatatan, userId: string) {
  await laporanBisaDiisi(reportId);
  const c = await catatanMilikLaporan(id, reportId);
  if (statusCatatan(c) !== "tercatat") {
    throw new LuarRabError("Catatan yang sudah dipadankan atau dibatalkan tidak bisa diubah.");
  }
  const d = rapikanIsi(isi);
  const baru = await db.pekerjaanLuarRab.update({ where: { id }, data: d });
  await audit(userId, "luar_rab.ubah", "pekerjaan_luar_rab", id, {
    reportId,
    sebelum: { uraian: c.uraian, satuan: c.satuan, volume: Number(c.volume), catatan: c.catatan },
    sesudah: d,
  });
  return baru;
}

/**
 * Hapus SUNGGUHAN – hanya selama laporannya masih bisa diisi. Sesudah dikirim,
 * catatan sudah dibaca orang lain dan hanya bisa DIBATALKAN dengan alasan.
 * Fotonya tidak ikut hilang: tetap menempel di laporan sebagai foto tanpa
 * pekerjaan, sama seperti item laporan yang dihapus.
 */
export async function hapusLuarRab(reportId: string, id: string, userId: string) {
  // Catatan tanpa foto (unggahan gagal) dibersihkan sistem sendiri, termasuk
  // pada laporan yang barusan dinyatakan nihil – lihat `buangCatatanGagal`.
  await laporanBisaDiisi(reportId);
  const c = await catatanMilikLaporan(id, reportId);
  if (statusCatatan(c) === "dipadankan") {
    throw new LuarRabError("Catatan ini sudah dipadankan ke draft adendum – minta Site Manager melepas padanannya dulu.");
  }
  await db.$transaction(async (tx) => {
    await tx.photo.updateMany({ where: { luarRabId: id }, data: { luarRabId: null } });
    await tx.pekerjaanLuarRab.delete({ where: { id } });
  });
  await audit(userId, "luar_rab.hapus", "pekerjaan_luar_rab", id, {
    reportId,
    uraian: c.uraian,
    satuan: c.satuan,
    volume: Number(c.volume),
  });
}

/**
 * Catatan yang baru dibuat tetapi tidak satu pun fotonya tersimpan dibuang lagi:
 * foto WAJIB, dan catatan tanpa bukti tidak boleh tertinggal diam-diam.
 */
export async function buangCatatanGagal(id: string, userId: string) {
  const ada = await db.photo.count({ where: { luarRabId: id } });
  if (ada > 0) return false;
  await db.pekerjaanLuarRab.deleteMany({ where: { id, reportItemId: null } });
  await audit(userId, "luar_rab.batal_tanpa_foto", "pekerjaan_luar_rab", id, {});
  return true;
}

/* ── Sisi Site Manager: batalkan, aktifkan lagi ────────────────────────── */

export async function batalkanLuarRab(id: string, alasan: string, userId: string) {
  const teks = alasan.trim();
  if (teks.length < 5) throw new LuarRabError("Tulis alasan pembatalannya – minimal 5 huruf.");
  if (teks.length > MAKS_ALASAN) throw new LuarRabError(`Alasan terlalu panjang – maksimal ${MAKS_ALASAN} huruf.`);
  const c = await db.pekerjaanLuarRab.findUnique({ where: { id } });
  if (!c) throw new LuarRabError("Catatan tidak ditemukan.");
  const st = statusCatatan(c);
  if (st === "dipadankan") throw new LuarRabError("Catatan yang sudah dipadankan tidak bisa dibatalkan – lepas padanannya dulu.");
  if (st === "dibatalkan") throw new LuarRabError("Catatan ini sudah dibatalkan.");
  const baru = await db.pekerjaanLuarRab.update({
    where: { id },
    data: { dibatalkanAt: new Date(), dibatalkanById: userId, alasanBatal: teks },
  });
  await audit(userId, "luar_rab.batalkan", "pekerjaan_luar_rab", id, { locationId: c.locationId, alasan: teks });
  return baru;
}

export async function aktifkanLagiLuarRab(id: string, userId: string) {
  const c = await db.pekerjaanLuarRab.findUnique({ where: { id } });
  if (!c) throw new LuarRabError("Catatan tidak ditemukan.");
  if (statusCatatan(c) !== "dibatalkan") throw new LuarRabError("Catatan ini tidak dalam keadaan dibatalkan.");
  const baru = await db.pekerjaanLuarRab.update({
    where: { id },
    data: { dibatalkanAt: null, dibatalkanById: null, alasanBatal: null },
  });
  await audit(userId, "luar_rab.aktifkan_lagi", "pekerjaan_luar_rab", id, {
    locationId: c.locationId,
    alasanSebelumnya: c.alasanBatal,
  });
  return baru;
}

/* ── Padanan ke draft adendum ───────────────────────────────────────────── */

type Tx = Prisma.TransactionClient | typeof db;

async function draftLokasi(tx: Tx, locationId: string) {
  return tx.rabRevision.findFirst({
    where: { locationId, status: "draft" },
    select: { id: true, revisionNo: true },
    orderBy: { revisionNo: "desc" },
  });
}

/** Item draft adendum + sisa volumenya. */
async function kandidatDraft(tx: Tx, locationId: string, revisionId: string): Promise<KandidatDraft[]> {
  const [nodes, aktif, terpakai] = await Promise.all([
    tx.rabNode.findMany({
      where: { revisionId },
      select: { id: true, parentId: true, kind: true, code: true, name: true, unit: true, volume: true, lineageKey: true },
      orderBy: [{ sortOrder: "asc" }, { lineageKey: "asc" }],
    }),
    tx.rabNode.findMany({
      where: { kind: "item", revision: { locationId, status: "aktif" } },
      select: { lineageKey: true },
    }),
    // SEMUA status dan kedua basis – lihat `KandidatDraft.sisa`.
    tx.dailyReportItem.groupBy({
      by: ["lineageKey"],
      where: { report: { locationId } },
      _sum: { volumeDone: true },
    }),
  ]);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const lineageAktif = new Set(aktif.map((a) => a.lineageKey));
  const pakai = new Map(terpakai.map((t) => [t.lineageKey, Number(t._sum.volumeDone ?? 0)]));
  const jalur = (id: string | null): string[] => {
    const hasil: string[] = [];
    for (let n = id ? byId.get(id) : undefined; n; n = n.parentId ? byId.get(n.parentId) : undefined) hasil.unshift(n.name);
    return hasil;
  };
  return nodes
    .filter((n) => n.kind === "item")
    .map((n) => {
      const volumeDraft = n.volume != null ? Number(n.volume) : null;
      return {
        id: n.id,
        lineageKey: n.lineageKey,
        kode: n.code ?? "",
        nama: n.name,
        jalur: jalur(n.parentId),
        satuan: n.unit,
        volumeDraft,
        sisa: volumeDraft != null ? Math.round((volumeDraft - (pakai.get(n.lineageKey) ?? 0)) * 1000) / 1000 : null,
        baru: !lineageAktif.has(n.lineageKey),
      };
    });
}

/**
 * Baris laporan yang sudah ada pada (laporan, lineage) yang dituju catatan,
 * berikut apakah isinya seluruhnya dari catatan di luar RAB.
 */
async function barisYangAda(tx: Tx, reportIds: string[]): Promise<Map<string, BarisAda & { id: string; basis: string }>> {
  if (reportIds.length === 0) return new Map();
  const rows = await tx.dailyReportItem.findMany({
    where: { reportId: { in: reportIds } },
    select: { id: true, reportId: true, lineageKey: true, volumeDone: true, basis: true, luarRab: { select: { volume: true } } },
  });
  return new Map(
    rows.map((r) => {
      const volume = Number(r.volumeDone);
      const jumlahCatatan = r.luarRab.reduce((t, c) => t + Number(c.volume), 0);
      return [
        kunciBaris(r.reportId, r.lineageKey),
        {
          id: r.id,
          basis: r.basis,
          volume,
          // Baris yang sudah RESMI (adendumnya aktif) tidak pernah ditambah dari
          // sini, walau asalnya catatan: menambahnya berarti menggerakkan angka resmi.
          dariCatatan:
            r.basis === "draft_adendum" &&
            r.luarRab.length > 0 &&
            Math.abs(jumlahCatatan - volume) <= VOLUME_EPSILON,
        },
      ];
    }),
  );
}

export type CatatanTampil = CatatanPadan & {
  catatan: string | null;
  jumlahFoto: number;
  fotoId: string | null;
  dicatatOleh: string | null;
};

export type DataPadanan = {
  draft: { id: string; revisionNo: number } | null;
  catatan: CatatanTampil[];
  kandidat: KandidatDraft[];
  usulan: Record<string, UsulanCatatan>;
  /** Kunci `reportId|lineageKey` → baris yang sudah ada. */
  barisAda: Record<string, BarisAda>;
};

/** Catatan yang menunggu dipadankan + item draft + usulan otomatis. */
export async function dataPadanan(locationId: string): Promise<DataPadanan> {
  const [draft, rows] = await Promise.all([
    draftLokasi(db, locationId),
    db.pekerjaanLuarRab.findMany({
      where: { locationId, dibatalkanAt: null, reportItemId: null },
      select: {
        id: true,
        reportId: true,
        uraian: true,
        satuan: true,
        volume: true,
        catatan: true,
        createdById: true,
        report: { select: { reportDate: true } },
        photos: { select: { id: true }, orderBy: { createdAt: "asc" } },
      },
      orderBy: [{ report: { reportDate: "asc" } }, { createdAt: "asc" }],
    }),
  ]);
  const nama = await namaPengguna(rows.map((r) => r.createdById));
  const catatan: CatatanTampil[] = rows.map((r) => ({
    id: r.id,
    reportId: r.reportId,
    tanggal: jakartaDateKey(r.report.reportDate),
    uraian: r.uraian,
    satuan: r.satuan,
    volume: Number(r.volume),
    catatan: r.catatan,
    jumlahFoto: r.photos.length,
    fotoId: r.photos[0]?.id ?? null,
    dicatatOleh: nama.get(r.createdById) ?? null,
  }));
  if (!draft) return { draft: null, catatan, kandidat: [], usulan: {}, barisAda: {} };
  const [kandidat, ada] = await Promise.all([
    kandidatDraft(db, locationId, draft.id),
    barisYangAda(db, [...new Set(catatan.map((c) => c.reportId))]),
  ]);
  const usulan = Object.fromEntries(catatan.map((c) => [c.id, usulkanPadanan(c, kandidat)]));
  return {
    draft,
    catatan,
    kandidat,
    usulan,
    barisAda: Object.fromEntries([...ada].map(([k, v]) => [k, { volume: v.volume, dariCatatan: v.dariCatatan }])),
  };
}

async function namaPengguna(ids: string[]): Promise<Map<string, string>> {
  const unik = [...new Set(ids)];
  if (unik.length === 0) return new Map();
  const users = await db.user.findMany({ where: { id: { in: unik } }, select: { id: true, fullName: true } });
  return new Map(users.map((u) => [u.id, u.fullName]));
}

export type HasilGabung = {
  baris: number;
  catatan: number;
  /** Catatan yang tidak ikut digabung beserta sebabnya. */
  ditahan: { catatanId: string; status: StatusPadan; pesan: string | null }[];
  laporanFinal: number;
};

/**
 * Gabungkan catatan ke draft adendum. Status setiap pilihan DIHITUNG ULANG di
 * server dari keadaan basis data saat ini – yang dikirim layar hanya pilihan
 * orangnya, bukan keputusan bolehnya.
 */
export async function gabungkanLuarRab(locationId: string, pilihan: PilihanPadan[], userId: string): Promise<HasilGabung> {
  const dipilih = pilihan.filter((p) => p.kandidatId);
  if (dipilih.length === 0) throw new LuarRabError("Belum ada catatan yang dipilihkan itemnya.");

  const hasil = await db.$transaction(
    async (tx) => {
      // Antre dengan pengiriman laporan di lokasi yang sama: keduanya membaca
      // jumlah volume lalu menulis (pola `transition`, CALC-02).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${locationId}::text, 0))`;
      const draft = await draftLokasi(tx, locationId);
      if (!draft) throw new LuarRabError("Draft adendum lokasi ini tidak ada lagi. Muat ulang halaman.");

      const rows = await tx.pekerjaanLuarRab.findMany({
        where: { id: { in: dipilih.map((p) => p.catatanId) }, locationId },
        select: {
          id: true,
          reportId: true,
          uraian: true,
          satuan: true,
          volume: true,
          createdById: true,
          dibatalkanAt: true,
          reportItemId: true,
          report: { select: { reportDate: true, status: true, noActivity: true } },
        },
      });
      const terbuka = rows.filter((r) => statusCatatan(r) === "tercatat");
      const catatan: CatatanPadan[] = terbuka.map((r) => ({
        id: r.id,
        reportId: r.reportId,
        tanggal: jakartaDateKey(r.report.reportDate),
        uraian: r.uraian,
        satuan: r.satuan,
        volume: Number(r.volume),
      }));
      const kandidat = await kandidatDraft(tx, locationId, draft.id);
      const ada = await barisYangAda(tx, [...new Set(catatan.map((c) => c.reportId))]);
      const status = statusPadanan(catatan, dipilih, kandidat, ada);
      const rencana = rencanaGabung(catatan, dipilih, kandidat, status);

      const byKandidat = new Map(kandidat.map((k) => [k.id, k]));
      const nodeHarga = new Map(
        (
          await tx.rabNode.findMany({
            where: { id: { in: [...new Set(rencana.map((r) => r.kandidatId))] } },
            select: { id: true, unitPrice: true },
          })
        ).map((n) => [n.id, n.unitPrice != null ? Number(n.unitPrice) : 0]),
      );
      const infoCatatan = new Map(terbuka.map((r) => [r.id, r]));
      const laporanFinal = new Map<string, Date>();
      const sekarang = new Date();

      for (const g of rencana) {
        const k = byKandidat.get(g.kandidatId)!;
        const harga = nodeHarga.get(g.kandidatId) ?? 0;
        const lama = ada.get(kunciBaris(g.reportId, g.lineageKey));
        const pertama = infoCatatan.get(g.catatanIds[0])!;
        let rowId: string;
        if (lama) {
          // Hanya baris yang isinya seluruhnya dari catatan (status `siap`
          // sudah menjamin `dariCatatan`); volumenya bertambah sebesar catatan baru.
          const volume = Math.round((lama.volume + g.volume) * 1000) / 1000;
          await tx.dailyReportItem.update({
            where: { id: lama.id },
            data: { volumeDone: volume, valueDone: hitungNilai(volume, harga) },
          });
          rowId = lama.id;
        } else {
          const baru = await tx.dailyReportItem.create({
            data: {
              reportId: g.reportId,
              rabNodeId: k.id,
              lineageKey: k.lineageKey,
              basis: "draft_adendum",
              volumeDone: g.volume,
              valueDone: hitungNilai(g.volume, harga),
              notes: "Dari catatan pekerjaan di luar RAB",
              reportedById: pertama.createdById,
            },
          });
          rowId = baru.id;
        }
        await tx.pekerjaanLuarRab.updateMany({
          where: { id: { in: g.catatanIds }, reportItemId: null, dibatalkanAt: null },
          data: { reportItemId: rowId, dipadankanById: userId, dipadankanAt: sekarang },
        });
        // Foto bukti ikut menjadi foto baris itu; asalnya tetap tercatat di `luarRabId`.
        await tx.photo.updateMany({
          where: { luarRabId: { in: g.catatanIds }, reportItemId: null },
          data: { reportItemId: rowId },
        });
        if (pertama.report.status === "final") laporanFinal.set(g.reportId, pertama.report.reportDate);
        await auditIn(tx, userId, "luar_rab.padankan", "daily_report_item", rowId, {
          locationId,
          reportId: g.reportId,
          tanggal: jakartaDateKey(pertama.report.reportDate),
          statusLaporan: pertama.report.status,
          draftRevisionNo: draft.revisionNo,
          item: `${k.kode} ${k.nama}`.trim(),
          lineageKey: k.lineageKey,
          volumeDitambahkan: g.volume,
          catatanIds: g.catatanIds,
        });
      }

      const masuk = new Set(rencana.flatMap((r) => r.catatanIds));
      const ditahan = dipilih
        .filter((p) => !masuk.has(p.catatanId))
        .map((p) => {
          const st = status.get(p.catatanId);
          const r = rows.find((x) => x.id === p.catatanId);
          if (!r) return { catatanId: p.catatanId, status: "pilih_item" as const, pesan: "Catatan tidak ditemukan." };
          if (!st) {
            return {
              catatanId: p.catatanId,
              status: "pilih_item" as const,
              pesan: statusCatatan(r) === "dipadankan" ? "Sudah dipadankan orang lain." : "Catatan ini sudah dibatalkan.",
            };
          }
          return { catatanId: p.catatanId, status: st.status, pesan: st.pesan };
        });
      return {
        baris: rencana.length,
        catatan: masuk.size,
        ditahan,
        tanggalFinal: [...laporanFinal.values()],
      };
    },
    { timeout: 60_000, maxWait: 15_000 },
  );

  // Snapshot laporan final menyimpan JUMLAH baris draft adendum (DECISIONS 215);
  // bangun ulang supaya hitungannya ikut, walau angka resminya tidak berubah.
  await bangunUlangSnapshotTanggal(locationId, hasil.tanggalFinal);
  return { baris: hasil.baris, catatan: hasil.catatan, ditahan: hasil.ditahan, laporanFinal: hasil.tanggalFinal.length };
}

async function bangunUlangSnapshotTanggal(locationId: string, tanggal: Date[]) {
  if (tanggal.length === 0) return;
  const { bangunUlangSnapshotFinal } = await import("@/lib/daily-report/snapshot-rebuild");
  for (const t of tanggal) {
    await bangunUlangSnapshotFinal(locationId, { sejak: t, sebelum: new Date(t.getTime() + 86_400_000) });
  }
}

/**
 * Lepas padanan: baris draft yang dibuat dari catatan dikurangi (atau dihapus
 * bila tinggal catatan ini), catatannya kembali menunggu. Ditolak bila baris
 * itu sudah RESMI (adendumnya diaktifkan) atau volumenya sudah diubah orang –
 * dua keadaan di mana melepas berarti mengubah angka yang bukan milik catatan.
 */
export async function lepasPadanan(id: string, userId: string) {
  const hasil = await db.$transaction(async (tx) => {
    const c = await tx.pekerjaanLuarRab.findUnique({
      where: { id },
      select: {
        id: true,
        locationId: true,
        volume: true,
        reportItemId: true,
        dibatalkanAt: true,
        reportItem: {
          select: {
            id: true,
            basis: true,
            volumeDone: true,
            rabNodeId: true,
            report: { select: { status: true, reportDate: true } },
            rabNode: { select: { unitPrice: true, name: true } },
            luarRab: { select: { id: true, volume: true } },
          },
        },
      },
    });
    if (!c) throw new LuarRabError("Catatan tidak ditemukan.");
    const row = c.reportItem;
    if (!row) throw new LuarRabError("Catatan ini belum dipadankan.");
    if (row.basis !== "draft_adendum") {
      throw new LuarRabError("Adendumnya sudah diaktifkan – baris ini sudah angka resmi dan tidak bisa dilepas dari sini.");
    }
    const jumlahCatatan = row.luarRab.reduce((t, x) => t + Number(x.volume), 0);
    if (Math.abs(jumlahCatatan - Number(row.volumeDone)) > VOLUME_EPSILON) {
      throw new LuarRabError(
        "Volume baris laporannya sudah diubah langsung, jadi tidak lagi sama dengan catatannya. Ubah di laporan hariannya.",
      );
    }
    await tx.photo.updateMany({ where: { luarRabId: id, reportItemId: row.id }, data: { reportItemId: null } });
    await tx.pekerjaanLuarRab.update({
      where: { id },
      data: { reportItemId: null, dipadankanById: null, dipadankanAt: null },
    });
    const sisa = Math.round((Number(row.volumeDone) - Number(c.volume)) * 1000) / 1000;
    if (sisa <= VOLUME_EPSILON) {
      await tx.photo.updateMany({ where: { reportItemId: row.id }, data: { reportItemId: null } });
      await tx.dailyReportItem.delete({ where: { id: row.id } });
    } else {
      await tx.dailyReportItem.update({
        where: { id: row.id },
        data: { volumeDone: sisa, valueDone: hitungNilai(sisa, Number(row.rabNode.unitPrice ?? 0)) },
      });
    }
    await auditIn(tx, userId, "luar_rab.lepas", "pekerjaan_luar_rab", id, {
      locationId: c.locationId,
      reportItemId: row.id,
      item: row.rabNode.name,
      volume: Number(c.volume),
      barisDihapus: sisa <= VOLUME_EPSILON,
    });
    return { locationId: c.locationId, final: row.report.status === "final" ? row.report.reportDate : null };
  });
  if (hasil.final) await bangunUlangSnapshotTanggal(hasil.locationId, [hasil.final]);
}

/* ── Rekap per lokasi (bahan menyusun CCO) ─────────────────────────────── */

export type CatatanSelesai = {
  id: string;
  tanggal: string;
  uraian: string;
  satuan: string;
  volume: number;
  /** Diisi untuk catatan yang dipadankan. */
  item: string | null;
  resmi: boolean;
  /** Diisi untuk catatan yang dibatalkan. */
  alasan: string | null;
  oleh: string | null;
};

export type RekapKelompok = {
  uraian: string;
  satuan: string;
  volume: number;
  jumlahCatatan: number;
  tanggalAwal: string;
  tanggalAkhir: string;
};

/**
 * Catatan yang sudah dipadankan dan yang dibatalkan (untuk dilepas / diaktifkan
 * lagi), plus rekap catatan yang MENUNGGU dikelompokkan per uraian + satuan –
 * itu daftar yang dibawa ke penyusunan CCO.
 */
export async function rekapLuarRab(locationId: string, menunggu: readonly CatatanPadan[]) {
  const rows = await db.pekerjaanLuarRab.findMany({
    where: { locationId, OR: [{ reportItemId: { not: null } }, { dibatalkanAt: { not: null } }] },
    select: {
      id: true,
      uraian: true,
      satuan: true,
      volume: true,
      alasanBatal: true,
      dibatalkanAt: true,
      dibatalkanById: true,
      dipadankanById: true,
      report: { select: { reportDate: true } },
      reportItem: { select: { basis: true, rabNode: { select: { code: true, name: true } } } },
    },
    orderBy: [{ report: { reportDate: "desc" } }, { createdAt: "desc" }],
  });
  const nama = await namaPengguna(rows.flatMap((r) => [r.dibatalkanById, r.dipadankanById]).filter((x): x is string => !!x));
  const ubah = (r: (typeof rows)[number]): CatatanSelesai => {
    const olehId = r.dibatalkanAt ? r.dibatalkanById : r.dipadankanById;
    return {
    id: r.id,
    tanggal: jakartaDateKey(r.report.reportDate),
    uraian: r.uraian,
    satuan: r.satuan,
    volume: Number(r.volume),
    item: r.reportItem ? `${r.reportItem.rabNode.code ? `${r.reportItem.rabNode.code} ` : ""}${r.reportItem.rabNode.name}` : null,
    resmi: r.reportItem?.basis === "aktif",
    alasan: r.alasanBatal,
    oleh: olehId ? (nama.get(olehId) ?? null) : null,
    };
  };
  const dipadankan = rows.filter((r) => !r.dibatalkanAt && r.reportItem).map(ubah);
  const dibatalkan = rows.filter((r) => r.dibatalkanAt).map(ubah);

  const { token } = await import("@/lib/daily-report/impor-pelaksana/cocok");
  const { rapiSatuan } = await import("@/lib/daily-report/impor-pelaksana/baca-angka");
  const grup = new Map<string, RekapKelompok>();
  for (const c of menunggu) {
    const kunci = `${token(c.uraian).join(" ")}|${rapiSatuan(c.satuan)}`;
    const g = grup.get(kunci);
    if (g) {
      g.volume = Math.round((g.volume + c.volume) * 1000) / 1000;
      g.jumlahCatatan++;
      if (c.tanggal < g.tanggalAwal) g.tanggalAwal = c.tanggal;
      if (c.tanggal > g.tanggalAkhir) g.tanggalAkhir = c.tanggal;
    } else {
      grup.set(kunci, { uraian: c.uraian, satuan: c.satuan, volume: c.volume, jumlahCatatan: 1, tanggalAwal: c.tanggal, tanggalAkhir: c.tanggal });
    }
  }
  return { dipadankan, dibatalkan, kelompok: [...grup.values()].sort((a, b) => a.uraian.localeCompare(b.uraian, "id")) };
}

/* ── Dipakai siklus draft adendum (DECISIONS 611) ──────────────────────── */

/**
 * Dari baris laporan yang menunjuk draft, mana yang isinya SELURUHNYA dari
 * catatan di luar RAB. Baris itu tidak pernah diketik orang – yang dilaporkan
 * orang adalah catatannya – jadi saat itemnya hilang dari draft (draft dibuang,
 * atau diganti draft tanpa item itu) barisnya boleh dilepas: catatannya kembali
 * menunggu, fotonya kembali ke catatan. Tidak ada laporan lapangan yang hilang.
 */
export async function barisMurniDariCatatan(tx: Tx, itemIds: string[]): Promise<Set<string>> {
  if (itemIds.length === 0) return new Set();
  const rows = await tx.dailyReportItem.findMany({
    where: { id: { in: itemIds } },
    select: { id: true, volumeDone: true, luarRab: { select: { volume: true } } },
  });
  return new Set(
    rows
      .filter((r) => {
        if (r.luarRab.length === 0) return false;
        const jumlah = r.luarRab.reduce((t, c) => t + Number(c.volume), 0);
        return Math.abs(jumlah - Number(r.volumeDone)) <= VOLUME_EPSILON;
      })
      .map((r) => r.id),
  );
}

/** Lepas baris-baris murni-catatan sekaligus. Mengembalikan tanggal laporan final yang tersentuh. */
export async function lepasBarisDariCatatan(tx: Tx, itemIds: string[], userId: string, sebab: string): Promise<Date[]> {
  if (itemIds.length === 0) return [];
  const rows = await tx.dailyReportItem.findMany({
    where: { id: { in: itemIds } },
    select: { id: true, report: { select: { status: true, reportDate: true, locationId: true } }, luarRab: { select: { id: true } } },
  });
  await tx.photo.updateMany({ where: { reportItemId: { in: itemIds } }, data: { reportItemId: null } });
  await tx.pekerjaanLuarRab.updateMany({
    where: { reportItemId: { in: itemIds } },
    data: { reportItemId: null, dipadankanById: null, dipadankanAt: null },
  });
  await tx.dailyReportItem.deleteMany({ where: { id: { in: itemIds } } });
  for (const r of rows) {
    await auditIn(tx, userId, "luar_rab.lepas_otomatis", "daily_report_item", r.id, {
      locationId: r.report.locationId,
      sebab,
      catatanIds: r.luarRab.map((c) => c.id),
    });
  }
  return rows.filter((r) => r.report.status === "final").map((r) => r.report.reportDate);
}

const potong = (s: string, maks: number) => (s.length > maks ? `${s.slice(0, maks - 1)}…` : s);

/**
 * BARIS LAPORAN YANG ITEM DRAFT-NYA HILANG → CATATAN DI LUAR RAB (DECISIONS 755).
 *
 * Keluhan user 2026-11-10: *"itu casenya ada draft adendum, yang kemudian
 * diinput kegiatan harian, lalu di draft yang baru tidak ada, kenapa harus jadi
 * menghentikan prosesnya"*. Dulu impor pengganti draft DITOLAK di sini.
 *
 * Pekerjaannya sungguh terjadi, hanya itemnya tidak ada lagi di draft mana pun –
 * persis "pekerjaan di luar RAB" (DECISIONS 738). Jadi barisnya pindah ke catatan
 * di laporan dan tanggal yang SAMA: uraian dan satuan dari item draft lamanya,
 * volume dari laporannya, fotonya ikut. Tidak ada laporan yang hilang, dan Site
 * Manager bisa memadankannya ke item draft baru sebelum aktivasi; `asalDraftNo`
 * membuatnya ikut disebut di konfirmasi aktivasi (DECISIONS 754).
 *
 * Baris campuran (sebagian dari catatan lama, sebagian diketik langsung):
 * catatan lamanya kembali menunggu seperti `lepasBarisDariCatatan`, dan
 * hanya SELISIHNYA yang menjadi catatan baru – supaya volumenya tidak dobel.
 *
 * Mengembalikan jumlah catatan baru dan tanggal laporan final yang tersentuh
 * (snapshot-nya menghitung baris draft, DECISIONS 215).
 */
export async function jadikanCatatanDariDraft(
  tx: Tx,
  itemIds: string[],
  asal: { draftNo: number; sebab: string },
  userId: string,
): Promise<{ catatan: number; tanggalFinal: Date[] }> {
  if (itemIds.length === 0) return { catatan: 0, tanggalFinal: [] };
  const rows = await tx.dailyReportItem.findMany({
    where: { id: { in: itemIds } },
    select: {
      id: true,
      reportId: true,
      lineageKey: true,
      volumeDone: true,
      notes: true,
      reportedById: true,
      rabNode: { select: { code: true, name: true, unit: true } },
      report: { select: { locationId: true, status: true, reportDate: true } },
      luarRab: { select: { id: true, volume: true } },
    },
  });
  let dibuat = 0;
  for (const r of rows) {
    const dariCatatanLama = r.luarRab.reduce((t, c) => t + Number(c.volume), 0);
    const sisa = Math.round((Number(r.volumeDone) - dariCatatanLama) * 1000) / 1000;
    if (r.luarRab.length > 0) {
      await tx.photo.updateMany({ where: { reportItemId: r.id, luarRabId: { not: null } }, data: { reportItemId: null } });
      await tx.pekerjaanLuarRab.updateMany({
        where: { reportItemId: r.id },
        data: { reportItemId: null, dipadankanById: null, dipadankanAt: null },
      });
    }
    let catatanId: string | null = null;
    if (r.luarRab.length === 0 || sisa > VOLUME_EPSILON) {
      const nomor = r.rabNode.code?.trim() ? ` nomor ${r.rabNode.code.trim()}` : "";
      const keterangan =
        `Dulu dilaporkan sebagai item${nomor} di draft adendum #${asal.draftNo}. ` +
        `Itemnya tidak ada lagi sesudah ${asal.sebab}, jadi laporannya disimpan di sini untuk dipadankan ulang.` +
        (r.notes?.trim() ? ` Catatan laporan: ${r.notes.trim()}` : "");
      const c = await tx.pekerjaanLuarRab.create({
        data: {
          locationId: r.report.locationId,
          reportId: r.reportId,
          uraian: potong(r.rabNode.name.replace(/\s+/g, " ").trim(), MAKS_URAIAN),
          satuan: r.rabNode.unit?.trim() || "-",
          volume: r.luarRab.length === 0 ? Number(r.volumeDone) : sisa,
          catatan: potong(keterangan, MAKS_CATATAN),
          asalDraftNo: asal.draftNo,
          createdById: r.reportedById ?? userId,
        },
      });
      catatanId = c.id;
      dibuat++;
      await tx.photo.updateMany({ where: { reportItemId: r.id, luarRabId: null }, data: { luarRabId: c.id, reportItemId: null } });
    }
    // Foto yang tersisa (baris campuran tanpa selisih) tetap di laporannya.
    await tx.photo.updateMany({ where: { reportItemId: r.id }, data: { reportItemId: null } });
    await tx.dailyReportItem.delete({ where: { id: r.id } });
    await auditIn(tx, userId, "luar_rab.dari_draft", "daily_report_item", r.id, {
      locationId: r.report.locationId,
      reportId: r.reportId,
      tanggal: jakartaDateKey(r.report.reportDate),
      statusLaporan: r.report.status,
      draftNo: asal.draftNo,
      sebab: asal.sebab,
      item: `${r.rabNode.code ?? ""} ${r.rabNode.name}`.trim(),
      lineageKey: r.lineageKey,
      volume: Number(r.volumeDone),
      catatanBaruId: catatanId,
      catatanLamaKembali: r.luarRab.map((c) => c.id),
    });
  }
  return {
    catatan: dibuat,
    tanggalFinal: rows.filter((r) => r.report.status === "final").map((r) => r.report.reportDate),
  };
}

export { bangunUlangSnapshotTanggal };
