import "server-only";
import sharp from "sharp";
import { db } from "@/lib/db";
import { r2GetBuffer, isR2Configured } from "@/lib/r2";
import { getBranding } from "@/lib/branding";
import { getActivityKindLabelMap } from "@/lib/field-activity/kinds";
import { FIELD_ACTIVITY_STATUS_LABEL } from "@/lib/field-activity/labels";
import { formatTanggal, formatTanggalWaktu } from "@/lib/format";
import { formatCoordinate, jamTakDiketahui } from "@/lib/photo-stamp/format";
import { signPhotoToken } from "@/lib/pdf/photo-token";
import {
  CONTENT_WIDTH,
  PAGE_MARGIN,
  PDF_COLORS,
  PDF_FONT,
  createA4Doc,
  docToBuffer,
  ensureSpace,
  paragraph,
  reportHeader,
  sanitizeText,
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

export type PhotoForPdf = { jpeg: Buffer; caption: string; sub: string | null; link?: string | null };

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
  projectOfficialName: string | null; // nama pekerjaan resmi (Contract.workTitle)
  vendorName: string | null; // penyedia / perusahaan pelaksana
  contractNumber: string | null;
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
  const doc = createA4Doc({ title: `Laporan Kegiatan – ${d.title}` });

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
    projectOfficialName: d.projectOfficialName,
    vendorName: d.vendorName,
    contractNumber: d.contractNumber,
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
  if (d.photos.some((p) => p.link)) {
    doc
      .font(PDF_FONT.regular)
      .fontSize(8)
      .fillColor(PDF_COLORS.inkMuted)
      .text("Foto dipangkas agar rapi – ketuk foto untuk membuka gambar penuh (tak ter-crop) di cloud.", PAGE_MARGIN, doc.y, {
        width: CONTENT_WIDTH,
      });
    doc.y += 4;
  }
  drawPhotoGrid(doc, d.photos);

  stampFooters(doc, `Dibuat otomatis via ${d.appName} · ${formatTanggalWaktu(new Date())}`);

  return docToBuffer(doc);
}

/**
 * Render Laporan Kegiatan Lapangan → PDF A4 (teks + galeri foto), rapi &
 * profesional. Mengembalikan null bila kegiatan tak ada. TIDAK melakukan
 * otorisasi — pemanggil wajib gate capability + akses lokasi. DECISIONS 124.
 */
export async function renderKegiatanPdf(
  activityId: string,
  opts?: { baseUrl?: string | null },
): Promise<KegiatanPdfResult | null> {
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
        select: {
          id: true,
          slug: true,
          name: true,
          province: true,
          package: {
            select: {
              name: true,
              candidateVendorName: true,
              contract: {
                select: { workTitle: true, contractNumber: true, vendor: { select: { name: true } } },
              },
            },
          },
        },
      },
      photos: {
        select: {
          id: true,
          r2Key: true,
          exifTakenAt: true,
          exifGpsLat: true,
          exifGpsLng: true,
          // Dua penanda ini yang membedakan bukti dari klaim (DECISIONS 197):
          // apakah jamnya diketahui, dan apakah koordinatnya dari perangkat.
          gpsSource: true,
          metadataSource: true,
        },
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
  const baseUrl = opts?.baseUrl?.replace(/\/+$/, "") || null;

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
        // Jam hanya dicetak bila memang diketahui; koordinat cadangan titik
        // proyek WAJIB ditandai — mengakuinya sebagai bukti GPS adalah
        // kebohongan yang tidak kelihatan (DECISIONS 197).
        const waktu = p.exifTakenAt
          ? jamTakDiketahui(p.metadataSource, p.exifTakenAt)
            ? formatTanggal(p.exifTakenAt)
            : formatTanggalWaktu(p.exifTakenAt)
          : null;
        const koordTeks =
          koord && p.gpsSource === "project" ? `${koord} (titik proyek, bukan GPS perangkat)` : koord;
        const sub = [waktu, koordTeks].filter(Boolean).join("  ·  ");
        // Link publik MARLIN ke gambar PENUH (tak ter-crop) — hanya bila origin diketahui.
        const link = baseUrl ? `${baseUrl}/api/foto/${signPhotoToken(p.id)}` : null;
        photos.push({ jpeg, caption: `Foto ${i}`, sub: sub || null, link });
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
    projectOfficialName:
      activity.location.package.contract?.workTitle?.trim() || null,
    vendorName:
      activity.location.package.contract?.vendor?.name?.trim() ||
      activity.location.package.candidateVendorName?.trim() ||
      null,
    contractNumber: activity.location.package.contract?.contractNumber ?? null,
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
  reportHeader(doc, appName, context, "Laporan Kegiatan Lapangan");
}

