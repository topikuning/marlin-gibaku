"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { ForbiddenError, requireCapability, requireLocationAccess } from "@/lib/auth/session";
import {
  LuarRabError,
  aktifkanLagiLuarRab,
  batalkanLuarRab,
  gabungkanLuarRab,
  lepasPadanan,
} from "@/lib/luar-rab/service";

/**
 * Aksi Site Manager atas catatan pekerjaan di luar RAB (DECISIONS 738):
 * gabungkan ke draft adendum, lepas padanan, batalkan dengan alasan, aktifkan
 * lagi. Penegak aturannya di `lib/luar-rab/service` – di sini otorisasi,
 * pembacaan formulir, dan penyegaran halaman.
 */

export type LuarRabActionState = { error?: string; success?: string; warning?: string } | undefined;

function gagal(err: unknown): LuarRabActionState {
  if (err instanceof LuarRabError || err instanceof ForbiddenError) return { error: err.message };
  const digest = (err as { digest?: unknown } | null)?.digest;
  if (typeof digest === "string" && digest.startsWith("NEXT_")) throw err;
  console.error("[luar-rab] aksi gagal:", err);
  return { error: "Terjadi kesalahan tak terduga. Coba lagi." };
}

async function konteks(slug: string) {
  const user = await requireCapability("rab.manage");
  const location = await db.location.findUnique({ where: { slug }, select: { id: true, slug: true } });
  if (!location) throw new LuarRabError("Lokasi tidak ditemukan.");
  await requireLocationAccess(user, location.id);
  return { user, location };
}

/** Catatan harus milik lokasi yang dibuka – id dari formulir tidak dipercaya begitu saja. */
async function catatanLokasi(id: string, locationId: string) {
  const c = await db.pekerjaanLuarRab.findUnique({ where: { id }, select: { locationId: true } });
  if (!c || c.locationId !== locationId) throw new LuarRabError("Catatan tidak ditemukan di lokasi ini.");
}

function segarkan(slug: string) {
  revalidatePath(`/lokasi/${slug}/rab/adendum`);
  revalidatePath(`/lokasi/${slug}/harian`, "layout");
}

const pilihanSchema = z
  .array(z.object({ catatanId: z.uuid(), kandidatId: z.uuid().nullable(), terimaSatuanBeda: z.boolean() }))
  .max(500);

export async function gabungLuarRabAction(_prev: LuarRabActionState, formData: FormData): Promise<LuarRabActionState> {
  try {
    const { user, location } = await konteks(z.string().min(1).parse(formData.get("slug")));
    let pilihan: z.infer<typeof pilihanSchema>;
    try {
      pilihan = pilihanSchema.parse(JSON.parse(String(formData.get("pilihan") ?? "[]")));
    } catch {
      return { error: "Pilihan tidak terbaca. Muat ulang halaman, lalu coba lagi." };
    }
    const h = await gabungkanLuarRab(location.id, pilihan, user.id);
    segarkan(location.slug);
    if (h.catatan === 0) {
      return { error: `Tidak ada yang digabung. ${h.ditahan.map((d) => d.pesan).filter(Boolean).join(" ")}`.trim() };
    }
    return {
      success:
        `${h.catatan} catatan masuk draft adendum sebagai ${h.baris} baris laporan pada tanggal aslinya.` +
        (h.laporanFinal > 0 ? ` ${h.laporanFinal} di antaranya laporan final – isi resminya tidak berubah.` : ""),
      warning: h.ditahan.length > 0 ? `${h.ditahan.length} catatan ditahan: ${h.ditahan.map((d) => d.pesan).filter(Boolean).join(" ")}` : undefined,
    };
  } catch (err) {
    return gagal(err);
  }
}

const satuCatatan = z.object({ slug: z.string().min(1), catatanId: z.uuid() });

export async function lepasPadananAction(_prev: LuarRabActionState, formData: FormData): Promise<LuarRabActionState> {
  try {
    const d = satuCatatan.parse({ slug: formData.get("slug"), catatanId: formData.get("catatanId") });
    const { user, location } = await konteks(d.slug);
    await catatanLokasi(d.catatanId, location.id);
    await lepasPadanan(d.catatanId, user.id);
    segarkan(location.slug);
    return { success: "Padanan dilepas. Catatannya kembali menunggu." };
  } catch (err) {
    if (err instanceof z.ZodError) return { error: "Catatan tidak dikenali." };
    return gagal(err);
  }
}

export async function batalkanLuarRabAction(_prev: LuarRabActionState, formData: FormData): Promise<LuarRabActionState> {
  try {
    const d = satuCatatan.parse({ slug: formData.get("slug"), catatanId: formData.get("catatanId") });
    const { user, location } = await konteks(d.slug);
    await catatanLokasi(d.catatanId, location.id);
    await batalkanLuarRab(d.catatanId, String(formData.get("alasan") ?? ""), user.id);
    segarkan(location.slug);
    return { success: "Catatan dibatalkan. Isinya dan fotonya tetap tersimpan." };
  } catch (err) {
    if (err instanceof z.ZodError) return { error: "Catatan tidak dikenali." };
    return gagal(err);
  }
}

export async function aktifkanLagiLuarRabAction(_prev: LuarRabActionState, formData: FormData): Promise<LuarRabActionState> {
  try {
    const d = satuCatatan.parse({ slug: formData.get("slug"), catatanId: formData.get("catatanId") });
    const { user, location } = await konteks(d.slug);
    await catatanLokasi(d.catatanId, location.id);
    await aktifkanLagiLuarRab(d.catatanId, user.id);
    segarkan(location.slug);
    return { success: "Catatan aktif lagi dan kembali menunggu dipadankan." };
  } catch (err) {
    if (err instanceof z.ZodError) return { error: "Catatan tidak dikenali." };
    return gagal(err);
  }
}
