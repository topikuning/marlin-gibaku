"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canManageUsers } from "@/lib/roles";
import { r2SelfTest, type R2TestResult } from "@/lib/r2";

type ResetState = { ok?: string; error?: string };

/**
 * Kosongkan DATA OPERASIONAL (laporan harian + foto + biaya). MASTER TETAP:
 * lokasi, RAB, revisi, kurva-S/jadwal, kontrak, pengguna, dokumen. Super Admin.
 */
export async function resetData(
  _prev: ResetState | undefined,
  formData: FormData
): Promise<ResetState> {
  const session = await auth();
  if (!session?.user || session.user.role !== "super_admin")
    return { error: "Hanya Super Admin yang boleh mengosongkan data." };
  if (String(formData.get("confirm") ?? "").trim() !== "KOSONGKAN")
    return { error: 'Ketik persis KOSONGKAN (huruf besar) untuk konfirmasi.' };

  // Urutan hormati foreign key.
  const res = await db.$transaction(async (tx) => {
    const cost = await tx.costEntry.deleteMany({});
    const photos = await tx.photo.deleteMany({});
    const items = await tx.dailyReportItem.deleteMany({});
    const reports = await tx.dailyReport.deleteMany({});
    return { cost: cost.count, photos: photos.count, items: items.count, reports: reports.count };
  });

  revalidatePath("/beranda");
  revalidatePath("/laporan");
  return {
    ok: `Data operasional dikosongkan: ${res.items} item laporan, ${res.photos} foto, ${res.reports} laporan harian, ${res.cost} entri biaya. Master & kurva-S tetap.`,
  };
}

export async function runR2Test(
  _prev: R2TestResult | undefined,
  _formData: FormData
): Promise<R2TestResult | undefined> {
  const session = await auth();
  if (!session?.user || !canManageUsers(session.user.role)) return undefined;
  return r2SelfTest();
}
