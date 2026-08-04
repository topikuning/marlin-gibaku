"use server";

import { revalidatePath } from "next/cache";
import { requireCapability, requireLocationAccess } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { buildRecapPreview, commitRecap, type RecapPreview, type RecapCommitResult } from "@/lib/daily-report/recap-import";

/**
 * Aksi impor rekap laporan harian (Excel). Dua fase:
 *  - preview: parse + cocokkan + tandai masalah (tidak menulis apa pun).
 *  - commit: buat/isi laporan harian per tanggal lalu submit (→ menunggu verifikasi).
 * File diunggah ulang saat commit (client memegang File), jadi commit selalu
 * memakai data terbaru & guard volume sesungguhnya. Gate daily_report.create +
 * requireLocationAccess.
 */

export type RecapImportState =
  | { ok: true; phase: "preview"; preview: RecapPreview }
  | { ok: true; phase: "done"; result: RecapCommitResult }
  | { ok: false; error: string }
  | undefined;

const MAX_BYTES = 8 * 1024 * 1024;

async function readFileForLocation(formData: FormData): Promise<{ locationId: string; slug: string; buf: Buffer }> {
  const locationId = String(formData.get("locationId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("Pilih file Excel rekap terlebih dahulu.");
  if (file.size > MAX_BYTES) throw new Error("File terlalu besar (maks 8MB).");

  const user = await requireCapability("daily_report.create");
  const loc = await db.location.findUnique({ where: { id: locationId }, select: { id: true, slug: true } });
  if (!loc) throw new Error("Lokasi tidak ditemukan.");
  await requireLocationAccess(user, locationId); // gate akses lokasi (scope org + penugasan)

  return { locationId, slug: slug || loc.slug, buf: Buffer.from(await file.arrayBuffer()) };
}

export async function previewRecapAction(_prev: RecapImportState, formData: FormData): Promise<RecapImportState> {
  try {
    const { locationId, buf } = await readFileForLocation(formData);
    const preview = await buildRecapPreview(locationId, buf);
    if (preview.rows.length === 0) return { ok: false, error: "Tidak ada baris data terbaca di file." };
    return { ok: true, phase: "preview", preview };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Gagal membaca file rekap." };
  }
}

export async function commitRecapAction(_prev: RecapImportState, formData: FormData): Promise<RecapImportState> {
  try {
    const { locationId, slug, buf } = await readFileForLocation(formData);
    const user = await requireCapability("daily_report.create");
    const result = await commitRecap(locationId, buf, user.id);
    if (result.itemsSaved === 0) {
      return { ok: false, error: "Tidak ada baris valid untuk disimpan. Periksa pratinjau." };
    }
    revalidatePath(`/proyek/lokasi/${slug}/harian`);
    revalidatePath(`/proyek/lokasi/${slug}/progress`);
    revalidatePath(`/proyek/lokasi/${slug}`);
    return { ok: true, phase: "done", result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Gagal menyimpan rekap." };
  }
}
