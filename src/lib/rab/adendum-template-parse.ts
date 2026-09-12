import type ExcelJS from "exceljs";
import { bacaAngkaLokal } from "@/lib/rab/angka-lokal";
import type { FlatNode } from "@/lib/rab/flatten";
import {
  ADENDUM_HEADER_ROW,
  ADENDUM_INDUK_COL,
  ADENDUM_JENIS_COL,
  ADENDUM_SUMBER_COL,
  ADENDUM_SUMBER_PREFIX,
  ADENDUM_SUMBER_ROW,
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
  /** Baris ber-volume NEGATIF – ditolak, tidak diikutkan, dan disebut. */
  volumeNegatif: { lineageKey: string; code: string; name: string; volume: number }[];
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
 * Dari revisi MANA template ini dibuat?
 *
 * `null` = bukan template adendum sama sekali. Selain itu selalu mengembalikan
 * nomornya; `revisionId` bisa `null` untuk berkas yang sudah beredar sebelum
 * penanda mesinnya ada — dan berkas-berkas itulah yang ada di tangan orang
 * sekarang, jadi barisan judulnya dibaca sebagai cadangan. Membiarkannya lolos
 * berarti cacat yang dilaporkan 2026-09-12 tetap terjadi pada berkas lama.
 */
export function sumberRevisiTemplate(
  wb: ExcelJS.Workbook,
): { revisionNo: number; revisionId: string | null } | null {
  if (!isAdendumTemplate(wb)) return null;
  const ws = wb.getWorksheet(ADENDUM_TEMPLATE_SHEET)!;

  const penanda = String(ws.getCell(ADENDUM_SUMBER_ROW, ADENDUM_SUMBER_COL).value ?? "").trim();
  if (penanda.startsWith(ADENDUM_SUMBER_PREFIX)) {
    const sisa = penanda.slice(ADENDUM_SUMBER_PREFIX.length);
    const pisah = sisa.indexOf(":");
    const no = Number.parseInt(pisah >= 0 ? sisa.slice(0, pisah) : sisa, 10);
    if (Number.isFinite(no)) {
      const id = pisah >= 0 ? sisa.slice(pisah + 1).trim() : "";
      return { revisionNo: no, revisionId: id || null };
    }
  }

  // Cadangan: kalimat di barisan judul ("… RAB revisi aktif #1").
  for (let r = 1; r < ADENDUM_HEADER_ROW; r++) {
    const teks = String(ws.getCell(r, 1).value ?? "");
    const m = /revisi aktif #(\d+)/i.exec(teks);
    if (m) return { revisionNo: Number.parseInt(m[1]!, 10), revisionId: null };
  }
  return null;
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
  const volumeNegatif: HasilTemplateAdendum["volumeNegatif"] = [];
  const itemBaru: HasilTemplateAdendum["itemBaru"] = [];

  /** Tumpukan induk berjalan: lineageKey per kedalaman, untuk item baru. */
  let kategoriBerjalan: { lineageKey: string; name: string } | null = null;
  let indukBerjalan: string | null = null;
  /**
   * TUMPUKAN INDUK BERDASARKAN INDENTASI — cadangan untuk berkas yang sudah
   * beredar sebelum kolom induk ada.
   *
   * Indentasi kolom Uraian ditulis eksportir sebagai kedalaman pohon sejak
   * template pertama, jadi berkas lama pun membawanya. Ia dipakai HANYA bila
   * kolom induk kosong, dan tidak pernah menimpanya.
   */
  const tumpukan: { key: string; depth: number }[] = [];
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
    const indukTertulis = teks(ws.getCell(r, ADENDUM_INDUK_COL).value);
    const jenisTertulis = teks(ws.getCell(r, ADENDUM_JENIS_COL).value);
    /*
     * KEDALAMAN DARI INDENTASI, bukan dari jumlah "#" pada kunci.
     *
     * Menghitung "#" tampak masuk akal sampai satu kode kembar muncul: kunci
     * kode kedua sudah mengandung "#" sebagai akhiran pembeda, bukan sebagai
     * pemisah jalur, dan kedalamannya langsung terbaca satu tingkat terlalu
     * dalam. Indentasi ditulis eksportir apa adanya dan tidak punya beban ganda.
     */
    // Excel tidak menyimpan `indent="0"` — sel tanpa indentasi memang berarti
    // kedalaman 0 (kategori akar), bukan kedalaman yang tidak diketahui.
    const indentSel = ws.getCell(r, C_URAIAN).alignment?.indent;
    const kedalaman = typeof indentSel === "number" ? indentSel : 0;
    while (tumpukan.length > 0 && tumpukan[tumpukan.length - 1]!.depth >= kedalaman) tumpukan.pop();
    /** Induk baris ini: yang TERTULIS menang, indentasi jadi cadangannya. */
    const indukBaris = (): string | null =>
      indukTertulis || (tumpukan.length > 0 ? tumpukan[tumpukan.length - 1]!.key : null);
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
      const induk = indukBaris();
      // Item dikenali dari kolom KONTRAK (volume/harga), bukan dari kolom
      // isian: kalau dikenali dari kolom VOLUME ADENDUM, item yang isiannya
      // dikosongkan user akan berubah menjadi "kategori" dan seluruh anak
      // sesudahnya salah induk.
      const isItem = volKontrak != null || harga != null;

      if (!isItem) {
        // Kategori/sub/grup: nilainya diturunkan dari anak, tidak dibaca.
        const parent = induk || null;
        nodes.push({
          // Jenis baris judul DITULIS di berkas; tanpa penanda itu (berkas yang
          // sudah beredar) jatuh ke dugaan lama — akar = kategori, sisanya sub.
          kind:
            jenisTertulis === "kategori" || jenisTertulis === "sub" || jenisTertulis === "grup"
              ? jenisTertulis
              : parent == null
                ? "kategori"
                : "sub",
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
        if (parent == null) kategoriBerjalan = { lineageKey, name: nama };
        indukBerjalan = lineageKey;
        tumpukan.push({ key: lineageKey, depth: kedalaman });
        continue;
      }

      // Cocok LONGGAR, bukan persis. Sebelumnya `=== "HAPUS"`, sehingga
      // "Hapus item", "HAPUS?", atau "hapus saja" diabaikan TANPA SUARA dan
      // itemnya tetap masuk dengan volume dari kolom G — niat mencabut yang
      // ditulis nyaris benar hilang tanpa kabar. Audit 2026-09-01.
      if (/\bHAPUS\b/.test(keterangan)) {
        // DINYATAKAN dicabut. Barisnya TIDAK diikutkan; diff terhadap RAB aktif
        // yang akan melaporkannya sebagai item hilang — termasuk peringatan
        // keras bila item itu sudah punya realisasi.
        dihapus.push({ lineageKey, code: kode, name: nama });
        continue;
      }

      const vol = volAdendum ?? 0;
      /*
       * Volume NEGATIF ditolak, bukan diterima diam-diam.
       *
       * Sebelumnya `G10 = -3` menghasilkan `amount` negatif dan total kategori
       * negatif, dan yang muncul di pratinjau hanya "volume berubah dari 2,5 ke
       * -3" tanpa mengatakan bahwa angka itu mustahil. DECISIONS 203 sudah
       * menetapkan sebaliknya untuk impor jadwal: *"Nilai negatif ditolak
       * dengan menyebut baris & minggunya. Sebelumnya parser diam-diam
       * mengubahnya jadi 0 - persis jenis perubahan-tanpa-memberi-tahu yang
       * sedang diperbaiki di sini."* Jalur adendum kini ikut.
       *
       * DITOLAK, bukan dibetulkan jadi 0: pekerjaan-kurang dinyatakan dengan
       * MENURUNKAN volume, bukan dengan volume negatif, jadi angka negatif di
       * sini selalu salah ketik atau rumus yang meleset.
       */
      if (vol < -EPS) {
        volumeNegatif.push({ lineageKey, code: kode, name: nama, volume: vol });
        continue;
      }
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
        parentLineageKey: induk || null,
        sortOrder: sortOrder++,
      });
      // Item BISA punya anak (mis. baris rincian di bawah pekerjaan berharga).
      // Tumpukan karena itu memuat item juga — kalau tidak, baris di bawahnya
      // naik satu tingkat dan berpindah induk diam-diam.
      tumpukan.push({ key: lineageKey, depth: kedalaman });
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
  /*
   * ITEM BISA PUNYA ANAK, dan anaknya ikut dihitung.
   *
   * Versi sebelumnya berhenti begitu bertemu baris ber-harga — `if (kind ===
   * "item") return n.amount` — dengan anggapan item selalu daun. Di RAB KKP
   * anggapan itu tidak berlaku: ada item yang bersarang di bawah item lain
   * (mis. `IX#IX.2#17#2` di bawah `IX#IX.2#17`). Anak-anak itu luput dari
   * kategori mana pun, dan uangnya lenyap dari total tanpa satu pun peringatan
   * — dilaporkan user 2026-09-12 sebagai selisih Rp 35 juta pada berkas yang
   * jumlah kolomnya di Excel justru pas.
   *
   * Nilai item sendiri TIDAK ditimpa: pada sisi aktif nilai induk ber-harga
   * memang tidak mencakup anaknya (keduanya dijumlahkan terpisah), jadi yang
   * ditambahkan ke atas adalah nilai sendiri PLUS anak.
   */
  const hitung = (n: FlatNode): bigint => {
    let t = n.kind === "item" ? n.amount : 0n;
    for (const c of anakDari.get(n.lineageKey) ?? []) t += hitung(c);
    if (n.kind !== "item") n.amount = t;
    return t;
  };
  for (const n of nodes) if (!n.parentLineageKey) hitung(n);

  return { nodes, dihapus, volumeNol, volumeNegatif, itemBaru };
}
