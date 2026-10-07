import "server-only";
import { db } from "@/lib/db";
import { flattenParsedRab, type FlatNode } from "@/lib/rab/flatten";
import { cocokkanItem, jalurInduk, type NodeRevisi } from "./cocok";
import { ImporPerluJawaban, parseHpsBuffer } from "@/lib/rab/hps-parser";
import { namaSheetXlsx } from "@/lib/rab/xlsx-slim";
import { ambilBerkas } from "@/lib/penyimpanan/berkas";
import { bacaRincian, gantiKunci, type RincianBerkas, type RingkasanRincian } from "./baca";
import { simpanRincian, type HasilSimpanRincian } from "./simpan";

/**
 * MELENGKAPI RINCIAN REVISI LAMA DARI BERKAS ARSIPNYA (DECISIONS baru 2026-10-06).
 *
 * Sejak 14 Juli setiap impor RAB mengarsipkan berkas aslinya UTUH (semua
 * sheet). Revisi yang dibuat sebelum rincian ada bisa dilengkapi dari berkas
 * itu tanpa unggah ulang.
 *
 * Dua langkah yang sengaja dipisah – permintaan user: lihat dulu laporannya
 * sebelum ada data yang disimpan.
 *   1. `periksaRevisi` – membaca berkas, menelusuri rincian, mencocokkan item
 *      berkas dengan item revisi. Yang ditulis hanya LAPORAN periksa.
 *   2. `lengkapiRevisi` – membaca ulang lalu menyimpan rincian.
 *
 * Pencocokan item berkas ↔ item revisi: lineage + kode + nama dulu; sisanya
 * hanya bila (kode, nama, volume, harga) – atau (nama, volume, harga) – SATU-
 * SATUNYA di kedua sisi. Yang tidak berpasangan tidak diberi rincian, dan
 * jumlahnya dilaporkan. Angka revisi tidak pernah disentuh.
 */

export type StatusPeriksa =
  | "siap"
  | "sebagian"
  | "tanpa_berkas"
  | "berkas_hilang"
  | "template_adendum"
  | "perlu_pilihan"
  | "tidak_cocok"
  | "gagal";

export type HasilPeriksa = {
  status: StatusPeriksa;
  pesan: string | null;
  itemRevisi: number;
  itemCocok: number;
  ringkasan: RingkasanRincian | null;
  tersembunyiDibaca: string[];
};

