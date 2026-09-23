import "server-only";
import { db } from "@/lib/db";

/**
 * JALUR INDUK SEBUAH NODE RAB — "item ini masuk kategori/sub-kategori apa?"
 *
 * **Laporan user 2026-09-23**, memotret laporan harian yang sudah disetujui:
 *
 *   *"itu ada item pekerjaan, tapi masuk kategori atau sub kategori apa tidak
 *   diketahui, padahal waktu proses input ada. ini penting untuk dapat sekali
 *   lihat tanpa harus buka-buka laporan lain lagi"*
 *
 * Keluhan yang SAMA pernah datang 2026-09-05 (*"2.d, 2.e itu yang mana, ada
 * banyak kategori di sini, seharusnya sekalian sebutkan parentnya"*) dan waktu
 * itu hanya diperbaiki di pratinjau impor RAB. Nomor item hanya unik DI DALAM
 * induknya: baris di layar user berbunyi "1", dan "1" ada di setiap kategori.
 *
 * ### Dua bentuk, dua kegunaan
 *
 * - `kode` — rantai kode termasuk kodenya sendiri (`II · 1 · 1`). Bentuk ini
 *   yang dicocokkan orang dengan dokumen kontrak dan RAB.
 * - `nama` — rantai NAMA induknya saja (`PEKERJAAN REVETMENT › Pekerjaan
 *   Tanah`), tanpa nama itemnya sendiri: nama item sudah tercetak besar di
 *   barisnya, dan mengulanginya memakan tempat yang justru dipakai menjawab
 *   "kategori apa".
 *
 * Dicari per NODE ID, bukan per `lineageKey`: `DailyReportItem.rabNodeId`
 * menunjuk node pada revisi tempat barisnya dibuat, yang bisa sudah
 * `digantikan` oleh adendum. Menelusur dari node itu sendiri memberi kategori
 * yang benar-benar berlaku saat pekerjaan itu dilaporkan, dan tetap bekerja
 * untuk lineage yang sudah tidak ada di revisi aktif.
 */

export type JalurNode = {
  /** Rantai kode termasuk kode node ini sendiri, mis. `"II · 1 · 1"`. */
  kode: string;
  /** Rantai NAMA induknya saja, mis. `"PEKERJAAN REVETMENT › Pekerjaan Tanah"`. */
  nama: string;
};

/** Sufiks pembeda kode kembar (`VI#2`) artefak teknis — dilarang tampil. */
const bersih = (code: string) => code.replace(/(?:#\d+)+$/, "").trim();

/**
 * Peta `nodeId` → jalurnya. Id yang tidak ada cukup absen dari peta (bukan
 * lemparan): baris laporan bisa menunjuk node yang revisinya sudah dihapus, dan
 * satu baris tanpa jalur tidak boleh merobohkan seluruh layar.
 */
export async function jalurNodeById(ids: Iterable<string>): Promise<Map<string, JalurNode>> {
  const daftar = [...new Set(ids)];
  if (daftar.length === 0) return new Map();

  const awal = await db.rabNode.findMany({
    where: { id: { in: daftar } },
    select: { id: true, parentId: true, code: true, name: true, revisionId: true },
  });
  if (awal.length === 0) return new Map();

  /*
   * Seluruh simpul revisi terkait diambil SEKALI, bukan satu query per tingkat:
   * laporan harian bisa memuat puluhan item, dan menelusur induk satu per satu
   * berarti puluhan bolak-balik ke DB untuk menghias satu tabel.
   */
  const revisi = [...new Set(awal.map((n) => n.revisionId))];
  const semua = await db.rabNode.findMany({
    where: { revisionId: { in: revisi } },
    select: { id: true, parentId: true, code: true, name: true },
  });
  const byId = new Map(semua.map((n) => [n.id, n]));

  const hasil = new Map<string, JalurNode>();
  for (const n of awal) {
    const kode: string[] = [];
    const nama: string[] = [];
    let kini = n.parentId ? byId.get(n.parentId) : undefined;
    // Pagar: pohon rusak (induk melingkar) tidak boleh jadi loop tak henti.
    let pagar = 0;
    while (kini && pagar++ < 20) {
      const k = bersih(kini.code);
      if (k) kode.unshift(k);
      const nm = kini.name.trim();
      if (nm) nama.unshift(nm);
      kini = kini.parentId ? byId.get(kini.parentId) : undefined;
    }
    kode.push(bersih(n.code));
    hasil.set(n.id, {
      kode: kode.filter(Boolean).join(" · "),
      nama: nama.join(" › "),
    });
  }
  return hasil;
}
