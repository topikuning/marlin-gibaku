"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { ForbiddenError, requireCapability } from "@/lib/auth/session";
import { getGroupInfo, normalizeGroupChatId, WahaError } from "@/lib/waha/client";
import { kanonikGrupId } from "@/lib/waha/grup-id";

/**
 * GRUP WA PER KABUPATEN — dipasang dari halaman PAKET (DECISIONS 596).
 *
 * Layarnya di paket, bukan di tiap lokasi, karena itulah bentuk aturannya:
 * PPK meminta *satu kabupaten satu grup*, dan kabupaten selalu berada di dalam
 * satu paket. Memasangnya lokasi-per-lokasi berarti mengetik ID grup yang sama
 * berkali-kali — dan satu ketikan meleset berarti satu lokasi diam-diam
 * melapor ke grup lain.
 *
 * Keanggotaan tetap disimpan per lokasi (`Location.waGroupRefId`); kabupaten
 * hanya cara MEMASANGNYA. Kalau keanggotaan dicocokkan dari nama kabupaten saat
 * mengirim, satu salah ketik di `Location.regency` akan mengeluarkan lokasi
 * dari grupnya tanpa bersuara.
 */

export type WaKabupatenState = { error?: string; success?: string; warning?: string } | undefined;

function fail(err: unknown): WaKabupatenState {
  if (err instanceof ForbiddenError) return { error: "Tidak punya izin." };
  if (err instanceof WahaError) return { error: err.message };
  return { error: err instanceof Error ? err.message : "Gagal menyimpan." };
}

const skema = z.object({
  packageId: z.uuid(),
  regency: z.string().trim().min(1, "Kabupaten wajib diisi."),
  waGroupId: z.string().trim().optional(),
  waGroupName: z.string().trim().optional(),
});

/**
 * Pasang (atau ganti) grup kabupaten, lalu terapkan ke SELURUH lokasi aktif
 * paket ini di kabupaten itu.
 *
 * Mengosongkan `waGroupId` = melepas: anggotanya kembali mengikuti grup paket,
 * dan barisnya dihapus supaya chatId-nya bebas dipakai lagi.
 */
