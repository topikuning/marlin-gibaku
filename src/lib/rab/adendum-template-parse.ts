import type ExcelJS from "exceljs";
import { bacaAngkaLokal } from "@/lib/rab/angka-lokal";
import type { FlatNode } from "@/lib/rab/flatten";
import {
  ADENDUM_HEADER_ROW,
  ADENDUM_TEMPLATE_MARKER,
  ADENDUM_TEMPLATE_SHEET,
} from "@/lib/export/adendum-template-xlsx";

/**
 * Baca TEMPLATE KERJA ADENDUM kembali menjadi `FlatNode[]` — bentuk yang sama
 * dengan keluaran `flattenParsedRab`, supaya seluruh mesin pratinjau impor yang
 * sudah ada (diff terhadap RAB aktif, peringatan realisasi lepas, peringatan
 * harga item lama bergeser) bekerja tanpa diubah sedikit pun. DECISIONS 216.
 *
 * Bukan `hps-parser`: template punya bentuk sendiri (kolom kontrak DAN kolom
 * adendum berdampingan) dan identitas barisnya eksplisit lewat `lineageKey`,
 * bukan ditebak dari struktur kode seperti pada HPS mentah.
 */

const EPS = 1e-6;
/** Kolom template (1-indexed) — cerminan `adendum-template-xlsx`. */
const C_KODE = 1;
const C_URAIAN = 2;
const C_VOL_KONTRAK = 3;
const C_SATUAN = 4;
const C_HARGA = 5;
const C_JUMLAH_KONTRAK = 6;
const C_VOL_ADENDUM = 7;
const C_KETERANGAN = 10;
const C_LINEAGE = 11;

export class AdendumTemplateError extends Error {}

export type HasilTemplateAdendum = {
  nodes: FlatNode[];
  /** Item kontrak yang DINYATAKAN dicabut lewat kolom Keterangan = HAPUS. */
  dihapus: { lineageKey: string; code: string; name: string }[];
  /** Item kontrak yang volumenya dijadikan 0 — TETAP ada, nilainya nol. */
  volumeNol: { lineageKey: string; code: string; name: string }[];
  /** Item baru yang disisipkan user (tanpa lineageKey). */
  itemBaru: { code: string; name: string; kategori: string }[];
};

/** Apakah workbook ini template adendum terbitan MARLIN? */
export function isAdendumTemplate(wb: ExcelJS.Workbook): boolean {
  const ws = wb.getWorksheet(ADENDUM_TEMPLATE_SHEET);
  if (!ws) return false;
  return String(ws.getCell(ADENDUM_HEADER_ROW, C_LINEAGE).value ?? "").trim() === ADENDUM_TEMPLATE_MARKER;
}

/**
 * Pembaca angka BERSAMA. Versi lama di sini membiarkan `Number("")` yang
 * bernilai **0** lolos sebagai angka sah, sehingga sel `#REF!`, rumus tanpa
 * hasil ter-cache, spasi, `"n/a"`, dan objek richText semuanya menjadi
 * **volume 0** tanpa satu pun galat - pekerjaan bernilai ratusan juta lenyap
 * diam-diam. Sel `Date` bahkan menghasilkan angka omong kosong. Audit
 * 2026-09-01.
 */
const angka = bacaAngkaLokal;

function teks(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (typeof v === "object") {
    if ("richText" in v) return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join("");
    if ("result" in v) return teks((v as { result: ExcelJS.CellValue }).result);
    if ("text" in v) return String((v as { text: string }).text);
  }
  return String(v).trim();
}

