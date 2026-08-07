import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { isR2Configured, r2GetBuffer } from "@/lib/r2";
import { getRingkasHarian, type RingkasFoto, type RingkasHarian } from "@/lib/daily-report/ringkas";
import { formatRupiah, formatTanggal, formatTanggalWaktu, lokasiDenganWilayah } from "@/lib/format";
import { REPORT_STATUS_LABEL } from "@/lib/lifecycle";
import { formatCoordinate } from "@/lib/photo-stamp/format";
import { signPhotoToken } from "@/lib/pdf/photo-token";
import {
  A4,
  CONTENT_BOTTOM,
  CONTENT_WIDTH,
  PAGE_MARGIN,
  PDF_COLORS,
  PDF_FONT,
  createA4Doc,
  docToBuffer,
  ensureSpace,
  sanitizeText,
  stampFooters,
  type PdfDoc,
} from "./document";

/**
 * LAPORAN HARIAN — RINGKASAN. Dokumen bacaan untuk dikirim ke grup WhatsApp
 * paket (PPK, dinas, pejabat). BUKAN blanko KKP. DECISIONS 261.
 *
 * ### Susunannya, dan kenapa begitu
 *
 * Mengikuti kebiasaan laporan pemantauan proyek internasional (site supervision
 * daily report ala Bank Dunia/ADB, catatan harian FIDIC). Empat aturan yang
 * membentuk halaman ini:
 *
 * 1. **Identitas dulu, lengkap.** Paket, pekerjaan, kontrak, lokasi, hari,
 *    minggu ke berapa. Dokumen yang beredar di grup harus bisa diarsipkan
 *    tanpa bertanya "ini punya paket mana".
 * 2. **Keadaan dokumen dinyatakan.** Karena pengiriman TIDAK digerbangi status
 *    (keputusan user 2026-08-05), draf pun bisa terkirim — maka pembaca harus
 *    melihat sendiri bahwa yang ia pegang belum diverifikasi. Pita statusnya
 *    berwarna dan berada di atas segalanya.
 * 3. **Kinerja mendahului rincian** (kebiasaan Earned Value): posisi kumulatif,
 *    rencana kurva-S, deviasi, dan sumbangan hari itu — sebelum daftar
 *    pekerjaan. Yang membaca di HP sering berhenti di layar pertama.
 * 4. **Bukti punya asal-usul.** Tiap foto menyebut ia bukti apa, kapan diambil,
 *    dan di mana — termasuk penanda bila koordinatnya CADANGAN titik proyek,
 *    bukan GPS perangkat (DECISIONS 197).
 *
 * Tidak ada satu pun angka yang dihitung di berkas ini; semuanya datang dari
 * `getRingkasHarian` yang mengambilnya dari `progress.ts`/`progress-calc.ts`.
 */

export type HarianRingkasPdfResult = {
  buffer: Buffer;
  locationId: string;
  locationName: string;
  dateKey: string;
};

/**
 * Foto siap-tanam (murni, tanpa I/O saat menggambar).
 *
 * `link` = URL publik MARLIN ke gambar PENUH (tak ter-crop). Wajib ada bila
 * origin-nya diketahui: foto di dokumen ini DIPANGKAS ke kotak 4:3, dan
 * memangkas bukti tanpa menyediakan jalan ke aslinya berarti menghilangkan
 * bagian gambar tanpa ada yang bisa memeriksanya. Pola dan tokennya sama persis
 * dengan PDF kegiatan lapangan (DECISIONS 125).
 */
export type FotoTertanam = {
  jpeg: Buffer;
  sumber: string;
  sub: string | null;
  link?: string | null;
};

const nf0 = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf3 = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 });
const pct = (n: number) => `${nf2.format(n)}%`;
const signedPct = (n: number) => `${n >= 0 ? "+" : "−"}${nf2.format(Math.abs(n))}%`;

/** Warna pita status. `null` (belum ada laporan) sengaja punya warnanya sendiri. */
function statusTone(s: RingkasHarian["status"]): { bg: string; fg: string; label: string } {
  switch (s) {
    case "final":
      return { bg: "#dcfce7", fg: "#166534", label: "FINAL — ANGKA TERKUNCI" };
    case "disetujui":
      return { bg: "#dbeafe", fg: "#1e40af", label: "DISETUJUI — MENUNGGU FINALISASI" };
    case "dikirim":
      return { bg: "#fef3c7", fg: "#92400e", label: "DIKIRIM — BELUM DIVERIFIKASI" };
    case "perlu_koreksi":
      return { bg: "#fee2e2", fg: "#991b1b", label: "PERLU KOREKSI — DIKEMBALIKAN KE PELAPOR" };
    case "draft":
      return { bg: "#fee2e2", fg: "#991b1b", label: "DRAF — BELUM DIKIRIM PELAPOR" };
    default:
      return { bg: "#f1f5f9", fg: "#475569", label: "BELUM ADA LAPORAN HARIAN" };
  }
}

/** Nada deviasi — ambang yang sama dengan yang dipakai layar. */
function deviasiTone(d: number): string {
  if (d >= 0) return PDF_COLORS.success;
  if (d >= -5) return PDF_COLORS.warning;
  return "#b91c1c";
}

/* ── Renderer ────────────────────────────────────────────────────────────── */

/**
 * Susun PDF dari data siap-render. MURNI: tidak menyentuh DB/R2, sehingga tata
 * letaknya bisa diuji tanpa infrastruktur.
 */
