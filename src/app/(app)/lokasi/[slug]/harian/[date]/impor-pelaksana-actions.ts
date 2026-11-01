"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCapability, requireLocationAccess } from "@/lib/auth/session";
import { DailyReportError } from "@/lib/daily-report/service";
import {
  BATAS_BYTE,
  ImporPelaksanaError,
  pratinjauImporPelaksana,
  simpanImporPelaksana,
  type PratinjauImpor,
} from "@/lib/daily-report/impor-pelaksana/proses";

/**
 * Impor laporan harian buatan pelaksana (DECISIONS 733). Dua langkah:
 * baca berkas → pratinjau (tidak menulis apa pun); simpan baris yang dipilih
 * lewat layanan laporan harian biasa. Gate sama dengan input item manual:
 * `daily_report.create` + akses lokasi; keduanya diperiksa ulang tiap langkah.
 */

export type PratinjauImporState = { error?: string; pratinjau?: PratinjauImpor } | undefined;

export async function pratinjauImporPelaksanaAction(
  _prev: PratinjauImporState,
  fd: FormData,
): Promise<PratinjauImporState> {
  try {
    const user = await requireCapability("daily_report.create");
    const locationId = z.uuid().parse(fd.get("locationId"));
    const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(fd.get("dateKey"));
    await requireLocationAccess(user, locationId);
    const file = fd.get("berkas");
    if (!(file instanceof File) || file.size === 0) return { error: "Pilih berkas PDF laporan pelaksana dulu." };
    if (file.size > BATAS_BYTE) return { error: `Berkas ${Math.round(file.size / 1024 / 1024)} MB terlalu besar (batas 15 MB).` };
    const pratinjau = await pratinjauImporPelaksana({
      locationId,
      dateKey,
      buf: Buffer.from(await file.arrayBuffer()),
      nama: file.name,
      mime: file.type,
    });
    return { pratinjau };
  } catch (e) {
    if (e instanceof ImporPelaksanaError || e instanceof DailyReportError) return { error: e.message };
    if (e instanceof z.ZodError) return { error: "Permintaan tidak valid. Muat ulang halaman, lalu coba lagi." };
    throw e;
  }
}

const simpanSchema = z.object({
  berkas: z.string().max(300),
  sumber: z.string().max(40),
  baris: z
    .array(
      z.object({
        kandidatId: z.uuid(),
        volume: z.number().positive(),
        uraian: z.string().max(500),
        catatan: z.string().max(300).nullable(),
      }),
    )
    .max(200),
  tenaga: z
    .array(z.object({ role: z.enum(["site_manager", "pelaksana", "mandor", "kepala_tukang", "tukang_bongkar", "tukang_batu", "tukang_besi", "tukang_kayu", "tukang_pipa", "tukang_listrik", "tukang_cat", "tenaga", "logistik", "operator"]), count: z.number().int().positive().max(10_000) }))
    .max(30)
    .nullable(),
  bahan: z
    .array(
      z.object({
        jenis: z.enum(["bahan", "alat"]),
        nama: z.string().min(1).max(200),
        qty: z.number().nonnegative().nullable(),
        satuan: z.string().max(40).nullable(),
      }),
    )
    .max(100),
});

export type SimpanImporState =
  | { error?: string; success?: string; ditolak?: { uraian: string; pesan: string }[] }
  | undefined;

export async function simpanImporPelaksanaAction(_prev: SimpanImporState, fd: FormData): Promise<SimpanImporState> {
  try {
    const user = await requireCapability("daily_report.create");
    const locationId = z.uuid().parse(fd.get("locationId"));
    const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(fd.get("dateKey"));
    const slug = z.string().min(1).max(200).parse(fd.get("slug"));
    await requireLocationAccess(user, locationId);
    const input = simpanSchema.parse(JSON.parse(String(fd.get("payload") ?? "{}")));
    if (input.baris.length === 0 && !input.tenaga && input.bahan.length === 0) {
      return { error: "Belum ada yang dipilih untuk dimasukkan." };
    }
    const h = await simpanImporPelaksana(locationId, dateKey, input, user.id);
    revalidatePath(`/lokasi/${slug}/harian/${dateKey}`);
    revalidatePath(`/lokasi/${slug}/harian`);
    const bagian = [
      h.tersimpan > 0 ? `${h.tersimpan} pekerjaan masuk draft` : null,
      h.tenagaDiganti ? "tenaga kerja diganti dari berkas" : null,
      h.bahanDitambah > 0 ? `${h.bahanDitambah} bahan/alat ditambahkan` : null,
    ].filter(Boolean);
    return {
      success: bagian.length ? `${bagian.join(", ")}.` : undefined,
      error:
        [h.ditolak.length > 0 ? `${h.ditolak.length} pekerjaan ditolak (lihat di bawah).` : null, h.galatPelengkap]
          .filter(Boolean)
          .join(" ") || undefined,
      ditolak: h.ditolak,
    };
  } catch (e) {
    if (e instanceof ImporPelaksanaError || e instanceof DailyReportError) return { error: e.message };
    if (e instanceof z.ZodError || e instanceof SyntaxError) return { error: "Isian tidak valid. Baca ulang berkasnya, lalu coba lagi." };
    throw e;
  }
}
