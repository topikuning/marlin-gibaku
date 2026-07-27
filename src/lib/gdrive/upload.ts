import "server-only";
import { db } from "@/lib/db";
import { r2GetBuffer } from "@/lib/r2";
import { ensureFolderPath, uploadToDrive } from "./client";
import { photoFileName, photoMimeFromKey, safeFileName } from "./folders";
import type { GDriveUploadKind } from "./parse";

/**
 * Lapisan upload: menempatkan file ke path folder KKP dan MENCATAT hasilnya
 * (sukses/gagal) ke GDriveUpload. Satu file gagal tidak membatalkan sisanya —
 * yang gagal tetap tercatat supaya terlihat & bisa diulang. DECISIONS 143.
 */

export type UploadTarget = {
  packageId: string;
  locationId: string | null;
  rootFolderId: string;
  kind: GDriveUploadKind;
  refKey: string;
  byId: string;
};

export type UploadItem = { fileName: string; mime: string; data: Buffer };

export type UploadOutcome = {
  ok: number;
  failed: number;
  /** Pesan error pertama — ditampilkan ke user. */
  firstError: string | null;
  webLink: string | null;
};

async function log(
  t: UploadTarget,
  fileName: string,
  status: "sukses" | "gagal",
  extra: { fileId?: string | null; webLink?: string | null; error?: string | null },
): Promise<void> {
  await db.gDriveUpload
    .create({
      data: {
        packageId: t.packageId,
        locationId: t.locationId,
        kind: t.kind,
        refKey: t.refKey,
        fileName,
        fileId: extra.fileId ?? null,
        webLink: extra.webLink ?? null,
        status,
        error: extra.error ?? null,
        createdById: t.byId,
      },
    })
    .catch(() => {});
}

/** Upload sekumpulan file ke SATU folder (path relatif terhadap folder paket). */
export async function uploadBatch(
  target: UploadTarget,
  path: string[],
  items: UploadItem[],
): Promise<UploadOutcome> {
  const out: UploadOutcome = { ok: 0, failed: 0, firstError: null, webLink: null };
  if (items.length === 0) return out;

  let folderId: string;
  try {
    folderId = await ensureFolderPath(target.rootFolderId, path);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Gagal menyiapkan folder.";
    for (const it of items) await log(target, it.fileName, "gagal", { error: msg });
    return { ok: 0, failed: items.length, firstError: msg, webLink: null };
  }

  for (const it of items) {
    try {
      const file = await uploadToDrive({
        folderId,
        fileName: it.fileName,
        mime: it.mime,
        data: it.data,
      });
      out.ok++;
      out.webLink ??= file.webViewLink;
      await log(target, it.fileName, "sukses", { fileId: file.id, webLink: file.webViewLink });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload gagal.";
      out.failed++;
      out.firstError ??= msg;
      await log(target, it.fileName, "gagal", { error: msg });
    }
  }
  return out;
}

/**
 * Ambil foto dari R2 jadi item siap upload. Foto yang gagal diambil dilewati
 * (dilaporkan lewat `skipped`) — laporan utamanya tetap naik.
 */
export async function photoItems(
  photos: { r2Key: string }[],
  naming: { dateKey: string; locationName: string },
): Promise<{ items: UploadItem[]; skipped: number }> {
  const items: UploadItem[] = [];
  let skipped = 0;
  let i = 0;
  for (const p of photos) {
    i++;
    const { ext, mime } = photoMimeFromKey(p.r2Key);
    try {
      const data = await r2GetBuffer(p.r2Key);
      items.push({
        fileName: photoFileName({ ...naming, index: i, ext }),
        mime,
        data,
      });
    } catch {
      skipped++;
    }
  }
  return { items, skipped };
}

/** Ambil dokumen (R2) jadi item siap upload. */
export async function documentItem(doc: {
  r2Key: string;
  fileName: string;
  mimeType: string;
}): Promise<UploadItem> {
  return {
    fileName: safeFileName(doc.fileName, "dokumen"),
    mime: doc.mimeType || "application/octet-stream",
    data: await r2GetBuffer(doc.r2Key),
  };
}

/** Rangkum hasil jadi kalimat Indonesia untuk banner aksi. */
export function summarize(label: string, outcomes: UploadOutcome[], skippedPhotos = 0): string {
  const ok = outcomes.reduce((s, o) => s + o.ok, 0);
  const failed = outcomes.reduce((s, o) => s + o.failed, 0);
  const parts = [`${label}: ${ok} file terupload`];
  if (failed > 0) parts.push(`${failed} gagal`);
  if (skippedPhotos > 0) parts.push(`${skippedPhotos} foto tak terbaca dari penyimpanan`);
  return `${parts.join(", ")}.`;
}
