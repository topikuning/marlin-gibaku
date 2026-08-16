"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { ForbiddenError, requireCapability, requireLocationAccess } from "@/lib/auth/session";

/**
 * Aksi pemetaan RAB → AHSP (DECISIONS 319).
 *
 * Capability-nya `rab.manage`: pemetaan ini menentukan koefisien bahan/upah yang
 * dipakai memperkirakan biaya pelaksanaan, jadi bobotnya setara mengubah RAB —
 * bukan sekadar melihat. Setiap mutasi memanggil `requireLocationAccess` juga,
 * karena pintunya dibuka dari halaman satu lokasi.
 */

export type PadananActionState = { error?: string; success?: string } | undefined;

const petakanSchema = z.object({ locationId: z.uuid(), slug: z.string().min(1) });

export async function petakanRabAction(
  _prev: PadananActionState,
  formData: FormData,
): Promise<PadananActionState> {
  const parsed = petakanSchema.safeParse({
    locationId: formData.get("locationId"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { locationId, slug } = parsed.data;

  try {
    const user = await requireCapability("rab.manage");
    await requireLocationAccess(user, locationId);
    const { petakanLokasi } = await import("./padanan");
    const h = await petakanLokasi(locationId, user.id);
    await audit(user.id, "ahsp.petakan", "location", locationId, h);
    revalidatePath(`/lokasi/${slug}/rapl`);

    if (h.itemRab === 0) {
      return { error: "Lokasi ini belum punya revisi RAB aktif, jadi belum ada yang bisa dipetakan." };
    }
    if (h.baru === 0) {
      const alasan =
        h.belumKetemu > 0
          ? `${h.belumKetemu} uraian belum ketemu padanannya — pilih sendiri di daftar di bawah.`
          : "Semua uraian sudah punya padanan.";
      return { success: `Tidak ada padanan baru. ${alasan}` };
    }
    const bagian = [
      `${h.baru} uraian dipetakan (${h.baruMeyakinkan} meyakinkan, ${h.baru - h.baruMeyakinkan} beda tipis — perlu diperiksa)`,
    ];
    if (h.belumKetemu > 0) bagian.push(`${h.belumKetemu} uraian belum ketemu padanannya`);
    if (h.dijagaKoreksi > 0) bagian.push(`${h.dijagaKoreksi} koreksi manusia tidak disentuh`);
    return { success: `${bagian.join("; ")}.` };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Gagal memetakan RAB ke AHSP." };
  }
}

const koreksiSchema = z.object({
  locationId: z.uuid(),
  slug: z.string().min(1),
  tanda: z.string().min(1),
  uraianContoh: z.string().min(1),
  satuan: z.string(),
  /** "" = dinyatakan tidak ada padanannya (keputusan sah, bukan kosong). */
  entryId: z.union([z.uuid(), z.literal("")]),
});

export async function koreksiPadananAction(
  _prev: PadananActionState,
  formData: FormData,
): Promise<PadananActionState> {
  const parsed = koreksiSchema.safeParse({
    locationId: formData.get("locationId"),
    slug: formData.get("slug"),
    tanda: formData.get("tanda"),
    uraianContoh: formData.get("uraianContoh"),
    satuan: String(formData.get("satuan") ?? ""),
    entryId: String(formData.get("entryId") ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  try {
    const user = await requireCapability("rab.manage");
    await requireLocationAccess(user, d.locationId);
    const { koreksiPadanan } = await import("./padanan");
    const hasil = await koreksiPadanan({
      tanda: d.tanda,
      uraianContoh: d.uraianContoh,
      satuan: d.satuan,
      entryId: d.entryId === "" ? null : d.entryId,
      userId: user.id,
    });
    await audit(user.id, "ahsp.padanan.koreksi", "location", d.locationId, {
      tanda: d.tanda,
      uraian: d.uraianContoh,
      entryId: d.entryId || null,
      ...hasil,
    });
    revalidatePath(`/lokasi/${d.slug}/rapl`);

    const luas =
      hasil.lokasiKena > 1
        ? ` Berlaku untuk ${hasil.barisKena} baris RAB di ${hasil.lokasiKena} lokasi.`
        : "";
    return {
      success:
        (d.entryId === ""
          ? `"${d.uraianContoh}" ditandai tidak punya padanan AHSP.`
          : `Padanan "${d.uraianContoh}" disimpan.`) + luas,
    };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Gagal menyimpan koreksi padanan." };
  }
}

/** Kandidat untuk satu baris: usulan mesin + hasil pencarian kata kunci. */
export async function cariPadananAction(args: {
  locationId: string;
  uraian: string;
  satuan: string | null;
  kueri?: string;
}) {
  const user = await requireCapability("rab.manage");
  await requireLocationAccess(user, args.locationId);
  const { alternatifPadanan, cariAhsp } = await import("./padanan");
  const q = (args.kueri ?? "").trim();
  return q.length >= 3 ? cariAhsp(q) : alternatifPadanan(args.uraian, args.satuan);
}
