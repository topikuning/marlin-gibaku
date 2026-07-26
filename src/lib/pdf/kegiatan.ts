import "server-only";
import sharp from "sharp";
import { db } from "@/lib/db";
import { r2GetBuffer, isR2Configured } from "@/lib/r2";
import { getBranding } from "@/lib/branding";
import { getActivityKindLabelMap } from "@/lib/field-activity/kinds";
import { FIELD_ACTIVITY_STATUS_LABEL } from "@/lib/field-activity/labels";
import { formatTanggal, formatTanggalWaktu } from "@/lib/format";
import { formatCoordinate } from "@/lib/photo-stamp/format";
import {
  CONTENT_WIDTH,
  PAGE_MARGIN,
  PDF_COLORS,
  PDF_FONT,
  createA4Doc,
  docToBuffer,
  ensureSpace,
  metaRow,
  paragraph,
  sectionHeading,
  stampFooters,
  type PdfDoc,
} from "@/lib/pdf/document";

/** Hasil render: PDF + metadata ringkas (untuk nama file & caption tanpa query ulang). DECISIONS 124. */
export type KegiatanPdfResult = {
  buffer: Buffer;
  locationId: string;
  slug: string;
  title: string;
  activityDate: Date;
};

export type PhotoForPdf = { jpeg: Buffer; caption: string; sub: string | null };

/** Data siap-render (murni, tanpa I/O) — dipakai renderer produksi & pratinjau. */
export type KegiatanPdfData = {
  appName: string;
  projectContext: string;
  kindLabel: string;
  statusLabel: string;
  title: string;
  activityDate: Date;
  locationName: string;
  province: string;
  packageName: string;
  creatorName: string | null;
  participants: string | null;
  notes: string | null;
  kendala: string | null;
  solusi: string | null;
  photos: PhotoForPdf[];
};

/** Normalisasi 1 foto R2 → JPEG (rotasi EXIF, batasi dimensi) untuk ditanam ke PDF. */
async function normalizePhoto(r2Key: string): Promise<Buffer> {
  const raw = await r2GetBuffer(r2Key);
  return sharp(raw)
    .rotate() // hormati orientasi EXIF
    .resize({ width: 1100, height: 1100, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 78 })
    .toBuffer();
}

/**
 * Susun dokumen PDF dari data siap-render (MURNI: tidak menyentuh DB/R2). Tata
 * letak tunggal dipakai renderer produksi & pratinjau agar tak pernah beda.
 * DECISIONS 124.
 */
export async function buildKegiatanPdf(d: KegiatanPdfData): Promise<Buffer> {
  const doc = createA4Doc({ title: `Laporan Kegiatan — ${d.title}` });

  drawHeader(doc, d.appName, d.projectContext);
  drawIdentity(doc, {
    kindLabel: d.kindLabel,
    statusLabel: d.statusLabel,
    title: d.title,
    locationName: d.locationName,
    packageName: d.packageName,
    province: d.province,
  });
  drawDetails(doc, {
    kindLabel: d.kindLabel,
    activityDate: d.activityDate,
    locationName: d.locationName,
    province: d.province,
    packageName: d.packageName,
    creatorName: d.creatorName,
    participants: d.participants,
  });

  if (d.notes?.trim()) {
    sectionHeading(doc, "Uraian Kegiatan");
    paragraph(doc, d.notes.trim());
  }
  if (d.kendala?.trim()) {
    sectionHeading(doc, "Kendala");
    paragraph(doc, d.kendala.trim());
  }
  if (d.solusi?.trim()) {
    sectionHeading(doc, "Solusi / Tindak Lanjut");
    paragraph(doc, d.solusi.trim());
  }

  sectionHeading(doc, `Dokumentasi Foto (${d.photos.length})`);
  drawPhotoGrid(doc, d.photos);

  stampFooters(doc, `Dibuat otomatis via ${d.appName} · ${formatTanggalWaktu(new Date())}`);

  return docToBuffer(doc);
}

/**
 * Render Laporan Kegiatan Lapangan → PDF A4 (teks + galeri foto), rapi &
 * profesional. Mengembalikan null bila kegiatan tak ada. TIDAK melakukan
 * otorisasi — pemanggil wajib gate capability + akses lokasi. DECISIONS 124.
 */
