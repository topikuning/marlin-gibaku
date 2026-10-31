"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { can } from "@/lib/authz";
import { parseDateKey } from "@/lib/format";
import { JENIS_SURAT_TERSEDIA, LABEL_JENIS_SURAT } from "@/lib/surat-penyedia/aturan";
import type { JenisSuratPenyedia } from "@/generated/prisma/enums";
import { ForbiddenError, accessibleLocationIds, requireCapability, requireLocationAccess } from "@/lib/auth/session";
import { packageScopeWhere } from "@/lib/auth/scope";
import { DocumentError, uploadDocument } from "@/lib/documents";
import { phaseForType } from "@/lib/gdrive/classify";
import { butirBerkas, namaButir } from "./katalog";

/**
 * Unggah berkas termin dari baris daftar periksa Penagihan (DECISIONS 720).
 * Dokumen biasa (`uploadDocument`: kapabilitas `document.upload`, R2, audit
 * `document.upload`) yang diberi penanda butir & termin. Dokumen TETAP
 * (SSUK, NIB, …) disimpan tanpa termin: sekali unggah, berlaku di semua termin.
 */

export type PenagihanState =
  | {
      error?: string;
      success?: string;
      tautan?: { teks: string; href: string };
      /** Judul pendek bila `kurang` diisi (surat belum bisa disusun). */
      judul?: string;
      /** Data yang kurang, masing-masing dengan tautan ke tempat mengisinya. */
      kurang?: { teks: string; tempat: string; href: string }[];
    }
  | undefined;

const schema = z.object({
  packageId: z.uuid(),
  terminKe: z.coerce.number().int().min(1).max(6),
  kode: z.string().trim().min(1).max(8),
  /** Lokasi pemilik berkas pada butir per lokasi (DECISIONS 725); kosong = seluruh paket. */
  locationId: z.uuid().optional(),
});

