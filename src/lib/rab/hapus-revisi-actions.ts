"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireCapability, requireLocationAccess } from "@/lib/auth/session";
import { adalahAkar, parseAkar } from "@/lib/akar";
import { env } from "@/lib/env";
import { HapusRevisiDitolak, hapusRevisiKeliru } from "@/lib/rab/hapus-revisi";

export type HapusRevisiState = { error?: string; success?: string } | undefined;

const skema = z.object({ revisionId: z.string().uuid(), konfirmasi: z.string() });

/**
 * Hapus revisi RAB adendum yang keliru (DECISIONS 636). Tiga pagar:
 * kapabilitas super admin, SUPER ADMIN UTAMA (env), dan konfirmasi
 * `HAPUS #<nomor>` diketik persis – penghapusan ini tidak bisa dibatalkan.
 */
export async function hapusRevisiKeliruAction(_prev: HapusRevisiState, formData: FormData): Promise<HapusRevisiState> {
  const user = await requireCapability("rab.revision_purge");
  if (!adalahAkar(user, parseAkar(env.SUPER_ADMIN_UTAMA))) {
    return { error: "Hanya super admin utama yang boleh menghapus revisi RAB." };
  }
  const parsed = skema.safeParse({ revisionId: formData.get("revisionId"), konfirmasi: formData.get("konfirmasi") ?? "" });
  if (!parsed.success) return { error: "Permintaan tidak valid." };

  const rev = await db.rabRevision.findUnique({
    where: { id: parsed.data.revisionId },
    select: { id: true, revisionNo: true, totalValue: true, source: true, location: { select: { id: true, slug: true, name: true } } },
  });
  if (!rev) return { error: "Revisi tidak ditemukan." };
  await requireLocationAccess(user, rev.location.id);
  const wajib = `HAPUS #${rev.revisionNo}`;
  if (parsed.data.konfirmasi.trim().toUpperCase() !== wajib) {
    return { error: `Ketik ${wajib} persis untuk konfirmasi.` };
  }

  try {
    const h = await hapusRevisiKeliru(rev.id, user.id);
    await audit(user.id, "rab.revisi_hapus_keliru", "location", rev.location.id, {
      revisionId: rev.id,
      revisionNo: rev.revisionNo,
      totalValue: rev.totalValue.toString(),
      pengganti: h.pengganti?.revisionNo ?? null,
      laporanDipindah: h.laporanDipindah,
      rencanaDipindah: h.rencanaDipindah,
      kurvaSDihapus: h.kurvaS,
      volumeDipulihkan: h.pemulihan.map((p) => ({ tanggal: p.tanggal, item: p.item, dari: p.sekarang, ke: p.kembaliKe })),
      pemulihanDilewati: h.pemulihanDilewati,
      dipangkasUlang: h.dipangkasUlang,
      snapshotDibangunUlang: h.snapshotDibangunUlang,
    });
    revalidatePath(`/lokasi/${rev.location.slug}`, "layout");
    return {
      success:
        `Revisi #${rev.revisionNo} dihapus dari riwayat ${rev.location.name}. ` +
        `${h.laporanDipindah} baris laporan dipindah ke revisi #${h.pengganti?.revisionNo}, ` +
        `${h.pemulihan.length} volume dipulihkan` +
        (h.dipangkasUlang > 0 ? `, ${h.dipangkasUlang} dipangkas ulang oleh RAB aktif` : "") +
        `, ${h.kurvaS} kurva-S ikut dihapus.`,
    };
  } catch (err) {
    if (err instanceof HapusRevisiDitolak) return { error: err.message };
    throw err;
  }
}
