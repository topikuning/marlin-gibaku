"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { ForbiddenError, requireCapability } from "@/lib/auth/session";
import { catatImpor, catatImporGagal } from "@/lib/import-log/record";
import { parseMasterLocationXlsx, type ParsedMasterRow } from "./import";
import { existingLocationIndex, locationKey } from "./queries";

export type MasterImportPreview = {
  parsed: number;
  unique: number;
  newCatalog: number; // belum ada di katalog
  updateCatalog: number; // sudah ada di katalog (akan diperbarui)
  alreadyReal: number; // sudah ada sebagai Location riil
  vendorsInFile: number;
  vendorsNew: number;
  warnings: string[];
  sample: { province: string; regency: string; village: string; candidateVendor: string | null }[];
};

export type MasterImportState =
  | { error?: string; preview?: MasterImportPreview; success?: string }
  | undefined;

const dec = (n: number | null) => (n == null ? null : n.toFixed(7));
const keyOf = (r: ParsedMasterRow) => locationKey(r);

/** Dedupe baris per kunci alami (baris terakhir menang untuk koordinat/vendor). */
function dedupe(rows: ParsedMasterRow[]): Map<string, ParsedMasterRow> {
  const map = new Map<string, ParsedMasterRow>();
  for (const r of rows) map.set(keyOf(r), r);
  return map;
}

async function readFile(
  formData: FormData,
): Promise<{ buffer: Buffer; name: string; bytes: number } | { error: string }> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Pilih file xlsx dulu." };
  if (file.size > 5 * 1024 * 1024) return { error: "File terlalu besar (maks 5 MB)." };
  if (!/\.xlsx$/i.test(file.name)) return { error: "Format harus .xlsx" };
  // Nama & ukuran ikut dibawa: jejak impor tanpa nama berkas tidak bisa
  // dipakai menjawab "diimpor dari file mana" — pertanyaan yang justru
  // menjadi alasan jejak itu ada (DECISIONS 254).
  return { buffer: Buffer.from(await file.arrayBuffer()), name: file.name, bytes: file.size };
}

/** Pratinjau: parse + ringkasan, TANPA menulis DB. */
export async function previewMasterImportAction(
  _prev: MasterImportState,
  formData: FormData,
): Promise<MasterImportState> {
  try {
    const actor = await requireCapability("package.bypass");
    const read = await readFile(formData);
    if ("error" in read) return { error: read.error };

    const { rows, warnings } = await parseMasterLocationXlsx(read.buffer);
    if (rows.length === 0) return { error: warnings.join(" ") || "Tidak ada baris valid." };

    const uniq = dedupe(rows);
    const [existingCatalog, realIndex, vendors] = await Promise.all([
      db.masterLocation.findMany({ where: { orgId: actor.orgId }, select: { province: true, regency: true, district: true, village: true } }),
      existingLocationIndex(actor.orgId),
      db.vendor.findMany({ where: { orgId: actor.orgId }, select: { name: true } }),
    ]);
    const catalogKeys = new Set(existingCatalog.map(locationKey));
    const vendorNames = new Set(vendors.map((v) => v.name.trim().toLowerCase()));

    let newCatalog = 0, updateCatalog = 0, alreadyReal = 0;
    for (const [k, r] of uniq) {
      if (catalogKeys.has(k)) updateCatalog++;
      else newCatalog++;
      if (realIndex.has(r)) alreadyReal++;
    }
    const fileVendors = new Set(
      [...uniq.values()].map((r) => r.candidateVendor?.trim()).filter((v): v is string => !!v),
    );
    const vendorsNew = [...fileVendors].filter((v) => !vendorNames.has(v.toLowerCase())).length;

    return {
      preview: {
        parsed: rows.length,
        unique: uniq.size,
        newCatalog,
        updateCatalog,
        alreadyReal,
        vendorsInFile: fileVendors.size,
        vendorsNew,
        warnings,
        sample: [...uniq.values()].slice(0, 8).map((r) => ({
          province: r.province,
          regency: r.regency,
          village: r.village,
          candidateVendor: r.candidateVendor,
        })),
      },
    };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Gagal memproses file." };
  }
}