export function buildHarianRingkasPdf(
  d: RingkasHarian,
  foto: FotoTertanam[],
  opts: { logoPerusahaan?: Buffer | null } = {},
): Promise<Buffer> {
  const doc = createA4Doc({
    title: `Ringkasan Pelaksanaan Harian — ${d.locationName} — ${d.dateKey}`,
  });

  kop(doc, d, opts.logoPerusahaan ?? null);
  pitaStatus(doc, d);
  identitas(doc, d);
  pitaKinerja(doc, d);
  bagianPekerjaan(doc, d);
  bagianKegiatan(doc, d);
  bagianKendala(doc, d);
  bagianKondisiKerja(doc, d);
  bagianFoto(doc, d, foto);

  // Kaki halaman DIPIMPIN identitas pekerjaan & perusahaannya, bukan MARLIN.
  // Wilayah ikut karena halaman kedua dan seterusnya (galeri foto) tidak memuat
  // blok identitas — di sana nama desa berdiri sendiri. MARLIN disebut terakhir,
  // sebagai alat pembuatnya (permintaan user 2026-08-06).
  // Provinsi SENGAJA tidak ikut di kaki: yang diminta adalah kabupatennya, dan
  // barisnya harus muat satu baris — versi dengan provinsi membungkus ke baris
  // kedua dan menabrak batas halaman. Provinsi tetap ada di blok identitas.
  // Waktu pembuatan TIDAK dicetak di kaki: barisnya jadi lewat satu baris, dan
  // PDF sudah menyimpannya sendiri di `CreationDate` — terbaca dari properti
  // berkas, jadi tidak ada provenance yang hilang.
  const kaki = [
    lokasiDenganWilayah(d.locationName, d.regency),
    d.tanggalFull,
    d.vendorName,
    `dibuat dengan ${d.appName}`,
  ].filter(Boolean);
  stampFooters(doc, sanitizeText(kaki.join(" · ")));
  return docToBuffer(doc);
}

/**
 * Ambil data + foto, lalu render. TIDAK melakukan otorisasi — pemanggil wajib
 * gate capability + akses lokasi.
 */
export async function renderHarianRingkasPdf(
  slug: string,
  dateKey: string,
  opts?: { baseUrl?: string | null },
): Promise<HarianRingkasPdfResult | null> {
  const d = await getRingkasHarian(slug, dateKey);
  if (!d) return null;

  // Foto best-effort: yang gagal diambil dilewati, dokumennya tetap terbentuk.
  // Laporan tanpa satu foto masih berguna; laporan yang gagal total tidak.
  const foto: FotoTertanam[] = [];
  let gagal = 0;
  const baseUrl = opts?.baseUrl?.replace(/\/+$/, "") || null;
  if (isR2Configured()) {
    for (const p of d.foto) {
      try {
        foto.push({
          jpeg: await normalisasiFoto(p.r2Key),
          sumber: p.sumber,
          sub: subFoto(p),
          // Tanpa origin yang diketahui, link TIDAK dikarang — URL yang salah
          // lebih buruk daripada tidak ada link.
          link: baseUrl ? `${baseUrl}/api/foto/${signPhotoToken(p.id)}` : null,
        });
      } catch {
        gagal++;
      }
    }
  }
  // Foto yang gagal diambil DITAMBAHKAN ke hitungan yang tidak dimuat, supaya
  // galeri yang lebih pendek dari kenyataan selalu mengatakan berapa kurangnya.
  const data: RingkasHarian = {
    ...d,
    fotoDisembunyikan: d.fotoDisembunyikan + gagal,
  };

  // Logo perusahaan pelaksana — best-effort. Gagal diambil berarti kop memakai
  // NAMA perusahaan sebagai ganti, bukan dokumen yang batal terbentuk.
  let logoPerusahaan: Buffer | null = null;
  if (isR2Configured() && d.vendorLogoKey) {
    try {
      logoPerusahaan = await sharp(await r2GetBuffer(d.vendorLogoKey))
        .resize({ width: 400, height: 160, fit: "inside", withoutEnlargement: true })
        .png()
        .toBuffer();
    } catch {
      logoPerusahaan = null;
    }
  }

  return {
    buffer: await buildHarianRingkasPdf(data, foto, { logoPerusahaan }),
    locationId: d.locationId,
    locationName: d.locationName,
    dateKey: d.dateKey,
  };
}

async function normalisasiFoto(r2Key: string): Promise<Buffer> {
  const raw = await r2GetBuffer(r2Key);
  return sharp(raw)
    .rotate() // hormati orientasi EXIF
    .resize({ width: 1000, height: 1000, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 76 })
    .toBuffer();
}

/**
 * Keterangan bawah foto: waktu + koordinat, dengan penanda GPS cadangan.
 *
 * Jam hanya dicetak bila jamnya MEMANG diketahui. Foto galeri tanpa EXIF cuma
 * membawa tanggal kerjanya; memformatnya lengkap menghasilkan "07.00" — jam
 * yang tidak pernah ada, dan di dokumen bukti itu bukan ketidakrapian
 * melainkan keterangan palsu (DECISIONS 197).
 */
function subFoto(p: RingkasFoto): string | null {
  const bagian: string[] = [];
  if (p.takenAt) {
    bagian.push(p.jamTidakDiketahui ? formatTanggal(p.takenAt) : formatTanggalWaktu(p.takenAt));
  }
  const koord = formatCoordinate(p.lat, p.lng);
  if (koord) bagian.push(p.gpsCadangan ? `${koord} (titik proyek, bukan GPS perangkat)` : koord);
  return bagian.length > 0 ? bagian.join("  ·  ") : null;
}

/* ── Bagian-bagian dokumen ───────────────────────────────────────────────── */

