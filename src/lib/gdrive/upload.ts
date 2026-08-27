import "server-only";
import { db } from "@/lib/db";
import { r2GetBuffer } from "@/lib/r2";
import { ensureFolderPath, GDriveError, uploadToDrive } from "./client";
import { photoFileName, photoMimeFromKey, safeFileName } from "./folders";
import { type GDriveUploadKind, type UploadOutcome } from "./parse";

export { summarize, type UploadOutcome } from "./parse";

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
  /** null = unggahan TERJADWAL, tidak ada orang yang menekan tombol. */
  byId: string | null;
};

export type UploadItem = { fileName: string; mime: string; data: Buffer };


/**
 * Catat satu berkas ke `GDriveUpload`.
 *
 * ### `byId` kosong ≠ string kosong
 *
 * Jejak inilah yang dibaca daftar laporan harian untuk menjawab "sudah naik ke
 * Drive atau belum". Sampai 2026-08-27 jalur TERJADWAL tidak pernah muncul di
 * sana: penjadwal memanggil dengan `byId: null`, `konteksUnggah` mengubahnya
 * jadi `""`, dan `created_by_id` bertipe `uuid` menolak string kosong. Barisnya
 * gagal ditulis — lalu `.catch(() => {})` menelan galatnya tanpa sisa.
 *
 * Akibatnya persis yang dilaporkan user: berkasnya ADA di Drive, tetapi
 * daftarnya menulis "Belum ke Drive". Bukan hanya salah, tetapi mengundang
 * orang mengunggah ulang berkas yang sudah ada di sana.
 *
 * Kegagalan mencatat tetap TIDAK menggagalkan unggahannya — berkasnya sudah
 * terlanjur ada di Drive, dan melempar di sini hanya membuat penjadwal
 * mengulangnya. Tetapi tidak boleh senyap lagi: yang senyap tidak pernah
 * diperbaiki.
 */
async function log(
  t: UploadTarget,
  fileName: string,
  status: "sukses" | "gagal",
  extra: { fileId?: string | null; webLink?: string | null; error?: string | null },
): Promise<void> {
  await catatUnggah(t, fileName, status, extra);
}

export async function catatUnggah(
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
        createdById: t.byId || null,
      },
    })
    .catch((err) => {
      console.error(
        `[gdrive] jejak unggah "${fileName}" (${t.kind} ${t.refKey}) gagal dicatat:`,
        err,
      );
    });
}

/** Detail galat Drive (status HTTP + Retry-After) bila galatnya memang dari Drive. */
function rinciGalat(err: unknown): { pesan: string; status: number | null; retryAfter: string | null } {
  if (err instanceof GDriveError) {
    return { pesan: err.message, status: err.status, retryAfter: err.retryAfter };
  }
  return {
    pesan: err instanceof Error ? err.message : "Upload gagal.",
    status: null,
    retryAfter: null,
  };
}

/**
 * Upload sekumpulan file ke SATU folder (path relatif terhadap folder paket).
 *
 * `jedaMs` memberi jeda antar berkas. Jalur MANUAL memakai 0 — ada orang yang
 * menunggu di depan layar, dan belasan foto × jeda berarti menahannya tanpa
 * alasan untuk satu unggahan yang tidak akan menyentuh batas apa pun. Jalur
 * OTOMATIS mengisinya (DECISIONS 313): di sanalah ledakan bisa terjadi, dan
 * tidak ada yang menunggu.
 */
export async function uploadBatch(
  target: UploadTarget,
  path: string[],
  items: UploadItem[],
  opts: { jedaMs?: number } = {},
): Promise<UploadOutcome> {
  const out: UploadOutcome = {
    ok: 0,
    failed: 0,
    updated: 0,
    firstError: null,
    firstErrorStatus: null,
    firstRetryAfter: null,
    webLink: null,
  };
  if (items.length === 0) return out;

  let folderId: string;
  try {
    folderId = await ensureFolderPath(target.rootFolderId, path);
  } catch (err) {
    const g = rinciGalat(err);
    for (const it of items) await log(target, it.fileName, "gagal", { error: g.pesan });
    return {
      ok: 0,
      failed: items.length,
      updated: 0,
      firstError: g.pesan,
      firstErrorStatus: g.status,
      firstRetryAfter: g.retryAfter,
      webLink: null,
    };
  }

  const jeda = Math.max(0, opts.jedaMs ?? 0);
  let pertama = true;
  for (const it of items) {
    if (!pertama && jeda > 0) await tidur(jeda);
    pertama = false;
    try {
      const file = await uploadToDrive({
        folderId,
        fileName: it.fileName,
        mime: it.mime,
        data: it.data,
      });
      out.ok++;
      if (!file.created) out.updated++;
      out.webLink ??= file.webViewLink;
      await log(target, it.fileName, "sukses", { fileId: file.id, webLink: file.webViewLink });
    } catch (err) {
      const g = rinciGalat(err);
      out.failed++;
      if (out.firstError == null) {
        out.firstError = g.pesan;
        out.firstErrorStatus = g.status;
        out.firstRetryAfter = g.retryAfter;
      }
      await log(target, it.fileName, "gagal", { error: g.pesan });
    }
  }
  return out;
}

function tidur(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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