export async function setWaGrupKabupatenAction(
  _prev: WaKabupatenState,
  formData: FormData,
): Promise<WaKabupatenState> {
  const parsed = skema.safeParse({
    packageId: formData.get("packageId"),
    regency: formData.get("regency"),
    waGroupId: formData.get("waGroupId") || undefined,
    waGroupName: formData.get("waGroupName") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  try {
    const user = await requireCapability("wa.configure");
    const pkg = await db.package.findUnique({
      where: { id: d.packageId },
      select: { id: true, orgId: true, name: true },
    });
    if (!pkg) return { error: "Paket tidak ditemukan." };

    const anggota = await db.location.findMany({
      where: { packageId: pkg.id, regency: d.regency, isActive: true },
      select: { id: true },
    });
    if (anggota.length === 0) {
      return { error: `Paket ini tidak punya lokasi aktif di Kabupaten ${d.regency}.` };
    }
    const anggotaIds = anggota.map((l) => l.id);

    /* ---------- MELEPAS ---------- */
    if (!d.waGroupId) {
      const lama = await db.waGroup.findFirst({
        where: { packageId: pkg.id, regency: d.regency },
        select: { id: true, waGroupId: true },
      });
      if (!lama) return { warning: `Kabupaten ${d.regency} memang belum punya grup sendiri.` };

      await db.$transaction([
        db.location.updateMany({ where: { waGroupRefId: lama.id }, data: { waGroupRefId: null } }),
        db.waGroup.delete({ where: { id: lama.id } }),
      ]);
      await audit(user.id, "wa.kabupaten_group_unset", "package", pkg.id, {
        regency: d.regency,
        chatId: lama.waGroupId,
        lokasi: anggotaIds.length,
      });
      revalidatePath(`/paket/${pkg.id}`);
      return {
        success:
          `Grup kabupaten ${d.regency} dilepas. ${anggotaIds.length} lokasi kembali mengikuti grup paket.`,
      };
    }

    /* ---------- MEMASANG ---------- */
    let chatId: string;
    try {
      chatId = normalizeGroupChatId(d.waGroupId);
    } catch (err) {
      return fail(err);
    }
    const kanonik = kanonikGrupId(chatId);
    if (!kanonik) return { error: "ID grup tidak terbaca." };

    /*
     * Tabrakan ditolak DI SINI dengan menyebut pemiliknya. Indeks unik tetap
     * jadi pagar terakhir, tapi galatnya berbunyi "Unique constraint failed on
     * the fields: (`wa_group_id`)" — benar, dan tidak menolong siapa pun.
     */
    const dipakaiPaket = await db.package.findUnique({
      where: { waGroupId: kanonik },
      select: { id: true, name: true },
    });
    if (dipakaiPaket) {
      return {
        error:
          `Grup itu sudah dipakai sebagai grup PAKET "${dipakaiPaket.name}". Satu grup WhatsApp ` +
          `hanya boleh punya satu peran – lepaskan dulu dari paket itu.`,
      };
    }
    const dipakaiKab = await db.waGroup.findUnique({
      where: { waGroupId: kanonik },
      select: { id: true, regency: true, packageId: true, package: { select: { name: true } } },
    });
    if (dipakaiKab && !(dipakaiKab.packageId === pkg.id && dipakaiKab.regency === d.regency)) {
      return {
        error:
          `Grup itu sudah dipakai kabupaten ${dipakaiKab.regency ?? "-"} di paket ` +
          `"${dipakaiKab.package.name}". ` +
          (dipakaiKab.packageId === pkg.id
            ? "Lepaskan dulu dari kabupaten itu."
            : "Grup kabupaten tidak boleh dipakai dua paket – buat grup terpisah."),
      };
    }

    /*
     * Verifikasi ke WAHA best-effort: tarik NAMA grup yang sebenarnya supaya
     * admin yakin ID-nya benar (salah satu digit = laporan nyasar ke grup
     * lain). WAHA mati tidak boleh memblokir penyimpanan manual.
     */
    let nama = d.waGroupName ?? null;
    let peringatan: string | null = null;
    try {
      const info = await getGroupInfo(kanonik);
      if (info === null) {
        peringatan =
          "ID grup TIDAK ditemukan pada akun WhatsApp pengirim – periksa lagi ID-nya, dan pastikan nomor pengirim sudah menjadi anggota grup. Nama grup belum terverifikasi.";
      } else if (info.name && info.name !== info.id) {
        nama = info.name;
      }
    } catch {
      peringatan = "Nama grup belum bisa diverifikasi – WAHA sedang tidak bisa dihubungi.";
    }

    const provinsi = await db.location.findFirst({
      where: { packageId: pkg.id, regency: d.regency },
      select: { province: true },
    });

    const grup = await db.waGroup.upsert({
      where: { waGroupId: kanonik },
      create: {
        orgId: pkg.orgId,
        packageId: pkg.id,
        waGroupId: kanonik,
        waGroupName: nama,
        regency: d.regency,
        province: provinsi?.province ?? null,
        createdById: user.id,
      },
      update: { waGroupName: nama, regency: d.regency },
      select: { id: true },
    });

    await db.location.updateMany({
      where: { id: { in: anggotaIds } },
      data: { waGroupRefId: grup.id },
    });

    await audit(user.id, "wa.kabupaten_group_set", "package", pkg.id, {
      regency: d.regency,
      chatId: kanonik,
      nama,
      lokasi: anggotaIds.length,
    });
    revalidatePath(`/paket/${pkg.id}`);

    const inti = `Grup kabupaten ${d.regency} dipasang untuk ${anggotaIds.length} lokasi${nama ? ` – "${nama}"` : ""}.`;
    return peringatan ? { success: inti, warning: peringatan } : { success: inti };
  } catch (err) {
    return fail(err);
  }
}