async function bacaUntukRevisi(revisionId: string): Promise<{
  hasil: HasilPeriksa;
  rincian: RincianBerkas | null;
  documentId: string | null;
}> {
  const rev = await db.rabRevision.findUniqueOrThrow({
    where: { id: revisionId },
    select: {
      sourceDocument: { select: { id: true, r2Key: true, fileName: true } },
      nodes: {
        select: {
          id: true,
          parentId: true,
          kind: true,
          lineageKey: true,
          code: true,
          name: true,
          volume: true,
          unitPrice: true,
          sortOrder: true,
        },
      },
    },
  });
  const jalurRevisi = jalurInduk(rev.nodes, (n) => n.id, (n) => n.parentId, (n) => n.name);
  const revisi: NodeRevisi[] = rev.nodes
    .filter((n) => n.kind === "item")
    .map((n) => ({
      lineageKey: n.lineageKey,
      code: n.code,
      name: n.name,
      volume: n.volume == null ? null : Number(n.volume),
      unitPrice: n.unitPrice == null ? null : Number(n.unitPrice),
      jalur: jalurRevisi.get(n.id) ?? "",
      sortOrder: n.sortOrder,
    }));
  const dasar = { itemRevisi: revisi.length, itemCocok: 0, ringkasan: null, tersembunyiDibaca: [] };
  const doc = rev.sourceDocument;
  if (!doc) {
    return {
      hasil: {
        ...dasar,
        status: "tanpa_berkas",
        pesan: "Revisi ini tidak punya berkas sumber (dibuat lewat editor adendum, atau arsipnya gagal saat impor).",
      },
      rincian: null,
      documentId: null,
    };
  }

  let buf: Buffer;
  try {
    buf = await ambilBerkas(doc.r2Key);
  } catch (e) {
    return {
      hasil: { ...dasar, status: "berkas_hilang", pesan: `Berkas "${doc.fileName}" tidak bisa diambil: ${e instanceof Error ? e.message : e}` },
      rincian: null,
      documentId: doc.id,
    };
  }

  /*
   * TEMPLATE ADENDUM MARLIN (DECISIONS baru 2026-10-07): dulu dilewati karena
   * kolomnya diisi tangan. Sekarang ditelusuri juga – template yang kolom
   * Volume Adendum-nya diberi rumus ke sheet backup tambahan punya backup;
   * yang diketik dilaporkan "angka langsung", dan item yang volumenya tidak
   * berubah mewarisi backup revisi sebelumnya.
   */
  const { ADENDUM_TEMPLATE_SHEET } = await import("@/lib/export/adendum-template-xlsx");
  let flat: FlatNode[];
  let sheetRab: string;
  let kolom: { vol: number; price: number };
  if ((await namaSheetXlsx(buf)).some((s) => s.nama === ADENDUM_TEMPLATE_SHEET)) {
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
      const { parseAdendumTemplate, KOLOM_RINCIAN_TEMPLATE } = await import("@/lib/rab/adendum-template-parse");
      flat = parseAdendumTemplate(wb).nodes;
      sheetRab = ADENDUM_TEMPLATE_SHEET;
      kolom = { ...KOLOM_RINCIAN_TEMPLATE };
    } catch (e) {
      return {
        hasil: {
          ...dasar,
          status: "gagal",
          pesan: `Template adendum "${doc.fileName}" tidak terbaca: ${e instanceof Error ? e.message : e}`,
        },
        rincian: null,
        documentId: doc.id,
      };
    }
  } else {
    let parse;
    try {
      parse = await parseHpsBuffer(buf);
    } catch (e) {
      return {
        hasil: {
          ...dasar,
          status: e instanceof ImporPerluJawaban ? "perlu_pilihan" : "gagal",
          pesan:
            e instanceof ImporPerluJawaban
              ? `Berkas "${doc.fileName}" dulu dibaca dengan sheet/kolom yang dipilih tangan, dan pilihan itu tidak tersimpan: ${e.sebab}`
              : `Berkas "${doc.fileName}" tidak terbaca: ${e instanceof Error ? e.message : e}`,
        },
        rincian: null,
        documentId: doc.id,
      };
    }
    flat = flattenParsedRab(parse.parsed);
    sheetRab = parse.sheetName;
    kolom = parse.kolom;
  }

  const peta = cocokkanItem(flat, revisi);
  const r = await bacaRincian(buf, {
    sheetRab,
    kolom,
    items: flat
      .filter((n) => n.kind === "item" && n.excelRow != null && peta.has(String(n.excelRow)))
      .map((n) => ({ kunci: String(n.excelRow), excelRow: n.excelRow!, unitPrice: n.unitPrice })),
  });
  const rincian = gantiKunci(r, peta);
  const itemCocok = rincian.items.length;
  const status: StatusPeriksa = itemCocok === 0 ? "tidak_cocok" : itemCocok < revisi.length ? "sebagian" : "siap";
  return {
    hasil: {
      status,
      pesan:
        status === "tidak_cocok"
          ? `Tidak satu pun item di berkas "${doc.fileName}" berpasangan dengan item revisi ini.`
          : status === "sebagian"
            ? `${revisi.length - itemCocok} item revisi tidak punya pasangan di berkas "${doc.fileName}" dan tidak akan diberi rincian.`
            : null,
      itemRevisi: revisi.length,
      itemCocok,
      ringkasan: rincian.ringkasan,
      tersembunyiDibaca: rincian.tersembunyiDibaca,
    },
    rincian,
    documentId: doc.id,
  };
}