/**
 * KOP: logo perusahaan (kiri) · judul + tanggal (tengah) · MARLIN kecil (kanan).
 *
 * Susunan ini keputusan user 2026-08-06, dan intinya bukan tata letak melainkan
 * KEPEMILIKAN: *"jangan terlalu menonjolkan marlin di laporan-laporanmu … dengan
 * mindset laporan ini dibuat DENGAN marlin OLEH perusahaan."*
 *
 * Jadi yang memimpin halaman adalah **logo perusahaan pelaksana** — merekalah
 * yang bertanggung jawab atas isinya dan yang menyerahkannya ke PPK. MARLIN
 * turun jadi keterangan kecil di sudut kanan: alat yang dipakai, bukan penerbit
 * dokumen. Versi sebelumnya menaruh "MARLIN" tebal di kiri atas, dan itu
 * membaca seolah laporan ini terbitan MARLIN.
 *
 * Nama paket dibuang dari kop dan dari blok identitas (permintaan user yang
 * sama): pembaca dokumen ini butuh tahu LOKASI dan PEKERJAANNYA; nama paket
 * internal hanya menambah baris tanpa menambah keterangan.
 */
function kop(doc: PdfDoc, d: RingkasHarian, logoPerusahaan: Buffer | null): void {
  const top = PAGE_MARGIN;
  const blokW = 104; // lebar blok kiri & kanan; tengah memakai sisanya
  const tinggiKop = 28;

  /* Kiri — logo perusahaan, atau namanya bila logo belum diunggah. */
  if (logoPerusahaan) {
    doc.image(`data:image/png;base64,${logoPerusahaan.toString("base64")}`, PAGE_MARGIN, top, {
      fit: [blokW, tinggiKop],
      valign: "center",
    });
  } else if (d.vendorName) {
    doc
      .font(PDF_FONT.bold)
      .fontSize(8)
      .fillColor(PDF_COLORS.ink)
      .text(sanitizeText(d.vendorName), PAGE_MARGIN, top + 6, { width: blokW });
  }

  /* Tengah — judul dokumen + tanggalnya. Inilah yang dicari mata lebih dulu. */
  const tengahX = PAGE_MARGIN + blokW + 6;
  const tengahW = CONTENT_WIDTH - (blokW + 6) * 2;
  const judulTeks = "RINGKASAN PELAKSANAAN HARIAN";
  // Ukuran judul DIUKUR terhadap ruang yang tersedia, tidak dipatok. Judul yang
  // membungkus ke baris kedua menabrak baris tanggal di bawahnya — persis yang
  // terjadi pada percobaan pertama.
  let judulSize = 11.5;
  doc.font(PDF_FONT.bold);
  while (judulSize > 8 && doc.fontSize(judulSize).widthOfString(judulTeks) > tengahW - 2) {
    judulSize -= 0.25;
  }
  doc
    .fontSize(judulSize)
    .fillColor(PDF_COLORS.primary)
    .text(judulTeks, tengahX, top + 4, {
      width: tengahW,
      align: "center",
      lineBreak: false,
    });
  doc
    .font(PDF_FONT.regular)
    .fontSize(7.5)
    .fillColor(PDF_COLORS.inkMuted)
    .text(`${d.hari}, ${d.tanggalFull}`, tengahX, top + 5 + judulSize + 3, {
      width: tengahW,
      align: "center",
      lineBreak: false,
    });

  /* Kanan — MARLIN, sekecil keterangan alat. */
  const kananX = PAGE_MARGIN + CONTENT_WIDTH - blokW;
  doc
    .font(PDF_FONT.regular)
    .fontSize(5.5)
    .fillColor(PDF_COLORS.inkFaint)
    .text("DIBUAT DENGAN", kananX, top + 4, {
      width: blokW,
      align: "right",
      characterSpacing: 0.4,
      lineBreak: false,
    });
  // Wordmark ditulis sebagai TEKS, bukan gambar lockup: lockup penuh memuat
  // ikon + nama + tagline, dan pada ukuran sekecil ini taglinenya jadi bubur —
  // menonjol karena buram, bukan karena penting. Ikonnya saja yang dipakai.
  doc.font(PDF_FONT.bold).fontSize(8.5);
  const namaW = doc.widthOfString(sanitizeText(d.appName));
  const ikon = ikonMarlin();
  const ikonW = ikon ? 11 : 0;
  const barisX = kananX + blokW - namaW - (ikon ? ikonW + 3 : 0);
  if (ikon) {
    doc.image(`data:image/png;base64,${ikon.toString("base64")}`, barisX, top + 13, {
      fit: [ikonW, 11],
    });
  }
  doc
    .fillColor(PDF_COLORS.inkMuted)
    .text(sanitizeText(d.appName), barisX + (ikon ? ikonW + 3 : 0), top + 14.5, {
      lineBreak: false,
    });

  const lineY = top + tinggiKop + 3;
  doc
    .moveTo(PAGE_MARGIN, lineY)
    .lineTo(PAGE_MARGIN + CONTENT_WIDTH, lineY)
    .lineWidth(1.6)
    .strokeColor(PDF_COLORS.primary)
    .stroke();
  doc.y = lineY + 7;
  doc.x = PAGE_MARGIN;
}

/**
 * Ikon MARLIN dari `public/brand/` (dibawa image Docker, lihat Dockerfile).
 * Dibaca sekali lalu disimpan; gagal baca = kop memakai teks saja, bukan gagal
 * render — logo yang hilang tidak boleh membatalkan laporan.
 */
let ikonCache: Buffer | null | undefined;
function ikonMarlin(): Buffer | null {
  if (ikonCache !== undefined) return ikonCache;
  try {
    ikonCache = readFileSync(path.join(process.cwd(), "public", "brand", "marlin-icon-192.png"));
  } catch {
    ikonCache = null;
  }
  return ikonCache;
}

/**
 * Pita keadaan dokumen. Sengaja BESAR dan di atas: dokumen yang belum
 * diverifikasi tidak boleh terlihat sama dengan yang sudah.
 */
