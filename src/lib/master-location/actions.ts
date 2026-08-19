"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { ForbiddenError, requireCapability } from "@/lib/auth/session";
import { parseMasterLocationXlsx, type ParsedMasterRow } from "./import";
import {
  cariDuplikat,
  existingLocationIndex,
  locationKey,
  type KandidatDuplikat,
} from "./queries";

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

async function readFile(formData: FormData): Promise<{ buffer: Buffer } | { error: string }> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Pilih file xlsx dulu." };
  if (file.size > 5 * 1024 * 1024) return { error: "File terlalu besar (maks 5 MB)." };
  if (!/\.xlsx$/i.test(file.name)) return { error: "Format harus .xlsx" };
  return { buffer: Buffer.from(await file.arrayBuffer()) };
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

    const { rows } = await parseMasterLocationXlsx(read.buffer);
    if (rows.length === 0) return { error: "Tidak ada baris valid untuk disimpan." };
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
    revalidatePath("/master/lokasi");
    revalidatePath("/paket/bypass");
    return {
      success: `Impor selesai: ${created} lokasi baru, ${updated} diperbarui, ${vendorNames.length} vendor diproses.`,
    };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Gagal menyimpan impor." };
  }
}

/* ------------------------------------------------------------------ */
/* Tambah satu lokasi — jalur manual (DECISIONS 368)                   */
/* ------------------------------------------------------------------ */

export type TambahLokasiState =
  | {
      error?: string;
      success?: string;
      /**
       * Kandidat lokasi yang mungkin SAMA. Bukan pesan galat: selama ini ada,
       * formulir menahan diri dan memperlihatkannya supaya orang memutuskan —
       * membuat entri baru diam-diam adalah cara paling mudah melahirkan lokasi
       * ganda, dan akibatnya baru terasa berbulan-bulan kemudian saat angka satu
       * desa terpecah dua.
       */
      kandidat?: KandidatDuplikat[];
      /** Nilai yang tadi diketik, supaya formulir tidak kosong lagi setelah ditahan. */
      isian?: Record<string, string>;
    }
  | undefined;

const teks = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim().replace(/\s+/g, " ");

/** Koordinat: kosong DIIZINKAN (jadi "perlu verifikasi"); isi harus masuk akal. */
function bacaKoordinat(fd: FormData): { lat: number | null; lng: number | null } | { error: string } {
  const mentahLat = String(fd.get("latitude") ?? "").trim().replace(",", ".");
  const mentahLng = String(fd.get("longitude") ?? "").trim().replace(",", ".");
  if (!mentahLat && !mentahLng) return { lat: null, lng: null };
  /*
   * Setengah koordinat DITOLAK, bukan disimpan apa adanya.
   *
   * Lintang tanpa bujur tidak menunjuk tempat mana pun, tapi kolomnya terisi —
   * sehingga lokasinya lolos dari status "perlu verifikasi" dan tak seorang pun
   * kembali memperbaikinya. Kosong seluruhnya jujur; separuh terisi menipu.
   */
  if (!mentahLat || !mentahLng) {
    return { error: "Isi lintang DAN bujur, atau kosongkan keduanya. Separuh koordinat tidak menunjuk tempat mana pun." };
  }
  const lat = Number(mentahLat);
  const lng = Number(mentahLng);
  if (!Number.isFinite(lat) || lat < -11 || lat > 6) {
    return { error: "Lintang di luar wilayah Indonesia (−11 sampai 6). Periksa apakah tertukar dengan bujur." };
  }
  if (!Number.isFinite(lng) || lng < 94 || lng > 142) {
    return { error: "Bujur di luar wilayah Indonesia (94 sampai 142). Periksa apakah tertukar dengan lintang." };
  }
  return { lat, lng };
}

export async function tambahLokasiMasterAction(
  _prev: TambahLokasiState,
  formData: FormData,
): Promise<TambahLokasiState> {
  try {
    const actor = await requireCapability("package.bypass");

    const province = teks(formData, "province");
    const regency = teks(formData, "regency");
    const district = teks(formData, "district");
    const village = teks(formData, "village");
    const candidateVendor = teks(formData, "candidateVendor");
    const isian = { province, regency, district, village, candidateVendor };

    if (!province || !regency || !village) {
      return { error: "Provinsi, Kabupaten/Kota, dan Desa/Kelurahan wajib diisi.", isian };
    }

    const koordinat = bacaKoordinat(formData);
    if ("error" in koordinat) return { error: koordinat.error, isian };

    const identitas = { province, regency, district: district || null, village };

    const [katalog, lokasiRiil] = await Promise.all([
      db.masterLocation.findMany({
        where: { orgId: actor.orgId },
        select: { id: true, province: true, regency: true, district: true, village: true },
      }),
      db.location.findMany({
        where: { package: { orgId: actor.orgId } },
        select: {
          id: true,
          name: true,
          province: true,
          regency: true,
          district: true,
          village: true,
        },
      }),
    ]);

    const kandidat = cariDuplikat(identitas, katalog, lokasiRiil);
    const persis = kandidat.some((k) => k.kemiripan === "persis");

    /*
     * Dua perlakuan berbeda, sengaja:
     *
     * - `persis` TIDAK PERNAH boleh dipaksa. Indeks unik basis data akan
     *   menolaknya, jadi memberi tombol "tetap simpan" cuma menjanjikan sesuatu
     *   yang berakhir dengan galat mentah.
     * - `mirip` boleh dipaksa SESUDAH orang melihat kandidatnya. Desa senama di
     *   kecamatan berbeda itu nyata, dan menolaknya berarti melarang data yang
     *   benar demi mencegah data yang salah.
     */
    const dipaksa = formData.get("konfirmasi") === "ya";
    if (kandidat.length > 0 && (persis || !dipaksa)) {
      return { kandidat, isian };
    }

    const dibuat = await db.masterLocation.create({
      data: {
        orgId: actor.orgId,
        province,
        regency,
        // Kolomnya `String?` tapi indeks uniknya ikut memakai kecamatan —
        // `null` membuat baris berbeda selalu dianggap unik oleh Postgres.
        // Impor batch sudah memakai "" untuk alasan yang sama; disamakan.
        district: district || "",
        village,
        latitude: dec(koordinat.lat),
        longitude: dec(koordinat.lng),
        candidateVendor: candidateVendor || null,
      },
      select: { id: true },
    });

    if (candidateVendor) {
      await db.vendor.upsert({
        where: { orgId_name: { orgId: actor.orgId, name: candidateVendor } },
        update: {},
        create: { orgId: actor.orgId, name: candidateVendor },
      });
    }

    await audit(actor.id, "master_location.create", "master_location", dibuat.id, {
      province,
      regency,
      district: district || null,
      village,
      tanpaKoordinat: koordinat.lat == null,
      dipaksaMeskipunMirip: kandidat.length > 0,
    });

    revalidatePath("/master/lokasi");
    revalidatePath("/paket/bypass");
    return {
      success:
        koordinat.lat == null
          ? `${village} tersimpan tanpa koordinat — statusnya "Perlu verifikasi" sampai koordinatnya diisi.`
          : `${village} tersimpan di katalog.`,
    };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Gagal menyimpan lokasi." };
  }
}
