import "server-only";
import ExcelJS from "exceljs";
import { ppnAmount, withPpn } from "@/lib/money";
import { formatRupiah } from "@/lib/format";

/**
 * EKSPOR RAB AKTIF → .xlsx 3 sheet SALING TERTAUT FORMULA (permintaan user
 * 29 Juli 2026, pola "konsep file" RAB KKP):
 *
 *   1. "Resume"     — satu baris per kategori/bangunan, nilainya =rumus ke
 *                     subtotal Sub Resume; lalu JUMLAH, PPN, TOTAL, DIBULATKAN
 *                     (semuanya rumus, bukan angka mati).
 *   2. "Sub Resume" — per kategori: rincian anak langsungnya, nilai =rumus ke
 *                     baris Detail RAB; subtotal = SUM blok.
 *   3. "Detail RAB" — pohon lengkap; Jumlah item = RUMUS ROUND(Volume × Harga
 *                     Satuan; 0), Jumlah induk = penjumlahan sel anak-anaknya.
 *
 * SELURUH kolom Jumlah berupa rumus, sampai ke daunnya — perintah user
 * 2026-09-21: *"konyol kalau misal sedang cek2 lalu jumlahnya ternyata
 * hardcode"*. Berkas ini dipakai untuk MEMERIKSA, dan yang pertama diperiksa
 * adalah apakah Jumlah memang volume × harga satuan; kolom berisi angka mati
 * tidak bisa diperiksa sama sekali.
 *
 * Setiap sel rumus tetap membawa `result` = angka tersimpan DB, jadi sebelum
 * Excel merekalkulasi berkas dan layar menyebut angka yang sama. Bila
 * rekalkulasinya mendarat berbeda (harga satuan dicatat 2 desimal, AHSP
 * sumbernya lebih panjang), selisihnya DIKATAKAN di sheet Resume — bukan
 * dihindari dengan menulis angka mati.
 */

export type RabExportNode = {
  id: string;
  parentId: string | null;
  kind: "kategori" | "sub" | "grup" | "item";
  code: string;
  name: string;
  unit: string | null;
  volume: number | null;
  unitPrice: number | null;
  amount: bigint;
};

export type RabExportInput = {
  locationName: string;
  packageName: string;
  contractNumber: string | null;
  vendorName: string | null;
  ppnPercent: number;
  revisionNo: number;
  totalValue: bigint;
  nodes: RabExportNode[];
};

const RUPIAH_FMT = "#,##0";
const VOL_FMT = "#,##0.000";

/**
 * Kode/nama TAMPILAN — data DB tidak diubah:
 * - `code` di DB bisa membawa suffix dedup internal (`VI#2`, `X.1#2`) hasil
 *   disambiguasi lineageKey saat impor; itu artefak teknis, dilarang tampil
 *   di dokumen ekspor.
 * - Nama dirapikan dari spasi ganda bawaan file sumber.
 *
 * KODE KATEGORI DIPAKAI APA ADANYA (DECISIONS 208).
 *
 * Versi sebelumnya menomori ulang kategori berurutan (I, II, III, …) dengan
 * alasan "file sumber kerap memuat roman loncat". Itu keliru dua kali:
 *
 * 1. Loncatnya kode BUKAN kesalahan. RAB yang aktif adalah hasil negosiasi
 *    RESMI; nomor bangunan di sana dirujuk kontrak, adendum, berita acara, dan
 *    laporan KKP. Menomori ulang membuat dokumen ekspor tidak bisa dicocokkan
 *    dengan berkas resmi mana pun — dan diam-diam, tanpa pemberitahuan.
 * 2. Penomoran ulangnya bahkan tidak konsisten: hanya kategori yang diubah,
 *    sedangkan anak-anaknya tetap membawa kode aslinya. Hasilnya file yang
 *    bertentangan dengan dirinya sendiri — kategori "II" berisi anak "III.1",
 *    yang membuat berkasnya tak bisa diimpor ulang (kode anak menunjuk
 *    kategori yang tak ada).
 *
 * Sejalan dengan DECISIONS 203: angka dan kode dari user dipakai apa adanya.
 */