/** Simpan: upsert MasterLocation (idempotent) + ingest vendor unik. */
export async function commitMasterImportAction(
  _prev: MasterImportState,
  formData: FormData,
): Promise<MasterImportState> {
  try {
    const actor = await requireCapability("package.bypass");
    const read = await readFile(formData);
    if ("error" in read) return { error: read.error };

    const { rows, warnings } = await parseMasterLocationXlsx(read.buffer);
    if (rows.length === 0) {
      // Impor yang gagal TOTAL tetap dicatat. Justru yang gagal inilah yang
      // paling sering ditanyakan ulang ("kemarin sudah saya unggah kok"), dan
      // tanpa jejaknya tidak ada apa pun yang bisa ditunjukkan.
      await catatImporGagal({
        orgId: actor.orgId,
        userId: actor.id,
        kind: "master_lokasi",
        fileName: read.name,
        fileBytes: read.bytes,
        alasan: warnings.join(" ") || "Tidak ada baris valid untuk disimpan.",
      });
      return { error: "Tidak ada baris valid untuk disimpan." };
    }
    const uniq = dedupe(rows);

    // Vendor unik → master (upsert by orgId+name).
    const vendorNames = [...new Set([...uniq.values()].map((r) => r.candidateVendor?.trim()).filter((v): v is string => !!v))];
    for (const name of vendorNames) {
      await db.vendor.upsert({
        where: { orgId_name: { orgId: actor.orgId, name } },
        update: {},
        create: { orgId: actor.orgId, name },
      });
    }

    let created = 0, updated = 0;
    for (const r of uniq.values()) {
      const where = {
        orgId_province_regency_district_village: {
          orgId: actor.orgId,
          province: r.province,
          regency: r.regency,
          district: r.district ?? "",
          village: r.village,
        },
      };
      const existing = await db.masterLocation.findUnique({ where, select: { id: true } });
      await db.masterLocation.upsert({
        where,
        update: {
          latitude: dec(r.latitude),
          longitude: dec(r.longitude),
          candidateVendor: r.candidateVendor?.trim() || null,
        },
        create: {
          orgId: actor.orgId,
          province: r.province,
          regency: r.regency,
          district: r.district ?? "",
          village: r.village,
          latitude: dec(r.latitude),
          longitude: dec(r.longitude),
          candidateVendor: r.candidateVendor?.trim() || null,
        },
      });
      if (existing) updated++;
      else created++;
    }

    await audit(actor.id, "master_location.import", "organization", actor.orgId, {
      created,
      updated,
      vendors: vendorNames.length,
    });
    // Baris yang dibuang dedupe BUKAN kegagalan — file memang boleh memuat
    // desa yang sama dua kali. Dicatat sebagai peringatan supaya selisih
    // "dibaca 120, masuk 118" punya penjelasan, bukan jadi teka-teki.
    const terduplikasi = rows.length - uniq.size;
    await catatImpor({
      orgId: actor.orgId,
      userId: actor.id,
      kind: "master_lokasi",
      fileName: read.name,
      fileBytes: read.bytes,
      rowsRead: rows.length,
      rowsAccepted: uniq.size,
      rowsRejected: 0,
      message: `${created} lokasi baru, ${updated} diperbarui, ${vendorNames.length} vendor diproses.`,
      masalah: [
        ...warnings.map((w) => ({ severity: "peringatan" as const, message: w })),
        ...(terduplikasi > 0
          ? [
              {
                severity: "peringatan" as const,
                message: `${terduplikasi} baris berisi desa yang sama dengan baris lain; yang dipakai adalah baris TERAKHIR untuk tiap desa.`,
              },
            ]
          : []),
      ],
    });
    revalidatePath("/administrasi/lokasi-master");
    revalidatePath("/proyek/paket/bypass");
    return {
      success: `Impor selesai: ${created} lokasi baru, ${updated} diperbarui, ${vendorNames.length} vendor diproses.`,
    };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Gagal menyimpan impor." };
  }
}
