"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireCapability, requireLocationAccess } from "@/lib/auth/session";

/**
 * PENIMPAAN PELAKSANA LAPANGAN DI SATU LOKASI (DECISIONS 402/404).
 *
 * **Hanya lokasi.** Pelaksana tingkat PAKET tidak lagi lewat sini: ia ikut
 * formulir penanda tangan kontrak bersama PPK, pengawas, dan Direktur —
 * keberatan user 2026-08-21 *"kamu terlalu mengistimewakan pelaksana di paket,
 * jadikan saja satu form dengan penginputan ppk pengawas dsb."*
 *
 * Jalur paket di berkas ini DIBUANG, tidak dibiarkan menganggur. Cabang yang
 * tidak dipakai siapa pun tetap dipelihara, tetap ikut dibaca, dan suatu saat
 * dipanggil lagi oleh orang yang mengira itu jalur resmi — sementara aturan
 * sebenarnya sudah pindah ke tempat lain.
 *
 * Yang tinggal di sini justru yang tidak punya rumah lain: halaman lokasi tidak
 * punya formulir penanda tangan kontrak, karena PPK dan pengawas memang urusan
 * paket.
 */

export type PelaksanaActionState = { error?: string; success?: string } | undefined;

const skema = z.object({
  locationId: z.uuid("ID lokasi tidak valid"),
  nama: z.string().trim().max(150).optional(),
  jabatan: z.string().trim().max(120).optional(),
  // Konsultan Pengawas lokasi ini (DECISIONS 409) – satu formulir, dua pihak.
  pengawasNama: z.string().trim().max(150).optional(),
  pengawasFirma: z.string().trim().max(150).optional(),
});

const BERKAS_MAKS = 2 * 1024 * 1024;

/** Medan gambar; nama medan = nama field form, sama untuk kedua sasaran. */
// Stempel TIDAK ada di sini lagi – lihat DECISIONS 408 (milik perusahaan/firma,
// bukan orang). Yang diunggah per lokasi hanya CORETAN tanda tangan.
const MEDAN = ["pelaksanaTtdKey", "supervisorTtdKey"] as const;
type Medan = (typeof MEDAN)[number];

const LABEL: Record<Medan, string> = {
  pelaksanaTtdKey: "tanda tangan pelaksana",
  supervisorTtdKey: "tanda tangan pengawas",
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
    locationId: formData.get("locationId"),
    nama: teks(formData.get("nama"), 150),
    jabatan: teks(formData.get("jabatan"), 120),
    pengawasNama: teks(formData.get("pengawasNama"), 150),
    pengawasFirma: teks(formData.get("pengawasFirma"), 150),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  // Penimpaan lokasi hanya menyentuh satu lokasi, jadi cukup dipegang yang
  // mengelola lokasi itu — bukan pengelola kontrak. Sejak DECISIONS 419 pagarnya
  // `location.signer` (Site Manager ke atas), bukan `location.manage`: yang
  // diminta user adalah mengisi NAMA, bukan mengganti nama lokasi atau
  // menggeser koordinat master.
  const actor = await requireCapability("location.signer");
  await requireLocationAccess(actor, d.locationId);

  const lokasi = await db.location.findFirst({
    where: { id: d.locationId, package: { orgId: actor.orgId } },
    select: {
      id: true,
      packageId: true,
      slug: true,
      pelaksanaTtdKey: true,
      supervisorTtdKey: true,
    },
  });
  if (!lokasi) return { error: "Lokasi tidak ditemukan." };

  const { isR2Configured, r2Put } = await import("@/lib/r2");
  const data: Record<string, string | null> = {
    pelaksanaName: d.nama ?? null,
    pelaksanaTitle: d.jabatan ?? null,
    supervisorName: d.pengawasNama ?? null,
    supervisorFirm: d.pengawasFirma ?? null,
  };
  const berubah: string[] = [];

  for (const medan of MEDAN) {
    if (formData.get(`hapus_${medan}`) === "1") {
      // Berkas lama TIDAK dihapus dari R2: dokumen yang sudah tercetak memakai
      // gambar itu. Yang dilepas cuma kaitannya.
      if (lokasi[medan] !== null) {
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
    const key = `penandatangan/lokasi/${lokasi.id}/${medan}.webp`;
    await r2Put(key, buf, "image/webp");
    data[medan] = key;
    berubah.push(`${LABEL[medan]} diperbarui`);
  }

  await db.location.update({ where: { id: lokasi.id }, data });
  await audit(actor.id, "lokasi.penandatangan", "location", lokasi.id, {
    nama: d.nama ?? null,
    jabatan: d.jabatan ?? null,
    pengawas: d.pengawasNama ?? null,
    pengawasFirma: d.pengawasFirma ?? null,
    berkas: berubah,
  });
  revalidatePath(`/lokasi/${lokasi.slug}`, "layout");
  revalidatePath(`/paket/${lokasi.packageId}`, "layout");

  /*
   * Kabarnya menyebut KEDUANYA apa adanya, termasuk yang dikosongkan. Kalimat
   * "tersimpan" yang tidak menyebut apa yang tersimpan membuat orang tidak
   * pernah tahu kalau ia baru saja MENGHAPUS penimpaan – dan penimpaan yang
   * hilang diam-diam berarti dokumen berikutnya menyebut orang lain.
   */
  const bagian = [
    d.nama
      ? `Pelaksana Lapangan: ${d.nama}`
      : "Pelaksana Lapangan mengikuti paket",
    d.pengawasNama
      ? `Pengawas: ${d.pengawasNama}`
      : "Pengawas mengikuti paket",
  ];
  const ekor = berubah.length > 0 ? ` (${berubah.join(", ")})` : "";
  return { success: `${bagian.join(" · ")}${ekor}.` };
}
