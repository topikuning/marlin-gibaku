import "server-only";
import type { KkpDailyData } from "@/components/knmp/kkp-daily-report";
import { PDF_COLORS, PDF_FONT, FORM_MARGIN, type PdfDoc } from "./document";
import { colWidths, gridRow, gridRowHeight, type GridCell, type GridOptions } from "./grid";

/**
 * SAMPUL + DOKUMENTASI PEKERJAAN untuk laporan harian format KKP.
 *
 * Bentuk dokumen yang diminta user 2026-08-07, mengikuti contoh terbitan
 * konsultan pengawas di lapangan:
 *
 *   halaman 1  — sampul (identitas kontrak + tanda tangan dua pihak)
 *   halaman 2  — blanko harian, APA ADANYA (tidak disentuh modul ini)
 *   halaman 3+ — DOKUMENTASI PEKERJAAN: kartu dua kolom berisi kop
 *                perusahaan pelaksana, nama pekerjaan, lalu foto-fotonya
 *
 * *"kamu ikuti layoutnya, tapi buat lebih rapi dan profesional."* — jadi
 * susunannya ditiru, sementara garis putus-putus, kotak logo yang menempel
 * seenaknya, dan judul yang berdesakan diganti kerangka bergaris tipis dengan
 * jarak yang tetap.
 *
 * Dipisah dari `harian-kkp.ts` dengan sengaja: berkas itu sudah memuat seluruh
 * blanko resmi dan tidak boleh ikut berubah setiap kali sampul dipoles.
 */

const R = PDF_COLORS;

/** Angka minggu jadi terbilang: "MINGGU KE-2 (DUA)" seperti contoh KKP. */
const TERBILANG = [
  "NOL", "SATU", "DUA", "TIGA", "EMPAT", "LIMA", "ENAM", "TUJUH", "DELAPAN",
  "SEMBILAN", "SEPULUH", "SEBELAS", "DUA BELAS", "TIGA BELAS", "EMPAT BELAS",
  "LIMA BELAS", "ENAM BELAS", "TUJUH BELAS", "DELAPAN BELAS", "SEMBILAN BELAS",
  "DUA PULUH",
];
export function terbilang(n: number): string | null {
  if (!Number.isInteger(n) || n < 0) return null;
  if (n <= 20) return TERBILANG[n];
  if (n < 100) {
    const p = Math.floor(n / 10);
    const s = n % 10;
    return `${TERBILANG[p]} PULUH${s ? ` ${TERBILANG[s]}` : ""}`;
  }
  return null; // di atas 99 tidak pernah terjadi untuk nomor minggu proyek
}

/**
 * Bundel pdfkit yang di-vendor TIDAK mengenali `Buffer` Node.
 *
 * Bundelnya membawa polyfill `Buffer` sendiri, jadi `Buffer.isBuffer()` di
 * dalamnya menolak Buffer asli Node; pdfkit lalu menganggap masukannya sebuah
 * PATH dan jatuh ke `fs.readFileSync` — yang juga tidak ada di bundel itu.
 * Hasilnya galat `fs.readFileSync is not a function`, dan tanpa penjagaan
 * gambarnya hilang DIAM-DIAM.
 *
 * Diuji langsung terhadap `assets/pdfkit-standalone.cjs`: Buffer GAGAL,
 * Uint8Array GAGAL, ArrayBuffer BERHASIL, data-URI berhasil. ArrayBuffer
 * dipilih karena tanpa biaya penyandian base64.
 */