export function parseAdendumTemplate(wb: ExcelJS.Workbook): HasilTemplateAdendum {
  const ws = wb.getWorksheet(ADENDUM_TEMPLATE_SHEET);
  if (!ws) throw new AdendumTemplateError(`Sheet "${ADENDUM_TEMPLATE_SHEET}" tidak ditemukan.`);

  const nodes: FlatNode[] = [];
  const dihapus: HasilTemplateAdendum["dihapus"] = [];
  const volumeNol: HasilTemplateAdendum["volumeNol"] = [];
  const itemBaru: HasilTemplateAdendum["itemBaru"] = [];

  /** Tumpukan induk berjalan: lineageKey per kedalaman, untuk item baru. */
  let kategoriBerjalan: { lineageKey: string; name: string } | null = null;
  let indukBerjalan: string | null = null;
  /** Berapa item baru sudah disisipkan di bawah satu induk — untuk lineageKey. */
  const barisBaruPerInduk = new Map<string, number>();
  /** lineageKey → nomor baris pertama yang memakainya (deteksi baris disalin). */
  const barisPerLineage = new Map<string, number>();
  let sortOrder = 0;

  for (let r = ADENDUM_HEADER_ROW + 1; r <= ws.rowCount; r++) {
    const kode = teks(ws.getCell(r, C_KODE).value);
    const nama = teks(ws.getCell(r, C_URAIAN).value);
    if (!kode && !nama) continue;
    // Baris total di kaki tabel: tidak berkode dan bukan bagian pohon.
    if (!kode && nama.toUpperCase().startsWith("NILAI KONTRAK")) continue;

    const lineageKey = teks(ws.getCell(r, C_LINEAGE).value);
    const volKontrak = angka(ws.getCell(r, C_VOL_KONTRAK).value);
    const volAdendum = angka(ws.getCell(r, C_VOL_ADENDUM).value);
    const harga = angka(ws.getCell(r, C_HARGA).value);
    const jumlahKontrak = angka(ws.getCell(r, C_JUMLAH_KONTRAK).value);
    const keterangan = teks(ws.getCell(r, C_KETERANGAN).value).toUpperCase();
    const adaAngkaItem = volKontrak != null || volAdendum != null || harga != null;

    if (lineageKey) {
      /*
       * IDENTITAS HARUS TUNGGAL.
       *
       * Cara tercepat membuat baris item baru — dan yang paling sering dipakai
       * orang — adalah MENYALIN baris lama supaya format dan rumusnya ikut.
       * Salinan itu membawa serta lineageKey di kolom tersembunyi, jadi dua
       * baris mengaku sebagai item kontrak yang sama. Tanpa penjagaan, yang
       * belakangan menimpa yang duluan diam-diam: satu item hilang dari RAB
       * hasil adendum tanpa sepatah kata pun, dan realisasi lapangannya ikut
       * menggantung. Disebutkan sekarang, dengan nomor barisnya.
       */
      const sebelumnya = barisPerLineage.get(lineageKey);
      if (sebelumnya != null) {
        throw new AdendumTemplateError(
          `Baris ${r} ("${nama || kode}") memakai identitas item yang sama dengan baris ${sebelumnya}. ` +
            `Ini terjadi kalau baris lama DISALIN untuk membuat item baru. Hapus baris ${r}, lalu sisipkan ` +
            `baris KOSONG (klik kanan nomor baris → Insert) dan ketik isinya.`,
        );
      }
      barisPerLineage.set(lineageKey, r);

      // ── Baris kontrak yang sudah ada ──────────────────────────────────
      const depth = lineageKey.split("#").length - 1;
      // Item dikenali dari kolom KONTRAK (volume/harga), bukan dari kolom
      // isian: kalau dikenali dari kolom VOLUME ADENDUM, item yang isiannya
      // dikosongkan user akan berubah menjadi "kategori" dan seluruh anak
      // sesudahnya salah induk.
      const isItem = volKontrak != null || harga != null;

      if (!isItem) {
        // Kategori/sub/grup: nilainya diturunkan dari anak, tidak dibaca.
        const parent = depth === 0 ? null : lineageKey.slice(0, lineageKey.lastIndexOf("#"));
        nodes.push({
          kind: depth === 0 ? "kategori" : "sub",
          code: kode,
          name: nama,
          volume: null,
          unit: null,
          unitPrice: null,
          amount: 0n,
          lineageKey,
          parentLineageKey: parent,
          sortOrder: sortOrder++,
        });
        if (depth === 0) kategoriBerjalan = { lineageKey, name: nama };
        indukBerjalan = lineageKey;
        continue;
      }

      if (keterangan === "HAPUS") {
        // DINYATAKAN dicabut. Barisnya TIDAK diikutkan; diff terhadap RAB aktif
        // yang akan melaporkannya sebagai item hilang — termasuk peringatan
        // keras bila item itu sudah punya realisasi.
        dihapus.push({ lineageKey, code: kode, name: nama });
        continue;
      }

      const vol = volAdendum ?? 0;
      // Volume 0 BUKAN penghapusan (DECISIONS 216): item tetap tercantum
      // dengan nilai nol. Dicatat supaya bisa disebut di pratinjau — user perlu
      // melihat bahwa maksudnya tidak diterjemahkan jadi "dihapus".
      if (Math.abs(vol) < EPS && (volKontrak ?? 0) > EPS) {
        volumeNol.push({ lineageKey, code: kode, name: nama });
      }

      // Baris yang volumenya TIDAK disentuh memakai Jumlah Kontrak APA ADANYA
      // (angka dokumen), bukan hasil kali ulang — harga satuan dokumen sudah
      // dibulatkan 2 desimal sehingga round(vol×harga) meleset dari kontrak
      // (DECISIONS 212). Hanya baris yang volumenya berubah yang dihitung.
      const tetap = volKontrak != null && Math.abs(vol - volKontrak) < EPS;
      const amount =
        tetap && jumlahKontrak != null
          ? BigInt(Math.round(jumlahKontrak))
          : BigInt(Math.round(vol * (harga ?? 0)));

      nodes.push({
        kind: "item",
        code: kode,
        name: nama,
        volume: vol,
        unit: teks(ws.getCell(r, C_SATUAN).value) || null,
        unitPrice: harga,
        amount,
        lineageKey,
        parentLineageKey: lineageKey.slice(0, lineageKey.lastIndexOf("#")) || null,
        sortOrder: sortOrder++,
      });
      continue;
    }

    // ── Baris TANPA lineageKey = item baru yang disisipkan user ─────────
    /*
     * Baris bertulisan TAPI tanpa satu angka pun DITOLAK, tidak dilewati.
     *
     * Dulu baris begini dianggap "catatan" dan dilewati diam-diam. Padahal
     * bentuk itu jauh lebih sering berarti item baru yang belum selesai diketik
     * — orang mengisi Uraian, tertunda, lalu mengirim berkasnya. Melewatinya
     * berarti pekerjaan yang sudah dituliskan orang lenyap dari adendum tanpa
     * ada yang memberi tahu, dan barunya ketahuan saat nilai kontrak tidak
     * cocok. Baris yang benar-benar kosong (tanpa kode DAN tanpa uraian) sudah
     * dilewati di atas, jadi yang sampai ke sini memang ada tulisannya.
     */
    if (!adaAngkaItem) {
      throw new AdendumTemplateError(
        `Baris ${r} ("${nama || kode}") ada tulisannya tapi tanpa angka sama sekali – ` +
          `Volume Adendum dan Harga Satuan dua-duanya kosong. Kalau ini item baru, lengkapi ` +
          `Harga Satuan dan VOLUME ADENDUM; kalau bukan, kosongkan barisnya.`,
      );
    }
    const induk = indukBerjalan ?? kategoriBerjalan?.lineageKey ?? null;
    if (!induk) {
      throw new AdendumTemplateError(
        `Baris ${r} ("${nama || kode}") berada di luar kategori mana pun. Sisipkan item baru DI DALAM kategori yang sesuai.`,
      );
    }
    if (harga == null || harga <= 0) {
      throw new AdendumTemplateError(
        `Item baru "${nama || kode}" (baris ${r}) belum ada Harga Satuan. Item baru wajib berharga – hanya item kontrak lama yang harganya sudah tetap.`,
      );
    }
    const urut = (barisBaruPerInduk.get(induk) ?? 0) + 1;
    barisBaruPerInduk.set(induk, urut);
    // lineageKey item baru dibuat dari kodenya; ditandai "+" supaya tidak
    // pernah bentrok dengan lineage kontrak lama yang sudah punya realisasi.
    const key = `${induk}#+${kode || `baru${urut}`}`;
    const vol = volAdendum ?? 0;
    nodes.push({
      kind: "item",
      code: kode || `B${urut}`,
      name: nama,
      volume: vol,
      unit: teks(ws.getCell(r, C_SATUAN).value) || null,
      unitPrice: harga,
      amount: BigInt(Math.round(vol * harga)),
      lineageKey: key,
      parentLineageKey: induk,
      sortOrder: sortOrder++,
    });
    itemBaru.push({ code: kode || `B${urut}`, name: nama, kategori: kategoriBerjalan?.name ?? induk });
  }

  if (nodes.filter((n) => n.kind === "item").length === 0) {
    throw new AdendumTemplateError("Tidak ada baris pekerjaan terbaca di template.");
  }

  // Nilai induk = Σ anak, dihitung dari bawah ke atas. Sengaja TIDAK memakai
  // apportionment seperti `flattenParsedRab`: di sini daunnya sudah bilangan
  // rupiah bulat (sebagian ANGKA DOKUMEN yang wajib dipakai apa adanya), jadi
  // membagi-bagi selisih pembulatan ke bawah justru akan mengubahnya.
  const anakDari = new Map<string, FlatNode[]>();
  for (const n of nodes) {
    if (!n.parentLineageKey) continue;
    const arr = anakDari.get(n.parentLineageKey) ?? [];
    arr.push(n);
    anakDari.set(n.parentLineageKey, arr);
  }
  const hitung = (n: FlatNode): bigint => {
    if (n.kind === "item") return n.amount;
    let t = 0n;
    for (const c of anakDari.get(n.lineageKey) ?? []) t += hitung(c);
    n.amount = t;
    return t;
  };
  for (const n of nodes) if (!n.parentLineageKey) hitung(n);

  return { nodes, dihapus, volumeNol, itemBaru };
}
