import "server-only";
import ExcelJS from "exceljs";
import { susunBarisCco, type CcoNode, type CcoRow } from "@/lib/rab/cco-rows";

/**
 * DOKUMEN CCO (Contract Change Order) — format pengajuan adendum KKP.
 *
 * BERKASNYA HIDUP: seluruh angka turunan adalah FORMULA EXCEL, bukan nilai
 * mati. Permintaan user 2026-08-03: *"kenapa kamu menggunakan hardcode nilai
 * pada file cco ini? sedangkan aku sudah bilang, gunakan rumus, agar ketika
 * file itu diubah di lokal, semua hal menyesuaikan."* Versi sebelumnya menulis
 * angka hasil hitungan server — begitu satu volume diubah di Excel, tidak ada
 * yang ikut berubah, dan dokumen resmi yang angkanya saling bertentangan lebih
 * berbahaya daripada tidak ada dokumen.
 *
 * HANYA EMPAT KOLOM YANG BERISI DATA (sisanya diturunkan):
 *
 *   C  VOLUME MC-0     ← keadaan kontrak berlaku
 *   D  SATUAN
 *   E  HARGA SATUAN    ← terkunci; dasar semua jumlah harga
 *   N  VOLUME CCO-01   ← INI yang diubah saat menyusun adendum
 *
 * Ubah C atau N, maka volume tambah/kurang, seluruh jumlah harga, semua bobot,
 * keterangan TETAP/TAMBAH/KURANG/BARU/HAPUS, sorotan barisnya, JUMLAH, PPN, dan
 * TOTAL NILAI menyesuaikan sendiri.
 *
 * ATURAN HITUNGAN — diturunkan dari berkas contoh user, bukan karangan:
 *
 *   volume tambah  = volume CCO-01 − volume MC-0   (bila positif)
 *   volume kurang  = volume MC-0 − volume CCO-01   (bila positif)
 *   jumlah harga   = harga satuan × volume         (tiap blok pakai volumenya)
 *   bobot          = jumlah harga ÷ TOTAL × 100
 *
 * PENYEBUT BOBOT — bagian ini penalaran, dan sengaja dibuat kelihatan sebagai
 * rujukan sel supaya bisa diperiksa, bukan dipercaya:
 *
 * - Bobot itu porsi biaya satu item terhadap keseluruhan; dasar pembobotan
 *   kurva-S. Maka satu potret RAB harus berjumlah 100%. MC-0 dibagi TOTAL
 *   MC-0, CCO-01 dibagi TOTAL CCO-01 — dua potret, dua penyebut, masing-masing
 *   genap 100%.
 * - TAMBAH dan KURANG bukan potret melainkan selisih. Yang ditanyakan
 *   "seberapa besar perubahan ini terhadap kontrak yang sedang berjalan", jadi
 *   penyebutnya TOTAL MC-0. Konsekuensinya jumlah bobot tambah = persentase
 *   penambahan terhadap nilai kontrak — angka yang dipakai uji batas 10%
 *   Perpres 16/2018 Pasal 54 (DECISIONS 233). Kalau penyebutnya total CCO-01,
 *   persentase itu tidak merujuk aturan apa pun.
 * - Semuanya pra-PPN di kedua sisi pecahan, jadi PPN saling meniadakan.
 *
 * TIDAK ADA ROUND PER BARIS. `ROUND(E*C,0)` tiap baris lalu dijumlah bisa
 * meleset dari total kontrak, dan membuat `MC-0 + tambah − kurang = CCO-01`
 * gagal beberapa rupiah pada baris yang berubah. Aturan repo sudah menetapkan
 * yang sebaliknya: total = round(Σ nilai eksak), "PERSIS seperti Excel yang
 * menjumlah nilai penuh lalu membulatkan sekali" (DECISIONS 075,
 * `src/lib/rab/flatten.ts`). Jadi selnya menyimpan nilai penuh dan format
 * angka `#,##0` yang membulatkan tampilannya — sama seperti sumber datanya.
 *
 * Blok kanan berkas contoh (CCO-PRC / CCO-PERENCANA / BIAYA PELAKSANAAN) tetap
 * tidak disalin — keputusan user *"b-v saja"*; itu kertas kerja konsultan dan
 * isinya `#REF!`. Begitu pula baris PROGRAM/KEGIATAN/PAGU/SUMBER DANA —
 * *"dihide, abaikan saja dulu"*.
 */

const RUPIAH_FMT = "#,##0";
const VOL_FMT = "#,##0.000";
const PCT_FMT = "0.00";
/** Angka realisasi di dalam pesan validasi — dibaca manusia, bukan sel. */
const VOL_ID = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 });
/** Rupiah untuk teks catatan (bukan sel angka) – dua desimal bila ada. */
const RUPIAH_ID = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });

const GARIS: Partial<ExcelJS.Borders> = {
  top: { style: "thin" },
  left: { style: "thin" },
  bottom: { style: "thin" },
  right: { style: "thin" },
};

