"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { ForbiddenError, requireCapability, requireLocationAccess } from "@/lib/auth/session";
import { JABATAN_KKP, JABATAN_KONSULTAN, JABATAN_PENYEDIA, MEDAN_SLOT, type PihakSlot } from "@/lib/laporan/penandatangan";

/**
 * ISIAN CEPAT PENANDA TANGAN dari peringatan "Penanda tangan belum diisi"
 * (DECISIONS 758).
 *
 * Permintaan user 2026-11-11: *"ini yang belum terisi seharusnya tinggal klik
 * yang mana, lalu masuk pilihan inputan nama dan ttdnya"*.
 *
 * Hanya SATU slot yang ditulis: nama + (bila diunggah) tanda tangannya.
 * `updateContractSignatories` tidak bisa dipakai di sini – ia menulis SEMUA
 * nama sekaligus, jadi formulir satu isian akan mengosongkan yang lain.
 * Izin dan tempat simpannya sama dengan formulir di Paket › Kontrak:
 * `contract.manage`, kontrak paket lokasi ini (Pelaksana Lapangan di paket).
 */

export type IsiPenandatanganState = { error?: string; success?: string } | undefined;

const PIHAK = Object.keys(MEDAN_SLOT) as [PihakSlot, ...PihakSlot[]];
const JABATAN: Record<PihakSlot, string> = {
  ...JABATAN_KKP,
  ...JABATAN_KONSULTAN,
  ...JABATAN_PENYEDIA,
} as Record<PihakSlot, string>;

const skema = z.object({
  locationId: z.uuid("Lokasi tidak valid."),
  pihak: z.enum(PIHAK, "Penanda tangan tidak dikenal."),
  nama: z.string().trim().min(2, "Tulis namanya – minimal 2 huruf.").max(150, "Nama terlalu panjang."),
});

export async function isiPenandatanganAction(
  _prev: IsiPenandatanganState,
  formData: FormData,
): Promise<IsiPenandatanganState> {
  const p = skema.safeParse({
    locationId: formData.get("locationId"),
    pihak: formData.get("pihak"),
    nama: formData.get("nama") ?? "",
  });
  if (!p.success) return { error: p.error.issues[0].message };
  try {
    const user = await requireCapability("contract.manage");
    await requireLocationAccess(user, p.data.locationId);
    const loc = await db.location.findFirst({
      where: { id: p.data.locationId, package: { orgId: user.orgId } },
      select: { slug: true, package: { select: { id: true, contract: { select: { id: true } } } } },
    });
    if (!loc) return { error: "Lokasi tidak ditemukan." };
    const kontrak = loc.package.contract;
    if (!kontrak) return { error: "Paket lokasi ini belum punya kontrak. Isi kontraknya dulu di Paket › Kontrak." };

    const medan = MEDAN_SLOT[p.data.pihak];
    const jabatan = JABATAN[p.data.pihak];
    // Gambar diolah LEBIH DULU: bila gagal, nama pun tidak ditulis – tidak ada
    // slot setengah terisi yang baru ketahuan di kertas.
    let ttdKey: string | null = null;
    const berkas = formData.get("ttd");
    if (berkas instanceof File && berkas.size > 0) {
      const { simpanGambarTtd } = await import("@/lib/package/gambar-ttd");
      const versi = Date.now().toString(36);
      const key =
        medan.di === "paket"
          ? `paket/${loc.package.id}/${medan.ttd}-${versi}.webp`
          : `kontrak/${kontrak.id}/${medan.ttd}-${versi}.webp`;
      const hasil = await simpanGambarTtd(berkas, `tanda tangan ${jabatan}`, key);
      if (typeof hasil !== "string") return hasil;
      ttdKey = hasil;
    }

    const data: Record<string, string> = { [medan.nama]: p.data.nama };
    if (ttdKey) data[medan.ttd] = ttdKey;
    if (medan.di === "paket") {
      await db.package.update({ where: { id: loc.package.id }, data });
    } else {
      await db.contract.update({ where: { id: kontrak.id }, data });
    }
    await audit(user.id, "contract.signatory_slot", "package", loc.package.id, {
      contractId: kontrak.id,
      locationId: p.data.locationId,
      pihak: p.data.pihak,
      jabatan,
      nama: p.data.nama,
      ttdDiunggah: !!ttdKey,
    });
    revalidatePath(`/lokasi/${loc.slug}`, "layout");
    revalidatePath(`/paket/${loc.package.id}`, "layout");
    return {
      success: `${jabatan} diisi: ${p.data.nama}${ttdKey ? ", tanda tangannya tersimpan" : ""}. Berlaku untuk seluruh paket.`,
    };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: e.message };
    console.error("[penandatangan] isian cepat gagal:", e);
    return { error: "Terjadi kesalahan tak terduga. Coba lagi." };
  }
}
