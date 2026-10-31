"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { ForbiddenError, accessibleLocationIds, requireCapability } from "@/lib/auth/session";
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
  | { error?: string; success?: string; tautan?: { teks: string; href: string } }
  | undefined;

const schema = z.object({
  packageId: z.uuid(),
  terminKe: z.coerce.number().int().min(1).max(6),
  kode: z.string().trim().min(1).max(5),
});

export async function unggahBerkasTerminAction(_prev: PenagihanState, formData: FormData): Promise<PenagihanState> {
  try {
    const user = await requireCapability("document.upload");
    const parsed = schema.safeParse({
      packageId: formData.get("packageId"),
      terminKe: formData.get("terminKe"),
      kode: formData.get("kode"),
    });
    if (!parsed.success) return { error: "Permintaan tidak valid. Muat ulang halaman, lalu coba lagi." };
    const butir = butirBerkas(parsed.data.kode);
    if (!butir) return { error: "Butir berkas tidak dikenal." };
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
            title: `${namaButir(butir)}${ke ? ` – Termin ${ke}` : ""}`,
            termin: { ke, butir: butir.kode },
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
    return {
      success: ke
        ? `${jumlah}${namaButir(butir)} untuk termin ${ke} diunggah.`
        : `${jumlah}${namaButir(butir)} diunggah dan berlaku untuk semua termin.`,
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

    const { antrekanBerkasTermin } = await import("./berkas-termin");
    const r = await antrekanBerkasTermin(pkg.id, terminKe, user);
    if (!r.ok) {
      return {
        error: r.error,
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
        " Anda tidak perlu menunggu di halaman ini; muat ulang nanti untuk melihat kemajuannya.",
    };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Terjadi kesalahan." };
  }
}