function pitaStatus(doc: PdfDoc, d: RingkasHarian): void {
  const t = statusTone(d.status);
  const h = 15;
  const y = doc.y;
  doc.roundedRect(PAGE_MARGIN, y, CONTENT_WIDTH, h, 4).fill(t.bg);
  doc
    .font(PDF_FONT.bold)
    .fontSize(7.5)
    .fillColor(t.fg)
    .text(sanitizeText(t.label), PAGE_MARGIN + 9, y + 4.3, {
      width: CONTENT_WIDTH - 20,
      characterSpacing: 0.5,
      lineBreak: false,
    });
  doc.y = y + h + 10;
  doc.x = PAGE_MARGIN;
}

/**
 * Blok identitas — KISI 3 KOLOM dengan label di ATAS nilainya.
 *
 * Versi pertama memakai dua kolom "label : nilai" bersebelahan, dan itu boros
 * pada dua arah sekaligus: kolom label memakan ~74pt lebar di tiap sisi,
 * sedangkan nama pekerjaan resmi (yang panjangnya wajar 100+ karakter) terpaksa
 * membungkus jadi lima baris di kolom setengah lebar — sementara kolom kanan
 * yang isinya pendek-pendek dibiarkan kosong sejajar dengannya.
 *
 * Sekarang: label kecil di atas nilai (tanpa kolom label), enam medan pendek
 * dalam kisi 3 kolom, dan nama pekerjaan mendapat barisnya sendiri selebar
 * halaman sehingga cukup dua baris.
 */
function identitas(doc: PdfDoc, d: RingkasHarian): void {
  const pad = 7;
  const gap = 10;
  const kolomW = (CONTENT_WIDTH - pad * 2 - gap * 2) / 3;
  const startY = doc.y;
  let y = startY + pad;

  const sel = (label: string, value: string, x: number, yy: number, w: number): number => {
    const val = sanitizeText(value || "—");
    doc
      .font(PDF_FONT.regular)
      .fontSize(5.8)
      .fillColor(PDF_COLORS.inkFaint)
      .text(sanitizeText(label).toUpperCase(), x, yy, { width: w, characterSpacing: 0.3, lineBreak: false });
    const h = doc.font(PDF_FONT.bold).fontSize(7.5).heightOfString(val, { width: w });
    doc.fillColor(PDF_COLORS.ink).text(val, x, yy + 7, { width: w });
    return yy + 7 + Math.max(9, h);
  };

  const baris = (kolom: [string, string][]): void => {
    let bawah = y;
    kolom.forEach(([label, value], i) => {
      const x = PAGE_MARGIN + pad + i * (kolomW + gap);
      bawah = Math.max(bawah, sel(label, value, x, y, kolomW));
    });
    y = bawah + 5;
  };

  baris([
    ["Lokasi", d.locationName],
    ["Wilayah", `${d.regency}, ${d.province}`],
    [
      "Minggu ke",
      d.totalWeeks > 0 ? `${d.weekNumber} dari ${d.totalWeeks}` : "belum ada baseline kurva-S",
    ],
  ]);
  // Nama pekerjaan & nomor kontrak berbagi satu baris terakhir: pekerjaan
  // mengambil sisa lebar (ia yang panjang), nomor kontrak kolom tetap di kanan.
  // Keduanya digambar dari y yang SAMA, lalu y turun ke yang paling bawah.
  const yBaris = y;
  const lebarKontrak = 150;
  const lebarPekerjaan = CONTENT_WIDTH - pad * 2 - lebarKontrak - gap;
  const bawahPekerjaan = sel("Pekerjaan", d.workTitle ?? "—", PAGE_MARGIN + pad, yBaris, lebarPekerjaan);
  const bawahKontrak = sel(
    "No. Kontrak",
    d.contractNumber ?? "—",
    PAGE_MARGIN + pad + lebarPekerjaan + gap,
    yBaris,
    lebarKontrak,
  );
  y = Math.max(bawahPekerjaan, bawahKontrak);

  const boxH = y - startY + pad - 2;
  doc
    .roundedRect(PAGE_MARGIN, startY, CONTENT_WIDTH, boxH, 4)
    .lineWidth(0.8)
    .strokeColor(PDF_COLORS.border)
    .stroke();
  doc.y = startY + boxH + 8;
  doc.x = PAGE_MARGIN;
}

/**
 * Pita kinerja: empat angka + batang perbandingan realisasi vs rencana.
 *
 * Ini bagian yang dibaca lebih dulu (dan sering satu-satunya yang dibaca), jadi
 * deviasi diberi warna dan diberi kalimat — angka telanjang "−99,74%" tidak
 * memberi tahu pembaca apa yang harus ia lakukan dengan itu.
 */