function drawIdentity(
  doc: PdfDoc,
  d: { kindLabel: string; statusLabel: string; title: string; locationName: string; packageName: string; province: string },
): void {
  // Badge kategori + status.
  const y = doc.y;
  const padH = 6;
  doc.font(PDF_FONT.bold).fontSize(8.5);
  const kindLabel = sanitizeText(d.kindLabel);
  const badgeW = doc.widthOfString(kindLabel) + padH * 2;
  doc.roundedRect(PAGE_MARGIN, y, badgeW, 15, 3).fill(PDF_COLORS.primary50);
  doc.fillColor(PDF_COLORS.primary).text(kindLabel, PAGE_MARGIN + padH, y + 3.5, { lineBreak: false });
  doc
    .font(PDF_FONT.regular)
    .fontSize(8.5)
    .fillColor(PDF_COLORS.inkMuted)
    .text(d.statusLabel, PAGE_MARGIN + badgeW + 8, y + 3.5, { lineBreak: false });
  doc.y = y + 21;
  doc.x = PAGE_MARGIN;

  doc.font(PDF_FONT.bold).fontSize(16).fillColor(PDF_COLORS.ink).text(sanitizeText(d.title), PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH });
  doc
    .font(PDF_FONT.regular)
    .fontSize(9.5)
    .fillColor(PDF_COLORS.inkMuted)
    .text(sanitizeText(`${d.locationName} · ${d.packageName} · ${d.province}`), PAGE_MARGIN, doc.y + 1, { width: CONTENT_WIDTH });
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
    projectOfficialName: string | null;
    vendorName: string | null;
    contractNumber: string | null;
    creatorName: string | null;
    participants: string | null;
  },
): void {
  const rows: [string, string][] = [];
  if (d.projectOfficialName) rows.push(["Nama proyek", d.projectOfficialName]);
  rows.push(
    ["Jenis kegiatan", d.kindLabel],
    ["Tanggal", formatTanggal(d.activityDate, "EEEE, d MMMM yyyy")],
    ["Lokasi", `${d.locationName} (${d.province})`],
    ["Paket", d.packageName],
  );
  if (d.vendorName) rows.push(["Penyedia", d.vendorName]);
  if (d.contractNumber) rows.push(["No. kontrak", d.contractNumber]);
  if (d.creatorName) rows.push(["Pelapor", d.creatorName]);
  if (d.participants) rows.push(["Peserta / hadir", d.participants]);

  // Tata letak 2 KOLOM + huruf kecil supaya rincian ringkas (tak terlalu lebar).
  // Nilai panjang (mis. nama proyek/peserta) memakai satu baris penuh (2 kolom).
  const boxX = PAGE_MARGIN;
  const boxW = CONTENT_WIDTH;
  const padIn = 10;
  const colGap = 18;
  const colW = (boxW - padIn * 2 - colGap) / 2;
  const LABEL_W = 70;
  const LABEL_FS = 7.5;
  const VALUE_FS = 8.5;
  const ROW_GAP = 5;

  // Ukur tinggi satu sel (label kiri + nilai kanan) pada lebar tertentu.
  const cellHeight = (value: string, cellW: number): number => {
    const vw = cellW - LABEL_W - 6;
    doc.font(PDF_FONT.regular).fontSize(VALUE_FS);
    return Math.max(doc.currentLineHeight(), doc.heightOfString(sanitizeText(value), { width: vw }));
  };
  // Gambar satu sel di (cx, cy) lebar cellW → tak mengubah doc.y.
  const drawCell = (label: string, value: string, cx: number, cy: number, cellW: number): void => {
    doc.font(PDF_FONT.bold).fontSize(LABEL_FS).fillColor(PDF_COLORS.inkMuted).text(label, cx, cy + 0.5, { width: LABEL_W, lineBreak: false });
    doc
      .font(PDF_FONT.regular)
      .fontSize(VALUE_FS)
      .fillColor(PDF_COLORS.ink)
      .text(sanitizeText(value), cx + LABEL_W + 6, cy, { width: cellW - LABEL_W - 6 });
  };

  const startY = doc.y;
  let y = startY + padIn;
  const leftX = boxX + padIn;
  const rightX = boxX + padIn + colW + colGap;
  const isLong = (v: string) => v.length > 44;

  let i = 0;
  while (i < rows.length) {
    const [lLabel, lValue] = rows[i];
    if (isLong(lValue)) {
      // Baris penuh (2 kolom) untuk nilai panjang.
      const h = cellHeight(lValue, boxW - padIn * 2);
      drawCell(lLabel, lValue, leftX, y, boxW - padIn * 2);
      y += h + ROW_GAP;
      i += 1;
      continue;
    }
    const right = rows[i + 1] && !isLong(rows[i + 1][1]) ? rows[i + 1] : null;
    const h = Math.max(cellHeight(lValue, colW), right ? cellHeight(right[1], colW) : 0);
    drawCell(lLabel, lValue, leftX, y, colW);
    if (right) drawCell(right[0], right[1], rightX, y, colW);
    y += h + ROW_GAP;
    i += right ? 2 : 1;
  }

  const boxH = y - startY + padIn - ROW_GAP;
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
  // Foto (cover + clip ke area gambar). PENTING: bundle pdfkit self-contained
  // menstub `fs` → doc.image(Buffer) gagal ("fs.readFileSync is not a function").
  // Beri DATA URI base64 supaya decode inline tanpa fs. DECISIONS 129.
  doc.save();
  doc.roundedRect(x, y, w, boxH, 5).clip();
  try {
    const dataUri = `data:image/jpeg;base64,${p.jpeg.toString("base64")}`;
    doc.image(dataUri, x, y, { cover: [w, boxH], align: "center", valign: "center" });
  } catch {
    doc.rect(x, y, w, boxH).fill(PDF_COLORS.primary50);
  }
  doc.restore();

  // Chip "Lihat penuh" (kanan-atas foto) — foto di-crop, chip menandai bisa diketuk
  // untuk membuka gambar PENUH di cloud (link publik MARLIN). DECISIONS 125.
  if (p.link) {
    const label = "Lihat penuh";
    doc.font(PDF_FONT.bold).fontSize(7);
    const chipPadH = 5;
    const chipH = 14;
    const chipW = doc.widthOfString(label) + chipPadH * 2;
    const chipX = x + w - chipW - 6;
    const chipY = y + 6;
    doc.roundedRect(chipX, chipY, chipW, chipH, 3).fill(PDF_COLORS.primary);
    doc.fillColor(PDF_COLORS.white).text(label, chipX + chipPadH, chipY + 3.5, { lineBreak: false });
    // Seluruh sel (foto + kapsi) jadi tautan ke gambar penuh.
    doc.link(x, y, w, boxH + captionH, p.link);
  }

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