export async function renderKegiatanPdf(activityId: string): Promise<KegiatanPdfResult | null> {
  const activity = await db.fieldActivity.findUnique({
    where: { id: activityId },
    select: {
      type: true,
      title: true,
      activityDate: true,
      notes: true,
      participants: true,
      kendala: true,
      solusi: true,
      status: true,
      createdById: true,
      location: {
        select: { id: true, slug: true, name: true, province: true, package: { select: { name: true } } },
      },
      photos: {
        select: { r2Key: true, exifTakenAt: true, exifGpsLat: true, exifGpsLng: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!activity) return null;

  const [branding, kindLabels, creator] = await Promise.all([
    getBranding(),
    getActivityKindLabelMap(),
    db.user.findUnique({ where: { id: activity.createdById }, select: { fullName: true } }),
  ]);
  const kindLabel = kindLabels.get(activity.type) ?? activity.type;

  // Foto: ambil + normalisasi (best-effort; foto gagal dilewati, laporan tetap terbentuk).
  const photos: PhotoForPdf[] = [];
  if (isR2Configured()) {
    let i = 0;
    for (const p of activity.photos) {
      i++;
      try {
        const jpeg = await normalizePhoto(p.r2Key);
        const lat = p.exifGpsLat != null ? Number(p.exifGpsLat) : null;
        const lng = p.exifGpsLng != null ? Number(p.exifGpsLng) : null;
        const koord = formatCoordinate(lat, lng);
        const sub = [p.exifTakenAt ? formatTanggalWaktu(p.exifTakenAt) : null, koord].filter(Boolean).join("  ·  ");
        photos.push({ jpeg, caption: `Foto ${i}`, sub: sub || null });
      } catch {
        /* lewati foto yang gagal diambil/diolah */
      }
    }
  }

  const buffer = await buildKegiatanPdf({
    appName: branding.appName,
    projectContext: branding.projectContext,
    kindLabel,
    statusLabel: FIELD_ACTIVITY_STATUS_LABEL[activity.status],
    title: activity.title,
    activityDate: new Date(activity.activityDate),
    locationName: activity.location.name,
    province: activity.location.province,
    packageName: activity.location.package.name,
    creatorName: creator?.fullName ?? null,
    participants: activity.participants,
    notes: activity.notes,
    kendala: activity.kendala,
    solusi: activity.solusi,
    photos,
  });
  return {
    buffer,
    locationId: activity.location.id,
    slug: activity.location.slug,
    title: activity.title,
    activityDate: new Date(activity.activityDate),
  };
}

/* ── Bagian-bagian dokumen ───────────────────────────────────────────────── */

function drawHeader(doc: PdfDoc, appName: string, context: string): void {
  const top = PAGE_MARGIN;
  doc
    .font(PDF_FONT.bold)
    .fontSize(9)
    .fillColor(PDF_COLORS.inkMuted)
    .text(appName.toUpperCase(), PAGE_MARGIN, top, { characterSpacing: 1, width: CONTENT_WIDTH * 0.6 });
  doc
    .font(PDF_FONT.regular)
    .fontSize(8)
    .fillColor(PDF_COLORS.inkMuted)
    .text(context, PAGE_MARGIN, doc.y + 1, { width: CONTENT_WIDTH * 0.6 });
  // Judul dokumen (kanan-atas).
  doc
    .font(PDF_FONT.bold)
    .fontSize(15)
    .fillColor(PDF_COLORS.primary)
    .text("LAPORAN KEGIATAN LAPANGAN", PAGE_MARGIN, top + 2, { width: CONTENT_WIDTH, align: "right" });
  const lineY = Math.max(doc.y, top + 34) + 4;
  doc
    .moveTo(PAGE_MARGIN, lineY)
    .lineTo(PAGE_MARGIN + CONTENT_WIDTH, lineY)
    .lineWidth(2.5)
    .strokeColor(PDF_COLORS.primary)
    .stroke();
  doc.y = lineY + 12;
  doc.x = PAGE_MARGIN;
}

function drawIdentity(
  doc: PdfDoc,
  d: { kindLabel: string; statusLabel: string; title: string; locationName: string; packageName: string; province: string },
): void {
  // Badge kategori + status.
  const y = doc.y;
  const padH = 6;
  doc.font(PDF_FONT.bold).fontSize(8.5);
  const badgeW = doc.widthOfString(d.kindLabel) + padH * 2;
  doc.roundedRect(PAGE_MARGIN, y, badgeW, 15, 3).fill(PDF_COLORS.primary50);
  doc.fillColor(PDF_COLORS.primary).text(d.kindLabel, PAGE_MARGIN + padH, y + 3.5, { lineBreak: false });
  doc
    .font(PDF_FONT.regular)
    .fontSize(8.5)
    .fillColor(PDF_COLORS.inkMuted)
    .text(d.statusLabel, PAGE_MARGIN + badgeW + 8, y + 3.5, { lineBreak: false });
  doc.y = y + 21;
  doc.x = PAGE_MARGIN;

  doc.font(PDF_FONT.bold).fontSize(16).fillColor(PDF_COLORS.ink).text(d.title, PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH });
  doc
    .font(PDF_FONT.regular)
    .fontSize(9.5)
    .fillColor(PDF_COLORS.inkMuted)
    .text(`${d.locationName} · ${d.packageName} · ${d.province}`, PAGE_MARGIN, doc.y + 1, { width: CONTENT_WIDTH });
  doc.y += 8;
}

function drawDetails(
  doc: PdfDoc,
  d: {
    kindLabel: string;
    activityDate: Date;
    locationName: string;
    province: string;
    packageName: string;
    creatorName: string | null;
    participants: string | null;
  },
): void {
  const rows: [string, string][] = [
    ["Jenis kegiatan", d.kindLabel],
    ["Tanggal", formatTanggal(d.activityDate, "EEEE, d MMMM yyyy")],
    ["Lokasi", `${d.locationName} (${d.province})`],
    ["Paket", d.packageName],
  ];
  if (d.creatorName) rows.push(["Pelapor", d.creatorName]);
  if (d.participants) rows.push(["Peserta / hadir", d.participants]);

  const boxX = PAGE_MARGIN;
  const boxW = CONTENT_WIDTH;
  const padIn = 10;
  const startY = doc.y;
  let y = startY + padIn;
  for (const [label, value] of rows) {
    y = metaRow(doc, label, value, boxX + padIn, y, boxW - padIn * 2);
  }
  const boxH = y - startY + padIn - 4;
  // Gambar border di belakang tanpa menimpa teks: pdfkit menggambar sesuai urutan,
  // jadi kita gambar ulang kotak lalu render ulang? Lebih murah: kotak digambar
  // setelah menghitung tinggi, dengan teks sudah tergambar di atasnya — border
  // stroke tidak menutup teks. Cukup stroke persegi rounded.
  doc.roundedRect(boxX, startY, boxW, boxH, 6).lineWidth(0.8).strokeColor(PDF_COLORS.border).stroke();
  doc.y = startY + boxH + 6;
  doc.x = PAGE_MARGIN;
}

function drawPhotoGrid(doc: PdfDoc, photos: PhotoForPdf[]): void {
  if (photos.length === 0) {
    doc.font(PDF_FONT.regular).fontSize(9.5).fillColor(PDF_COLORS.inkMuted).text("Tidak ada foto terlampir.", PAGE_MARGIN, doc.y, {
      width: CONTENT_WIDTH,
    });
    return;
  }
  const gap = 14;
  const colW = (CONTENT_WIDTH - gap) / 2;
  const boxH = 150;
  const captionH = 26;
  const cellH = boxH + captionH;

  for (let i = 0; i < photos.length; i += 2) {
    ensureSpace(doc, cellH + 6);
    const rowY = doc.y;
    for (let c = 0; c < 2; c++) {
      const p = photos[i + c];
      if (!p) break;
      const x = PAGE_MARGIN + c * (colW + gap);
      drawPhotoCell(doc, p, x, rowY, colW, boxH, captionH);
    }
    doc.y = rowY + cellH + 6;
    doc.x = PAGE_MARGIN;
  }
}

function drawPhotoCell(doc: PdfDoc, p: PhotoForPdf, x: number, y: number, w: number, boxH: number, captionH: number): void {
  // Bingkai.
  doc.roundedRect(x, y, w, boxH + captionH, 5).lineWidth(0.8).strokeColor(PDF_COLORS.border).stroke();
  // Foto (cover + clip ke area gambar).
  doc.save();
  doc.roundedRect(x, y, w, boxH, 5).clip();
  try {
    doc.image(p.jpeg, x, y, { cover: [w, boxH], align: "center", valign: "center" });
  } catch {
    doc.rect(x, y, w, boxH).fill(PDF_COLORS.primary50);
  }
  doc.restore();
  // Caption.
  const capX = x + 8;
  const capY = y + boxH + 5;
  doc.font(PDF_FONT.bold).fontSize(8).fillColor(PDF_COLORS.ink).text(p.caption, capX, capY, { width: w - 16, lineBreak: false });
  if (p.sub) {
    doc
      .font(PDF_FONT.regular)
      .fontSize(7)
      .fillColor(PDF_COLORS.inkMuted)
      .text(p.sub, capX, capY + 10, { width: w - 16, lineBreak: false, ellipsis: true });
  }
}