function sebagaiArrayBuffer(b: Buffer): ArrayBuffer {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

/** Gambar logo di dalam kotak, mempertahankan rasio. Gagal → dilewati diam. */
function logoDiKotak(doc: PdfDoc, buf: Buffer, x: number, y: number, w: number, h: number) {
  try {
    doc.image(sebagaiArrayBuffer(buf), x, y, { fit: [w, h], align: "center", valign: "center" });
  } catch {
    /* Logo rusak/format tak didukung tidak boleh menggagalkan laporan. */
  }
}

/* ────────────────────────────── SAMPUL ────────────────────────────────── */

export function gambarSampul(doc: PdfDoc, d: KkpDailyData, logoPemilik: Buffer | null, logoVendor: Buffer | null) {
  const x = FORM_MARGIN;
  const width = doc.page.width - FORM_MARGIN * 2;
  const bawah = doc.page.height - FORM_MARGIN;

  // Bingkai luar. Contohnya memakai garis putus-putus; di sini garis tipis
  // penuh — sama tegasnya, jauh lebih rapi saat dicetak.
  doc.lineWidth(0.75).strokeColor(R.inkMuted).rect(x, FORM_MARGIN, width, bawah - FORM_MARGIN).stroke();

  const dalam = x + 16;
  const lebarDalam = width - 32;
  let y = FORM_MARGIN + 16;

  /* ── Kop pemilik pekerjaan ────────────────────────────────────────────
     Identitasnya dari menu Sistem, BUKAN hardcode KKP — satu basis kode
     melayani klien mana pun (DECISIONS 166). */
  const tinggiKop = 58;
  doc.save().rect(dalam, y, lebarDalam, tinggiKop).fill(R.primary).restore();
  if (logoPemilik) logoDiKotak(doc, logoPemilik, dalam + 10, y + 7, 44, 44);
  const xTeks = dalam + (logoPemilik ? 62 : 10);
  const wTeks = lebarDalam - (logoPemilik ? 72 : 20);
  doc
    .font(PDF_FONT.bold)
    .fontSize(11)
    .fillColor(R.white)
    .text((d.ownerName ?? "").toUpperCase(), xTeks, y + 14, { width: wTeks, align: "center", lineBreak: false });
  if (d.ownerSubtitle)
    doc
      .font(PDF_FONT.regular)
      .fontSize(8.5)
      .fillColor(R.white)
      .text(d.ownerSubtitle.toUpperCase(), xTeks, y + 30, { width: wTeks, align: "center", lineBreak: false });
  y += tinggiKop + 46;

  /* ── Judul ────────────────────────────────────────────────────────── */
  doc.font(PDF_FONT.bold).fontSize(20).fillColor(R.ink)
    .text("LAPORAN HARIAN", dalam, y, { width: lebarDalam, align: "center" });
  y += 34;

  const bilangan = d.weekNo != null ? terbilang(d.weekNo) : null;
  if (d.weekNo != null) {
    doc.font(PDF_FONT.bold).fontSize(14).fillColor(R.ink).text(
      `MINGGU KE-${d.weekNo}${bilangan ? ` (${bilangan})` : ""}`,
      dalam,
      y,
      { width: lebarDalam, align: "center" },
    );
    y += 30;
  }

  /* ── Identitas kontrak ────────────────────────────────────────────────
     Baris label–isi yang sejajar. Di contoh, "PERIODE : … S/D …" tersebar
     dengan jarak tab yang tidak konsisten sehingga sulit dipindai; di sini
     labelnya rata kanan pada satu sumbu dan isinya rata kiri pada sumbu lain. */
  const baris = (label: string, isi: string | null | undefined) => {
    if (!isi) return;
    const wLabel = lebarDalam * 0.34;
    const wIsi = lebarDalam - wLabel - 12;
    doc.font(PDF_FONT.regular).fontSize(10).fillColor(R.inkMuted)
      .text(label, dalam, y, { width: wLabel, align: "right", lineBreak: false });
    doc.font(PDF_FONT.bold).fontSize(10).fillColor(R.ink)
      .text(`:  ${isi}`, dalam + wLabel + 12, y, { width: wIsi });
    // Maju setinggi teks yang BENAR-BENAR tergambar. Dulu majunya tetap 20 pt,
    // jadi judul pekerjaan yang turun ke baris kedua ditabrak baris LOKASI di
    // bawahnya — cacat yang langsung terlihat pada kontrak bernama panjang,
    // dan nama kontrak KKP memang selalu panjang.
    const tinggi = doc.heightOfString(`:  ${isi}`, { width: wIsi });
    y += Math.max(20, tinggi + 8);
  };

  y += 8;
  if (d.periodStart && d.periodEnd) baris("PERIODE", `${d.periodStart}  s/d  ${d.periodEnd}`);
  baris("NOMOR KONTRAK", d.contractNumber);
  baris("TANGGAL KONTRAK", d.contractDate);
  y += 10;
  baris("PEKERJAAN", d.pekerjaan);
  baris("LOKASI", `${d.locationName} — ${d.regency}, ${d.province}`);
  baris("TAHUN ANGGARAN", String(d.tahunAnggaran));

  /* ── Tanda tangan dua pihak, menempel di kaki halaman ─────────────── */
  const tinggiTtd = 118;
  const yTtd = bawah - 16 - tinggiTtd;
  const wKolom = lebarDalam / 2;
  const kolom = (kx: number, judul: string, firma: string | null | undefined, logo: Buffer | null, alamat?: string | null) => {
    doc.font(PDF_FONT.bold).fontSize(9.5).fillColor(R.ink)
      .text(judul, kx, yTtd, { width: wKolom - 12, align: "center", lineBreak: false });
    let ky = yTtd + 18;
    if (logo) {
      logoDiKotak(doc, logo, kx + (wKolom - 12) / 2 - 26, ky, 52, 26);
      ky += 30;
    }
    doc.font(PDF_FONT.bold).fontSize(9).fillColor(R.ink)
      .text(firma || "……………………………………", kx, ky, { width: wKolom - 12, align: "center" });
    ky = doc.y + 2;
    if (alamat)
      doc.font(PDF_FONT.regular).fontSize(6.5).fillColor(R.inkMuted)
        .text(alamat, kx + 10, ky, { width: wKolom - 32, align: "center" });
    // Garis tanda tangan selalu di ketinggian yang SAMA di kedua kolom —
    // di contoh keduanya melayang beda tinggi karena mengikuti panjang teks.
    const yGaris = yTtd + tinggiTtd - 16;
    doc.lineWidth(0.6).strokeColor(R.inkMuted)
      .moveTo(kx + (wKolom - 12) / 2 - 55, yGaris).lineTo(kx + (wKolom - 12) / 2 + 55, yGaris).stroke();
  };
  kolom(dalam, "KONSULTAN PENGAWAS", d.supervisorFirm ?? d.supervisorSub, null);
  kolom(dalam + wKolom, "KONTRAKTOR PELAKSANA", d.contractorFirm, logoVendor, d.contractorAddress);
}

/* ─────────────────────── DOKUMENTASI PEKERJAAN ────────────────────────── */

export type FotoDok = {
  buf: Buffer;
  pekerjaan: string | null;
  kategori: string | null;
  bobot: number | null;
};

/** Maksimal foto per kartu — 3 seperti contoh, supaya tiap foto masih terbaca. */
const FOTO_PER_KARTU = 3;
const pctFmt = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Kelompokkan foto per PEKERJAAN, lalu pecah tiap kelompok jadi kartu berisi
 * maksimal 3 foto. Foto tanpa item tetap dicetak di kartu tersendiri — bukti
 * yang tidak tertaut pekerjaan tetap bukti, dan menghilangkannya diam-diam
 * membuat orang mengira fotonya tidak terunggah.
 */
export function susunKartu(foto: FotoDok[]): FotoDok[][] {
  const grup = new Map<string, FotoDok[]>();
  for (const f of foto) {
    const kunci = f.pekerjaan ?? " tanpa-item";
    const arr = grup.get(kunci) ?? [];
    arr.push(f);
    grup.set(kunci, arr);
  }
  const kartu: FotoDok[][] = [];
  for (const arr of grup.values())
    for (let i = 0; i < arr.length; i += FOTO_PER_KARTU) kartu.push(arr.slice(i, i + FOTO_PER_KARTU));
  return kartu;
}

/** Gambar satu kartu dokumentasi; kembalikan tinggi terpakai. */
function gambarKartu(
  doc: PdfDoc,
  kartu: FotoDok[],
  x: number,
  y: number,
  w: number,
  vendor: { nama: string | null | undefined; alamat: string | null | undefined; logo: Buffer | null },
  tinggiFoto: number,
): number {
  const y0 = y;
  const opsi = (cols: number[], fontSize = 7): GridOptions => ({ x, width: w, cols, fontSize });

  /* Kop perusahaan pelaksana — sama di tiap kartu, seperti contoh. */
  const hKop = 30;
  doc.lineWidth(0.6).strokeColor(R.inkMuted).rect(x, y, w, hKop).stroke();
  if (vendor.logo) logoDiKotak(doc, vendor.logo, x + 4, y + 4, 34, hKop - 8);
  const xk = x + (vendor.logo ? 42 : 6);
  doc.font(PDF_FONT.bold).fontSize(7).fillColor(R.ink)
    .text((vendor.nama ?? "").toUpperCase(), xk, y + 6, { width: w - (xk - x) - 6, lineBreak: false });
  if (vendor.alamat)
    doc.font(PDF_FONT.regular).fontSize(5.5).fillColor(R.inkMuted)
      .text(vendor.alamat, xk, y + 15, { width: w - (xk - x) - 6, height: 12 });
  y += hKop;

  /* Judul + identitas pekerjaan. */
  y = gridRow(doc, y, [{ text: "DOKUMENTASI PEKERJAAN", head: true, align: "center" }], opsi([w], 9));
  const pekerjaan = kartu[0]?.pekerjaan;
  const kategori = kartu[0]?.kategori;
  const label = colWidths(w, [1.1, 3.4]);
  y = gridRow(doc, y, [{ text: "Pekerjaan" }, { text: pekerjaan ?? "(tanpa item pekerjaan)", bold: true }], opsi(label));
  y = gridRow(doc, y, [{ text: "Bangunan" }, { text: kategori ?? "—" }], opsi(label));

  /* Foto: baris judul (nama pekerjaan | Bobot %) lalu baris gambar. */
  const kolomFoto = colWidths(w, [4.2, 1]);
  for (const f of kartu) {
    const judul: GridCell[] = [
      { text: f.pekerjaan ?? "Dokumentasi lapangan", align: "center", head: true },
      { text: "Bobot (%)", align: "center", head: true },
    ];
    y = gridRow(doc, y, judul, opsi(kolomFoto, 6.5));
    // Kotak gambar + kotak bobot dengan tinggi yang SAMA supaya garisnya
    // bertemu — di contoh keduanya kerap meleset satu-dua milimeter.
    doc.lineWidth(0.6).strokeColor(R.inkMuted).rect(x, y, kolomFoto[0], tinggiFoto).stroke();
    doc.rect(x + kolomFoto[0], y, kolomFoto[1], tinggiFoto).stroke();
    try {
      doc.image(sebagaiArrayBuffer(f.buf), x + 2, y + 2, {
        fit: [kolomFoto[0] - 4, tinggiFoto - 4],
        align: "center",
        valign: "center",
      });
    } catch (e) {
      console.error("[kkp-lampiran] foto gagal ditempel:", (e as Error).message);
      doc.font(PDF_FONT.regular).fontSize(6).fillColor(R.inkFaint)
        .text("foto tidak dapat dimuat", x + 4, y + tinggiFoto / 2 - 4, { width: kolomFoto[0] - 8, align: "center" });
    }
    // Bobot DIISI bila diketahui. Contoh KKP membiarkannya kosong untuk
    // ditulis tangan; angkanya sudah ada di sistem, jadi mengosongkannya
    // justru menyuruh orang menghitung ulang yang sudah dihitung.
    doc.font(PDF_FONT.bold).fontSize(7.5).fillColor(R.ink).text(
      f.bobot != null ? pctFmt.format(f.bobot) : "",
      x + kolomFoto[0],
      y + tinggiFoto / 2 - 5,
      { width: kolomFoto[1], align: "center", lineBreak: false },
    );
    y += tinggiFoto;
  }
  return y - y0;
}

/**
 * Halaman-halaman dokumentasi: dua kartu berdampingan per halaman.
 * Tidak menggambar apa pun bila tidak ada foto — halaman kosong berjudul
 * "DOKUMENTASI PEKERJAAN" hanya membuat pembaca mengira fotonya hilang.
 */
export function gambarDokumentasi(doc: PdfDoc, d: KkpDailyData, foto: FotoDok[], mulaiHalamanBaru: () => void) {
  const kartu = susunKartu(foto);
  if (kartu.length === 0) return;

  const x = FORM_MARGIN;
  const width = doc.page.width - FORM_MARGIN * 2;
  const gap = 14;
  const wKartu = (width - gap) / 2;
  const bawah = doc.page.height - FORM_MARGIN - 12;
  const vendor = { nama: d.contractorFirm, alamat: d.contractorAddress, logo: null as Buffer | null };

  for (let i = 0; i < kartu.length; i += 2) {
    mulaiHalamanBaru();
    let y = FORM_MARGIN;
    // Tinggi foto dihitung dari ruang yang tersisa supaya kartu paling penuh
    // tetap muat satu halaman — bukan angka tetap yang kadang meluber.
    const terbanyak = Math.max(kartu[i].length, kartu[i + 1]?.length ?? 0);
    const sisa = bawah - y - 30 /* kop */ - 3 * 14 /* judul + 2 baris identitas */ - terbanyak * 12;
    const tinggiFoto = Math.max(90, Math.min(150, Math.floor(sisa / terbanyak)));
    gambarKartu(doc, kartu[i], x, y, wKartu, vendor, tinggiFoto);
    if (kartu[i + 1]) gambarKartu(doc, kartu[i + 1], x + wKartu + gap, y, wKartu, vendor, tinggiFoto);
    y = bawah;
  }
}

/** Dipakai uji: tinggi baris grid (re-export supaya modul uji tak menyentuh grid). */
export { gridRowHeight };