/*
 * Sufiks pembeda kode kembar TIDAK ikut ke dokumen resmi — dan SEMUANYA, bukan
 * satu.
 *
 * Sufiks itu bisa bertumpuk: `hps-parser` memberi sub kedua kode "II.1#2", lalu
 * `flattenParsedRab` menambah "#2" lagi ketika key-nya bertabrakan dengan item
 * "2" milik sub pertama → "II.1#2#2". Versi lama membuang satu saja, jadi kolom
 * Kode berisi "II.1#2" — bentuk yang tidak dikenali parser saat berkasnya
 * diimpor ulang: barisnya dibuang tanpa peringatan dan item-itemnya pindah ke
 * sub pertama. Audit 2026-09-15 (D-3).
 */
const displayCode = (code: string) => code.replace(/(?:#\d+)+$/, "").trim();
const displayName = (name: string) => name.replace(/\s+/g, " ").trim();

const thin: Partial<ExcelJS.Borders> = {
  top: { style: "thin" },
  left: { style: "thin" },
  bottom: { style: "thin" },
  right: { style: "thin" },
};

function headerCell(cell: ExcelJS.Cell) {
  cell.font = { bold: true, size: 10 };
  cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
  cell.border = thin;
}

/** Judul blok identitas di atas tabel (3 baris, kolom A). */
function addTitle(ws: ExcelJS.Worksheet, judul: string, input: RabExportInput) {
  ws.getCell("A1").value = judul;
  ws.getCell("A1").font = { bold: true, size: 13 };
  ws.getCell("A2").value =
    `Lokasi: ${input.locationName} · Paket: ${input.packageName}` +
    (input.vendorName ? ` · ${input.vendorName}` : "");
  ws.getCell("A3").value =
    (input.contractNumber ? `Kontrak: ${input.contractNumber} · ` : "") +
    `RAB revisi aktif #${input.revisionNo}`;
  ws.getCell("A2").font = { size: 10 };
  ws.getCell("A3").font = { size: 10, color: { argb: "FF666666" } };
}

export async function buildRabXlsx(input: RabExportInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MARLIN";

  const byParent = new Map<string | null, RabExportNode[]>();
  for (const n of input.nodes) {
    const arr = byParent.get(n.parentId) ?? [];
    arr.push(n);
    byParent.set(n.parentId, arr);
  }
  const kategoris = byParent.get(null) ?? [];

  /**
   * Kode kategori untuk KETIGA sheet — dari DB, apa adanya (DECISIONS 208).
   * Kategori tanpa kode sama sekali diberi penanda posisi agar kolom Kode tidak
   * kosong di dokumen resmi; itu satu-satunya kode yang kami karang, dan hanya
   * ketika tidak ada yang bisa dipakai.
   */
  const romanOf = new Map<string, string>();
  kategoris.forEach((k, i) => romanOf.set(k.id, displayCode(k.code) || `(${i + 1})`));

  // Urutan tab: Resume → Sub Resume → Detail RAB (dibuat dulu semua supaya
  // urut, lalu DIISI dari Detail karena dua sheet lain menunjuk ke barisnya).
  const res = wb.addWorksheet("Resume", { views: [{ state: "frozen", ySplit: 5 }] });
  const sub = wb.addWorksheet("Sub Resume", { views: [{ state: "frozen", ySplit: 5 }] });
  const det = wb.addWorksheet("Detail RAB", { views: [{ state: "frozen", ySplit: 5 }] });
  det.columns = [
    { width: 10 }, // A kode
    { width: 52 }, // B uraian
    { width: 12 }, // C volume
    { width: 8 }, // D sat
    { width: 15 }, // E harga satuan
    { width: 17 }, // F jumlah
  ];
  addTitle(det, "RENCANA ANGGARAN BIAYA – DETAIL", input);
  const detHeaderRow = 5;
  const detHeaders = ["Kode", "Uraian Pekerjaan", "Volume", "Sat", "Harga Satuan (Rp)", "Jumlah (Rp)"];
  detHeaders.forEach((h, i) => {
    const c = det.getCell(detHeaderRow, i + 1);
    c.value = h;
    headerCell(c);
  });

  /** Baris Detail per node id — dipakai rumus antar-sheet. */
  const detRowOf = new Map<string, number>();
  let r = detHeaderRow;
  /*
   * Selisih rekalkulasi, DIPILAH MENURUT SEBABNYA.
   *
   * Nol pada hampir semua berkas. Bila tidak nol, itulah yang akan terlihat
   * berbeda begitu Excel merekalkulasi — dan justru karena itu harus DIKATAKAN
   * di berkasnya, bukan dihindari dengan menulis angka mati.
   *
   * Dipilah karena kedua sebabnya menuntut tindakan yang BERBEDA, dan catatan
   * yang menyebut sebab yang salah lebih buruk daripada tidak ada catatan:
   *
   * - `nol`     — Jumlah tersimpan 0 padahal volume dan harga satuannya terisi.
   *               Ini lubang di berkas SUMBER (kolom JUMLAH kosong, dipakai apa
   *               adanya per DECISIONS 212); rupiahnya besar dan harus
   *               diperiksa orang. Diukur di data nyata: 3–19 baris per lokasi,
   *               sampai Rp 22,9 juta di satu lokasi.
   * - `bulat`   — sisanya: harga satuan dicatat `Decimal(15,2)` sedangkan AHSP
   *               sumbernya lebih panjang. Receh (Rp 2–10 ribu per lokasi) dan
   *               memang tidak bisa dihilangkan dari sisi MARLIN.
   */
  let nolBaris = 0;
  let nolRupiah = 0;
  let bulatBaris = 0;
  let bulatRupiah = 0;

  /**
   * Menulis satu baris + turunannya, dan mengembalikan SEL-SEL yang bila
   * dijumlahkan sama dengan nilai penuh cabang ini. Untuk baris judul cukup
   * selnya sendiri (ia sudah berumus); untuk baris ITEM yang punya anak,
   * selnya sendiri berisi angka mati sehingga anak-anaknya harus ikut disebut
   * — kalau tidak, rumus kategori di atasnya menjumlah kurang. DECISIONS 563.
   */
  const writeNode = (n: RabExportNode, depth: number): string[] => {
    r += 1;
    const row = r;
    detRowOf.set(n.id, row);
    const sumbangan = [`F${row}`];
    det.getCell(row, 1).value = n.kind === "kategori" ? romanOf.get(n.id)! : displayCode(n.code);
    det.getCell(row, 1).alignment = { horizontal: "center", vertical: "top" };
    // Hierarki lewat indent NATIF Excel, bukan spasi literal di teks.
    det.getCell(row, 2).value = displayName(n.name);
    det.getCell(row, 2).alignment = { indent: depth, wrapText: true, vertical: "top" };
    if (n.kind === "item") {
      det.getCell(row, 3).value = n.volume ?? 0;
      det.getCell(row, 3).numFmt = VOL_FMT;
      det.getCell(row, 4).value = n.unit ?? "";
      det.getCell(row, 5).value = n.unitPrice ?? 0;
      det.getCell(row, 5).numFmt = RUPIAH_FMT;
      /*
       * RUMUS `ROUND(volume × harga satuan, 0)` — perintah user 2026-09-21,
       * MEMBALIK DECISIONS 212.
       *
       *   *"kenapa kolom jumlah kamu hardcode? padahal kan jelas kolom jumlah
       *   harusnya perkalian harga satuan dan volume"* … *"yang pasti kan konyol
       *   kalau misal sedang cek2 lalu jumlahnya ternyata hardcode"*
       *
       * Berkas ini dipakai orang untuk MEMERIKSA, dan yang pertama diperiksa
       * justru apakah Jumlah memang volume × harga. Kolom berisi angka mati
       * tidak bisa diperiksa sama sekali — ia hanya menyuruh percaya.
       *
       * Keberatan lama tetap benar dan tidak dibuang, cuma tidak lagi
       * menentukan: harga satuan disimpan `Decimal(15,2)` sedangkan AHSP
       * sumbernya lebih panjang, jadi sebagian baris meleset. Diukur pada RAB
       * aktif 16 lokasi: di luar baris ber-Jumlah 0, selisihnya Rp 2–10 ribu
       * per lokasi pada kontrak miliaran. Yang WAJIB adalah selisih itu
       * dikatakan, bukan disembunyikan di balik angka mati — catatannya
       * ditulis di sheet Resume (`catatanSelisih`) begitu ada.
       *
       * `result` tetap angka tersimpan: sebelum Excel merekalkulasi, berkas dan
       * layar menyebut angka yang sama.
       *
       * Item TANPA volume/harga satuan tetap angka mati — tidak ada yang bisa
       * dikalikan, dan `ROUND(0*0,0)` cuma mengarang perkalian yang tidak punya
       * dasar di dokumen. Pada data nyata semuanya memang bernilai 0.
       */
      if (n.volume != null && n.unitPrice != null) {
        det.getCell(row, 6).value = {
          formula: `ROUND(C${row}*E${row},0)`,
          result: Number(n.amount),
        };
        const hitung = Math.round(n.volume * n.unitPrice);
        const beda = hitung - Number(n.amount);
        if (beda !== 0) {
          if (n.amount === 0n) {
            nolBaris += 1;
            nolRupiah += beda;
          } else {
            bulatBaris += 1;
            bulatRupiah += beda;
          }
        }
      } else {
        det.getCell(row, 6).value = Number(n.amount);
      }
      // Baris di bawah ITEM tetap ditulis — penelusuran ini dulu hanya ada di
      // cabang non-item, jadi item yang punya anak membuang anaknya dari
      // berkas: bukan salah jumlah, melainkan pekerjaan yang tidak disebut.
      for (const c of byParent.get(n.id) ?? []) sumbangan.push(...writeNode(c, depth + 1));
    } else {
      det.getRow(row).font = { bold: depth === 0, italic: depth > 0 };
      if (n.kind === "kategori") {
        for (let c = 1; c <= 6; c++) {
          det.getCell(row, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F5" } };
        }
      }
      const parts: string[] = [];
      for (const c of byParent.get(n.id) ?? []) parts.push(...writeNode(c, depth + 1));
      det.getCell(row, 6).value = parts.length
        ? { formula: parts.join("+"), result: Number(n.amount) }
        : 0;
    }
    det.getCell(row, 6).numFmt = RUPIAH_FMT;
    if (n.kind !== "item") det.getCell(row, 6).font = { bold: true };
    for (let c = 1; c <= 6; c++) det.getCell(row, c).border = thin;
    det.getCell(row, 4).alignment = { horizontal: "center" };
    return sumbangan;
  };
  for (const kat of kategoris) writeNode(kat, 0);

  // Baris jumlah pra-PPN di Detail (rumus ke sel kategori).
  r += 1;
  const detTotalRow = r;
  det.getCell(detTotalRow, 2).value = "JUMLAH (pra-PPN)";
  det.getCell(detTotalRow, 2).font = { bold: true };
  det.getCell(detTotalRow, 6).value = {
    formula: kategoris.map((k) => `F${detRowOf.get(k.id)!}`).join("+") || "0",
    result: Number(input.totalValue),
  };
  det.getCell(detTotalRow, 6).numFmt = RUPIAH_FMT;
  det.getCell(detTotalRow, 6).font = { bold: true };
  for (let c = 1; c <= 6; c++) det.getCell(detTotalRow, c).border = thin;

  /* ── Sheet 2: Sub Resume — anak langsung tiap kategori, tertaut ke Detail ── */
  sub.columns = [{ width: 10 }, { width: 56 }, { width: 18 }];
  addTitle(sub, "RENCANA ANGGARAN BIAYA – SUB RESUME", input);
  const subHeaderRow = 5;
  ["Kode", "Uraian", "Jumlah Harga (Rp)"].forEach((h, i) => {
    const c = sub.getCell(subHeaderRow, i + 1);
    c.value = h;
    headerCell(c);
  });

  /** Baris subtotal kategori di Sub Resume — dipakai sheet Resume. */
  const subTotalRowOf = new Map<string, number>();
  let s = subHeaderRow;
  for (const kat of kategoris) {
    s += 1;
    sub.getCell(s, 1).value = romanOf.get(kat.id)!;
    sub.getCell(s, 1).alignment = { horizontal: "center" };
    sub.getCell(s, 2).value = displayName(kat.name);
    sub.getRow(s).font = { bold: true };
    for (let c = 1; c <= 3; c++) {
      sub.getCell(s, c).border = thin;
      sub.getCell(s, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F5" } };
    }
    const children = byParent.get(kat.id) ?? [];
    const childRows: number[] = [];
    for (const c of children) {
      s += 1;
      childRows.push(s);
      sub.getCell(s, 1).value = displayCode(c.code);
      sub.getCell(s, 1).alignment = { horizontal: "center" };
      sub.getCell(s, 2).value = displayName(c.name);
      sub.getCell(s, 2).alignment = { indent: 1, wrapText: true };
      sub.getCell(s, 3).value = {
        formula: `'Detail RAB'!F${detRowOf.get(c.id)!}`,
        result: Number(c.amount),
      };
      sub.getCell(s, 3).numFmt = RUPIAH_FMT;
      for (let cc = 1; cc <= 3; cc++) sub.getCell(s, cc).border = thin;
    }
    s += 1;
    subTotalRowOf.set(kat.id, s);
    sub.getCell(s, 2).value = `JUMLAH ${romanOf.get(kat.id)!} – ${displayName(kat.name)}`;
    sub.getCell(s, 2).font = { bold: true };
    sub.getCell(s, 3).value = childRows.length
      ? { formula: childRows.map((cr) => `C${cr}`).join("+"), result: Number(kat.amount) }
      : 0;
    sub.getCell(s, 3).numFmt = RUPIAH_FMT;
    sub.getCell(s, 3).font = { bold: true };
    sub.getCell(s, 3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F5" } };
    for (let cc = 1; cc <= 3; cc++) sub.getCell(s, cc).border = thin;
    s += 1; // baris kosong antar blok
  }

  /* ── Sheet 1: Resume — kategori tertaut ke Sub Resume + PPN + pembulatan ── */
  res.columns = [{ width: 6 }, { width: 56 }, { width: 18 }];
  addTitle(res, "RENCANA ANGGARAN BIAYA – RESUME", input);
  const resHeaderRow = 5;
  ["No", "Uraian Pekerjaan", "Jumlah Harga (Rp)"].forEach((h, i) => {
    const c = res.getCell(resHeaderRow, i + 1);
    c.value = h;
    headerCell(c);
  });
  let q = resHeaderRow;
  const katRows: number[] = [];
  kategoris.forEach((kat) => {
    q += 1;
    katRows.push(q);
    res.getCell(q, 1).value = romanOf.get(kat.id)!;
    res.getCell(q, 1).alignment = { horizontal: "center" };
    res.getCell(q, 2).value = displayName(kat.name);
    res.getCell(q, 3).value = {
      formula: `'Sub Resume'!C${subTotalRowOf.get(kat.id)!}`,
      result: Number(kat.amount),
    };
    res.getCell(q, 3).numFmt = RUPIAH_FMT;
    for (let cc = 1; cc <= 3; cc++) res.getCell(q, cc).border = thin;
  });

  // result cache dari formula kanonik lib/money — bukan hitungan lokal baru.
  const jumlah = Number(input.totalValue);
  const ppn = Number(ppnAmount(input.totalValue, input.ppnPercent));
  const total = Number(withPpn(input.totalValue, input.ppnPercent));
  const bulat = Math.floor(total / 1000) * 1000;

  const tulisTotal = (label: string, value: ExcelJS.CellValue, fmt = RUPIAH_FMT) => {
    q += 1;
    res.getCell(q, 2).value = label;
    res.getCell(q, 2).font = { bold: true };
    res.getCell(q, 3).value = value;
    res.getCell(q, 3).numFmt = fmt;
    res.getCell(q, 3).font = { bold: true };
    for (let cc = 1; cc <= 3; cc++) res.getCell(q, cc).border = thin;
    return q;
  };
  const rowJumlah = tulisTotal("JUMLAH", {
    formula: katRows.length ? katRows.map((kr) => `C${kr}`).join("+") : "0",
    result: jumlah,
  });
  const rowPpn = tulisTotal(`PPN ${input.ppnPercent}%`, {
    formula: `ROUND(C${rowJumlah}*${input.ppnPercent}%,0)`,
    result: ppn,
  });
  const rowTotal = tulisTotal("JUMLAH TOTAL", {
    formula: `C${rowJumlah}+C${rowPpn}`,
    result: total,
  });
  tulisTotal("DIBULATKAN", {
    formula: `ROUNDDOWN(C${rowTotal},-3)`,
    result: bulat,
  });

  /*
   * SELISIH REKALKULASI DIKATAKAN, TIDAK DISEMBUNYIKAN.
   *
   * Sejak kolom Jumlah berupa rumus (perintah user 2026-09-21), angka yang
   * muncul begitu Excel menghitung ulang bisa berbeda dari nilai tersimpan:
   * harga satuan disimpan 2 desimal, AHSP sumbernya lebih panjang. Selisihnya
   * kecil (diukur: Rp 2–10 ribu per lokasi pada kontrak miliaran), tetapi
   * selisih kecil yang tidak disebut adalah persis cara angka kontrak bergeser
   * tanpa ada yang tahu.
   *
   * Hanya ditulis bila memang ada. Catatan yang selalu muncul akan berhenti
   * dibaca, dan menakuti orang pada berkas yang sebenarnya bulat.
   */
  const selisihRekalkulasi = nolRupiah + bulatRupiah;
  if (selisihRekalkulasi !== 0) {
    q += 2;
    const arah = selisihRekalkulasi > 0 ? "lebih tinggi" : "lebih rendah";
    const sebab: string[] = [];
    if (nolBaris > 0) {
      sebab.push(
        `${nolBaris} baris yang Jumlah-nya tercatat 0 di berkas sumber padahal volume dan harga satuannya terisi ` +
          `(${formatRupiah(Math.abs(nolRupiah))}) – ini yang perlu diperiksa`,
      );
    }
    if (bulatBaris > 0) {
      sebab.push(
        `${bulatBaris} baris selisih pembulatan (${formatRupiah(Math.abs(bulatRupiah))}), karena harga satuan dicatat ` +
          `2 desimal sedangkan analisa harga satuan sumbernya lebih panjang`,
      );
    }
    res.getCell(q, 1).value =
      `Catatan: Jumlah tiap item di sheet "Detail RAB" berupa rumus Volume × Harga Satuan, dibulatkan ke rupiah. ` +
      `Saat Excel menghitung ulang, JUMLAH pra-PPN menjadi ${formatRupiah(Math.abs(selisihRekalkulasi))} ${arah} ` +
      `daripada nilai tersimpan ${formatRupiah(input.totalValue)}. Penyebabnya: ${sebab.join("; ")}. ` +
      `Bukan perubahan lingkup pekerjaan.`;
    res.getCell(q, 1).alignment = { wrapText: true, vertical: "top" };
    res.getCell(q, 1).font = { size: 9, italic: true };
    res.mergeCells(q, 1, q, 3);
    res.getRow(q).height = 56;
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
