"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
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

export type PenagihanState = { error?: string; success?: string } | undefined;

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
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { error: "Pilih berkasnya dulu." };

    const scoped = await accessibleLocationIds(user);
    const pkg = await db.package.findFirst({
      where: { id: parsed.data.packageId, ...packageScopeWhere(user, scoped) },
      select: { id: true, contract: { select: { id: true } } },
    });
    if (!pkg?.contract) return { error: "Paket atau kontraknya tidak ditemukan." };

    const ke = butir.sumber === "tetap" ? null : parsed.data.terminKe;
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
    revalidatePath(`/paket/${pkg.id}/penagihan`);
    return {
      success: ke
        ? `${namaButir(butir)} untuk termin ${ke} diunggah.`
        : `${namaButir(butir)} diunggah dan berlaku untuk semua termin.`,
    };
  } catch (err) {
    if (err instanceof DocumentError || err instanceof ForbiddenError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Terjadi kesalahan." };
  }
}