/** Kode DB bisa membawa suffix dedup internal (`VI#2`) — artefak, jangan tampil. */
const displayCode = (code: string) => code.replace(/#\d+$/, "").trim();
const displayName = (name: string) => name.replace(/\s+/g, " ").trim();

export type CcoXlsxInput = {
  locationName: string;
  packageName: string;
  workTitle: string | null;
  address: string | null;
  contractNumber: string | null;
  vendorName: string | null;
  /** Dari `Contract.ppnPercent` — JANGAN dipatok 11. */
  ppnPercent: number;
  ccoNo: number;
  /**
   * Nilai revisi yang TERCATAT di MARLIN (pra-PPN) — dipakai baris rekonsiliasi.
   * Bukan hiasan: pada RAB nyata Σ(volume × harga satuan) bisa TIDAK sama
   * dengan nilai kontrak, dan selisih itu harus kelihatan. Lihat komentar
   * `tulisRekonsiliasi()`.
   */
  nilaiTercatatLama: bigint;
  nilaiTercatatBaru: bigint;
  /** Volume terealisasi per lineageKey — pengaman di level berkas (DECISIONS 242). */
  realisasiByLineage?: Map<string, number>;
  /**
   * Penanda tangan — dari `Contract`, BUKAN garis titik-titik. Ketiga pihak
   * memang sudah tercatat di sistem; mencetak "( ………… )" berarti menyuruh orang
   * menulis tangan sesuatu yang sudah diketahui, dan membuat dokumen pengajuan
   * terlihat belum siap. DECISIONS 243.
   */
  ppkName?: string | null;
  ppkNip?: string | null;
  supervisorName?: string | null;
  supervisorFirm?: string | null;
  contractorSignerName?: string | null;
  contractorSignerTitle?: string | null;
  lama: CcoNode[];
  baru: CcoNode[];
};

// ── Peta kolom ────────────────────────────────────────────────────────────────
type Rata = "left" | "center" | "right";
type Kolom = { key: string; judul: string; lebar: number; rata: Rata; fmt?: string };

const KOL_NO: Kolom = { key: "no", judul: "NO", lebar: 7, rata: "center" };
const KOL_URAIAN: Kolom = { key: "uraian", judul: "URAIAN PEKERJAAN", lebar: 52, rata: "left" };
const KOL_KET: Kolom = { key: "ket", judul: "KET", lebar: 11, rata: "center" };

const BLOK: { judul: string; kolom: Kolom[] }[] = [
  {
    judul: "MC - 0",
    kolom: [
      { key: "volumeLama", judul: "VOLUME", lebar: 11, rata: "right", fmt: VOL_FMT },
      // Realisasi lapangan — dasar pengaman "volume tidak boleh turun di bawah
      // yang sudah dikerjakan". DECISIONS 242.
      { key: "realisasi", judul: "REALISASI", lebar: 11, rata: "right", fmt: VOL_FMT },
      { key: "satuan", judul: "SATUAN", lebar: 9, rata: "center" },
      { key: "harga", judul: "HARGA SATUAN (Rp)", lebar: 16, rata: "right", fmt: RUPIAH_FMT },
      { key: "jumlahLama", judul: "JUMLAH HARGA (Rp)", lebar: 18, rata: "right", fmt: RUPIAH_FMT },
      { key: "bobotLama", judul: "BOBOT (%)", lebar: 9, rata: "right", fmt: PCT_FMT },
    ],
  },
  {
    judul: "PEKERJAAN TAMBAH",
    kolom: [
      { key: "volumeTambah", judul: "VOLUME", lebar: 11, rata: "right", fmt: VOL_FMT },
      { key: "jumlahTambah", judul: "JUMLAH HARGA (Rp)", lebar: 18, rata: "right", fmt: RUPIAH_FMT },
      { key: "bobotTambah", judul: "BOBOT (%)", lebar: 9, rata: "right", fmt: PCT_FMT },
    ],
  },
  {
    judul: "PEKERJAAN KURANG",
    kolom: [
      { key: "volumeKurang", judul: "VOLUME", lebar: 11, rata: "right", fmt: VOL_FMT },
      { key: "jumlahKurang", judul: "JUMLAH HARGA (Rp)", lebar: 18, rata: "right", fmt: RUPIAH_FMT },
      { key: "bobotKurang", judul: "BOBOT (%)", lebar: 9, rata: "right", fmt: PCT_FMT },
    ],
  },
  {
    judul: "CCO - 01",
    kolom: [
      { key: "volumeBaru", judul: "VOLUME", lebar: 11, rata: "right", fmt: VOL_FMT },
      { key: "jumlahBaru", judul: "JUMLAH HARGA (Rp)", lebar: 18, rata: "right", fmt: RUPIAH_FMT },
      { key: "bobotBaru", judul: "BOBOT (%)", lebar: 9, rata: "right", fmt: PCT_FMT },
    ],
  },
];

const KOLOM: Kolom[] = [KOL_NO, KOL_URAIAN, ...BLOK.flatMap((b) => b.kolom), KOL_KET];
const nomorKolom = (key: string) => KOLOM.findIndex((k) => k.key === key) + 1; // 1-based
const TOTAL_KOLOM = KOLOM.length;

/**
 * Huruf kolom Excel dari key — dipakai menyusun formula.
 *
 * DIEKSPOR untuk pengujian: uji formula sempat mematok huruf kolom sendiri,
 * jadi menambah satu kolom membuat 15 uji jatuh padahal berkasnya benar.
 * Menurunkannya dari peta yang sama membuat uji ikut bergeser sendiri.
 */
export const KOLOM_CCO: Record<string, string> = Object.fromEntries(
  KOLOM.map((k, i) => [k.key, String.fromCharCode(65 + i)]),
);
const K = KOLOM_CCO;

const BARIS_JUDUL = 1;
const BARIS_IDENTITAS = 3;
const BARIS_HEADER = 8;
const BARIS_DATA = 10;

export async function buildCcoXlsx(input: CcoXlsxInput): Promise<Buffer> {
  const { rows } = susunBarisCco(input.lama, input.baru, input.realisasiByLineage);
  const noCco = String(input.ccoNo).padStart(2, "0");

  const wb = new ExcelJS.Workbook();
  wb.creator = "MARLIN";
  wb.calcProperties.fullCalcOnLoad = true; // Excel hitung ulang saat dibuka
  const ws = wb.addWorksheet(`CCO-${noCco}`, {
    views: [{ state: "frozen", xSplit: 2, ySplit: BARIS_HEADER + 1 }],
    pageSetup: {
      orientation: "landscape",
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    },
  });
  ws.pageSetup.printTitlesRow = `${BARIS_HEADER}:${BARIS_HEADER + 1}`;
  KOLOM.forEach((k, i) => (ws.getColumn(i + 1).width = k.lebar));

  tulisJudul(ws, noCco);
  tulisIdentitas(ws, input);
  tulisHeader(ws);

  // ── Isi tabel ──────────────────────────────────────────────────────────────
  // Baris JUMLAH belum diketahui saat baris data ditulis, padahal formula bobot
  // menunjuk ke sana. Nomornya dihitung dulu: baris data = semua baris kecuali
  // baris "total" bawaan penyusun (JUMLAH ditulis manual di kaki).
  const barisTabel = rows.filter((r) => r.jenis !== "total");
  const barisAkhirData = BARIS_DATA + barisTabel.length - 1;
  const barisJumlah = barisAkhirData + 1;
  const barisPpn = barisJumlah + 1;
  const barisTotal = barisPpn + 1;

  // Baris yang punya realisasi — dipakai memasang sorotan merah sesudahnya.
  const barisBerealisasi: number[] = [];
  const hargaBeda: BarisHargaBeda[] = [];
  barisTabel.forEach((row, i) => tulisBaris(ws, BARIS_DATA + i, row, barisJumlah, barisBerealisasi, hargaBeda));

  tulisKaki(ws, { barisAkhirData, barisJumlah, barisPpn, barisTotal, ppnPercent: input.ppnPercent });
  sorotBarisBerubah(ws, barisAkhirData);
  sorotDiBawahRealisasi(ws, barisBerealisasi);
  const barisSesudahRekon = tulisRekonsiliasi(ws, barisTotal + 2, barisJumlah, input, hargaBeda);
  tulisCatatanDanTtd(ws, barisSesudahRekon + 1, input);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// ── Bagian-bagian lembar ──────────────────────────────────────────────────────

function tulisJudul(ws: ExcelJS.Worksheet, noCco: string) {
  const c = ws.getCell(BARIS_JUDUL, 1);
  c.value = `CONTRACT CHANGE ORDER - ${noCco} (CCO - ${noCco})`;
  c.font = { bold: true, size: 14 };
  c.alignment = { horizontal: "center" };
  ws.mergeCells(BARIS_JUDUL, 1, BARIS_JUDUL, TOTAL_KOLOM);
  ws.getRow(BARIS_JUDUL).height = 22;
}

function tulisIdentitas(ws: ExcelJS.Worksheet, input: CcoXlsxInput) {
  const identitas: [string, string][] = [
    ["NAMA PAKET", input.workTitle ?? input.packageName],
    ["LOKASI", [input.locationName, input.address].filter(Boolean).join(" – ")],
    ["PENYEDIA JASA", input.vendorName ?? ""],
    ["NOMOR KONTRAK", input.contractNumber ?? ""],
  ];
  identitas.forEach(([label, nilai], i) => {
    const r = BARIS_IDENTITAS + i;
    const cLabel = ws.getCell(r, 1);
    cLabel.value = label;
    cLabel.font = { bold: true, size: 10 };
    ws.mergeCells(r, 1, r, 2);
    const cNilai = ws.getCell(r, 3);
    cNilai.value = `:  ${nilai}`;
    cNilai.font = { size: 10 };
    cNilai.alignment = { horizontal: "left" };
    ws.mergeCells(r, 3, r, TOTAL_KOLOM);
  });
}

function tulisHeader(ws: ExcelJS.Worksheet) {
  const H = BARIS_HEADER;
  const set = (cell: ExcelJS.Cell, teks: string) => {
    cell.value = teks;
    cell.font = { bold: true, size: 9 };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9EDF2" } };
    cell.border = GARIS;
  };
  for (const k of [KOL_NO, KOL_URAIAN, KOL_KET]) {
    const c = nomorKolom(k.key);
    ws.mergeCells(H, c, H + 1, c);
    set(ws.getCell(H, c), k.judul);
  }
  let kursor = 3;
  for (const blok of BLOK) {
    const dari = kursor;
    const sampai = kursor + blok.kolom.length - 1;
    ws.mergeCells(H, dari, H, sampai);
    set(ws.getCell(H, dari), blok.judul);
    blok.kolom.forEach((k, i) => set(ws.getCell(H + 1, dari + i), k.judul));
    kursor = sampai + 1;
  }
  for (const r of [H, H + 1]) {
    for (let c = 1; c <= TOTAL_KOLOM; c++) {
      const cell = ws.getRow(r).getCell(c);
      if (!cell.border) cell.border = GARIS;
      if (!cell.fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9EDF2" } };
    }
  }
  ws.getRow(H).height = 18;
  ws.getRow(H + 1).height = 28;
}

/**
 * Baris tanpa isi keuangan — tanpa volume, tanpa harga satuan, nol di KEDUA
 * sisi. Di RAB nyata ini sub-judul yang terlanjur tersimpan sebagai `item`
 * ("6.6.1. Penyiapan RK3K, terdiri atas :"). Diberi formula pun hasilnya nol
 * semua; dirender sebagai judul. Aman: kedua sisi nol, tak ada perubahan yang
 * bisa tersembunyi di baliknya.
 */
const tanpaIsi = (row: CcoRow) =>
  row.jenis === "item" &&
  row.volumeLama == null &&
  row.volumeBaru == null &&
  row.hargaLama == null &&
  row.jumlahLama === 0n &&
  row.jumlahBaru === 0n;

/**
 * Baris yang harga satuannya BERBEDA antara kontrak dan berkas adendum.
 *
 * Dikumpulkan saat menulis, dipakai dua kali: menandai selnya, dan menyusun
 * baris rekonsiliasi yang menyebut nilainya. Lihat `CcoRow.hargaBaru`.
 */
type BarisHargaBeda = { baris: number; no: string; uraian: string; dampak: number };

/** Beda harga yang MEMINDAHKAN uang; di bawah satu sen bukan perbedaan harga. */
function bedaHarga(row: CcoRow): number | null {
  if (!row.adaDiKontrak || row.hargaBaru == null || row.hargaLama == null) return null;
  if (Math.abs(row.hargaBaru - row.hargaLama) < 0.005) return null;
  return (row.hargaLama - row.hargaBaru) * (row.volumeBaru ?? 0);
}

function tulisBaris(
  ws: ExcelJS.Worksheet,
  r: number,
  row: CcoRow,
  barisJumlah: number,
  barisBerealisasi: number[],
  hargaBeda: BarisHargaBeda[],
) {
  const judul = row.jenis === "judul" || tanpaIsi(row);
  const baris = ws.getRow(r);

  ws.getCell(r, nomorKolom("no")).value = row.no ? displayCode(row.no) : null;
  const uraian = ws.getCell(r, nomorKolom("uraian"));
  uraian.value = displayName(row.uraian);
  uraian.alignment = { indent: Math.min(row.depth, 6), wrapText: true, vertical: "middle" };

  if (!judul) {
    // Total MC-0 dan total CCO-01 sebagai rujukan MUTLAK — penyebut bobot.
    const totMc0 = `$${K.jumlahLama}$${barisJumlah}`;
    const totCco = `$${K.jumlahBaru}$${barisJumlah}`;
    const vol0 = `${K.volumeLama}${r}`;
    const volN = `${K.volumeBaru}${r}`;
    const harga = `${K.harga}${r}`;

    // Harga satuan kedua sisi berselisih? Dipakai dua kali di bawah: menandai
    // selnya, dan memilih harga untuk sisi CCO-01.
    const dampakHarga = bedaHarga(row);
    const hargaBedaSisi = dampakHarga != null;

    // DATA (satu-satunya nilai yang diketik) — nol ditulis eksplisit supaya
    // formula pembanding tidak menganggapnya sel kosong.
    const isiData: Record<string, number | string | null> = {
      volumeLama: row.volumeLama ?? 0,
      realisasi: row.realisasi,
      satuan: row.satuan,
      harga: row.hargaLama ?? 0,
      volumeBaru: row.volumeBaru ?? 0,
    };
    for (const [key, nilai] of Object.entries(isiData)) ws.getCell(r, nomorKolom(key)).value = nilai;

    /*
     * HARGA SATUAN YANG BERSELISIH DENGAN BERKAS ADENDUM — DITANDAI, BUKAN
     * DIDIAMKAN.
     *
     * Format CCO punya satu kolom harga, dan dokumen ini memakai harga KONTRAK
     * (DECISIONS 213). Kalau berkas adendumnya memuat harga lain, seluruh baris
     * ini dihitung ulang dengan harga kontrak, sehingga JUMLAH CCO-01 di
     * dokumen tidak lagi sama dengan nilai adendum yang tercatat di MARLIN.
     * Selisih itu sah selama DIKATAKAN; yang tidak boleh adalah dokumen
     * pengajuan yang totalnya membantah sistemnya sendiri tanpa satu pun tanda.
     */
    if (hargaBedaSisi) {
      const sel = ws.getCell(r, nomorKolom("harga"));
      sel.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
      sel.note =
        `Harga kontrak ${RUPIAH_ID.format(row.hargaLama ?? 0)}; di berkas adendum ` +
        `${RUPIAH_ID.format(row.hargaBaru ?? 0)}. Kolom ini harga MC-0 (kontrak); JUMLAH sisi CCO-01 ` +
        `memakai harga BERKAS – angka berkas dipakai apa adanya. Kalau yang benar harga kontrak, ` +
        `betulkan harganya di berkas adendum lalu impor ulang.`;
      hargaBeda.push({ baris: r, no: row.no, uraian: row.uraian, dampak: dampakHarga ?? 0 });
    }

    /*
     * PENGAMAN DI LEVEL BERKAS (DECISIONS 242).
     *
     * Berkas ini ber-formula dan MEMANG dimaksudkan diedit lokal, jadi
     * pengaman server saja tidak cukup: menurunkan volume CCO-01 di bawah
     * realisasi menghasilkan dokumen PENGAJUAN yang mengusulkan membatalkan
     * pekerjaan yang sudah dikerjakan — dan tidak ada apa pun di berkasnya yang
     * keberatan. Excel tidak bisa mencegah (validasi bisa ditembus
     * tempel-salin), jadi berlapis: entri di bawahnya ditolak dengan pesan, dan
     * pelanggaran yang lolos tetap menyala merah lewat format bersyarat.
     */
    if (row.realisasi > 0) {
      const selRealisasi = ws.getCell(r, nomorKolom("realisasi"));
      selRealisasi.font = { size: 9, bold: true };
      selRealisasi.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF6EC" } };
      ws.getCell(r, nomorKolom("volumeBaru")).dataValidation = {
        type: "decimal",
        operator: "greaterThanOrEqual",
        formulae: [`$${K.realisasi}$${r}`],
        allowBlank: false,
        showErrorMessage: true,
        // "stop", BUKAN "error": OOXML hanya mengenal stop/warning/information.
        // ExcelJS menerima nilai apa pun dan menuliskannya apa adanya, dan berkas
        // yang dihasilkan DITOLAK pembaca lain (Excel: "unreadable content").
        errorStyle: "stop",
        errorTitle: "Di bawah realisasi",
        error:
          `Pekerjaan ini sudah terealisasi ${VOL_ID.format(row.realisasi)}${row.satuan ? ` ${row.satuan}` : ""} ` +
          `di lapangan (kolom REALISASI). Volume CCO-01 tidak boleh di bawahnya – pekerjaan-kurang atas item ` +
          `berjalan maksimal sampai volume yang sudah dikerjakan.`,
      };
      barisBerealisasi.push(r);
    }

    /*
     * HARGA SISI CCO-01: MILIK BERKAS ADENDUM, BUKAN HARGA KONTRAK.
     *
     * Kolom HARGA SATUAN berada di blok MC-0 dan memang berisi harga kontrak.
     * Sampai laporan user 2026-09-05, SELURUH baris dihitung dengan harga itu —
     * termasuk sisi CCO-01. Akibatnya pada Pasar Banggi V 3.b: berkas adendum
     * menuliskan harga 0 (item itu memang dinolkan), tapi dokumen mengalikan
     * volume 704 dengan harga kontrak Rp 28.117,52 dan mencetak PEKERJAAN
     * TAMBAH Rp 19.794.734 — pekerjaan yang tidak diminta siapa pun. Bersama
     * IX 3.b, JUMLAH CCO-01 di dokumen membengkak Rp 27,4 juta di atas nilai
     * adendum yang tercatat di sistem.
     *
     * Angka berkas dipakai APA ADANYA (DECISIONS 203): sisi CCO-01 memakai
     * harga sisi CCO-01. Kalau kedua harga sama — keadaan normal — rumusnya
     * tetap menunjuk sel harga, jadi mengubah harga di Excel tetap menggerakkan
     * kedua sisi.
     */
    const hargaN = hargaBedaSisi ? String(row.hargaBaru ?? 0) : harga;

    // TURUNAN — semuanya formula.
    const rumus: Record<string, string> = {
      // jumlah harga = harga satuan × volume (tanpa ROUND — lihat DECISIONS 075)
      jumlahLama: `${harga}*${vol0}`,
      jumlahBaru: `${hargaN}*${volN}`,
      // volume tambah = vol CCO − vol MC-0 ; kurang = vol MC-0 − vol CCO
      volumeTambah: `IF(${volN}-${vol0}>0,${volN}-${vol0},"")`,
      volumeKurang: `IF(${vol0}-${volN}>0,${vol0}-${volN},"")`,
      /*
       * TAMBAH/KURANG = selisih NILAI kedua sisi, bukan volume × satu harga.
       *
       * Rumus lama mengalikan selisih volume dengan harga kontrak, jadi baris
       * yang volumenya naik tapi nilainya tidak (harga sisi CCO-01 nol) tetap
       * dicetak sebagai pekerjaan tambah bernilai. Selisih nilai menjawab
       * pertanyaan yang sebenarnya ditanyakan kolom ini: berapa rupiah yang
       * bertambah. Pada baris berharga sama hasilnya identik dengan rumus lama.
       */
      jumlahTambah: `IF(${K.jumlahBaru}${r}-${K.jumlahLama}${r}>0,${K.jumlahBaru}${r}-${K.jumlahLama}${r},"")`,
      jumlahKurang: `IF(${K.jumlahLama}${r}-${K.jumlahBaru}${r}>0,${K.jumlahLama}${r}-${K.jumlahBaru}${r},"")`,
      // bobot = jumlah harga ÷ TOTAL × 100 (penyebut lihat komentar berkas)
      bobotLama: `IF(${totMc0}=0,0,${K.jumlahLama}${r}/${totMc0}*100)`,
      bobotTambah: `IF(OR(${K.jumlahTambah}${r}="",${totMc0}=0),"",${K.jumlahTambah}${r}/${totMc0}*100)`,
      bobotKurang: `IF(OR(${K.jumlahKurang}${r}="",${totMc0}=0),"",${K.jumlahKurang}${r}/${totMc0}*100)`,
      bobotBaru: `IF(${totCco}=0,0,${K.jumlahBaru}${r}/${totCco}*100)`,
      // Keterangan ikut berubah kalau volumenya diubah — kalau ini nilai mati,
      // baris yang baru saja diubah tetap tertulis TETAP.
      /*
       * KET: "BARU" berarti item ini TIDAK ADA di kontrak – bukan sekadar
       * volumenya nol.
       *
       * Rumus lama menyimpulkannya dari `volume MC-0 = 0`. Laporan user
       * 2026-09-05 (Pasar Banggi V 3.b dan IX 3.b): keduanya item KONTRAK yang
       * volumenya memang 0, lalu dinyatakan "BARU" – dokumen pengajuan
       * menyebut pekerjaan baru untuk baris yang sudah ada di kontrak sejak
       * awal. Keberadaannya di kontrak bukan sesuatu yang bisa disimpulkan dari
       * satu sel volume, jadi dipasang sebagai tetapan per baris; sisanya tetap
       * formula supaya volume yang diubah di Excel tetap menggerakkan KET.
       */
      ket: row.adaDiKontrak
        ? `IF(${volN}=${vol0},"TETAP",` +
          `IF(${volN}=0,"HAPUS",` +
          `IF(${volN}>${vol0},"TAMBAH","KURANG")))`
        : `"BARU"`,
    };
    /*
     * HASIL rumus ikut ditulis (`result`), bukan hanya rumusnya.
     *
     * Tanpa cache, berkas CCO terbitan MARLIN TIDAK BISA diimpor ulang: sel
     * rumus tanpa `result` terbaca `null` oleh pembaca Excel mana pun kecuali
     * Excel sendiri, sehingga pembuktian `volume x harga ~ jumlah` di
     * `cco-import.deteksiCco` gagal dan berkasnya jatuh ke jalur RAB biasa
     * dengan total 0. Kalau berkasnya dibuka lalu disimpan di Excel dulu,
     * impornya berhasil - jadi kegagalannya menimpa persis alur yang paling
     * lazim: unduh, teruskan lewat WhatsApp, unggah balik tanpa pernah dibuka.
     * Audit 2026-09-01.
     *
     * Nilainya dihitung dari angka yang sama dengan yang menyusun rumusnya,
     * jadi cache dan rumus tidak bisa berselisih. Kolom BOBOT sengaja tidak
     * di-cache: penyebutnya sel TOTAL yang baru ada setelah semua baris
     * ditulis, dan `fullCalcOnLoad` sudah dipasang di berkas ini sehingga Excel
     * menghitungnya saat dibuka. Impor tidak memakai bobot.
     */
    const vLama = row.volumeLama ?? 0;
    const vBaru = row.volumeBaru ?? 0;
    const h = row.hargaLama ?? 0;
    const hB = hargaBedaSisi ? (row.hargaBaru ?? 0) : h;
    const vTambah = vBaru - vLama > 0 ? vBaru - vLama : "";
    const vKurang = vLama - vBaru > 0 ? vLama - vBaru : "";
    const nLama = h * vLama;
    const nBaru = hB * vBaru;
    const hasil: Record<string, number | string> = {
      jumlahLama: nLama,
      jumlahBaru: nBaru,
      volumeTambah: vTambah,
      volumeKurang: vKurang,
      jumlahTambah: nBaru - nLama > 0 ? nBaru - nLama : "",
      jumlahKurang: nLama - nBaru > 0 ? nLama - nBaru : "",
      ket: !row.adaDiKontrak
        ? "BARU"
        : vBaru === vLama
          ? "TETAP"
          : vBaru === 0
            ? "HAPUS"
            : vBaru > vLama
              ? "TAMBAH"
              : "KURANG",
    };
    for (const [key, formula] of Object.entries(rumus)) {
      const r2 = hasil[key];
      ws.getCell(r, nomorKolom(key)).value =
        r2 === undefined ? { formula, date1904: false } : { formula, result: r2, date1904: false };
    }
  }

  for (let c = 1; c <= TOTAL_KOLOM; c++) {
    const cell = baris.getCell(c);
    const k = KOLOM[c - 1]!;
    cell.border = GARIS;
    cell.font = { size: 9, bold: judul };
    if (k.fmt) cell.numFmt = k.fmt;
    if (c !== nomorKolom("uraian")) cell.alignment = { horizontal: k.rata, vertical: "middle" };
    if (judul) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
  }
}

/**
 * Sorotan MERAH bila volume CCO-01 jatuh di bawah realisasi — jaring terakhir
 * untuk pelanggaran yang lolos validasi (tempel-salin, atau berkas dibuka di
 * aplikasi yang mengabaikan validasi Excel).
 */
function sorotDiBawahRealisasi(ws: ExcelJS.Worksheet, baris: number[]) {
  for (const r of baris) {
    ws.addConditionalFormatting({
      ref: `${K.volumeBaru}${r}`,
      rules: [
        {
          type: "expression",
          formulae: [`$${K.volumeBaru}$${r}<$${K.realisasi}$${r}`],
          priority: 1,
          style: {
            font: { bold: true, color: { argb: "FF9F1239" } },
            fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFDECEC" } },
          },
        },
      ],
    });
  }
}

function tulisKaki(
  ws: ExcelJS.Worksheet,
  o: { barisAkhirData: number; barisJumlah: number; barisPpn: number; barisTotal: number; ppnPercent: number },
) {
  const { barisAkhirData, barisJumlah, barisPpn, barisTotal } = o;
  const jangkau = (kol: string) => `SUM(${kol}${BARIS_DATA}:${kol}${barisAkhirData})`;
  const kolomAngka = ["jumlahLama", "bobotLama", "jumlahTambah", "bobotTambah", "jumlahKurang", "bobotKurang", "jumlahBaru", "bobotBaru"];

  // JUMLAH — termasuk kolom bobot. Bobot MC-0 dan CCO-01 mestinya 100,00;
  // menjumlahkannya (bukan menulis 100) membuat baris ini memeriksa dirinya
  // sendiri: begitu ada yang salah, angkanya bukan 100.
  const rJumlah = ws.getRow(barisJumlah);
  ws.getCell(barisJumlah, 1).value = "JUMLAH";
  ws.mergeCells(barisJumlah, 1, barisJumlah, nomorKolom("harga"));
  for (const key of kolomAngka) {
    ws.getCell(barisJumlah, nomorKolom(key)).value = { formula: jangkau(K[key]!), date1904: false };
  }

  // PPN — persennya SEL TERSENDIRI supaya bisa diubah; formulanya menunjuk ke
  // sana, bukan menanam angkanya. `Contract.ppnPercent`, tidak dipatok 11.
  const rPpn = ws.getRow(barisPpn);
  ws.getCell(barisPpn, 1).value = "PPN";
  ws.mergeCells(barisPpn, 1, barisPpn, nomorKolom("satuan"));
  const selPpn = ws.getCell(barisPpn, nomorKolom("harga"));
  selPpn.value = o.ppnPercent / 100;
  selPpn.numFmt = "0.##%";
  const ppnRef = `$${K.harga}$${barisPpn}`;
  for (const key of ["jumlahLama", "jumlahTambah", "jumlahKurang", "jumlahBaru"]) {
    ws.getCell(barisPpn, nomorKolom(key)).value = {
      formula: `${K[key]}${barisJumlah}*${ppnRef}`,
      date1904: false,
    };
  }

  // TOTAL NILAI
  const rTotal = ws.getRow(barisTotal);
  ws.getCell(barisTotal, 1).value = "TOTAL NILAI";
  ws.mergeCells(barisTotal, 1, barisTotal, nomorKolom("harga"));
  for (const key of ["jumlahLama", "jumlahTambah", "jumlahKurang", "jumlahBaru"]) {
    ws.getCell(barisTotal, nomorKolom(key)).value = {
      formula: `${K[key]}${barisJumlah}+${K[key]}${barisPpn}`,
      date1904: false,
    };
  }

  for (const [baris, tebal] of [
    [rJumlah, true],
    [rPpn, false],
    [rTotal, true],
  ] as const) {
    for (let c = 1; c <= TOTAL_KOLOM; c++) {
      const cell = baris.getCell(c);
      const k = KOLOM[c - 1]!;
      cell.border = GARIS;
      cell.font = { size: 9, bold: tebal };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9EDF2" } };
      if (k.fmt && !(baris === rPpn && c === nomorKolom("harga"))) cell.numFmt = k.fmt;
      if (c > 1) cell.alignment = { horizontal: k.rata };
    }
    baris.getCell(1).alignment = { horizontal: "right", vertical: "middle" };
    baris.height = 17;
  }
}

/**
 * Sorotan baris yang berubah lewat FORMAT BERSYARAT, bukan warna yang dibakar
 * saat ekspor: kolom KET sendiri sebuah formula, jadi warnanya harus ikut
 * berubah saat volume diubah di Excel. Warna statis akan menyorot baris yang
 * sudah tidak berubah lagi — dan itu justru menyesatkan.
 */
function sorotBarisBerubah(ws: ExcelJS.Worksheet, barisAkhirData: number) {
  const ref = `A${BARIS_DATA}:${K.ket}${barisAkhirData}`;
  const ket = `$${K.ket}${BARIS_DATA}`;
  ws.addConditionalFormatting({
    ref,
    rules: [
      {
        type: "expression",
        formulae: [`OR(${ket}="TAMBAH",${ket}="BARU")`],
        priority: 1,
        style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFEAF6EC" } } },
      },
      {
        type: "expression",
        formulae: [`OR(${ket}="KURANG",${ket}="HAPUS")`],
        priority: 2,
        style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFDECEC" } } },
      },
    ],
  });
}

/**
 * REKONSILIASI terhadap nilai yang tercatat di MARLIN.
 *
 * Kolom JUMLAH di dokumen ini formula `harga satuan × volume` — aturan dari
 * templat user. Pada RAB nyata hasilnya BISA TIDAK SAMA dengan nilai kontrak
 * yang tercatat, dan bukan karena pembulatan:
 *
 * - RAB sumber bisa memuat item ber-volume dan ber-harga satuan tetapi
 *   JUMLAHNYA ditulis nol. MARLIN menyimpannya apa adanya (DECISIONS 203:
 *   angka yang diunggah user dipakai apa adanya, tidak dibetulkan diam-diam).
 *   Contoh nyata Batah Timur: Roolag Bata, Plesteran, dan Acian — bertiga
 *   Rp 781.920.
 * - Pembulatan apportionment antar sibling (DECISIONS 075) menggeser beberapa
 *   ratus rupiah per baris; antar-sibling saling meniadakan.
 *
 * Menyembunyikan selisih ini berarti mengirim dokumen pengajuan yang totalnya
 * membantah nilai kontrak, tanpa ada yang tahu. Menutupnya diam-diam dengan
 * memaksa angka ke nilai tercatat juga terlarang — itu mengarang jumlah harga
 * yang tidak sama dengan harga × volume. Jadi selisihnya DITULIS, sebagai
 * formula, biar terlihat dan bisa ditelusuri. Nol berarti tidak ada masalah.
 */
function tulisRekonsiliasi(
  ws: ExcelJS.Worksheet,
  baris: number,
  barisJumlah: number,
  input: CcoXlsxInput,
  hargaBeda: BarisHargaBeda[] = [],
): number {
  const label = (r: number, teks: string) => {
    const c = ws.getCell(r, 1);
    c.value = teks;
    c.font = { size: 9 };
    c.alignment = { horizontal: "right" };
    ws.mergeCells(r, 1, r, nomorKolom("harga"));
  };

  label(baris, "Nilai tercatat di MARLIN (pra-PPN)");
  for (const [key, nilai] of [
    ["jumlahLama", input.nilaiTercatatLama],
    ["jumlahBaru", input.nilaiTercatatBaru],
  ] as const) {
    const c = ws.getCell(baris, nomorKolom(key));
    c.value = Number(nilai);
    c.numFmt = RUPIAH_FMT;
    c.font = { size: 9 };
  }

  const rSelisih = baris + 1;
  label(rSelisih, "Selisih Σ(harga × volume) − nilai tercatat");
  for (const key of ["jumlahLama", "jumlahBaru"] as const) {
    const kol = K[key]!;
    const c = ws.getCell(rSelisih, nomorKolom(key));
    c.value = { formula: `${kol}${barisJumlah}-${kol}${baris}`, date1904: false };
    c.numFmt = RUPIAH_FMT;
    c.font = { size: 9, bold: true };
  }
  // Selisih bukan-nol disorot sendiri — angka 0 tidak perlu menarik perhatian,
  // angka lain wajib.
  ws.addConditionalFormatting({
    ref: `${K.jumlahLama}${rSelisih}:${K.jumlahBaru}${rSelisih}`,
    rules: [
      {
        // `cellIs` di ExcelJS tak punya operator "notEqual"; ekspresi setara.
        type: "expression",
        formulae: [`${K.jumlahLama}${rSelisih}<>0`],
        priority: 1,
        style: {
          font: { bold: true, color: { argb: "FF9A3412" } },
          fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFEF3C7" } },
        },
      },
    ],
  });

  const rCatatan = rSelisih + 1;
  const c = ws.getCell(rCatatan, 1);
  c.value =
    "Selisih bukan nol berarti RAB sumber memuat item yang JUMLAH-nya tidak sama dengan harga satuan × volume " +
    "(mis. item ber-volume dan ber-harga tetapi jumlahnya ditulis nol). MARLIN menyimpan angka RAB apa adanya dan " +
    "tidak membetulkannya diam-diam – periksa item bersangkutan di RAB sebelum dokumen ini diajukan.";
  c.font = { size: 8, italic: true, color: { argb: "FF9A3412" } };
  c.alignment = { horizontal: "left", wrapText: true };
  ws.mergeCells(rCatatan, 1, rCatatan, TOTAL_KOLOM);
  if (hargaBeda.length === 0) return rCatatan;

  /*
   * SEBAB YANG PALING SERING, DISEBUT DENGAN NAMA DAN ANGKANYA.
   *
   * Catatan di atas menyebut satu kemungkinan (JUMLAH ≠ harga × volume di RAB
   * sumber) dan berhenti di situ. Pada Pasar Banggi penyebabnya bukan itu: dua
   * item yang harga satuannya 0 di berkas adendum tapi Rp 28.117,52 di kontrak
   * membuat dokumen ini Rp 27,4 juta di atas nilai adendum yang tercatat.
   * Pemeriksa tidak bisa menelusuri selisih yang tidak disebut barisnya.
   */
  const rHarga = rCatatan + 1;
  const total = hargaBeda.reduce((t, x) => t + x.dampak, 0);
  const daftar = hargaBeda
    .slice(0, 8)
    .map((x) => `${displayCode(x.no)} ${x.uraian}`)
    .join("; ");
  const sel = ws.getCell(rHarga, 1);
  sel.value =
    `PERHATIAN – harga satuan ${hargaBeda.length} item berbeda antara kontrak dan berkas adendum. ` +
    `Kolom HARGA SATUAN memuat harga KONTRAK (blok MC-0); JUMLAH sisi CCO-01 dihitung dengan harga ` +
    `BERKAS – angka berkas dipakai apa adanya (DECISIONS 203), jadi item yang dinolkan di berkas tetap ` +
    `bernilai nol di sini. Bila dihitung dengan harga kontrak, JUMLAH CCO-01 akan ` +
    `${total >= 0 ? "LEBIH TINGGI" : "LEBIH RENDAH"} ${RUPIAH_ID.format(Math.abs(total))}. ` +
    `Item: ${daftar}${hargaBeda.length > 8 ? `; +${hargaBeda.length - 8} lainnya` : ""}. ` +
    `Sel harga satuannya berlatar kuning – periksa berkas sumbernya sebelum dokumen ini diajukan.`;
  sel.font = { size: 8, italic: true, bold: true, color: { argb: "FF9A3412" } };
  sel.alignment = { horizontal: "left", wrapText: true };
  ws.mergeCells(rHarga, 1, rHarga, TOTAL_KOLOM);
  return rHarga;
}

function tulisCatatanDanTtd(ws: ExcelJS.Worksheet, baris: number, input: CcoXlsxInput) {
  const catatan = ws.getCell(baris, 1);
  catatan.value =
    "Sel berlatar putih pada kolom VOLUME (MC-0 & CCO-01) dan HARGA SATUAN adalah data; kolom lain formula yang ikut menyesuaikan. " +
    "Bobot MC-0, PEKERJAAN TAMBAH, dan PEKERJAAN KURANG dihitung terhadap JUMLAH MC-0; bobot CCO-01 terhadap JUMLAH CCO-01 – keduanya pra-PPN. " +
    "Kolom tambah/kurang dikosongkan bila volumenya tidak berubah.";
  catatan.font = { size: 8, italic: true, color: { argb: "FF6B7280" } };
  catatan.alignment = { horizontal: "left", wrapText: true };
  ws.mergeCells(baris, 1, baris, TOTAL_KOLOM);

  /*
   * TANDA TANGAN — NAMANYA DIISI DARI KONTRAK.
   *
   * Ketiga pihak sudah tercatat di `Contract` (`ppkName`/`ppkNip`,
   * `supervisorName`, `contractorSignerName`), jadi mencetak garis titik-titik
   * berarti menyuruh orang menulis tangan sesuatu yang sudah diketahui sistem —
   * dan membuat dokumen pengajuan terlihat belum jadi. Laporan user 2026-08-03:
   * *"nama-nama pihak kan sudah ada di sistem. kenapa tidak kamu masukkan!"*
   * DECISIONS 243.
   *
   * Yang KOSONG tetap jadi garis isian: field yang belum diisi di kontrak tidak
   * boleh ditebak, dan garis isian jujur menyatakan "belum ada datanya".
   */
  const GARIS_ISIAN = "(.................................................)";
  const r = baris + 2;
  const ttd: {
    dari: number;
    sampai: number;
    atas: string;
    peran: string;
    /** Baris ketiga: instansi/perusahaan; kosong = tidak dicetak. */
    firma: string | null;
    nama: string | null;
    /** Baris di bawah nama: NIP atau jabatan penanda tangan. */
    bawah: string | null;
  }[] = [
    {
      dari: 1,
      sampai: 4,
      atas: "Disetujui Oleh",
      peran: "PPK Pejabat Penandatangan Kontrak",
      firma: null,
      nama: input.ppkName ?? null,
      bawah: input.ppkNip ? `NIP. ${input.ppkNip}` : null,
    },
    {
      dari: nomorKolom("volumeTambah"),
      sampai: nomorKolom("bobotTambah"),
      atas: "Diperiksa Oleh",
      peran: "Konsultan Pengawas",
      firma: input.supervisorFirm ?? null,
      nama: input.supervisorName ?? null,
      bawah: input.supervisorName ? "Inspector" : null,
    },
    {
      dari: nomorKolom("volumeBaru"),
      sampai: nomorKolom("bobotBaru"),
      atas: "Dibuat Oleh",
      peran: "Penyedia Jasa",
      firma: input.vendorName ?? null,
      nama: input.contractorSignerName ?? null,
      bawah: input.contractorSignerTitle ?? (input.contractorSignerName ? "Pelaksana" : null),
    },
  ];
  for (const t of ttd) {
    const tulis = (b: number, teks: string, o: { tebal?: boolean; ukuran?: number; warna?: string } = {}) => {
      const cell = ws.getCell(b, t.dari);
      cell.value = teks;
      cell.font = { size: o.ukuran ?? 10, bold: o.tebal, color: o.warna ? { argb: o.warna } : undefined };
      cell.alignment = { horizontal: "center" };
      ws.mergeCells(b, t.dari, b, t.sampai);
    };
    tulis(r, t.atas);
    tulis(r + 1, t.peran, { tebal: true });
    if (t.firma) tulis(r + 2, t.firma, { ukuran: 9, warna: "FF6B7280" });
    // Nama digarisbawahi seperti lazimnya tanda tangan dokumen resmi.
    tulis(r + 6, t.nama ? `( ${t.nama} )` : GARIS_ISIAN, { tebal: !!t.nama });
    if (t.bawah) tulis(r + 7, t.bawah, { ukuran: 9, warna: "FF6B7280" });
  }
}
