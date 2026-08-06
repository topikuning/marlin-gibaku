import "server-only";
import sharp from "sharp";
import { isR2Configured, r2GetBuffer } from "@/lib/r2";
import { getRingkasHarian, type RingkasFoto, type RingkasHarian } from "@/lib/daily-report/ringkas";
import { formatRupiah, formatTanggalWaktu } from "@/lib/format";
import { REPORT_STATUS_LABEL } from "@/lib/lifecycle";
import { formatCoordinate } from "@/lib/photo-stamp/format";
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

/** Foto siap-tanam (murni, tanpa I/O saat menggambar). */
export type FotoTertanam = { jpeg: Buffer; sumber: string; sub: string | null };

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
export function buildHarianRingkasPdf(d: RingkasHarian, foto: FotoTertanam[]): Promise<Buffer> {
  const doc = createA4Doc({
    title: `Laporan Harian Ringkas — ${d.locationName} — ${d.dateKey}`,
  });

  kop(doc, d);
  pitaStatus(doc, d);
  identitas(doc, d);
  pitaKinerja(doc, d);
  bagianPekerjaan(doc, d);
  bagianKegiatan(doc, d);
  bagianKendala(doc, d);
  bagianKondisiKerja(doc, d);
  bagianFoto(doc, d, foto);

  stampFooters(
    doc,
    sanitizeText(
      `${d.appName} · ${d.locationName} · ${d.tanggalFull} · dibuat ${formatTanggalWaktu(new Date())}`,
    ),
  );
  return docToBuffer(doc);
}

/**
 * Ambil data + foto, lalu render. TIDAK melakukan otorisasi — pemanggil wajib
 * gate capability + akses lokasi.
 */
