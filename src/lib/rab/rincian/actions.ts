"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { ForbiddenError, requireCapability } from "@/lib/auth/session";
import { db } from "@/lib/db";

export type RincianActionState = { error?: string; success?: string } | undefined;

const JALUR = "/sistem/rincian-rab";

async function revisiMilikOrg(revisionId: string, orgId: string) {
  return db.rabRevision.findFirst({
    where: { id: revisionId, location: { package: { orgId } } },
    select: { id: true, revisionNo: true, locationId: true, location: { select: { name: true, slug: true } } },
  });
}

/** Periksa satu revisi: baca berkas arsip, catat laporan. Tidak menyimpan rincian. */
export async function periksaRevisiAction(_p: RincianActionState, fd: FormData): Promise<RincianActionState> {
  try {
    const user = await requireCapability("system.manage");
    const id = z.uuid().safeParse(fd.get("revisionId"));
    if (!id.success) return { error: "Revisi tidak valid." };
    const rev = await revisiMilikOrg(id.data, user.orgId);
    if (!rev) return { error: "Revisi tidak ditemukan." };
    const { periksaRevisi } = await import("./arsip");
    const h = await periksaRevisi(rev.id, user.id);
    await audit(user.id, "rab.rincian_periksa", "rab_revision", rev.id, {
      locationId: rev.locationId,
      status: h.status,
      itemRevisi: h.itemRevisi,
      itemCocok: h.itemCocok,
    });
    revalidatePath(JALUR);
    return { success: `${rev.location.name} revisi #${rev.revisionNo} diperiksa. Belum ada yang disimpan.` };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: e.message };
    return { error: e instanceof Error ? e.message : "Pemeriksaan gagal." };
  }
}

/** Simpan rincian satu revisi dari berkas arsipnya – hanya sesudah diperiksa. */
export async function lengkapiRevisiAction(_p: RincianActionState, fd: FormData): Promise<RincianActionState> {
  try {
    const user = await requireCapability("system.manage");
    const id = z.uuid().safeParse(fd.get("revisionId"));
    if (!id.success) return { error: "Revisi tidak valid." };
    const rev = await revisiMilikOrg(id.data, user.orgId);
    if (!rev) return { error: "Revisi tidak ditemukan." };
    const { lengkapiRevisi, RincianTidakSiap } = await import("./arsip");
    try {
      const { simpan } = await lengkapiRevisi(rev.id, user.id);
      await audit(user.id, "rab.rincian_lengkapi", "rab_revision", rev.id, { locationId: rev.locationId, ...simpan });
      revalidatePath(JALUR);
      revalidatePath(`/lokasi/${rev.location.slug}/rab`);
      return {
        success:
          `${rev.location.name} revisi #${rev.revisionNo}: backup volume ${simpan.backupVolume} item, ` +
          `analisa ${simpan.itemAnalisa} item, ${simpan.hargaDasar} bahan & upah tersimpan. Angka RAB tidak berubah.`,
      };
    } catch (e) {
      if (e instanceof RincianTidakSiap) return { error: e.message };
      throw e;
    }
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: e.message };
    return { error: e instanceof Error ? e.message : "Penyimpanan rincian gagal." };
  }
}

/**
 * Periksa SEMUA revisi yang belum diperiksa (atau semua, bila diminta) di
 * latar. Hasilnya muncul di tabel sambil berjalan.
 */
export async function periksaSemuaAction(_p: RincianActionState, fd: FormData): Promise<RincianActionState> {
  try {
    const user = await requireCapability("system.manage");
    const ulang = fd.get("ulang") === "1";
    const revs = await db.rabRevision.findMany({
      where: { location: { package: { orgId: user.orgId } }, ...(ulang ? {} : { rincianPeriksa: null }) },
      select: { id: true },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    });
    const { mulaiLatarRincian } = await import("./arsip");
    const m = mulaiLatarRincian("periksa", revs.map((r) => r.id), user.id);
    if (!m.dimulai) {
      return m.berjalan
        ? { error: `Masih ada putaran yang berjalan (${m.berjalan.selesai}/${m.berjalan.total}). Tunggu sampai selesai.` }
        : { success: "Semua revisi sudah diperiksa." };
    }
    await audit(user.id, "rab.rincian_periksa_semua", "system", null, { jumlah: revs.length, ulang });
    revalidatePath(JALUR);
    return { success: `Memeriksa ${revs.length} revisi di latar. Muat ulang halaman untuk melihat kemajuannya.` };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: e.message };
    return { error: e instanceof Error ? e.message : "Gagal memulai pemeriksaan." };
  }
}

/** Simpan rincian semua revisi yang hasil periksanya siap/sebagian dan belum berincian. */
export async function lengkapiSemuaSiapAction(_p: RincianActionState, _fd: FormData): Promise<RincianActionState> {
  try {
    const user = await requireCapability("system.manage");
    const revs = await db.rabRevision.findMany({
      where: {
        location: { package: { orgId: user.orgId } },
        rincian: null,
        rincianPeriksa: { status: { in: ["siap", "sebagian"] } },
      },
      select: { id: true },
    });
    const { mulaiLatarRincian } = await import("./arsip");
    const m = mulaiLatarRincian("lengkapi", revs.map((r) => r.id), user.id);
    if (!m.dimulai) {
      return m.berjalan
        ? { error: `Masih ada putaran yang berjalan (${m.berjalan.selesai}/${m.berjalan.total}). Tunggu sampai selesai.` }
        : { error: "Tidak ada revisi yang siap disimpan. Periksa dulu." };
    }
    await audit(user.id, "rab.rincian_lengkapi_semua", "system", null, { jumlah: revs.length });
    revalidatePath(JALUR);
    return { success: `Menyimpan rincian ${revs.length} revisi di latar. Angka RAB tidak berubah.` };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: e.message };
    return { error: e instanceof Error ? e.message : "Gagal memulai penyimpanan." };
  }
}