function pitaKinerja(doc: PdfDoc, d: RingkasHarian): void {
  const startY = doc.y;
  const pitaH = 30;
  const selW = CONTENT_WIDTH / 4;

  // Tanpa baseline, rencana & deviasi BUKAN nol — melainkan tidak diketahui.
  // Mencetak "0,00%" dan "+0,00%" berwarna hijau membuat lokasi tanpa kurva-S
  // terbaca "tepat jadwal", dan itu kebohongan yang tidak kelihatan.
  const adaBaseline = d.totalWeeks > 0;

  const sel: { label: string; nilai: string; warna: string }[] = [
    { label: "Realisasi s/d hari ini", nilai: pct(d.realizedPct), warna: PDF_COLORS.ink },
    {
      label: "Rencana kurva-S",
      nilai: adaBaseline ? pct(d.planPct) : "—",
      warna: adaBaseline ? PDF_COLORS.ink : PDF_COLORS.inkFaint,
    },
    {
      label: "Deviasi",
      nilai: adaBaseline ? signedPct(d.deviationPct) : "—",
      warna: adaBaseline ? deviasiTone(d.deviationPct) : PDF_COLORS.inkFaint,
    },
    {
      label: "Kemajuan hari ini",
      nilai: pct(d.bobotHariIni),
      warna: d.bobotHariIni > 0 ? PDF_COLORS.primary600 : PDF_COLORS.inkFaint,
    },
  ];

  // SATU pita dengan pemisah tipis, bukan empat kotak berjarak: empat angka
  // pendek tidak memerlukan empat bingkai beserta paddingnya masing-masing.
  doc.roundedRect(PAGE_MARGIN, startY, CONTENT_WIDTH, pitaH, 4).lineWidth(0.8).strokeColor(PDF_COLORS.border).stroke();
  sel.forEach((k, i) => {
    const x = PAGE_MARGIN + i * selW;
    if (i > 0) {
      doc
        .moveTo(x, startY + 5)
        .lineTo(x, startY + pitaH - 5)
        .lineWidth(0.6)
        .strokeColor(PDF_COLORS.border)
        .stroke();
    }
    doc
      .font(PDF_FONT.regular)
      .fontSize(5.8)
      .fillColor(PDF_COLORS.inkFaint)
      .text(sanitizeText(k.label).toUpperCase(), x + 8, startY + 5.5, {
        width: selW - 16,
        characterSpacing: 0.3,
        lineBreak: false,
      });
    doc
      .font(PDF_FONT.bold)
      .fontSize(11.5)
      .fillColor(k.warna)
      .text(k.nilai, x + 8, startY + 13.5, { width: selW - 16, lineBreak: false });
  });

  let y = startY + pitaH + 6;

  /**
   * SATU baris: batang realisasi + penanda tegak posisi rencana.
   *
   * Bentuk ini (bullet chart, Stephen Few) yang dipakai dashboard pemantauan
   * proyek serius, dan alasannya bukan selera: dua batang sejajar memaksa mata
   * membandingkan dua panjang di dua baris berbeda, sedangkan satu batang
   * dengan penanda target membuat jaraknya terbaca sebagai SATU gambar —
   * "sudah sampai mana" dan "seharusnya sampai mana" pada sumbu yang sama.
   *
   * Hanya digambar bila ada baseline: tanpa target, penandanya tidak punya
   * tempat berdiri dan batang kosong sepanjang halaman tidak mengatakan apa pun.
   */
  if (adaBaseline) {
    const barH = 7;
    // Ruang kanan diukur untuk MUAT SATU BARIS: "12,40%" + "rencana 90,18%".
    // Terlalu sempit → "rencana" dan angkanya patah ke dua baris, dan gagasan
    // "satu baris" itu sendiri yang hilang.
    const labelW = 122;
    const x0 = PAGE_MARGIN;
    const w = CONTENT_WIDTH - labelW;
    const skala = Math.max(100, d.realizedPct, d.planPct);

    doc.roundedRect(x0, y, w, barH, 3.5).fill("#eef2f7");
    const isi = Math.max(0, Math.min(1, d.realizedPct / skala)) * w;
    if (isi > 0.5) doc.roundedRect(x0, y, isi, barH, 3.5).fill(PDF_COLORS.primary600);

    // Penanda rencana: garis tegak yang MELEWATI tinggi batang, supaya tetap
    // terlihat walau persis berimpit dengan ujung isian.
    const xr = x0 + Math.max(0, Math.min(1, d.planPct / skala)) * w;
    doc
      .moveTo(xr, y - 2.5)
      .lineTo(xr, y + barH + 2.5)
      .lineWidth(1.8)
      .strokeColor("#dc2626")
      .stroke();

    doc
      .font(PDF_FONT.bold)
      .fontSize(7)
      .fillColor(PDF_COLORS.primary600)
      .text(pct(d.realizedPct), x0 + w + 6, y - 0.5, { width: 42, align: "right", lineBreak: false });
    doc
      .font(PDF_FONT.regular)
      .fontSize(6.5)
      .fillColor("#dc2626")
      .text(`rencana ${pct(d.planPct)}`, x0 + w + 54, y, {
        width: labelW - 54,
        align: "right",
        lineBreak: false,
      });
    y += barH + 6;
  }

  // Kalimat penutup pita: apa artinya angka-angka itu.
  const kalimat = !adaBaseline
    ? "Baseline kurva-S belum ada, jadi rencana dan deviasi belum bisa dihitung — bukan bernilai nol."
    : d.deviationPct >= 0
      ? `Realisasi berada ${signedPct(d.deviationPct)} terhadap rencana kurva-S minggu ke-${d.weekNumber}.`
      : `Realisasi tertinggal ${nf2.format(Math.abs(d.deviationPct))}% dari rencana kurva-S minggu ke-${d.weekNumber}.`;
  doc
    .font(PDF_FONT.regular)
    .fontSize(7)
    .fillColor(PDF_COLORS.inkMuted)
    .text(sanitizeText(kalimat), PAGE_MARGIN, y, { width: CONTENT_WIDTH });

  doc.y = doc.y + 9;
  doc.x = PAGE_MARGIN;
}

/** Judul bagian — garis tipis, huruf kapital kecil. Lebih ringan dari blanko. */
function judul(doc: PdfDoc, teks: string, catatan?: string): void {
  ensureSpace(doc, 40);
  const y = doc.y;
  doc
    .font(PDF_FONT.bold)
    .fontSize(8.5)
    .fillColor(PDF_COLORS.primary)
    .text(sanitizeText(teks).toUpperCase(), PAGE_MARGIN, y, {
      characterSpacing: 0.6,
      width: CONTENT_WIDTH * 0.65,
      lineBreak: false,
    });
  if (catatan) {
    doc
      .font(PDF_FONT.regular)
      .fontSize(6.5)
      .fillColor(PDF_COLORS.inkFaint)
      .text(sanitizeText(catatan), PAGE_MARGIN + CONTENT_WIDTH * 0.65, y + 1.5, {
        width: CONTENT_WIDTH * 0.35,
        align: "right",
        lineBreak: false,
      });
  }
  const lineY = y + 11;
  doc
    .moveTo(PAGE_MARGIN, lineY)
    .lineTo(PAGE_MARGIN + CONTENT_WIDTH, lineY)
    .lineWidth(1)
    .strokeColor(PDF_COLORS.primary600)
    .stroke();
  doc.y = lineY + 6;
  doc.x = PAGE_MARGIN;
}