export async function unggahBerkasTerminAction(_prev: PenagihanState, formData: FormData): Promise<PenagihanState> {
  try {
    const user = await requireCapability("document.upload");
    const parsed = schema.safeParse({
      packageId: formData.get("packageId"),
      terminKe: formData.get("terminKe"),
      kode: formData.get("kode"),
      locationId: formData.get("locationId") || undefined,
    });
    if (!parsed.success) return { error: "Permintaan tidak valid. Muat ulang halaman, lalu coba lagi." };
    const butir = butirBerkas(parsed.data.kode);
    if (!butir) return { error: "Butir berkas tidak dikenal." };
    if (butir.cukupDi) {
      const utama = butirBerkas(butir.cukupDi);
      return { error: `Butir ini cukup diisi di ${utama ? namaButir(utama) : butir.cukupDi}.` };
    }
    // Beberapa berkas sekaligus: scan bertanda tangan sering per minggu/per
    // lokasi (DECISIONS 722).
    const berkas = formData.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
    if (berkas.length === 0) return { error: "Pilih berkasnya dulu." };
    if (berkas.length > 30) return { error: "Paling banyak 30 berkas sekali unggah." };

    const scoped = await accessibleLocationIds(user);
    const pkg = await db.package.findFirst({
      where: { id: parsed.data.packageId, ...packageScopeWhere(user, scoped) },
      select: { id: true, contract: { select: { id: true } } },
    });
    if (!pkg?.contract) return { error: "Paket atau kontraknya tidak ditemukan." };

    // Berkas satu lokasi: lokasinya harus milik paket ini, aktif, dan boleh diakses.
    const locationId = parsed.data.locationId ?? null;
    let namaLokasi = "";
    if (locationId) {
      if (!butir.perLokasi) return { error: "Butir ini satu untuk seluruh paket, tidak per lokasi." };
      const lok = await db.location.findFirst({
        where: { id: locationId, packageId: pkg.id, isActive: true },
        select: { name: true },
      });
      if (!lok) return { error: "Lokasi tidak ditemukan di paket ini." };
      await requireLocationAccess(user, locationId);
      namaLokasi = lok.name;
    }

    const ke = butir.sumber === "tetap" ? null : parsed.data.terminKe;
    let naik = 0;
    for (const file of berkas) {
      try {
        await uploadDocument(
          {
            file,
            packageId: pkg.id,
            contractId: pkg.contract.id,
            phase: phaseForType(butir.jenisDokumen),
            type: butir.jenisDokumen,
            title: `${namaButir(butir)}${namaLokasi ? ` – ${namaLokasi}` : ""}${ke ? ` – Termin ${ke}` : ""}`,
            termin: { ke, butir: butir.kode },
            locationId: locationId ?? undefined,
          },
          user.id,
        );
        naik++;
      } catch (err) {
        if (naik > 0) revalidatePath(`/paket/${pkg.id}/penagihan`);
        const sebab = err instanceof DocumentError ? err.message : err instanceof Error ? err.message : "gagal";
        return {
          error: `${naik} dari ${berkas.length} berkas terunggah. "${file.name}" gagal: ${sebab}`,
        };
      }
    }
    revalidatePath(`/paket/${pkg.id}/penagihan`);
    const jumlah = berkas.length > 1 ? `${berkas.length} berkas ` : "";
    const untuk = namaLokasi ? ` (${namaLokasi})` : "";
    return {
      success: ke
        ? `${jumlah}${namaButir(butir)}${untuk} untuk termin ${ke} diunggah.`
        : `${jumlah}${namaButir(butir)}${untuk} diunggah dan berlaku untuk semua termin.`,
    };
  } catch (err) {
    if (err instanceof DocumentError || err instanceof ForbiddenError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Terjadi kesalahan." };
  }
}

/**
 * "Siapkan berkas Termin n" (DECISIONS 721): mengantre seluruh berkas termin
 * ke folder `7. BERKAS TERMIN / TERMIN n` di Drive, lalu mulai mengerjakannya
 * di latar. Orang tidak perlu menunggu: halaman menampilkan kemajuannya, dan
 * yang belum selesai diambil putaran antrean berikutnya. Menekan ulang aman –
 * berkas yang sama di Drive diperbarui, bukan digandakan.
 */
export async function siapkanBerkasTerminAction(_prev: PenagihanState, formData: FormData): Promise<PenagihanState> {
  try {
    const user = await requireCapability("document.upload");
    const parsed = z
      .object({ packageId: z.uuid(), terminKe: z.coerce.number().int().min(1).max(6) })
      .safeParse({ packageId: formData.get("packageId"), terminKe: formData.get("terminKe") });
    if (!parsed.success) return { error: "Permintaan tidak valid. Muat ulang halaman, lalu coba lagi." };
    const { packageId, terminKe } = parsed.data;

    const scoped = await accessibleLocationIds(user);
    const pkg = await db.package.findFirst({
      where: { id: packageId, ...packageScopeWhere(user, scoped) },
      select: { id: true, driveFolderId: true },
    });
    if (!pkg) return { error: "Paket tidak ditemukan." };
    if (!pkg.driveFolderId) {
      return {
        error: "Paket ini belum punya folder Google Drive.",
        tautan: { teks: "Atur folder Drive di halaman paket", href: `/paket/${pkg.id}` },
      };
    }
    const { getGDriveConfigDisplay } = await import("@/lib/gdrive/config");
    if (!(await getGDriveConfigDisplay()).connected) {
      return { error: "Akun Google Drive MARLIN belum terhubung. Minta admin menghubungkannya di menu Sistem." };
    }

    const { antrekanBerkasTermin, buatSuratTermin } = await import("./berkas-termin");

    // Lima surat penyedia yang belum ada dibuat lebih dulu (DECISIONS 724),
    // dengan tanggal dari formulir. Butuh izin kelola kontrak, sama dengan
    // formulir "Buat surat".
    const tanggal: Partial<Record<JenisSuratPenyedia, Date>> = {};
    for (const j of JENIS_SURAT_TERSEDIA) {
      const t = parseDateKey(String(formData.get(`tanggal_${j}`) ?? ""));
      if (t) tanggal[j] = t;
    }
    const adaTanggal = Object.keys(tanggal).length > 0;
    let catatanSurat = "";
    if (adaTanggal && can(user.role, "contract.manage")) {
      const k = await db.contract.findFirst({ where: { packageId: pkg.id }, select: { id: true } });
      const surat = await buatSuratTermin({ userId: user.id, orgId: user.orgId, contractId: k!.id, terminKe, tanggal });
      const dibuat = surat.dibuat.map((x) => `${LABEL_JENIS_SURAT[x.jenis]} nomor ${x.nomor}`);
      if (surat.gagal) {
        revalidatePath(`/paket/${pkg.id}/penagihan`);
        return {
          error: `${dibuat.length ? `Sudah dibuat: ${dibuat.join("; ")}. ` : ""}${surat.gagal.error} Berkas belum disiapkan ke Drive.`,
          judul: surat.gagal.judul
            ? `${dibuat.length ? `${dibuat.length} surat sudah dibuat. ` : ""}${surat.gagal.judul}`
            : undefined,
          kurang: surat.gagal.kurang,
        };
      }
      if (dibuat.length) catatanSurat = ` Surat dibuat: ${dibuat.join("; ")}.`;
    } else if (adaTanggal) {
      catatanSurat = " Surat yang belum ada tidak dibuat: perlu izin kelola kontrak.";
    }

    const r = await antrekanBerkasTermin(pkg.id, terminKe, user);
    if (!r.ok) {
      if (catatanSurat) revalidatePath(`/paket/${pkg.id}/penagihan`);
      return {
        error: `${r.error}${catatanSurat}`,
        tautan: r.terminKe
          ? { teks: `Isi progres konsultan termin ${r.terminKe}`, href: `/paket/${pkg.id}/termin?termin=${r.terminKe}#progres-konsultan` }
          : undefined,
      };
    }
    await audit(user.id, "penagihan.siapkan_berkas", "package", pkg.id, {
      terminKe,
      jumlah: r.jumlah,
      minggu: `${r.rentang.awal}-${r.rentang.akhir}`,
    });

    try {
      after(async () => {
        const { jalankanAntreanTermin } = await import("@/lib/gdrive/antrean");
        await jalankanAntreanTermin({ packageId: pkg.id, terminKe });
      });
    } catch (err) {
      // Barisnya sudah di antrean; putaran cron berikutnya yang mengambilnya.
      console.error("[penagihan] gagal menjadwalkan berkas termin:", err);
    }
    revalidatePath(`/paket/${pkg.id}/penagihan`);
    return {
      success:
        `${r.jumlah} berkas Termin ${terminKe} sedang disiapkan ke Drive (laporan minggu ke-${r.rentang.awal} s.d. ke-${r.rentang.akhir}).` +
        (r.dariDrive ? ` ${r.dariDrive} berkas lain memang berasal dari Drive, jadi tidak diunggah balik.` : "") +
        (r.dibuang
          ? ` ${r.dibuang} versi MARLIN yang sudah digantikan unggahan Anda dipindah ke Sampah Drive (masih bisa dipulihkan).`
          : "") +
        catatanSurat +
        " Anda tidak perlu menunggu di halaman ini; muat ulang nanti untuk melihat kemajuannya.",
    };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Terjadi kesalahan." };
  }
}
