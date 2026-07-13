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

/**
 * RESET PENUH — hapus SEMUA data isi (lokasi, kontrak, RAB, kurva-S, laporan,
 * dokumen, dst) supaya bisa mulai dari NOL untuk data real. TETAP: akun pengguna
 * (agar tetap bisa login) + organisasi. Cara perhitungan kurva-S/jadwal = kode,
 * jadi otomatis tetap. Super Admin, konfirmasi "RESET SEMUA".
 */
export async function resetAllData(
  _prev: ResetState | undefined,
  formData: FormData
): Promise<ResetState> {
  const session = await auth();
  if (!session?.user || session.user.role !== "super_admin")
    return { error: "Hanya Super Admin yang boleh reset penuh." };
  if (String(formData.get("confirm") ?? "").trim() !== "RESET SEMUA")
    return { error: 'Ketik persis RESET SEMUA (huruf besar) untuk konfirmasi.' };

  // TRUNCATE CASCADE semua tabel isi. TETAP: organizations, users.
  await db.$executeRawUnsafe(`TRUNCATE TABLE
    contractors, contracts, contract_amendments, locations,
    rab_revisions, rab_categories, rab_subcategories, rab_items,
    scheduled_milestones, scurve_plans, scurve_milestones, budget_lines,
    location_status_history, daily_reports, daily_report_items, photos, cost_entries,
    weekly_plans, weekly_plan_items, weekly_reports, monthly_reports,
    alerts, documents,
    daily_logs, daily_log_workers, daily_log_materials, daily_log_equipment,
    user_location_assignments, devices, otp_codes, sync_queue, audit_logs
    RESTART IDENTITY CASCADE;`);

  revalidatePath("/beranda");
  revalidatePath("/lokasi");
  revalidatePath("/peta");
  return {
    ok: "Sistem dikosongkan ke nol. Semua data contoh terhapus; akun login tetap. Silakan mulai input data real (Kontrak → Lokasi → RAB).",
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
