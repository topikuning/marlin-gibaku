"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { ForbiddenError, requireCapability } from "@/lib/auth/session";
import { jakartaDateKey } from "@/lib/format";
import { DailyReportError } from "@/lib/daily-report/service";
import { bacaAngka } from "@/lib/waha/lapor-aturan";
import { buangUsulan, masukkanUsulan, UsulanError } from "./service";

/** Aksi usulan dari WhatsApp di halaman laporan harian (DECISIONS 707). */

export type UsulanState = { ok?: string; error?: string; warning?: string } | undefined;

function gagal(err: unknown): UsulanState {
  if (err instanceof UsulanError || err instanceof DailyReportError || err instanceof ForbiddenError) {
    return { error: err.message };
  }
  const digest = (err as { digest?: unknown } | null)?.digest;
  if (typeof digest === "string" && digest.startsWith("NEXT_")) throw err;
  console.error("[usulan-wa] galat tak terduga", err);
  return { error: "Usulan gagal diproses. Coba lagi sebentar lagi." };
}

async function segarkan(usulanId: string) {
  const u = await db.waUsulan.findUnique({
    where: { id: usulanId },
    select: { reportDate: true, location: { select: { slug: true } } },
  });
  if (!u) return;
  const dateKey = jakartaDateKey(u.reportDate);
  revalidatePath(`/lokasi/${u.location.slug}/harian/${dateKey}`);
  revalidatePath(`/lokasi/${u.location.slug}/harian`);
  revalidatePath("/perlu-tindakan");
  revalidatePath("/foto-cepat");
}

const idSchema = z.uuid("Usulan tidak dikenali.");

export async function masukkanUsulanAction(_prev: UsulanState, formData: FormData): Promise<UsulanState> {
  try {
    const actor = await requireCapability("daily_report.create");
    const id = idSchema.parse(formData.get("usulanId"));
    const mentah = String(formData.get("volume") ?? "").trim();
    // Volume diketik orang Indonesia: "12,5" dan "1.250" dibaca sama seperti di WhatsApp.
    const volume = mentah ? bacaAngka(mentah) : null;
    if (mentah && (volume == null || volume <= 0)) return { error: "Volume harus angka lebih dari 0." };
    // Pekerjaan pilihan pemeriksa (DECISIONS 709); kosong = pekerjaan usulan.
    const lineageKey = String(formData.get("lineageKey") ?? "").trim().slice(0, 200) || null;
    const h = await masukkanUsulan(actor, id, volume, lineageKey);
    await segarkan(id);
    const dasar =
      h.volume != null ? "Usulan dimasukkan ke laporan harian." : "Foto usulan ditempel ke pekerjaan di laporan harian.";
    const foto = h.foto > 0 ? ` ${h.foto} foto ikut ditempel.` : "";
    if (h.gagalFoto) return { warning: `${dasar}${foto} Foto tidak ikut: ${h.gagalFoto}` };
    return { ok: `${dasar}${foto}` };
  } catch (err) {
    return gagal(err);
  }
}

export async function buangUsulanAction(_prev: UsulanState, formData: FormData): Promise<UsulanState> {
  try {
    const actor = await requireCapability("daily_report.create");
    const id = idSchema.parse(formData.get("usulanId"));
    await buangUsulan(actor, id);
    await segarkan(id);
    return { ok: "Usulan dibuang. Fotonya tetap ada di kantong Foto Cepat." };
  } catch (err) {
    return gagal(err);
  }
}
