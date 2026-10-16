import "server-only";
import sharp from "sharp";
import { db } from "@/lib/db";
import { getBranding } from "@/lib/branding";
import { formatPct, formatTanggal } from "@/lib/format";
import { susunDokumentasiSarpras, type FotoSarpras } from "@/lib/dokumentasi-sarpras/susun";
import { titikDokumentasi } from "@/lib/dokumentasi-sarpras/murni";
import { r2GetFotoBercap } from "@/lib/photo-stamp/cap-latar";
import {
  CONTENT_WIDTH,
  PAGE_MARGIN,
  PDF_COLORS,
  PDF_FONT,
  createA4Doc,
  docToBuffer,
  ensureSpace,
  reportHeader,
  sanitizeText,
  stampFooters,
  type PdfDoc,
} from "@/lib/pdf/document";

/**
 * LAMPIRAN DOKUMENTASI 0% – 50% – 100% PER SARANA & PRASARANA (DECISIONS 683).
 *
 * Tiap sarana: foto pertama, foto pertama saat progres sarana ≥ 50%, dan foto
 * pertama saat sudah tuntas (`titikDokumentasi`). Yang belum tercapai dicetak
 * KOSONG dengan sebabnya – foto lain tidak diakui sebagai 50% atau 100%.
 * Progres di bawah tiap foto adalah progres sarana s/d tanggal laporan foto
 * itu, angka yang sama dengan layar Foto Sarpras dan laporan mingguan.
 */
export type FotoPdfSarpras = {
  jpeg: Buffer | null;
  tanggal: string;
  minggu: number | null;
  progres: number;
  pekerjaan: string;
};

export type DokumentasiSarprasPdfData = {
  appName: string;
  konteks: string;
  revisionNo: number;
  sarpras: {
    judul: string;
    progresKini: number;
    jumlahFoto: number;
    titik: [FotoPdfSarpras | null, FotoPdfSarpras | null, FotoPdfSarpras | null];
  }[];
};

const LABEL = ["0% – awal", "50%", "100%"] as const;
const KOSONG = ["Belum ada foto", "Progres belum mencapai 50%", "Progres belum mencapai 100%"] as const;
const tgl = (t: string) => formatTanggal(new Date(`${t}T00:00:00Z`));

function sel(doc: PdfDoc, f: FotoPdfSarpras | null, k: number, x: number, y: number, w: number, fotoH: number): void {
  doc.font(PDF_FONT.bold).fontSize(8.5).fillColor(PDF_COLORS.primary).text(LABEL[k], x, y, { width: w, lineBreak: false });
  const fy = y + 13;
  doc.roundedRect(x, fy, w, fotoH, 4).lineWidth(0.8).strokeColor(PDF_COLORS.border).stroke();
  if (!f) {
    doc
      .font(PDF_FONT.regular)
      .fontSize(8)
      .fillColor(PDF_COLORS.inkMuted)
      .text(KOSONG[k], x + 6, fy + fotoH / 2 - 5, { width: w - 12, align: "center" });
    return;
  }
  if (f.jpeg) {
    doc.save();
    doc.roundedRect(x, fy, w, fotoH, 4).clip();
    // Data URI, bukan Buffer: bundel pdfkit menstub `fs` (DECISIONS 129).
    doc.image(`data:image/jpeg;base64,${f.jpeg.toString("base64")}`, x, fy, {
      cover: [w, fotoH],
      align: "center",
      valign: "center",
    });
    doc.restore();
  } else {
    doc
      .font(PDF_FONT.regular)
      .fontSize(8)
      .fillColor(PDF_COLORS.inkMuted)
      .text("Berkas foto tidak bisa dimuat", x + 6, fy + fotoH / 2 - 5, { width: w - 12, align: "center" });
  }
  const cy = fy + fotoH + 4;
  doc
    .font(PDF_FONT.bold)
    .fontSize(8)
    .fillColor(PDF_COLORS.ink)
    .text(`${tgl(f.tanggal)}${f.minggu != null ? ` · Minggu ke-${f.minggu}` : ""}`, x, cy, { width: w, lineBreak: false });
  doc
    .font(PDF_FONT.regular)
    .fontSize(7.5)
    .fillColor(PDF_COLORS.inkMuted)
    .text(`Progres sarana s/d tanggal ini: ${formatPct(f.progres, 2)}`, x, cy + 11, { width: w, lineBreak: false })
    .text(sanitizeText(f.pekerjaan), x, cy + 21, { width: w, height: 18, ellipsis: true });
}

