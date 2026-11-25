"use server";

import { revalidatePath } from "next/cache";
import { ForbiddenError, requireCapability, requireLocationAccess } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { buildRecapPreview, commitRecap, type RecapPreview, type RecapCommitResult } from "@/lib/daily-report/recap-import";
import { ImporRekapError, pratinjauImporRekap, terapkanImporRekap, type HasilImpor } from "@/lib/daily-report/rekap-matriks/impor";
import { RekapMatriksError } from "@/lib/daily-report/rekap-matriks/baca";
import type { BahanPratinjau, PilihanImpor } from "@/lib/daily-report/rekap-matriks/masukan";
import type { ModeImpor, PilihanBentrok } from "@/lib/daily-report/rekap-matriks/jenis";

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

async function readFileForLocation(
  formData: FormData,
): Promise<{ locationId: string; slug: string; buf: Buffer; lihatUang: boolean }> {
  const locationId = String(formData.get("locationId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("Pilih file Excel rekap terlebih dahulu.");
  if (file.size > MAX_BYTES) throw new Error("File terlalu besar (maks 8MB).");

  const user = await requireCapability("daily_report.create");
  const loc = await db.location.findUnique({ where: { id: locationId }, select: { id: true, slug: true } });
  if (!loc) throw new Error("Lokasi tidak ditemukan.");
  await requireLocationAccess(user, locationId); // gate akses lokasi (scope org + penugasan)

  return {
    locationId,
    slug: slug || loc.slug,
    buf: Buffer.from(await file.arrayBuffer()),
    lihatUang: can(user.role, "money.view"),
  };
}

export async function previewRecapAction(_prev: RecapImportState, formData: FormData): Promise<RecapImportState> {
  try {
    const { locationId, buf, lihatUang } = await readFileForLocation(formData);
    const mentah = await buildRecapPreview(locationId, buf);
    // Pelaksana tidak menerima nilai rupiah, juga lewat balasan aksi (DECISIONS 735).
    const preview = lihatUang
      ? mentah
      : { ...mentah, totalValue: null, rows: mentah.rows.map((r) => ({ ...r, valueDone: null })) };
    if (preview.rows.length === 0) return { ok: false, error: "Tidak ada baris data yang terbaca di file ini. Periksa lagi isinya." };
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
      return { ok: false, error: "Tidak ada baris yang bisa disimpan. Periksa catatan di pratinjau." };
    }
    revalidatePath(`/lokasi/${slug}/harian`);
    revalidatePath(`/lokasi/${slug}/progress`);
    revalidatePath(`/lokasi/${slug}`);
    return { ok: true, phase: "done", result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Gagal menyimpan rekap." };
  }
}

/* ── Impor REKAP HARIAN (matriks pekerjaan × tanggal) – DECISIONS 782 ───── */

export type RekapMatriksState =
  | { ok: true; fase: "pratinjau"; bahan: BahanPratinjau }
  | { ok: true; fase: "selesai"; hasil: HasilImpor }
  | { ok: false; error: string }
  | undefined;

/** Berkas rekap lapangan (banyak sheet + gambar) lebih besar dari template rekap biasa. */
const MAKS_REKAP = 25 * 1024 * 1024;

/**
 * Gerbang: `daily_report.create` + akses lokasi untuk membaca dan menulis laporan
 * yang masih draft. Mengubah laporan yang SUDAH dikirim/disetujui butuh
 * `daily_report.review` (Site Manager ke atas), yang sudah FINAL butuh
 * `daily_report.unfinalize` (super admin) – sama dengan hak membuka laporan
 * final untuk diubah isinya. Yang tidak berhak tetap melihat perubahannya,
 * ditandai "ditahan" dengan sebabnya.
 */
async function bacaBerkasRekap(fd: FormData) {
  const locationId = String(fd.get("locationId") ?? "");
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) throw new RekapMatriksError("Pilih berkas Excel dulu.");
  if (file.size > MAKS_REKAP) throw new RekapMatriksError("Berkas terlalu besar (maksimal 25 MB).");
  const user = await requireCapability("daily_report.create");
  const loc = await db.location.findUnique({ where: { id: locationId }, select: { id: true, slug: true } });
  if (!loc) throw new RekapMatriksError("Lokasi tidak ditemukan.");
  await requireLocationAccess(user, loc.id);
  return {
    user,
    location: loc,
    buf: Buffer.from(await file.arrayBuffer()),
    izin: { ubahTerkirim: can(user.role, "daily_report.review"), ubahFinal: can(user.role, "daily_report.unfinalize") },
  };
}

function galatRekap(err: unknown): RekapMatriksState {
  if (err instanceof RekapMatriksError || err instanceof ImporRekapError) return { ok: false, error: err.message };
  if (err instanceof ForbiddenError) return { ok: false, error: err.message };
  console.error("[impor-rekap-harian]", err);
  return { ok: false, error: "Berkas tidak bisa dibaca. Pastikan berkasnya .xlsx yang memuat sheet REKAP HARIAN." };
}

export async function pratinjauRekapMatriksAction(_prev: RekapMatriksState, fd: FormData): Promise<RekapMatriksState> {
  try {
    const { location, buf, izin } = await bacaBerkasRekap(fd);
    return { ok: true, fase: "pratinjau", bahan: await pratinjauImporRekap(location.id, buf, izin) };
  } catch (err) {
    return galatRekap(err);
  }
}

const MODE = new Set<ModeImpor>(["tambah", "timpa"]);
const PILIHAN = new Set<PilihanBentrok>(["lewati", "excel", "jumlahkan", "potong"]);

function bacaPilihan(fd: FormData): PilihanImpor {
  const mode = String(fd.get("mode") ?? "") as ModeImpor;
  if (!MODE.has(mode)) throw new RekapMatriksError("Pilih cara impornya: tambah atau timpa.");
  const parse = (k: string): Record<string, unknown> => {
    try {
      const v = JSON.parse(String(fd.get(k) ?? "{}"));
      return v && typeof v === "object" && !Array.isArray(v) ? v : {};
    } catch {
      return {};
    }
  };
  const tujuan: Record<number, string> = {};
  for (const [k, v] of Object.entries(parse("tujuan"))) {
    if (/^\d+$/.test(k) && typeof v === "string" && v.length <= 200) tujuan[Number(k)] = v;
  }
  const pilihan: Record<string, PilihanBentrok> = {};
  for (const [k, v] of Object.entries(parse("pilihan"))) {
    if (typeof v === "string" && PILIHAN.has(v as PilihanBentrok) && k.length <= 200) pilihan[k] = v as PilihanBentrok;
  }
  return { mode, tujuan, pilihan };
}

export async function simpanRekapMatriksAction(_prev: RekapMatriksState, fd: FormData): Promise<RekapMatriksState> {
  try {
    const { user, location, buf, izin } = await bacaBerkasRekap(fd);
    const hasil = await terapkanImporRekap({
      locationId: location.id,
      buf,
      userId: user.id,
      izin,
      pilihan: bacaPilihan(fd),
      sidik: String(fd.get("sidik") ?? ""),
    });
    for (const p of ["/harian", "/progress", "", "/rab"]) revalidatePath(`/lokasi/${location.slug}${p}`);
    return { ok: true, fase: "selesai", hasil };
  } catch (err) {
    return galatRekap(err);
  }
}
