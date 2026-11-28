"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { accessibleLocationIds, ForbiddenError, requireCapability } from "@/lib/auth/session";
import { jalankanDiLatar } from "@/lib/auth/latar";
import { locationScopeWhere } from "@/lib/auth/scope";
import { db } from "@/lib/db";

/**
 * Aksi KATALOG HARGA WILAYAH (DECISIONS 806).
 *
 * - Estimasi harga SATU PAKET sekali klik: setiap lokasi ber-RAB aktif yang
 *   boleh dibuka dikerjakan berurutan di latar dengan jalur yang sama dengan
 *   tombol "Estimasi semua harga" di lokasi. Lokasi sekabupaten memakai
 *   katalog yang diisi lokasi sebelumnya, jadi riset tidak berulang.
 * - Riset ulang satu kabupaten: katalognya dihapus, estimasi berikutnya
 *   mencari lagi. Usulan dan HSD yang sudah ada tidak disentuh.
 *
 * Pintu sama dengan draf harga AI: `ai.generate` + `rapl.manage`.
 */

export async function estimasiHargaPaketAction(args: {
  packageId: string;
}): Promise<{ ok: true; lokasi: number } | { ok: false; error: string }> {
  if (!z.uuid().safeParse(args.packageId).success) return { ok: false, error: "Paket tidak ditemukan." };
  try {
    const user = await requireCapability("ai.generate");
    await requireCapability("rapl.manage");
    const paket = await db.package.findFirst({ where: { id: args.packageId, orgId: user.orgId }, select: { id: true } });
    if (!paket) return { ok: false, error: "Paket tidak ditemukan." };
    const locIds = await accessibleLocationIds(user);
    const lokasi = await db.location.findMany({
      where: { ...locationScopeWhere(user, locIds), packageId: paket.id, rabRevisions: { some: { status: "aktif" } } },
      orderBy: [{ regency: "asc" }, { name: "asc" }],
      select: { id: true },
    });
    if (lokasi.length === 0) return { ok: false, error: "Belum ada lokasi paket ini yang punya RAB aktif dan boleh Anda buka." };

    const { getAiGuardConfig, checkAiGuard, AiGuardError } = await import("@/lib/ai-hub/guard");
    const { batasJawabanMs } = await import("@/lib/ai-hub/guard-rules");
    const cfg = await getAiGuardConfig();
    const berjalan = await db.hsdUsulanRun.findFirst({
      where: { locationId: { in: lokasi.map((l) => l.id) }, pendingSince: { not: null, gt: new Date(Date.now() - batasJawabanMs(cfg)) } },
      select: { id: true },
    });
    if (berjalan) return { ok: false, error: "Estimasi harga untuk lokasi paket ini masih berjalan. Tunggu sampai selesai." };
    try {
      await checkAiGuard(user, { kind: "rapl.riset_harga", locationCount: lokasi.length });
    } catch (err) {
      if (err instanceof AiGuardError) return { ok: false, error: err.message };
      throw err;
    }

    await audit(user.id, "rapl.harga_paket.minta", "package", paket.id, { lokasi: lokasi.length });

    const { siapkanTargetHarga } = await import("@/lib/ahsp/hsd-ai");
    const { jalankanUsulanSemua } = await import("@/lib/ahsp/hsd-ai-latar");
    void jalankanDiLatar(async () => {
      for (const l of lokasi) {
        try {
          const siap = await siapkanTargetHarga(l.id);
          if ("error" in siap) continue; // semua sudah berharga
          const penanda = new Date();
          const run = await db.hsdUsulanRun.create({
            data: { locationId: l.id, status: "menunggu", pendingSince: penanda, diminta: siap.totalKosong, totalKosong: siap.totalKosong, requestedById: user.id },
            select: { id: true },
          });
          await jalankanUsulanSemua(user, { runId: run.id, penanda, locationId: l.id, semua: true });
        } catch (err) {
          console.error("[harga-wilayah] estimasi paket – satu lokasi gagal:", err);
        }
      }
    });

    revalidatePath(`/paket/${paket.id}`);
    return { ok: true, lokasi: lokasi.length };
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : "Gagal memulai estimasi harga paket." };
  }
}

const wilayahSkema = z.object({ provinsi: z.string().min(1).max(120), kabupaten: z.string().min(1).max(160) });

export async function risetUlangWilayahAction(args: {
  provinsi: string;
  kabupaten: string;
}): Promise<{ ok: true; dihapus: number } | { ok: false; error: string }> {
  const d = wilayahSkema.safeParse(args);
  if (!d.success) return { ok: false, error: "Wilayah tidak dikenal." };
  try {
    const user = await requireCapability("rapl.manage");
    const n = await db.hargaWilayah.deleteMany({ where: { orgId: user.orgId, provinsi: d.data.provinsi, kabupaten: d.data.kabupaten } });
    await audit(user.id, "rapl.katalog_harga.riset_ulang", "organization", user.orgId, { ...d.data, dihapus: n.count });
    revalidatePath("/katalog-harga");
    return { ok: true, dihapus: n.count };
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : "Gagal menghapus katalog wilayah." };
  }
}