function kosong(doc: PdfDoc, teks: string): void {
  doc
    .font(PDF_FONT.regular)
    .fontSize(7.5)
    .fillColor(PDF_COLORS.inkFaint)
    .text(sanitizeText(teks), PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH });
  doc.y += 8;
  doc.x = PAGE_MARGIN;
}

function bagianPekerjaan(doc: PdfDoc, d: RingkasHarian): void {
  judul(
    doc,
    "Pekerjaan hari ini",
    d.pekerjaan.length > 0 ? `${d.pekerjaan.length} item` : undefined,
  );

  if (d.pekerjaan.length === 0) {
    kosong(
      doc,
      d.status == null
        ? "Belum ada laporan harian untuk tanggal ini."
        : "Tidak ada volume pekerjaan yang dilaporkan pada tanggal ini.",
    );
  } else {
    const cols = [30, 0, 52, 62, 54, 84];
    cols[1] = CONTENT_WIDTH - cols.reduce((s, c) => s + c, 0);
    const head = ["Kode", "Uraian pekerjaan", "Satuan", "Volume", "Bobot", "Nilai"];
    const align: ("left" | "right" | "center")[] = [
      "left",
      "left",
      "center",
      "right",
      "right",
      "right",
    ];

    const barisHead = () => {
      const y = doc.y;
      doc.rect(PAGE_MARGIN, y, CONTENT_WIDTH, 13).fill("#f1f5f9");
      let x = PAGE_MARGIN;
      head.forEach((h, i) => {
        doc
          .font(PDF_FONT.bold)
          .fontSize(6.8)
          .fillColor(PDF_COLORS.inkMuted)
          .text(h, x + 4, y + 3.2, { width: cols[i] - 8, align: align[i], lineBreak: false });
        x += cols[i];
      });
      doc.y = y + 13;
    };
    ensureSpace(doc, 40);
    barisHead();

    for (const p of d.pekerjaan) {
      const sel = [
        p.code,
        p.name,
        p.unit ?? "—",
        nf3.format(p.volumeToday),
        pct(p.bobotToday),
        formatRupiah(p.valueToday),
      ];
      // Tinggi baris ditentukan kolom uraian (satu-satunya yang membungkus).
      const hUraian = doc
        .font(PDF_FONT.regular)
        .fontSize(7.2)
        .heightOfString(sanitizeText(p.name), { width: cols[1] - 8 });
      const h = Math.max(13, hUraian + 5);
      if (doc.y + h > CONTENT_BOTTOM) {
        doc.addPage();
        barisHead();
      }
      const y = doc.y;
      let x = PAGE_MARGIN;
      sel.forEach((s, i) => {
        doc
          .font(i === 4 ? PDF_FONT.bold : PDF_FONT.regular)
          .fontSize(7.2)
          .fillColor(PDF_COLORS.ink)
          .text(sanitizeText(s), x + 4, y + 2.5, {
            width: cols[i] - 8,
            align: align[i],
            lineBreak: i === 1,
          });
        x += cols[i];
      });
      doc
        .moveTo(PAGE_MARGIN, y + h)
        .lineTo(PAGE_MARGIN + CONTENT_WIDTH, y + h)
        .lineWidth(0.4)
        .strokeColor(PDF_COLORS.border)
        .stroke();
      doc.y = y + h;
    }

    // Jumlah — dicetak tebal, karena inilah yang dicocokkan pembaca dengan
    // "kemajuan hari ini" di pita atas.
    const y = doc.y;
    doc.rect(PAGE_MARGIN, y, CONTENT_WIDTH, 15).fill("#f8fafc");
    doc
      .font(PDF_FONT.bold)
      .fontSize(7.2)
      .fillColor(PDF_COLORS.ink)
      .text("JUMLAH HARI INI", PAGE_MARGIN + 4, y + 4, {
        width: cols[0] + cols[1] + cols[2] + cols[3] - 8,
        lineBreak: false,
      });
    doc.text(pct(d.bobotHariIni), PAGE_MARGIN + cols[0] + cols[1] + cols[2] + cols[3] + 4, y + 4, {
      width: cols[4] - 8,
      align: "right",
      lineBreak: false,
    });
    doc.text(
      formatRupiah(d.nilaiHariIni),
      PAGE_MARGIN + cols[0] + cols[1] + cols[2] + cols[3] + cols[4] + 4,
      y + 4,
      { width: cols[5] - 8, align: "right", lineBreak: false },
    );
    doc.y = y + 15 + 3;
  }

  // Baris draft adendum TIDAK dihitung — tapi disebut. Penghilangan yang diam
  // adalah cara dokumen berbohong (DECISIONS 210/215).
  if (d.draftItemCount > 0) {
    doc
      .font(PDF_FONT.regular)
      .fontSize(6.8)
      .fillColor(PDF_COLORS.warning)
      .text(
        sanitizeText(
          `Catatan: ${d.draftItemCount} baris lain dilaporkan atas usulan adendum yang belum resmi, ` +
            "sehingga TIDAK dihitung dalam angka di atas.",
        ),
        PAGE_MARGIN,
        doc.y,
        { width: CONTENT_WIDTH },
      );
  }
  doc.y += 8;
  doc.x = PAGE_MARGIN;
}

