import "server-only";
import type { KkpDailyData } from "@/components/knmp/kkp-daily-report";
import { susunKartu, terbilang } from "@/lib/daily-report/kkp-lampiran-susun";
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

/**
 * Terbilang & pengelompokan kartu tinggal di modul MURNI
 * (`lib/daily-report/kkp-lampiran-susun.ts`) supaya halaman cetak HTML memakai
 * susunan yang sama persis tanpa ikut menarik pdfkit. Di-re-export agar
 * pemanggil lama tidak berubah.
 */
export { susunKartu, terbilang };

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

export function gambarSampul(
  doc: PdfDoc,
  d: KkpDailyData,
  logoPemilik: Buffer | null,
  logoVendor: Buffer | null,
  logoPengawas: Buffer | null = null,
) {
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
     melayani klien mana pun (DECISIONS 166).

     PITA TERANG, teks gelap. Versi pertama memakai navy pekat dan user
     langsung menolaknya: *"warnamu terlalu gelap, tabrakan dengan logo"* —
     betul, lambang instansi umumnya berwarna gelap/emas dan hilang di atas
     latar pekat. Kop asli KKP pun biru muda dengan tulisan hitam. Latar
     terang juga aman untuk logo klien mana pun, yang tidak bisa kita atur.

     Alamat & kontak dicetak APA ADANYA dari `ownerAddress`, baris per baris.
     Sebelumnya kop cuma memuat nama + keterangan, dan seluruh baris alamat,
     telepon, laman, surel tidak punya tempat sama sekali. */
  const barisAlamat = (d.ownerAddress ?? "")
    .split(/\r?\n/)
    .map((t) => t.trim())
    .filter(Boolean);
  const tinggiKop = Math.max(64, 40 + barisAlamat.length * 11 + (d.ownerSubtitle ? 13 : 0));
  doc.save().rect(dalam, y, lebarDalam, tinggiKop).fill(R.primary50).restore();
  doc.lineWidth(0.6).strokeColor(R.border).rect(dalam, y, lebarDalam, tinggiKop).stroke();
  const sisiLogo = Math.min(tinggiKop - 12, 52);
  if (logoPemilik) logoDiKotak(doc, logoPemilik, dalam + 10, y + (tinggiKop - sisiLogo) / 2, sisiLogo, sisiLogo);
  const xTeks = dalam + (logoPemilik ? sisiLogo + 20 : 10);
  const wTeks = lebarDalam - (xTeks - dalam) - 10;
  let ky = y + 9;
  doc.font(PDF_FONT.bold).fontSize(12).fillColor(R.ink)
    .text((d.ownerName ?? "").toUpperCase(), xTeks, ky, { width: wTeks, align: "center", lineBreak: false });
  ky += 16;
  if (d.ownerSubtitle) {
    doc.font(PDF_FONT.regular).fontSize(9.5).fillColor(R.ink)
      .text(d.ownerSubtitle.toUpperCase(), xTeks, ky, { width: wTeks, align: "center", lineBreak: false });
    ky += 13;
  }
  for (const t of barisAlamat) {
    doc.font(PDF_FONT.regular).fontSize(7.5).fillColor(R.inkMuted)
      .text(t.toUpperCase(), xTeks, ky, { width: wTeks, align: "center", lineBreak: false });
    ky += 11;
  }
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

  /* ── Dua pihak di kaki halaman: KOP BERLOGO + garis tanda tangan ──────
     Mengikuti contoh user: tiap pihak tampil sebagai KOP PERUSAHAAN (logo di
     kiri, nama + alamat di kanan, dalam kotak), lalu garis tanda tangan di
     bawahnya. Versi pertama hanya menulis NAMA perusahaan di atas garis —
     itu mengganti kop dengan tanda tangan, dan user langsung menegurnya.
     Kop-nya yang menyatakan siapa pihaknya; garisnya cuma tempat paraf. */
  const tinggiKotak = 40;
  const tinggiBlok = 100;
  const yTtd = bawah - 16 - tinggiBlok;
  const wKolom = lebarDalam / 2;
  const kolom = (
    kx: number,
    judul: string,
    firma: string | null | undefined,
    logo: Buffer | null,
    alamat?: string | null,
  ) => {
    const w = wKolom - 16;
    doc.font(PDF_FONT.bold).fontSize(9.5).fillColor(R.ink)
      .text(judul, kx, yTtd, { width: w, align: "center", lineBreak: false });

    const yk = yTtd + 16;
    doc.lineWidth(0.6).strokeColor(R.inkMuted).rect(kx, yk, w, tinggiKotak).stroke();
    if (logo) logoDiKotak(doc, logo, kx + 4, yk + 4, 40, tinggiKotak - 8);
    const xn = kx + (logo ? 50 : 8);
    const wn = w - (xn - kx) - 8;
    doc.font(PDF_FONT.bold).fontSize(7.5).fillColor(R.ink)
      .text((firma || "……………………………………").toUpperCase(), xn, yk + 7, { width: wn, lineBreak: false });
    if (alamat)
      doc.font(PDF_FONT.regular).fontSize(5.5).fillColor(R.inkMuted)
        .text(alamat, xn, yk + 18, { width: wn, height: tinggiKotak - 22 });

    // Garis paraf pada ketinggian yang SAMA di kedua kolom — di contoh
    // keduanya melayang beda tinggi mengikuti panjang teks.
    const yGaris = yTtd + tinggiBlok - 4;
    doc.lineWidth(0.6).strokeColor(R.inkMuted)
      .moveTo(kx + w / 2 - 58, yGaris).lineTo(kx + w / 2 + 58, yGaris).stroke();
  };
  kolom(dalam, "KONSULTAN PENGAWAS", d.supervisorFirm ?? d.supervisorSub, logoPengawas);
  kolom(dalam + wKolom, "KONTRAKTOR PELAKSANA", d.contractorFirm, logoVendor, d.contractorAddress);
}

/* ─────────────────────── DOKUMENTASI PEKERJAAN ────────────────────────── */

export type FotoDok = {
  buf: Buffer;
  pekerjaan: string | null;
  kategori: string | null;
  bobot: number | null;
  /**
   * Tautan ke gambar PENUH di cloud (`/api/foto/<token>`, DECISIONS 125).
   *
   * Permintaan user 2026-08-07: *"fotonya harusnya juga bisa diklik ke ukuran
   * yang lebih besar/cloud. tapi tidak perlu di crop, apa adanya seperti
   * sekarang, hanya beri link ke gambar yang lebih besar."* — jadi gambarnya
   * TIDAK disentuh sama sekali; yang ditambah hanya area klik di atasnya.
   *
   * null = origin publik tidak diketahui (mis. dipanggil dari cron tanpa
   * request). URL yang dikarang lebih buruk daripada tidak ada tautan, jadi
   * kotaknya cukup tidak bisa diklik.
   */
  link?: string | null;
};

const pctFmt = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
    // Seluruh kotak gambar jadi area klik ke versi penuh di cloud. Dipasang
    // SESUDAH gambarnya, dan di luar try: foto yang gagal ditempel pun tetap
    // layak ditautkan — justru di situ orang paling butuh melihat aslinya.
    if (f.link) doc.link(x, y, kolomFoto[0], tinggiFoto, f.link);
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