/** Susun PDF dari data siap-render – MURNI, tanpa DB/berkas. */
export async function buildDokumentasiSarprasPdf(d: DokumentasiSarprasPdfData): Promise<Buffer> {
  const doc = createA4Doc({ title: "Dokumentasi Sarana & Prasarana 0% – 50% – 100%" });
  reportHeader(doc, d.appName, d.konteks, "Dokumentasi Sarana & Prasarana");
  doc
    .font(PDF_FONT.regular)
    .fontSize(8.5)
    .fillColor(PDF_COLORS.inkMuted)
    .text(
      `Sarana dan prasarana = kategori RAB revisi #${d.revisionNo}. Foto dari laporan harian yang sudah dikirim, disetujui, ` +
        `atau final. Progres di bawah foto adalah progres sarana sampai tanggal laporan foto itu.`,
      PAGE_MARGIN,
      doc.y,
      { width: CONTENT_WIDTH },
    );
  doc.moveDown(0.8);

  const gap = 10;
  const w = (CONTENT_WIDTH - gap * 2) / 3;
  const fotoH = w * 0.75;
  const tinggiBlok = 22 + 13 + fotoH + 46;
  for (const s of d.sarpras) {
    ensureSpace(doc, tinggiBlok);
    const y = doc.y;
    doc
      .font(PDF_FONT.bold)
      .fontSize(10)
      .fillColor(PDF_COLORS.ink)
      .text(sanitizeText(s.judul), PAGE_MARGIN, y, { width: CONTENT_WIDTH * 0.7, lineBreak: false, ellipsis: true });
    doc
      .font(PDF_FONT.regular)
      .fontSize(8.5)
      .fillColor(PDF_COLORS.inkMuted)
      .text(`${s.jumlahFoto} foto · progres s/d hari ini ${formatPct(s.progresKini, 2)}`, PAGE_MARGIN, y + 1, {
        width: CONTENT_WIDTH,
        align: "right",
        lineBreak: false,
      });
    for (let k = 0; k < 3; k++) sel(doc, s.titik[k], k, PAGE_MARGIN + k * (w + gap), y + 18, w, fotoH);
    doc.y = y + tinggiBlok;
    doc.x = PAGE_MARGIN;
  }
  stampFooters(doc, `${d.appName} · Dokumentasi Sarana & Prasarana`);
  return docToBuffer(doc);
}

async function jpeg(f: FotoSarpras): Promise<Buffer | null> {
  try {
    const raw = await r2GetFotoBercap(f.r2Key);
    return await sharp(raw)
      .rotate()
      .resize({ width: 900, height: 900, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 78 })
      .toBuffer();
  } catch {
    return null;
  }
}

export async function renderDokumentasiSarprasPdf(
  locationId: string,
): Promise<{ buffer: Buffer; lokasi: string } | null> {
  const [dok, lokasi, branding] = await Promise.all([
    susunDokumentasiSarpras(locationId),
    db.location.findUniqueOrThrow({ where: { id: locationId }, select: { name: true, package: { select: { name: true } } } }),
    getBranding(),
  ]);
  if (!dok) return null;
  const sarpras = await Promise.all(
    dok.sarpras.map(async (s) => {
      const t = titikDokumentasi(s.foto);
      const muat = async (f: FotoSarpras | null): Promise<FotoPdfSarpras | null> =>
        f ? { jpeg: await jpeg(f), tanggal: f.tanggal, minggu: f.minggu, progres: f.progres, pekerjaan: f.pekerjaan } : null;
      return {
        judul: `${s.code}. ${s.name}`,
        progresKini: s.progresKini,
        jumlahFoto: s.foto.length,
        titik: [await muat(t.awal), await muat(t.tengah), await muat(t.akhir)] as DokumentasiSarprasPdfData["sarpras"][number]["titik"],
      };
    }),
  );
  const buffer = await buildDokumentasiSarprasPdf({
    appName: branding.appName,
    konteks: `${lokasi.name} – ${lokasi.package.name}`,
    revisionNo: dok.revisionNo,
    sarpras,
  });
  return { buffer, lokasi: lokasi.name };
}