export async function renderHarianRingkasPdf(
  slug: string,
  dateKey: string,
): Promise<HarianRingkasPdfResult | null> {
  const d = await getRingkasHarian(slug, dateKey);
  if (!d) return null;

  // Foto best-effort: yang gagal diambil dilewati, dokumennya tetap terbentuk.
  // Laporan tanpa satu foto masih berguna; laporan yang gagal total tidak.
  const foto: FotoTertanam[] = [];
  let gagal = 0;
  if (isR2Configured()) {
    for (const p of d.foto) {
      try {
        foto.push({ jpeg: await normalisasiFoto(p.r2Key), sumber: p.sumber, sub: subFoto(p) });
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

  return {
    buffer: await buildHarianRingkasPdf(data, foto),
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

/** Keterangan bawah foto: waktu + koordinat, dengan penanda GPS cadangan. */
function subFoto(p: RingkasFoto): string | null {
  const bagian: string[] = [];
  if (p.takenAt) bagian.push(formatTanggalWaktu(p.takenAt));
  const koord = formatCoordinate(p.lat, p.lng);
  if (koord) bagian.push(p.gpsCadangan ? `${koord} (titik proyek, bukan GPS perangkat)` : koord);
  return bagian.length > 0 ? bagian.join("  ·  ") : null;
}

/* ── Bagian-bagian dokumen ───────────────────────────────────────────────── */

function kop(doc: PdfDoc, d: RingkasHarian): void {
  const top = PAGE_MARGIN;
  const kiriW = CONTENT_WIDTH * 0.52;
  const kananX = PAGE_MARGIN + kiriW + 10;
  const kananW = CONTENT_WIDTH - kiriW - 10;

  doc
    .font(PDF_FONT.bold)
    .fontSize(9)
    .fillColor(PDF_COLORS.inkMuted)
    .text(sanitizeText(d.appName).toUpperCase(), PAGE_MARGIN, top, {
      characterSpacing: 1,
      width: kiriW,
    });
  doc
    .font(PDF_FONT.regular)
    .fontSize(8)
    .fillColor(PDF_COLORS.inkMuted)
    .text(sanitizeText(d.projectContext), PAGE_MARGIN, doc.y + 1, { width: kiriW });
  const kiriBawah = doc.y;

  doc
    .font(PDF_FONT.bold)
    .fontSize(15)
    .fillColor(PDF_COLORS.primary)
    .text("LAPORAN HARIAN", kananX, top, { width: kananW, align: "right" });
  doc
    .font(PDF_FONT.regular)
    .fontSize(9)
    .fillColor(PDF_COLORS.inkMuted)
    .text("Ringkasan pelaksanaan", kananX, doc.y + 1, { width: kananW, align: "right" });

  const lineY = Math.max(kiriBawah, doc.y, top + 34) + 5;
  doc
    .moveTo(PAGE_MARGIN, lineY)
    .lineTo(PAGE_MARGIN + CONTENT_WIDTH, lineY)
    .lineWidth(2.5)
    .strokeColor(PDF_COLORS.primary)
    .stroke();
  doc.y = lineY + 10;
  doc.x = PAGE_MARGIN;
}

/**
 * Pita keadaan dokumen. Sengaja BESAR dan di atas: dokumen yang belum
 * diverifikasi tidak boleh terlihat sama dengan yang sudah.
 */
function pitaStatus(doc: PdfDoc, d: RingkasHarian): void {
  const t = statusTone(d.status);
  const h = 22;
  const y = doc.y;
  doc.roundedRect(PAGE_MARGIN, y, CONTENT_WIDTH, h, 4).fill(t.bg);
  doc
    .font(PDF_FONT.bold)
    .fontSize(9)
    .fillColor(t.fg)
    .text(sanitizeText(t.label), PAGE_MARGIN + 10, y + 6.5, {
      width: CONTENT_WIDTH - 20,
      characterSpacing: 0.5,
      lineBreak: false,
    });
  doc.y = y + h + 10;
  doc.x = PAGE_MARGIN;
}

function identitas(doc: PdfDoc, d: RingkasHarian): void {
  const kiri: [string, string][] = [
    ["Paket", d.packageName],
    ["Pekerjaan", d.workTitle ?? "—"],
    ["Penyedia", d.vendorName ?? "—"],
    ["No. Kontrak", d.contractNumber ?? "—"],
  ];
  const kanan: [string, string][] = [
    ["Lokasi", d.locationName],
    ["Wilayah", `${d.regency}, ${d.province}`],
    ["Hari / Tanggal", `${d.hari}, ${d.tanggalFull}`],
    [
      "Minggu ke",
      d.totalWeeks > 0
        ? `${d.weekNumber} dari ${d.totalWeeks}`
        : "belum ada baseline kurva-S",
    ],
  ];

  const startY = doc.y;
  const kolomW = (CONTENT_WIDTH - 16) / 2;
  const yKiri = barisIdentitas(doc, kiri, PAGE_MARGIN + 10, startY + 9, kolomW - 10);
  const yKanan = barisIdentitas(doc, kanan, PAGE_MARGIN + kolomW + 16, startY + 9, kolomW - 20);
  const boxH = Math.max(yKiri, yKanan) - startY + 5;
  doc
    .roundedRect(PAGE_MARGIN, startY, CONTENT_WIDTH, boxH, 5)
    .lineWidth(0.8)
    .strokeColor(PDF_COLORS.border)
    .stroke();
  doc.y = startY + boxH + 12;
  doc.x = PAGE_MARGIN;
}

function barisIdentitas(
  doc: PdfDoc,
  rows: [string, string][],
  x: number,
  y0: number,
  width: number,
): number {
  const labelW = 74;
  let y = y0;
  for (const [label, value] of rows) {
    const val = sanitizeText(value);
    doc
      .font(PDF_FONT.regular)
      .fontSize(8)
      .fillColor(PDF_COLORS.inkFaint)
      .text(sanitizeText(label), x, y + 0.5, { width: labelW, lineBreak: false });
    const valW = width - labelW - 6;
    const h = doc.font(PDF_FONT.bold).fontSize(8.5).heightOfString(val, { width: valW });
    doc.fillColor(PDF_COLORS.ink).text(val, x + labelW + 6, y, { width: valW });
    y += Math.max(11, h) + 3.5;
  }
  return y;
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
  const gap = 8;
  const kartuW = (CONTENT_WIDTH - gap * 3) / 4;
  const kartuH = 46;

  const kartu: { label: string; nilai: string; warna: string }[] = [
    { label: "Realisasi s/d hari ini", nilai: pct(d.realizedPct), warna: PDF_COLORS.ink },
    { label: "Rencana kurva-S", nilai: pct(d.planPct), warna: PDF_COLORS.ink },
    {
      label: "Deviasi",
      nilai: signedPct(d.deviationPct),
      warna: deviasiTone(d.deviationPct),
    },
    {
      label: "Kemajuan hari ini",
      nilai: pct(d.bobotHariIni),
      warna: d.bobotHariIni > 0 ? PDF_COLORS.primary600 : PDF_COLORS.inkFaint,
    },
  ];

  kartu.forEach((k, i) => {
    const x = PAGE_MARGIN + i * (kartuW + gap);
    doc.roundedRect(x, startY, kartuW, kartuH, 5).lineWidth(0.8).strokeColor(PDF_COLORS.border).stroke();
    doc
      .font(PDF_FONT.regular)
      .fontSize(7.5)
      .fillColor(PDF_COLORS.inkFaint)
      .text(sanitizeText(k.label), x + 8, startY + 8, { width: kartuW - 16, lineBreak: false });
    doc
      .font(PDF_FONT.bold)
      .fontSize(16)
      .fillColor(k.warna)
      .text(k.nilai, x + 8, startY + 21, { width: kartuW - 16, lineBreak: false });
  });

  let y = startY + kartuH + 10;

  // Batang perbandingan: realisasi di atas rencana, skala sama, jadi jaraknya
  // TERLIHAT — bukan cuma dua angka yang harus dikurangkan sendiri oleh pembaca.
  const barW = CONTENT_WIDTH;
  const barH = 7;
  const skala = Math.max(100, d.realizedPct, d.planPct);
  const gambarBar = (label: string, nilai: number, warna: string, yy: number) => {
    doc
      .font(PDF_FONT.regular)
      .fontSize(7.5)
      .fillColor(PDF_COLORS.inkMuted)
      .text(sanitizeText(label), PAGE_MARGIN, yy - 1, { width: 74, lineBreak: false });
    const x0 = PAGE_MARGIN + 78;
    const w = barW - 78 - 46;
    doc.roundedRect(x0, yy, w, barH, 3).fill("#eef2f7");
    const isi = Math.max(0, Math.min(1, nilai / skala)) * w;
    if (isi > 0.5) doc.roundedRect(x0, yy, isi, barH, 3).fill(warna);
    doc
      .font(PDF_FONT.bold)
      .fontSize(7.5)
      .fillColor(PDF_COLORS.ink)
      .text(pct(nilai), x0 + w + 6, yy - 1, { width: 40, align: "right", lineBreak: false });
  };
  gambarBar("Realisasi", d.realizedPct, PDF_COLORS.primary600, y);
  y += barH + 6;
  gambarBar("Rencana", d.planPct, "#94a3b8", y);
  y += barH + 8;

  // Kalimat penutup pita: apa artinya deviasi itu.
  const kalimat =
    d.totalWeeks === 0
      ? "Baseline kurva-S belum ada, jadi rencana dan deviasi belum bisa dibandingkan."
      : d.deviationPct >= 0
        ? `Realisasi berada ${signedPct(d.deviationPct)} terhadap rencana kurva-S minggu ke-${d.weekNumber}.`
        : `Realisasi tertinggal ${nf2.format(Math.abs(d.deviationPct))}% dari rencana kurva-S minggu ke-${d.weekNumber}.`;
  doc
    .font(PDF_FONT.regular)
    .fontSize(8)
    .fillColor(PDF_COLORS.inkMuted)
    .text(sanitizeText(kalimat), PAGE_MARGIN, y, { width: CONTENT_WIDTH });

  doc.y = doc.y + 12;
  doc.x = PAGE_MARGIN;
}

/** Judul bagian — garis tipis, huruf kapital kecil. Lebih ringan dari blanko. */
function judul(doc: PdfDoc, teks: string, catatan?: string): void {
  ensureSpace(doc, 40);
  const y = doc.y;
  doc
    .font(PDF_FONT.bold)
    .fontSize(9.5)
    .fillColor(PDF_COLORS.primary)
    .text(sanitizeText(teks).toUpperCase(), PAGE_MARGIN, y, {
      characterSpacing: 0.6,
      width: CONTENT_WIDTH * 0.65,
      lineBreak: false,
    });
  if (catatan) {
    doc
      .font(PDF_FONT.regular)
      .fontSize(7.5)
      .fillColor(PDF_COLORS.inkFaint)
      .text(sanitizeText(catatan), PAGE_MARGIN + CONTENT_WIDTH * 0.65, y + 1.5, {
        width: CONTENT_WIDTH * 0.35,
        align: "right",
        lineBreak: false,
      });
  }
  const lineY = y + 13;
  doc
    .moveTo(PAGE_MARGIN, lineY)
    .lineTo(PAGE_MARGIN + CONTENT_WIDTH, lineY)
    .lineWidth(1)
    .strokeColor(PDF_COLORS.primary600)
    .stroke();
  doc.y = lineY + 7;
  doc.x = PAGE_MARGIN;
}

function kosong(doc: PdfDoc, teks: string): void {
  doc
    .font(PDF_FONT.regular)
    .fontSize(8.5)
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
      doc.rect(PAGE_MARGIN, y, CONTENT_WIDTH, 15).fill("#f1f5f9");
      let x = PAGE_MARGIN;
      head.forEach((h, i) => {
        doc
          .font(PDF_FONT.bold)
          .fontSize(7.5)
          .fillColor(PDF_COLORS.inkMuted)
          .text(h, x + 4, y + 4.5, { width: cols[i] - 8, align: align[i], lineBreak: false });
        x += cols[i];
      });
      doc.y = y + 15;
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
        .fontSize(8)
        .heightOfString(sanitizeText(p.name), { width: cols[1] - 8 });
      const h = Math.max(15, hUraian + 7);
      if (doc.y + h > CONTENT_BOTTOM) {
        doc.addPage();
        barisHead();
      }
      const y = doc.y;
      let x = PAGE_MARGIN;
      sel.forEach((s, i) => {
        doc
          .font(i === 4 ? PDF_FONT.bold : PDF_FONT.regular)
          .fontSize(8)
          .fillColor(PDF_COLORS.ink)
          .text(sanitizeText(s), x + 4, y + 3.5, {
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
    doc.rect(PAGE_MARGIN, y, CONTENT_WIDTH, 17).fill("#f8fafc");
    doc
      .font(PDF_FONT.bold)
      .fontSize(8)
      .fillColor(PDF_COLORS.ink)
      .text("JUMLAH HARI INI", PAGE_MARGIN + 4, y + 5, {
        width: cols[0] + cols[1] + cols[2] + cols[3] - 8,
        lineBreak: false,
      });
    doc.text(pct(d.bobotHariIni), PAGE_MARGIN + cols[0] + cols[1] + cols[2] + cols[3] + 4, y + 5, {
      width: cols[4] - 8,
      align: "right",
      lineBreak: false,
    });
    doc.text(
      formatRupiah(d.nilaiHariIni),
      PAGE_MARGIN + cols[0] + cols[1] + cols[2] + cols[3] + cols[4] + 4,
      y + 5,
      { width: cols[5] - 8, align: "right", lineBreak: false },
    );
    doc.y = y + 17 + 4;
  }

  // Baris draft adendum TIDAK dihitung — tapi disebut. Penghilangan yang diam
  // adalah cara dokumen berbohong (DECISIONS 210/215).
  if (d.draftItemCount > 0) {
    doc
      .font(PDF_FONT.regular)
      .fontSize(7.5)
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
  doc.y += 12;
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
      .fontSize(9)
      .fillColor(PDF_COLORS.ink)
      .text(sanitizeText(k.title), PAGE_MARGIN + 10, y, { width: CONTENT_WIDTH - 10 });
    const meta = [k.kindLabel, k.isFinal ? "final" : "draf"].join(" · ");
    doc
      .font(PDF_FONT.regular)
      .fontSize(7.5)
      .fillColor(PDF_COLORS.inkFaint)
      .text(sanitizeText(meta), PAGE_MARGIN + 10, doc.y + 1, { width: CONTENT_WIDTH - 10 });

    const tulis = (label: string, isi: string | null) => {
      if (!isi?.trim()) return;
      doc
        .font(PDF_FONT.bold)
        .fontSize(7.5)
        .fillColor(PDF_COLORS.inkMuted)
        .text(`${label}: `, PAGE_MARGIN + 10, doc.y + 2.5, { continued: true })
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
      .fontSize(8.5)
      .fillColor(PDF_COLORS.ink)
      .text(
        sanitizeText(`• ${k.title}  —  tingkat ${k.severity}, status ${k.status}`),
        PAGE_MARGIN,
        doc.y,
        { width: CONTENT_WIDTH },
      );
    doc.y += 2;
  }
  doc.y += 10;
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
    const valW = CONTENT_WIDTH - 96;
    const h = doc.font(PDF_FONT.regular).fontSize(8.5).heightOfString(val, { width: valW });
    ensureSpace(doc, h + 6);
    const y = doc.y;
    doc
      .font(PDF_FONT.regular)
      .fontSize(8)
      .fillColor(PDF_COLORS.inkFaint)
      .text(sanitizeText(label), PAGE_MARGIN, y + 0.5, { width: 90, lineBreak: false });
    doc
      .font(PDF_FONT.regular)
      .fontSize(8.5)
      .fillColor(PDF_COLORS.ink)
      .text(val, PAGE_MARGIN + 96, y, { width: valW });
    doc.y = y + Math.max(11, h) + 3;
  }
  doc.y += 10;
  doc.x = PAGE_MARGIN;
}

function bagianFoto(doc: PdfDoc, d: RingkasHarian, foto: FotoTertanam[]): void {
  const catatan =
    d.fotoDisembunyikan > 0 ? `${foto.length} dimuat · ${d.fotoDisembunyikan} tidak dimuat` : undefined;
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

  const gap = 10;
  const w = (CONTENT_WIDTH - gap) / 2;
  const boxH = w * 0.72;

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
      .fontSize(7.5)
      .heightOfString(sanitizeText(p.sumber), { width: w });
    const sub = p.sub
      ? doc.font(PDF_FONT.regular).fontSize(6.5).heightOfString(sanitizeText(p.sub), { width: w })
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

      doc
        .font(PDF_FONT.bold)
        .fontSize(7.5)
        .fillColor(PDF_COLORS.ink)
        .text(sanitizeText(p.sumber), x, y + boxH + 4, { width: w });
      if (p.sub) {
        doc
          .font(PDF_FONT.regular)
          .fontSize(6.5)
          .fillColor(PDF_COLORS.inkFaint)
          .text(sanitizeText(p.sub), x, y + boxH + 6 + ukuran[c].judul, { width: w });
      }
    });
    doc.y = y + boxH + capH + gap;
    doc.x = PAGE_MARGIN;
  }

  if (d.fotoDisembunyikan > 0) {
    ensureSpace(doc, 16);
    doc
      .font(PDF_FONT.regular)
      .fontSize(7.5)
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
