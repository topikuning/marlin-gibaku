"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { ForbiddenError, requireCapability, requireLocationAccess } from "@/lib/auth/session";

/**
 * Aksi Harga Satuan Dasar (DECISIONS 327).
 *
 * Capability `finance.input`: ini memasukkan ANGKA UANG yang dipakai
 * membandingkan biaya pelaksanaan dengan nilai kontrak — bobotnya sama dengan
 * memasukkan transaksi keuangan, bukan sekadar mengelola RAB.
 */

export type HargaActionState = { error?: string; success?: string } | undefined;

const skema = z.object({
  locationId: z.uuid(),
  slug: z.string().min(1),
  kategori: z.string().min(1),
  nama: z.string().min(1),
  satuan: z.string(),
  /** "" = kosongkan harganya (hapus barisnya), bukan simpan nol. */
  harga: z.string(),
  sumber: z.string().max(200).optional(),
});

/** "1.250.000" / "1250000" / "1 250 000" → 1250000n. Kosong → null. */
function bacaRupiah(raw: string): bigint | null | "salah" {
  const t = raw.replace(/[^\d]/g, "");
  if (raw.trim() === "") return null;
  if (t === "") return "salah";
  try {
    const n = BigInt(t);
    return n >= 0n ? n : "salah";
  } catch {
    return "salah";
  }
}

export async function simpanHargaAction(
  _prev: HargaActionState,
  formData: FormData,
): Promise<HargaActionState> {
  const parsed = skema.safeParse({
    locationId: formData.get("locationId"),
    slug: formData.get("slug"),
    kategori: formData.get("kategori"),
    nama: formData.get("nama"),
    satuan: String(formData.get("satuan") ?? ""),
    harga: String(formData.get("harga") ?? ""),
    sumber: String(formData.get("sumber") ?? "").trim() || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const harga = bacaRupiah(d.harga);
  if (harga === "salah") return { error: `Harga "${d.harga}" tidak terbaca sebagai angka rupiah.` };

  try {
    const user = await requireCapability("finance.input");
    await requireLocationAccess(user, d.locationId);
    const { simpanHarga } = await import("./hsd");
    await simpanHarga({
      locationId: d.locationId,
      kategori: d.kategori,
      nama: d.nama,
      satuan: d.satuan,
      harga,
      sumber: d.sumber ?? null,
      userId: user.id,
    });
    await audit(user.id, harga === null ? "hsd.hapus" : "hsd.simpan", "location", d.locationId, {
      kategori: d.kategori,
      nama: d.nama,
      satuan: d.satuan,
      harga: harga === null ? null : harga.toString(),
      sumber: d.sumber ?? null,
    });
    revalidatePath(`/lokasi/${d.slug}/rapl`);
    return {
      success:
        harga === null
          ? `Harga "${d.nama}" dikosongkan.`
          : `Harga "${d.nama}" disimpan: Rp${harga.toLocaleString("id-ID")} / ${d.satuan || "satuan"}.`,
    };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Gagal menyimpan harga." };
  }
}
