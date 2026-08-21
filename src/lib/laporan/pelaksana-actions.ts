"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireCapability, requireLocationAccess } from "@/lib/auth/session";

/**
 * MENGISI PELAKSANA LAPANGAN — paket dan lokasi lewat SATU pintu (DECISIONS 402).
 *
 * Satu aksi untuk dua sasaran dengan sengaja. Dua aksi kembar yang menulis medan
 * yang sama adalah cara paling mudah membuat aturan validasi, batas ukuran
 * berkas, dan jejak auditnya menyimpang diam-diam — dan yang menyimpang di sini
 * berakhir sebagai nama atau coretan tanda tangan yang salah pada dokumen resmi.
 *
 * Yang membedakan hanya izinnya: paket butuh `contract.manage`, lokasi butuh
 * `location.manage` PLUS akses ke lokasi itu.
 */

export type PelaksanaActionState = { error?: string; success?: string } | undefined;

/** Sasaran penyimpanan: paket (bawaan) atau lokasi (penimpaan). */
const SASARAN = ["paket", "lokasi"] as const;
type Sasaran = (typeof SASARAN)[number];

const skema = z.object({
  sasaran: z.enum(SASARAN),
  id: z.uuid("ID tidak valid"),
  nama: z.string().trim().max(150).optional(),
  jabatan: z.string().trim().max(120).optional(),
});

const BERKAS_MAKS = 2 * 1024 * 1024;

/** Medan gambar; nama medan = nama field form, sama untuk kedua sasaran. */
const MEDAN = ["pelaksanaTtdKey", "pelaksanaStempelKey"] as const;
type Medan = (typeof MEDAN)[number];

const LABEL: Record<Medan, string> = {
  pelaksanaTtdKey: "tanda tangan pelaksana",
  pelaksanaStempelKey: "stempel pelaksana",
};

function teks(v: FormDataEntryValue | null, maks: number): string | undefined {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, maks) : undefined;
}

export async function simpanPelaksana(
  _prev: PelaksanaActionState,
  formData: FormData,
): Promise<PelaksanaActionState> {
  const parsed = skema.safeParse({
    sasaran: formData.get("sasaran"),
    id: formData.get("id"),
    nama: teks(formData.get("nama"), 150),
    jabatan: teks(formData.get("jabatan"), 120),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  const sasaran: Sasaran = d.sasaran;

  /*
   * Gerbang izin BERBEDA per sasaran, dan itu bukan formalitas: pelaksana
   * paket berlaku untuk SEMUA lokasi di bawahnya, jadi ia setara mengubah
   * penanda tangan kontrak. Penimpaan lokasi hanya menyentuh satu lokasi dan
   * cukup dipegang yang mengelola lokasi itu.
   */
  const actor =
    sasaran === "paket"
      ? await requireCapability("contract.manage")
      : await requireCapability("location.manage");
  if (sasaran === "lokasi") await requireLocationAccess(actor, d.id);

  const paket =
    sasaran === "paket"
      ? await db.package.findFirst({
          where: { id: d.id, orgId: actor.orgId },
          select: { id: true, pelaksanaTtdKey: true, pelaksanaStempelKey: true },
        })
      : null;
  const lokasi =
    sasaran === "lokasi"
      ? await db.location.findFirst({
          where: { id: d.id, package: { orgId: actor.orgId } },
          select: {
            id: true,
            packageId: true,
            slug: true,
            pelaksanaTtdKey: true,
            pelaksanaStempelKey: true,
          },
        })
      : null;
  const sekarang = paket ?? lokasi;
  if (!sekarang) return { error: "Data tidak ditemukan." };

  const { isR2Configured, r2Put } = await import("@/lib/r2");
  const data: Record<string, string | null> = {
    pelaksanaName: d.nama ?? null,
    pelaksanaTitle: d.jabatan ?? null,
  };
  const berubah: string[] = [];

  for (const medan of MEDAN) {
    if (formData.get(`hapus_${medan}`) === "1") {
      // Berkas lama TIDAK dihapus dari R2: dokumen yang sudah tercetak memakai
      // gambar itu. Yang dilepas cuma kaitannya.
      if (sekarang[medan] !== null) {
        data[medan] = null;
        berubah.push(`${LABEL[medan]} dilepas`);
      }
      continue;
    }
    const berkas = formData.get(medan);
    if (!(berkas instanceof File) || berkas.size === 0) continue;
    if (berkas.size > BERKAS_MAKS) return { error: `Berkas ${LABEL[medan]} terlalu besar (maks 2 MB).` };
    if (!/^image\/(png|jpe?g|webp)$/i.test(berkas.type)) {
      return { error: `Format ${LABEL[medan]} harus PNG/JPG/WebP.` };
    }
    if (!isR2Configured()) {
      return { error: "Penyimpanan berkas (R2) belum dikonfigurasi – gambar tidak dapat diunggah." };
    }
    const sharp = (await import("sharp")).default;
    // 800px sisi terpanjang — angka yang sama dengan tanda tangan kontrak,
    // supaya dua blok TTD di halaman yang sama tidak berbeda ketajamannya.
    const buf = await sharp(Buffer.from(await berkas.arrayBuffer()), { failOn: "none" })
      .resize(800, 800, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 92 })
      .toBuffer();
    const key = `pelaksana/${sasaran}/${sekarang.id}/${medan}.webp`;
    await r2Put(key, buf, "image/webp");
    data[medan] = key;
    berubah.push(`${LABEL[medan]} diperbarui`);
  }

  if (paket) {
    await db.package.update({ where: { id: paket.id }, data });
    await audit(actor.id, "paket.pelaksana", "package", paket.id, {
      nama: d.nama ?? null,
      jabatan: d.jabatan ?? null,
      berkas: berubah,
    });
    revalidatePath(`/paket/${paket.id}`, "layout");
  } else if (lokasi) {
    await db.location.update({ where: { id: lokasi.id }, data });
    await audit(actor.id, "lokasi.pelaksana", "location", lokasi.id, {
      nama: d.nama ?? null,
      jabatan: d.jabatan ?? null,
      berkas: berubah,
    });
    revalidatePath(`/lokasi/${lokasi.slug}`, "layout");
    revalidatePath(`/paket/${lokasi.packageId}`, "layout");
  }

  const ekor = berubah.length > 0 ? ` (${berubah.join(", ")})` : "";
  return {
    success: d.nama
      ? `Pelaksana Lapangan disimpan: ${d.nama}${ekor}.`
      : `Pelaksana Lapangan dikosongkan${ekor} – blok tanda tangan akan tercetak tanpa nama.`,
  };
}