function bagianKegiatan(doc: PdfDoc, d: RingkasHarian): void {
  judul(
    doc,
    "Kegiatan lapangan hari ini",
    d.kegiatan.length > 0 ? `${d.kegiatan.length} kegiatan` : undefined,
  );
  if (d.kegiatan.length === 0) {
    kosong(doc, "Tidak ada kegiatan lapangan yang dicatat pada tanggal ini.");
    doc.y += 4;
    return;
  }

  for (const k of d.kegiatan) {
    ensureSpace(doc, 42);
    const y = doc.y;
    // Batang aksen di kiri: menandai satu blok kegiatan tanpa membuat kotak
    // penuh yang memakan ruang.
    const mulai = y;
    doc
      .font(PDF_FONT.bold)
      .fontSize(8.2)
      .fillColor(PDF_COLORS.ink)
      .text(sanitizeText(k.title), PAGE_MARGIN + 10, y, { width: CONTENT_WIDTH - 10 });
    const meta = [k.kindLabel, k.isFinal ? "final" : "draf"].join(" · ");
    doc
      .font(PDF_FONT.regular)
      .fontSize(6.8)
      .fillColor(PDF_COLORS.inkFaint)
      .text(sanitizeText(meta), PAGE_MARGIN + 10, doc.y + 1, { width: CONTENT_WIDTH - 10 });

    const tulis = (label: string, isi: string | null) => {
      if (!isi?.trim()) return;
      doc
        .font(PDF_FONT.bold)
        .fontSize(7)
        .fillColor(PDF_COLORS.inkMuted)
        .text(`${label}: `, PAGE_MARGIN + 10, doc.y + 2, { continued: true })
        .font(PDF_FONT.regular)
        .fillColor(PDF_COLORS.ink)
        .text(sanitizeText(isi.trim()), { width: CONTENT_WIDTH - 20 });
    };
    tulis("Peserta", k.participants);
    tulis("Uraian", k.notes);
    tulis("Kendala", k.kendala);
    tulis("Tindak lanjut", k.solusi);

    doc
      .rect(PAGE_MARGIN, mulai, 2.5, Math.max(14, doc.y - mulai))
      .fill(PDF_COLORS.primary600);
    doc.y += 9;
    doc.x = PAGE_MARGIN;
  }
  doc.y += 2;
}

function bagianKendala(doc: PdfDoc, d: RingkasHarian): void {
  if (d.kendala.length === 0) return;
  judul(doc, "Permasalahan tercatat", `${d.kendala.length}`);
  for (const k of d.kendala) {
    ensureSpace(doc, 16);
    doc
      .font(PDF_FONT.regular)
      .fontSize(7.5)
      .fillColor(PDF_COLORS.ink)
      .text(
        sanitizeText(`• ${k.title}  —  tingkat ${k.severity}, status ${k.status}`),
        PAGE_MARGIN,
        doc.y,
        { width: CONTENT_WIDTH },
      );
    doc.y += 2;
  }
  doc.y += 7;
  doc.x = PAGE_MARGIN;
}

function bagianKondisiKerja(doc: PdfDoc, d: RingkasHarian): void {
  judul(doc, "Kondisi kerja");

  const jam =
    d.workStart && d.workEnd ? `${d.workStart} – ${d.workEnd}` : (d.workStart ?? d.workEnd ?? "—");
  const tenagaTeks =
    d.tenaga.length > 0
      ? `${nf0.format(d.totalTenaga)} orang — ${d.tenaga.map((t) => `${t.label} ${t.count}`).join(", ")}`
      : "tidak dilaporkan";
  const materialTeks =
    d.material.length > 0
      ? d.material
          .map((m) => `${m.name}${m.qty != null ? ` ${nf3.format(m.qty)}${m.unit ? ` ${m.unit}` : ""}` : ""}`)
          .join(", ")
      : "tidak ada pemasukan";
  const alatTeks =
    d.peralatan.length > 0
      ? d.peralatan.map((e) => `${e.name} (${e.count})`).join(", ")
      : "tidak dilaporkan";

  const rows: [string, string][] = [
    ["Cuaca", d.cuaca ?? "tidak dicatat"],
    ["Jam kerja", jam],
    ["Tenaga kerja", tenagaTeks],
    ["Material masuk", materialTeks],
    ["Peralatan", alatTeks],
  ];
  if (d.catatan?.trim()) rows.push(["Catatan lapangan", d.catatan.trim()]);

  for (const [label, value] of rows) {
    const val = sanitizeText(value);
    const valW = CONTENT_WIDTH - 88;
    const h = doc.font(PDF_FONT.regular).fontSize(7.5).heightOfString(val, { width: valW });
    ensureSpace(doc, h + 6);
    const y = doc.y;
    doc
      .font(PDF_FONT.regular)
      .fontSize(7)
      .fillColor(PDF_COLORS.inkFaint)
      .text(sanitizeText(label), PAGE_MARGIN, y + 0.5, { width: 82, lineBreak: false });
    doc
      .font(PDF_FONT.regular)
      .fontSize(7.5)
      .fillColor(PDF_COLORS.ink)
      .text(val, PAGE_MARGIN + 88, y, { width: valW });
    doc.y = y + Math.max(10, h) + 2;
  }
  doc.y += 7;
  doc.x = PAGE_MARGIN;
}

