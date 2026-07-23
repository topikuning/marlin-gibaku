import type { PrismaClient } from "@/generated/prisma/client";
import { LOKASI_AWAL } from "./lokasi-awal.data";

/**
 * Seed master data awal (idempotent) dari impor lokasi_awal.xlsx:
 *   - Katalog `MasterLocation` (73 lokasi, belum terikat paket) — dipetakan ke
 *     paket/kontrak belakangan lewat menu bypass admin.
 *   - `Vendor` master: perusahaan unik ("CALON PENYEDIA") — TIDAK dihubungkan
 *     relasional ke lokasi (hanya hint teks `candidateVendor` di master lokasi).
 *
 * Sumber data ter-commit: src/lib/seed/lokasi-awal.data.ts (turunan dari Excel).
 */

const dec = (n: number | null) => (n == null ? null : n.toFixed(7));

export async function seedMasterLocations(db: PrismaClient, orgId: string): Promise<void> {
  const rows = LOKASI_AWAL;

  // 1) Vendor master dari perusahaan unik (upsert by orgId+name).
  const vendorNames = [...new Set(rows.map((r) => r.candidateVendor.trim()).filter(Boolean))];
  for (const name of vendorNames) {
    await db.vendor.upsert({
      where: { orgId_name: { orgId, name } },
      update: {},
      create: { orgId, name },
    });
  }

  // 2) Katalog master lokasi (idempotent by orgId+prov+kab+kec+desa).
  for (const r of rows) {
    await db.masterLocation.upsert({
      where: {
        orgId_province_regency_district_village: {
          orgId,
          province: r.province,
          regency: r.regency,
          district: r.district ?? "",
          village: r.village,
        },
      },
      update: {
        latitude: dec(r.latitude),
        longitude: dec(r.longitude),
        candidateVendor: r.candidateVendor.trim() || null,
      },
      create: {
        orgId,
        province: r.province,
        regency: r.regency,
        district: r.district ?? "",
        village: r.village,
        latitude: dec(r.latitude),
        longitude: dec(r.longitude),
        candidateVendor: r.candidateVendor.trim() || null,
      },
    });
  }

  console.log(`  master data awal: ${vendorNames.length} vendor · ${rows.length} lokasi katalog`);
}