/** Langkah 1: baca + catat laporan. Tidak menyimpan rincian. */
export async function periksaRevisi(revisionId: string, userId: string | null): Promise<HasilPeriksa> {
  let hasil: HasilPeriksa;
  try {
    hasil = (await bacaUntukRevisi(revisionId)).hasil;
  } catch (e) {
    hasil = {
      status: "gagal",
      pesan: e instanceof Error ? e.message : String(e),
      itemRevisi: 0,
      itemCocok: 0,
      ringkasan: null,
      tersembunyiDibaca: [],
    };
  }
  const data = {
    status: hasil.status,
    pesan: hasil.pesan,
    itemRevisi: hasil.itemRevisi,
    itemCocok: hasil.itemCocok,
    ringkasan: hasil.ringkasan ?? undefined,
    tersembunyiDibaca: hasil.tersembunyiDibaca,
    diperiksaOlehId: userId,
    diperiksaAt: new Date(),
  };
  await db.rabRincianPeriksa.upsert({ where: { revisionId }, create: { revisionId, ...data }, update: data });
  return hasil;
}

export class RincianTidakSiap extends Error {}

/** Langkah 2: baca ulang + simpan. Hanya untuk revisi yang SUDAH diperiksa dan bisa dilengkapi. */
export async function lengkapiRevisi(
  revisionId: string,
  userId: string,
): Promise<{ hasil: HasilPeriksa; simpan: HasilSimpanRincian }> {
  const periksa = await db.rabRincianPeriksa.findUnique({ where: { revisionId }, select: { status: true } });
  if (!periksa) throw new RincianTidakSiap("Periksa dulu berkas revisi ini sebelum menyimpan rinciannya.");
  if (periksa.status !== "siap" && periksa.status !== "sebagian") {
    throw new RincianTidakSiap("Hasil periksa revisi ini tidak bisa dilengkapi. Lihat keterangannya di tabel.");
  }
  const { hasil, rincian, documentId } = await bacaUntukRevisi(revisionId);
  if (!rincian || (hasil.status !== "siap" && hasil.status !== "sebagian")) {
    throw new RincianTidakSiap(hasil.pesan ?? "Berkas revisi ini tidak bisa dibaca lagi.");
  }
  const simpan = await simpanRincian(revisionId, rincian, { asal: "arsip", documentId, userId });
  await db.rabRincianPeriksa.update({
    where: { revisionId },
    data: {
      status: hasil.status,
      pesan: hasil.pesan,
      itemRevisi: hasil.itemRevisi,
      itemCocok: hasil.itemCocok,
      ringkasan: hasil.ringkasan ?? undefined,
      tersembunyiDibaca: hasil.tersembunyiDibaca,
      diperiksaAt: new Date(),
      diperiksaOlehId: userId,
    },
  });
  return { hasil, simpan };
}

/* ── Putaran latar: periksa / lengkapi banyak revisi ──────────────────── */

type Latar = { jenis: "periksa" | "lengkapi"; mulai: Date; selesai: number; total: number };
let latar: Latar | null = null;
let terakhir: { jenis: Latar["jenis"]; selesai: Date; diproses: number; gagal: number } | null = null;
const ANGGARAN_MS = 45 * 60_000;

export function keadaanLatarRincian() {
  return { berjalan: latar, terakhir };
}

/**
 * Jalankan di latar lalu langsung pulang – pola yang sama dengan cadangan &
 * pemindah berkas. Berurutan, satu revisi per waktu: tiap berkas KKP dibaca
 * utuh, dan beberapa sekaligus akan menekan memori kontainer.
 */
export function mulaiLatarRincian(
  jenis: Latar["jenis"],
  revisionIds: string[],
  userId: string,
): { dimulai: boolean; berjalan?: Latar } {
  if (latar) return { dimulai: false, berjalan: latar };
  if (revisionIds.length === 0) return { dimulai: false };
  const l: Latar = { jenis, mulai: new Date(), selesai: 0, total: revisionIds.length };
  latar = l;
  void (async () => {
    let gagal = 0;
    try {
      for (const id of revisionIds) {
        if (Date.now() - l.mulai.getTime() > ANGGARAN_MS) break;
        try {
          if (jenis === "periksa") await periksaRevisi(id, userId);
          else await lengkapiRevisi(id, userId);
        } catch (e) {
          gagal++;
          console.error(`[rincian-rab] ${jenis} ${id} gagal:`, e);
        }
        l.selesai++;
      }
    } finally {
      terakhir = { jenis, selesai: new Date(), diproses: l.selesai, gagal };
      latar = null;
    }
  })();
  return { dimulai: true, berjalan: l };
}