function bagianFoto(doc: PdfDoc, d: RingkasHarian, foto: FotoTertanam[]): void {
  const catatan =
    d.fotoDisembunyikan > 0 ? `${foto.length} dimuat · ${d.fotoDisembunyikan} tidak dimuat` : undefined;

  const gap = 10;
  const w = (CONTENT_WIDTH - gap) / 2;
  const boxH = w * 0.66;

  // Judul HARUS menempel pada baris foto pertamanya. Tanpa ini, judul yang
  // muat di sisa halaman membuat fotonya pindah halaman sendirian — dan
  // menyisakan sepertiga halaman kosong persis di bawah judul.
  if (foto.length > 0) {
    // 46 = judul + catatan "ketuk foto…"; 30 = keterangan bawah foto.
    ensureSpace(doc, 46 + boxH + 30);
  }

  judul(doc, "Dokumentasi foto", catatan);

  if (foto.length === 0) {
    kosong(
      doc,
      d.fotoDisembunyikan > 0
        ? `Tidak ada foto yang bisa dimuat (${d.fotoDisembunyikan} foto gagal diambil dari penyimpanan).`
        : "Tidak ada foto pada tanggal ini.",
    );
    return;
  }

  // Foto DIPANGKAS ke kotak 4:3 supaya galerinya rapi. Karena itu jalan ke
  // gambar penuh wajib disediakan — memangkas bukti tanpa menyisakan jalan ke
  // aslinya berarti menghilangkan bagian gambar tanpa ada yang bisa memeriksa
  // (DECISIONS 125, sama seperti PDF kegiatan lapangan).
  if (foto.some((p) => p.link)) {
    doc
      .font(PDF_FONT.regular)
      .fontSize(6.5)
      .fillColor(PDF_COLORS.inkMuted)
      .text(
        sanitizeText(
          "Foto dipangkas agar rapi — ketuk foto untuk membuka gambar penuh (tak ter-crop) di cloud.",
        ),
        PAGE_MARGIN,
        doc.y,
        { width: CONTENT_WIDTH },
      );
    doc.y += 3;
  }

  /**
   * Tinggi keterangan DIUKUR, tidak ditebak.
   *
   * Versi pertama memakai satu angka tetap (24pt) untuk judul + baris waktu.
   * Judul foto kegiatan memuat nama kegiatan dan sering membungkus ke dua
   * baris — dan baris waktu, yang ditulis pada offset tetap, menimpa baris
   * kedua itu. Terbukti saat dokumennya benar-benar dilihat.
   */
  const tinggiKeterangan = (p: FotoTertanam): { judul: number; total: number } => {
    const judul = doc
      .font(PDF_FONT.bold)
      .fontSize(7)
      .heightOfString(sanitizeText(p.sumber), { width: w });
    const sub = p.sub
      ? doc.font(PDF_FONT.regular).fontSize(6).heightOfString(sanitizeText(p.sub), { width: w })
      : 0;
    return { judul, total: 4 + judul + (p.sub ? 2 + sub : 0) };
  };

  for (let i = 0; i < foto.length; i += 2) {
    const pasangan = [foto[i], foto[i + 1]].filter(Boolean) as FotoTertanam[];
    const ukuran = pasangan.map(tinggiKeterangan);
    const capH = Math.max(...ukuran.map((u) => u.total));
    ensureSpace(doc, boxH + capH + gap);
    const y = doc.y;
    pasangan.forEach((p, c) => {
      const x = PAGE_MARGIN + c * (w + gap);
      // pdfkit membaca Buffer lewat fs pada beberapa jalur; data URI menghindari
      // itu sepenuhnya (pola yang sama dipakai PDF kegiatan lapangan).
      const dataUri = `data:image/jpeg;base64,${p.jpeg.toString("base64")}`;
      doc.save();
      doc.roundedRect(x, y, w, boxH, 4).clip();
      doc.image(dataUri, x, y, { cover: [w, boxH], align: "center", valign: "center" });
      doc.restore();
      doc.roundedRect(x, y, w, boxH, 4).lineWidth(0.6).strokeColor(PDF_COLORS.border).stroke();

      // Chip "Lihat penuh" + seluruh sel jadi tautan. Chipnya perlu: tanpa
      // penanda kasatmata, tidak ada yang tahu gambarnya bisa diketuk.
      if (p.link) {
        const label = "Lihat penuh";
        doc.font(PDF_FONT.bold).fontSize(6.5);
        const chipPad = 4;
        const chipH = 12;
        const chipW = doc.widthOfString(label) + chipPad * 2;
        const chipX = x + w - chipW - 5;
        const chipY = y + 5;
        doc.roundedRect(chipX, chipY, chipW, chipH, 3).fill(PDF_COLORS.primary);
        doc.fillColor(PDF_COLORS.white).text(label, chipX + chipPad, chipY + 3, { lineBreak: false });
        doc.link(x, y, w, boxH + ukuran[c].total, p.link);
      }

      doc
        .font(PDF_FONT.bold)
        .fontSize(7)
        .fillColor(PDF_COLORS.ink)
        .text(sanitizeText(p.sumber), x, y + boxH + 3.5, { width: w });
      if (p.sub) {
        doc
          .font(PDF_FONT.regular)
          .fontSize(6)
          .fillColor(PDF_COLORS.inkFaint)
          .text(sanitizeText(p.sub), x, y + boxH + 5 + ukuran[c].judul, { width: w });
      }
    });
    doc.y = y + boxH + capH + gap;
    doc.x = PAGE_MARGIN;
  }

  if (d.fotoDisembunyikan > 0) {
    ensureSpace(doc, 16);
    doc
      .font(PDF_FONT.regular)
      .fontSize(6.8)
      .fillColor(PDF_COLORS.inkMuted)
      .text(
        sanitizeText(
          `${d.fotoDisembunyikan} foto lain tidak dimuat di dokumen ini — semuanya tetap tersimpan di sistem.`,
        ),
        PAGE_MARGIN,
        doc.y,
        { width: CONTENT_WIDTH },
      );
  }
}

/** Dipakai uji tata letak: tinggi halaman A4 dalam pt. */
export const A4_HEIGHT = A4.height;
/** Label status untuk nama berkas & pesan pengiring. */
export function labelStatusRingkas(s: RingkasHarian["status"]): string {
  return s ? REPORT_STATUS_LABEL[s] : "Belum ada laporan";
}
