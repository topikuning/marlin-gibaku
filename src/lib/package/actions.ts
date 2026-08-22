"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit, auditIn } from "@/lib/audit";
import { requestIp, requireCapability, requireLocationAccess } from "@/lib/auth/session";
import {
  canTransitionPackage,
  canTransitionLocation,
  revertTargetFor,
  PACKAGE_STAGE_LABEL,
} from "@/lib/lifecycle";
import { jakartaDateKey, parseDateKey } from "@/lib/format";
import { getLocationsProgress } from "@/lib/progress";
import { weightedRealizedPct } from "@/lib/progress-calc";
import { regenerateBaseline } from "@/lib/rab/import";
import { existingLocationIndex } from "@/lib/master-location/queries";
import { coordinateForDb, parseCoordinatePair } from "@/lib/geo";
import type { PackageStage } from "@/generated/prisma/enums";

/**
 * Server actions modul Paket (lifecycle prospek → kontrak → pelaksanaan).
 * Semua mutasi: requireCapability + audit(resourceType "package", resourceId
 * = packageId agar tab Aktivitas paket membaca satu feed).
 * Transisi stage SELALU lewat canTransitionPackage + PackageStageHistory
 * dalam satu $transaction.
 */

export type PackageActionState =
  | { error?: string; success?: string; warning?: string }
  | undefined;

/* ------------------------------------------------------------------ */
/* Helper internal (bukan export — file "use server")                  */
/* ------------------------------------------------------------------ */

/** "Rp 1.234.567" / "1234567" → BigInt non-negatif. null bila tidak ada digit. */
function parseRupiah(s: unknown): bigint | null {
  const digits = String(s ?? "").replace(/[^0-9]/g, "");
  return digits ? BigInt(digits) : null;
}

/** Rupiah bertanda untuk delta adendum: "-1.500.000" → -1500000n. */
function parseRupiahSigned(s: unknown): bigint | null {
  const raw = String(s ?? "").trim();
  const negative = raw.startsWith("-") || raw.startsWith("−");
  const digits = raw.replace(/[^0-9]/g, "");
  if (!digits) return null;
  const v = BigInt(digits);
  return negative ? -v : v;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "lokasi";
}

function optionalText(v: FormDataEntryValue | null, max = 200): string | null {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
}

/** Persen opsional dari FormData ("" → undefined). */
const percentSchema = z.preprocess(
  (v) => (v === "" || v == null ? undefined : Number(v)),
  z.number().min(0, "Persen minimal 0").max(100, "Persen maksimal 100").optional(),
);

function isPackageStage(v: unknown): v is PackageStage {
  return typeof v === "string" && v in PACKAGE_STAGE_LABEL;
}

const PRA_KONTRAK: PackageStage[] = ["prospek", "tender", "penetapan"];

/** Ambang "100%" — sejalan dgn formatPct (1 desimal); 99.95 tampil "100.0%". */
const SERAH_TERIMA_MIN_PCT = 99.95;

/** Progress agregat paket — formula kanonik weightedRealizedPct (B13). */
async function aggregateProgressPct(locationIds: string[]): Promise<number> {
  if (locationIds.length === 0) return 0;
  const progress = await getLocationsProgress(locationIds);
  return weightedRealizedPct([...progress.values()]);
}

/* ------------------------------------------------------------------ */
/* Paket: create / update                                              */
/* ------------------------------------------------------------------ */

const createPackageSchema = z.object({
  name: z.string().trim().min(3, "Nama paket minimal 3 karakter").max(200),
  packageNumber: z.string().trim().max(100).optional(),
  province: z.string().trim().max(100).optional(),
  candidateVendorName: z.string().trim().max(200).optional(),
  note: z.string().trim().max(2000).optional(),
});

export async function createPackage(
  _prev: PackageActionState,
  formData: FormData,
): Promise<PackageActionState> {
  const actor = await requireCapability("prospect.manage");
  const parsed = createPackageSchema.safeParse({
    name: formData.get("name"),
    packageNumber: optionalText(formData.get("packageNumber")) ?? undefined,
    province: optionalText(formData.get("province"), 100) ?? undefined,
    candidateVendorName: optionalText(formData.get("candidateVendorName")) ?? undefined,
    note: optionalText(formData.get("note"), 2000) ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const hpsValue = parseRupiah(formData.get("hpsValue"));
  if (hpsValue === null) return { error: "Nilai HPS wajib diisi (angka rupiah, boleh 0)." };
  const d = parsed.data;

  const pkg = await db.$transaction(async (tx) => {
    const created = await tx.package.create({
      data: {
        orgId: actor.orgId,
        name: d.name,
        packageNumber: d.packageNumber ?? null,
        hpsValue,
        province: d.province ?? null,
        candidateVendorName: d.candidateVendorName ?? null,
        note: d.note ?? null,
        stage: "prospek",
        createdById: actor.id,
      },
      select: { id: true },
    });
    await tx.packageStageHistory.create({
      data: {
        packageId: created.id,
        fromStage: null,
        toStage: "prospek",
        changedById: actor.id,
        note: "Paket dibuat",
      },
    });
    return created;
  });

  await audit(actor.id, "package.create", "package", pkg.id, {
    name: d.name,
    hpsValue,
  });
  revalidatePath("/paket");
  redirect(`/paket/${pkg.id}`);
}

const updatePackageSchema = createPackageSchema.extend({
  packageId: z.uuid("ID paket tidak valid"),
});

export async function updatePackage(
  _prev: PackageActionState,
  formData: FormData,
): Promise<PackageActionState> {
  const actor = await requireCapability("package.edit");
  const parsed = updatePackageSchema.safeParse({
    packageId: formData.get("packageId"),
    name: formData.get("name"),
    packageNumber: optionalText(formData.get("packageNumber")) ?? undefined,
    province: optionalText(formData.get("province"), 100) ?? undefined,
    candidateVendorName: optionalText(formData.get("candidateVendorName")) ?? undefined,
    note: optionalText(formData.get("note"), 2000) ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const hpsValue = parseRupiah(formData.get("hpsValue"));
  if (hpsValue === null) return { error: "Nilai HPS wajib diisi (angka rupiah, boleh 0)." };
  const d = parsed.data;

  const pkg = await db.package.findFirst({
    where: { id: d.packageId, orgId: actor.orgId },
    select: { stage: true, contract: { select: { id: true } } },
  });
  if (!pkg) return { error: "Paket tidak ditemukan." };
  if (pkg.contract || !PRA_KONTRAK.includes(pkg.stage)) {
    return { error: "Paket sudah berkontrak/terkunci – identitas dan HPS tidak bisa diubah." };
  }

  await db.package.update({
    where: { id: d.packageId },
    data: {
      name: d.name,
      packageNumber: d.packageNumber ?? null,
      hpsValue,
      province: d.province ?? null,
      candidateVendorName: d.candidateVendorName ?? null,
      note: d.note ?? null,
    },
  });
  await audit(actor.id, "package.update", "package", d.packageId, {
    name: d.name,
    hpsValue,
  });
  revalidatePath("/paket");
  revalidatePath(`/paket/${d.packageId}`, "layout");
  return { success: "Data paket diperbarui." };
}

/* ------------------------------------------------------------------ */
/* Transisi stage                                                      */
/* ------------------------------------------------------------------ */

/**
 * Naikkan/ubah stage paket. `batal` wajib menyertakan alasan (note → cancelReason).
 * Dipanggil langsung dari client component (bukan FormData).
 */
export async function advanceStage(
  packageId: string,
  toStage: PackageStage,
  note?: string,
): Promise<PackageActionState> {
  const actor = await requireCapability("prospect.manage");
  const id = z.uuid().safeParse(packageId);
  if (!id.success) return { error: "ID paket tidak valid." };
  if (!isPackageStage(toStage)) return { error: "Stage tujuan tidak dikenal." };
  const reason = String(note ?? "").trim();
  if (toStage === "batal" && !reason) {
    return { error: "Pembatalan wajib disertai alasan." };
  }

  // Guard serah terima: progress fisik harus 100% (tidak mungkin serah terima
  // pekerjaan yang belum tuntas). Dihitung dari realisasi RAB aktif semua lokasi.
  if (toStage === "serah_terima") {
    const pre = await db.package.findFirst({
      where: { id: id.data, orgId: actor.orgId },
      select: { locations: { select: { id: true } } },
    });
    if (!pre) return { error: "Paket tidak ditemukan." };
    const pct = await aggregateProgressPct(pre.locations.map((l) => l.id));
    if (pct < SERAH_TERIMA_MIN_PCT) {
      return {
        error: `Progress paket baru ${pct.toLocaleString("id-ID", {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        })}% – serah terima hanya bisa saat pekerjaan 100%. Selesaikan/verifikasi laporan lokasi dulu.`,
      };
    }
  }

  const result = await db.$transaction(async (tx) => {
    const pkg = await tx.package.findFirst({
      where: { id: id.data, orgId: actor.orgId },
      select: { stage: true },
    });
    if (!pkg) return { error: "Paket tidak ditemukan." as string };
    if (!canTransitionPackage(pkg.stage, toStage)) {
      return {
        error: `Transisi ${PACKAGE_STAGE_LABEL[pkg.stage]} → ${PACKAGE_STAGE_LABEL[toStage]} tidak diizinkan.`,
      };
    }
    await tx.package.update({
      where: { id: id.data },
      data: { stage: toStage, ...(toStage === "batal" ? { cancelReason: reason } : {}) },
    });
    await tx.packageStageHistory.create({
      data: {
        packageId: id.data,
        fromStage: pkg.stage,
        toStage,
        changedById: actor.id,
        note: reason || null,
      },
    });
    return { fromStage: pkg.stage };
  });
  if ("error" in result) return { error: result.error };

  await audit(actor.id, toStage === "batal" ? "package.cancel" : "package.stage", "package", id.data, {
    fromStage: result.fromStage,
    toStage,
    ...(reason ? { note: reason } : {}),
  });
  revalidatePath("/paket");
  revalidatePath(`/paket/${id.data}`, "layout");
  return {
    success:
      toStage === "batal"
        ? "Paket dibatalkan."
        : `Stage paket menjadi ${PACKAGE_STAGE_LABEL[toStage]}.`,
  };
}

/**
 * Mundurkan stage paket satu langkah untuk KOREKSI salah-klik (mis. tak sengaja
 * "Tandai Serah Terima"). Hanya langkah aman tanpa efek samping destruktif
 * (lihat revertTargetFor). Alasan WAJIB → tercatat di histori + audit.
 */
export async function revertStage(
  packageId: string,
  reason: string,
): Promise<PackageActionState> {
  const actor = await requireCapability("prospect.manage");
  const id = z.uuid().safeParse(packageId);
  if (!id.success) return { error: "ID paket tidak valid." };
  const note = String(reason ?? "").trim();
  if (note.length < 5) return { error: "Alasan mundur wajib diisi (min 5 karakter)." };

  const result = await db.$transaction(async (tx) => {
    const pkg = await tx.package.findFirst({
      where: { id: id.data, orgId: actor.orgId },
      select: { stage: true },
    });
    if (!pkg) return { error: "Paket tidak ditemukan." as string };
    const target = revertTargetFor(pkg.stage);
    if (!target) {
      return {
        error: `Tahap ${PACKAGE_STAGE_LABEL[pkg.stage]} tidak bisa dimundurkan otomatis. Untuk koreksi tahap berkontrak, gunakan Koreksi Kontrak atau Batalkan Paket.`,
      };
    }
    await tx.package.update({ where: { id: id.data }, data: { stage: target } });
    await tx.packageStageHistory.create({
      data: {
        packageId: id.data,
        fromStage: pkg.stage,
        toStage: target,
        changedById: actor.id,
        note: `Mundur (koreksi): ${note}`,
      },
    });
    return { fromStage: pkg.stage, target };
  });
  if ("error" in result) return { error: result.error };

  await audit(actor.id, "package.revert", "package", id.data, {
    fromStage: result.fromStage,
    toStage: result.target,
    note,
  });
  revalidatePath("/paket");
  revalidatePath(`/paket/${id.data}`, "layout");
  return { success: `Stage dimundurkan ke ${PACKAGE_STAGE_LABEL[result.target]}.` };
}

/* ------------------------------------------------------------------ */
/* Lokasi target (pra-kontrak)                                         */
/* ------------------------------------------------------------------ */

const addLocationSchema = z.object({
  packageId: z.uuid("ID paket tidak valid"),
  name: z.string().trim().min(3, "Nama lokasi minimal 3 karakter").max(150),
  village: z.string().trim().min(2, "Desa/kelurahan wajib diisi").max(100),
  district: z.string().trim().max(100).optional(),
  regency: z.string().trim().min(2, "Kabupaten/kota wajib diisi").max(100),
  province: z.string().trim().min(2, "Provinsi wajib diisi").max(100),
  // Koordinat divalidasi terpisah lewat parseCoordinatePair (lib/geo) supaya
  // rentangnya sama dengan form edit — dulu di sini seluruh bumi diterima.
  gpsLat: z.string().trim().optional(),
  gpsLng: z.string().trim().optional(),
});

export async function addTargetLocation(
  _prev: PackageActionState,
  formData: FormData,
): Promise<PackageActionState> {
  const actor = await requireCapability("prospect.manage");
  const parsed = addLocationSchema.safeParse({
    packageId: formData.get("packageId"),
    name: formData.get("name"),
    village: formData.get("village"),
    district: optionalText(formData.get("district"), 100) ?? undefined,
    regency: formData.get("regency"),
    province: formData.get("province"),
    gpsLat: String(formData.get("gpsLat") ?? "").trim() || undefined,
    gpsLng: String(formData.get("gpsLng") ?? "").trim() || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  const coord = parseCoordinatePair(d.gpsLat, d.gpsLng);
  if (!coord.ok) return { error: coord.error };

  const result = await db.$transaction(async (tx) => {
    const pkg = await tx.package.findFirst({
      where: { id: d.packageId, orgId: actor.orgId },
      select: { stage: true, contract: { select: { id: true } } },
    });
    if (!pkg) return { error: "Paket tidak ditemukan." as string };
    if (pkg.contract || !PRA_KONTRAK.includes(pkg.stage)) {
      return { error: "Lokasi target hanya bisa ditambah sebelum paket berkontrak." };
    }
    // Slug unik: nama+desa, suffix angka bila tabrakan.
    const base = slugify(`${d.name}-${d.village}`);
    const taken = new Set(
      (
        await tx.location.findMany({
          where: { slug: { startsWith: base } },
          select: { slug: true },
        })
      ).map((l) => l.slug),
    );
    let slug = base;
    for (let n = 2; taken.has(slug); n += 1) slug = `${base}-${n}`;

    const loc = await tx.location.create({
      data: {
        packageId: d.packageId,
        name: d.name,
        slug,
        village: d.village,
        district: d.district ?? null,
        regency: d.regency,
        province: d.province,
        gpsLat: coordinateForDb(coord.lat),
        gpsLng: coordinateForDb(coord.lng),
        status: "persiapan",
        isActive: false,
      },
      select: { id: true, slug: true },
    });
    return { loc };
  });
  if ("error" in result) return { error: result.error };

  await audit(actor.id, "package.location_add", "package", d.packageId, {
    locationId: result.loc.id,
    slug: result.loc.slug,
    name: d.name,
  });
  revalidatePath(`/paket/${d.packageId}`, "layout");
  return { success: `Lokasi target "${d.name}" ditambahkan.` };
}

/**
 * Tambah lokasi target dari KATALOG master (impor). Alur normal (pra-kontrak) —
 * setara bypass tapi lokasi dibuat NONAKTIF (target), aktif saat konversi kontrak.
 * Menandai master terpakai + prefill kandidat vendor paket bila belum ada.
 */
export async function addTargetLocationsFromCatalog(
  packageId: string,
  masterLocationIds: string[],
): Promise<PackageActionState> {
  const actor = await requireCapability("prospect.manage");
  const pid = z.uuid().safeParse(packageId);
  if (!pid.success) return { error: "ID paket tidak valid." };
  const ids = z.array(z.uuid()).min(1, "Pilih minimal satu lokasi dari katalog.").safeParse(masterLocationIds);
  if (!ids.success) return { error: ids.error.issues[0].message };

  const result = await db.$transaction(async (tx) => {
    const pkg = await tx.package.findFirst({
      where: { id: pid.data, orgId: actor.orgId },
      select: { orgId: true, stage: true, candidateVendorName: true, contract: { select: { id: true } } },
    });
    if (!pkg) return { error: "Paket tidak ditemukan." as string };
    if (pkg.orgId !== actor.orgId) return { error: "Paket bukan milik organisasi Anda." };
    if (pkg.contract || !PRA_KONTRAK.includes(pkg.stage)) {
      return { error: "Lokasi target hanya bisa ditambah sebelum paket berkontrak." };
    }

    const masters = await tx.masterLocation.findMany({
      where: { id: { in: ids.data }, orgId: actor.orgId },
      select: {
        id: true, province: true, regency: true, district: true, village: true,
        latitude: true, longitude: true, candidateVendor: true, assignedLocationId: true,
      },
    });
    if (masters.length !== ids.data.length) return { error: "Sebagian lokasi tak ditemukan di katalog." };
    const used = masters.filter((m) => m.assignedLocationId);
    if (used.length > 0) return { error: `${used.length} lokasi sudah dipakai proyek lain – segarkan halaman.` };

    // Tolak yang kunci alaminya sudah ada sebagai Location riil (cegah ganda).
    const existing = await existingLocationIndex(actor.orgId);
    const clash = masters.filter((m) => existing.has(m));
    if (clash.length > 0) {
      return { error: `Sudah ada di sistem: ${clash.map((m) => `${m.village} (${m.regency})`).join(", ")}.` };
    }

    const takenSlugs = new Set<string>();
    for (const m of masters) {
      const name = m.village;
      const base = slugify(`${name}-${m.regency}`);
      let slug = base;
      for (let n = 2; takenSlugs.has(slug) || (await tx.location.findUnique({ where: { slug }, select: { id: true } })); n += 1) {
        slug = `${base}-${n}`;
      }
      takenSlugs.add(slug);
      const loc = await tx.location.create({
        data: {
          packageId: pid.data,
          name,
          slug,
          village: m.village,
          district: m.district,
          regency: m.regency,
          province: m.province,
          gpsLat: m.latitude,
          gpsLng: m.longitude,
          status: "persiapan",
          isActive: false,
        },
        select: { id: true },
      });
      await tx.masterLocation.update({ where: { id: m.id }, data: { assignedLocationId: loc.id } });
    }

    // Prefill kandidat vendor paket dari katalog bila belum diisi & seragam.
    if (!pkg.candidateVendorName?.trim()) {
      const vendors = [...new Set(masters.map((m) => m.candidateVendor?.trim()).filter((v): v is string => !!v))];
      if (vendors.length === 1) {
        await tx.package.update({ where: { id: pid.data }, data: { candidateVendorName: vendors[0] } });
      }
    }
    return { count: masters.length };
  });
  if ("error" in result) return { error: result.error };

  await audit(actor.id, "package.location_add_catalog", "package", pid.data, {
    count: result.count,
    masterLocationIds: ids.data,
  });
  revalidatePath(`/paket/${pid.data}`, "layout");
  return { success: `${result.count} lokasi target ditambahkan dari katalog.` };
}

/** Hapus lokasi target: hanya bila belum aktif dan belum punya RAB. */
export async function removeTargetLocation(locationId: string): Promise<PackageActionState> {
  const actor = await requireCapability("prospect.manage");
  const id = z.uuid().safeParse(locationId);
  if (!id.success) return { error: "ID lokasi tidak valid." };

  const result = await db.$transaction(async (tx) => {
    const loc = await tx.location.findFirst({
      where: { id: id.data, package: { orgId: actor.orgId } },
      select: {
        id: true,
        name: true,
        packageId: true,
        isActive: true,
        _count: { select: { rabRevisions: true, statusHistory: true, dailyReports: true } },
      },
    });
    if (!loc) return { error: "Lokasi tidak ditemukan." as string };
    if (loc.isActive) return { error: "Lokasi sudah aktif – tidak bisa dihapus." };
    if (loc._count.rabRevisions > 0) {
      return { error: "Lokasi sudah punya RAB – tidak bisa dihapus." };
    }
    if (loc._count.statusHistory > 0 || loc._count.dailyReports > 0) {
      return { error: "Lokasi sudah punya riwayat – tidak bisa dihapus." };
    }
    await tx.location.delete({ where: { id: id.data } });
    return { loc };
  });
  if ("error" in result) return { error: result.error };

  await audit(actor.id, "package.location_remove", "package", result.loc.packageId, {
    locationId: result.loc.id,
    name: result.loc.name,
  });
  revalidatePath(`/paket/${result.loc.packageId}`, "layout");
  return { success: `Lokasi target "${result.loc.name}" dihapus.` };
}

const renameLocationSchema = z.object({
  locationId: z.uuid(),
  name: z.string().trim().min(3, "Nama lokasi minimal 3 karakter").max(200),
});

/**
 * Ubah NAMA TAMPILAN lokasi (bukan slug — URL tetap stabil). Untuk merapikan
 * penamaan yang tak seragam (mis. prefix "KNMP"). DECISIONS 117.
 */
export async function renameLocation(_prev: PackageActionState, formData: FormData): Promise<PackageActionState> {
  const actor = await requireCapability("location.manage");
  const parsed = renameLocationSchema.safeParse({
    locationId: formData.get("locationId"),
    name: formData.get("name"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { locationId, name } = parsed.data;

  const loc = await db.location.findFirst({
    where: { id: locationId, package: { orgId: actor.orgId } },
    select: { id: true, slug: true, name: true, packageId: true },
  });
  if (!loc) return { error: "Lokasi tidak ditemukan." };
  await requireLocationAccess(actor, locationId);
  if (name === loc.name) return { success: "Nama lokasi tidak berubah." };

  await db.location.update({ where: { id: locationId }, data: { name } });
  await audit(actor.id, "location.rename", "location", locationId, { from: loc.name, to: name });
  revalidatePath(`/lokasi/${loc.slug}`, "layout");
  revalidatePath(`/paket/${loc.packageId}`, "layout");
  revalidatePath("/lokasi");
  return { success: "Nama lokasi diperbarui." };
}

/* ------------------------------------------------------------------ */
/* Konversi kontrak (idempotent)                                       */
/* ------------------------------------------------------------------ */

const convertSchema = z
  .object({
    packageId: z.uuid("ID paket tidak valid"),
    vendorId: z.uuid().optional(),
    vendorName: z.string().trim().min(3, "Nama vendor minimal 3 karakter").max(200).optional(),
    workTitle: z.string().trim().max(300).optional(),
    contractNumber: z.string().trim().min(3, "Nomor kontrak wajib diisi").max(150),
    ppnPercent: z.preprocess(
      (v) => (v === "" || v == null ? 11 : Number(v)),
      z.number().min(0, "PPN minimal 0").max(100, "PPN maksimal 100"),
    ),
    signedDate: z.string().min(1, "Tanggal tanda tangan wajib diisi"),
    // Kontrak hanya menyimpan masa pelaksanaan (hari kalender). Tanggal mulai
    // (SPMK) diisi belakangan saat Mulai Pelaksanaan.
    durationDays: z.preprocess(
      (v) => (v === "" || v == null ? undefined : Number(v)),
      z
        .number({ message: "Masa pelaksanaan (hari) wajib diisi" })
        .int("Jumlah hari harus bilangan bulat")
        .min(1, "Masa pelaksanaan minimal 1 hari")
        .max(3650, "Masa pelaksanaan maksimal 3650 hari"),
    ),
    advancePercent: percentSchema,
    retentionPercent: percentSchema,
    ppkName: z.string().trim().max(150).optional(),
    ppkNip: z.string().trim().max(60).optional(),
    supervisorName: z.string().trim().max(150).optional(),
    supervisorFirm: z.string().trim().max(200).optional(),
    contractorSignerName: z.string().trim().max(150).optional(),
    contractorSignerTitle: z.string().trim().max(120).optional(),
    // Form konversi memakai `SignatoryFields` YANG SAMA, jadi ia ikut membawa
    // Pelaksana Lapangan. Tanpa baris ini zod membuangnya diam-diam dan yang
    // sudah diketik hilang tanpa satu pun pesan (DECISIONS 404).
    pelaksanaName: z.string().trim().max(150).optional(),
    pelaksanaTitle: z.string().trim().max(120).optional(),
  })
  .refine((d) => d.vendorId || d.vendorName, {
    message: "Pilih vendor atau isi nama vendor baru.",
  });

export async function convertToContract(
  _prev: PackageActionState,
  formData: FormData,
): Promise<PackageActionState> {
  const actor = await requireCapability("contract.manage");
  const vendorIdRaw = optionalText(formData.get("vendorId"), 100);
  const parsed = convertSchema.safeParse({
    packageId: formData.get("packageId"),
    vendorId: vendorIdRaw ?? undefined,
    vendorName: optionalText(formData.get("vendorName")) ?? undefined,
    workTitle: optionalText(formData.get("workTitle"), 300) ?? undefined,
    contractNumber: formData.get("contractNumber"),
    ppnPercent: formData.get("ppnPercent"),
    signedDate: formData.get("signedDate"),
    durationDays: formData.get("durationDays"),
    advancePercent: formData.get("advancePercent"),
    retentionPercent: formData.get("retentionPercent"),
    ppkName: optionalText(formData.get("ppkName"), 150) ?? undefined,
    ppkNip: optionalText(formData.get("ppkNip"), 60) ?? undefined,
    supervisorName: optionalText(formData.get("supervisorName"), 150) ?? undefined,
    supervisorFirm: optionalText(formData.get("supervisorFirm"), 200) ?? undefined,
    contractorSignerName: optionalText(formData.get("contractorSignerName"), 150) ?? undefined,
    contractorSignerTitle: optionalText(formData.get("contractorSignerTitle"), 120) ?? undefined,
    pelaksanaName: optionalText(formData.get("pelaksanaName"), 150) ?? undefined,
    pelaksanaTitle: optionalText(formData.get("pelaksanaTitle"), 120) ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const contractValue = parseRupiah(formData.get("contractValue"));
  if (contractValue === null || contractValue <= 0n) {
    return { error: "Nilai kontrak wajib diisi dan lebih dari 0." };
  }
  const signedDate = parseDateKey(d.signedDate);
  if (!signedDate) return { error: "Format tanggal tidak valid." };
  // startDate (SPMK) & endDate belum ada saat kontrak dibuat — diisi saat Mulai
  // Pelaksanaan. Kontrak hanya menyimpan durationDays (masa pelaksanaan).

  const result = await db.$transaction(async (tx) => {
    const pkg = await tx.package.findFirst({
      where: { id: d.packageId, orgId: actor.orgId },
      select: {
        id: true,
        stage: true,
        contract: { select: { id: true } },
        locations: {
          select: { id: true, _count: { select: { statusHistory: true } } },
        },
      },
    });
    if (!pkg) return { error: "Paket tidak ditemukan." as string };

    // IDEMPOTENT: kontrak sudah ada → sukses tanpa duplikasi.
    if (pkg.contract) {
      return { alreadyExists: true as const };
    }

    if (pkg.stage === "prospek" || pkg.stage === "tender") {
      return {
        error: `Paket masih di tahap ${PACKAGE_STAGE_LABEL[pkg.stage]}. Naikkan ke Penetapan dulu sebelum konversi kontrak.`,
      };
    }
    if (pkg.stage !== "penetapan" && pkg.stage !== "kontrak") {
      return { error: `Paket di tahap ${PACKAGE_STAGE_LABEL[pkg.stage]} – konversi kontrak tidak berlaku.` };
    }
    if (pkg.locations.length === 0) {
      return { error: "Tambahkan minimal satu lokasi target dulu (tab Lokasi)." };
    }

    const dupe = await tx.contract.findUnique({
      where: { contractNumber: d.contractNumber },
      select: { id: true },
    });
    if (dupe) return { error: "Nomor kontrak sudah dipakai kontrak lain." };

    // Vendor: pilih existing atau upsert nama baru (unik per org+name).
    let vendorId = d.vendorId ?? null;
    if (vendorId) {
      const vendor = await tx.vendor.findFirst({ where: { id: vendorId, orgId: actor.orgId }, select: { id: true } });
      if (!vendor) return { error: "Vendor tidak ditemukan." };
    } else {
      const vendor = await tx.vendor.upsert({
        where: { orgId_name: { orgId: actor.orgId, name: d.vendorName! } },
        update: {},
        create: { orgId: actor.orgId, name: d.vendorName! },
        select: { id: true },
      });
      vendorId = vendor.id;
    }

    const contract = await tx.contract.create({
      data: {
        packageId: pkg.id,
        vendorId,
        contractNumber: d.contractNumber,
        workTitle: d.workTitle ?? null,
        contractValue,
        ppnPercent: d.ppnPercent,
        advancePercent: d.advancePercent ?? null,
        retentionPercent: d.retentionPercent ?? null,
        signedDate,
        durationDays: d.durationDays,
        startDate: null,
        endDate: null,
        ppkName: d.ppkName ?? null,
        ppkNip: d.ppkNip ?? null,
        supervisorName: d.supervisorName ?? null,
        supervisorFirm: d.supervisorFirm ?? null,
        contractorSignerName: d.contractorSignerName ?? null,
        contractorSignerTitle: d.contractorSignerTitle ?? null,
      },
      select: { id: true },
    });

    // Pelaksana Lapangan tersimpan di PAKET, bukan kontrak (DECISIONS 402) —
    // tapi diketik di formulir yang sama, jadi ditulis di transaksi yang sama.
    if (d.pelaksanaName !== undefined || d.pelaksanaTitle !== undefined) {
      await tx.package.update({
        where: { id: d.packageId },
        data: {
          pelaksanaName: d.pelaksanaName ?? null,
          pelaksanaTitle: d.pelaksanaTitle ?? null,
        },
      });
    }

    // Semua lokasi paket jadi aktif; tulis history persiapan bila belum ada.
    await tx.location.updateMany({
      where: { packageId: pkg.id },
      data: { isActive: true },
    });
    const withoutHistory = pkg.locations.filter((l) => l._count.statusHistory === 0);
    if (withoutHistory.length > 0) {
      await tx.locationStatusHistory.createMany({
        data: withoutHistory.map((l) => ({
          locationId: l.id,
          fromStatus: null,
          toStatus: "persiapan" as const,
          changedById: actor.id,
          note: `Kontrak ${d.contractNumber}`,
        })),
      });
    }

    // Transisi penetapan → kontrak (stage kontrak tanpa kontrak = perbaikan data, tanpa transisi).
    if (pkg.stage === "penetapan") {
      await tx.package.update({ where: { id: pkg.id }, data: { stage: "kontrak" } });
      await tx.packageStageHistory.create({
        data: {
          packageId: pkg.id,
          fromStage: "penetapan",
          toStage: "kontrak",
          changedById: actor.id,
          note: `Kontrak ${d.contractNumber}`,
        },
      });
    }
    return { contractId: contract.id, locationCount: pkg.locations.length };
  });

  if ("error" in result) return { error: result.error };
  if ("alreadyExists" in result) {
    return { success: "Kontrak untuk paket ini sudah tercatat – tidak dibuat duplikat." };
  }

  await audit(actor.id, "contract.convert", "package", d.packageId, {
    contractId: result.contractId,
    contractNumber: d.contractNumber,
    contractValue,
    locationCount: result.locationCount,
  });
  revalidatePath("/paket");
  revalidatePath(`/paket/${d.packageId}`, "layout");
  return {
    success: `Kontrak ${d.contractNumber} tercatat. ${result.locationCount} lokasi diaktifkan – lanjut import RAB per lokasi.`,
  };
}

/* ------------------------------------------------------------------ */
/* BYPASS admin: buat proyek langsung ke tahap Kontrak (SA & PD)         */
/* Lewati proses pra-kontrak (prospek→tender→penetapan). Dokumen menyusul.*/
/* Lokasi diambil dari katalog MasterLocation (impor awal).              */
/* ------------------------------------------------------------------ */

const directProjectSchema = z
  .object({
    name: z.string().trim().min(3, "Nama paket minimal 3 karakter").max(200),
    packageNumber: z.string().trim().max(100).optional(),
    workTitle: z.string().trim().max(300).optional(),
    province: z.string().trim().max(100).optional(),
    vendorId: z.uuid().optional(),
    vendorName: z.string().trim().min(3, "Nama vendor minimal 3 karakter").max(200).optional(),
    contractNumber: z.string().trim().min(3, "Nomor kontrak wajib diisi").max(150),
    ppnPercent: z.preprocess(
      (v) => (v === "" || v == null ? 11 : Number(v)),
      z.number().min(0, "PPN minimal 0").max(100, "PPN maksimal 100"),
    ),
    signedDate: z.string().min(1, "Tanggal tanda tangan kontrak wajib diisi"),
    durationDays: z.preprocess(
      (v) => (v === "" || v == null ? undefined : Number(v)),
      z
        .number({ message: "Masa pelaksanaan (hari) wajib diisi" })
        .int("Jumlah hari harus bilangan bulat")
        .min(1, "Masa pelaksanaan minimal 1 hari")
        .max(3650, "Masa pelaksanaan maksimal 3650 hari"),
    ),
    masterLocationIds: z.array(z.uuid()).min(1, "Pilih minimal satu lokasi dari katalog."),
  })
  .refine((d) => d.vendorId || d.vendorName, {
    message: "Pilih vendor dari master atau isi nama vendor baru.",
  });

/**
 * Bypass: buat Paket langsung di tahap Kontrak + Contract + Location riil dari
 * katalog MasterLocation terpilih (ditandai terpakai). Ditandai isBypass=true
 * (dokumen pengadaan menyusul). Histori stage null→kontrak + audit. Semua dalam
 * satu transaksi.
 */
export async function createDirectProject(
  _prev: PackageActionState,
  formData: FormData,
): Promise<PackageActionState> {
  const actor = await requireCapability("package.bypass");
  const parsed = directProjectSchema.safeParse({
    name: formData.get("name"),
    packageNumber: optionalText(formData.get("packageNumber"), 100) ?? undefined,
    workTitle: optionalText(formData.get("workTitle"), 300) ?? undefined,
    province: optionalText(formData.get("province"), 100) ?? undefined,
    vendorId: optionalText(formData.get("vendorId"), 100) ?? undefined,
    vendorName: optionalText(formData.get("vendorName")) ?? undefined,
    contractNumber: formData.get("contractNumber"),
    ppnPercent: formData.get("ppnPercent"),
    signedDate: formData.get("signedDate"),
    durationDays: formData.get("durationDays"),
    masterLocationIds: formData.getAll("masterLocationIds").map(String),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const contractValue = parseRupiah(formData.get("contractValue"));
  if (contractValue === null || contractValue <= 0n) {
    return { error: "Nilai kontrak wajib diisi dan lebih dari 0." };
  }
  const signedDate = parseDateKey(d.signedDate);
  if (!signedDate) return { error: "Format tanggal tidak valid." };

  const result = await db.$transaction(async (tx) => {
    // Lokasi katalog: milik org, belum terpakai.
    const masters = await tx.masterLocation.findMany({
      where: { id: { in: d.masterLocationIds }, orgId: actor.orgId },
      select: {
        id: true,
        province: true,
        regency: true,
        district: true,
        village: true,
        latitude: true,
        longitude: true,
        assignedLocationId: true,
      },
    });
    if (masters.length !== d.masterLocationIds.length) {
      return { error: "Sebagian lokasi tidak ditemukan di katalog." as string };
    }
    const used = masters.filter((m) => m.assignedLocationId);
    if (used.length > 0) {
      return { error: `${used.length} lokasi sudah dipakai proyek lain – segarkan halaman.` };
    }

    // Mitigasi lokasi GANDA: tolak master yang kunci alaminya (prov|kab|kec|desa)
    // sudah ada sebagai Location riil (mis. dibuat lewat alur normal di prod).
    const existing = await existingLocationIndex(actor.orgId);
    const clash = masters.filter((m) => existing.has(m));
    if (clash.length > 0) {
      const list = clash.map((m) => `${m.village} (${m.regency})`).join(", ");
      return {
        error: `Lokasi berikut sudah ada di sistem – tidak dibuat ganda: ${list}. Hapus dari pilihan, atau gunakan lokasi yang sudah ada.`,
      };
    }

    // Nomor kontrak unik.
    const dupe = await tx.contract.findUnique({
      where: { contractNumber: d.contractNumber },
      select: { id: true },
    });
    if (dupe) return { error: "Nomor kontrak sudah dipakai kontrak lain." };

    // Vendor: existing atau upsert nama baru.
    let vendorId = d.vendorId ?? null;
    if (vendorId) {
      const v = await tx.vendor.findFirst({
        where: { id: vendorId, orgId: actor.orgId },
        select: { id: true },
      });
      if (!v) return { error: "Vendor tidak ditemukan." };
    } else {
      const v = await tx.vendor.upsert({
        where: { orgId_name: { orgId: actor.orgId, name: d.vendorName! } },
        update: {},
        create: { orgId: actor.orgId, name: d.vendorName! },
        select: { id: true },
      });
      vendorId = v.id;
    }

    // Paket langsung di tahap kontrak (bypass) + histori.
    const pkg = await tx.package.create({
      data: {
        orgId: actor.orgId,
        name: d.name,
        packageNumber: d.packageNumber ?? null,
        hpsValue: contractValue, // tak ada HPS pra-kontrak; pakai nilai kontrak
        province: d.province ?? masters[0]?.province ?? null,
        stage: "kontrak",
        isBypass: true,
        note: "Dibuat via jalur cepat admin (bypass) – dokumen pengadaan menyusul.",
        createdById: actor.id,
      },
      select: { id: true },
    });
    await tx.packageStageHistory.create({
      data: {
        packageId: pkg.id,
        fromStage: null,
        toStage: "kontrak",
        changedById: actor.id,
        note: `Jalur cepat (bypass) – kontrak ${d.contractNumber}`,
      },
    });

    await tx.contract.create({
      data: {
        packageId: pkg.id,
        vendorId,
        contractNumber: d.contractNumber,
        workTitle: d.workTitle ?? null,
        contractValue,
        ppnPercent: d.ppnPercent,
        signedDate,
        durationDays: d.durationDays,
        startDate: null,
        endDate: null,
      },
    });

    // Instansiasi lokasi dari katalog (slug unik, aktif, histori persiapan).
    const takenSlugs = new Set<string>();
    for (const m of masters) {
      const name = m.village;
      const base = slugify(`${name}-${m.regency}`);
      let slug = base;
      for (let n = 2; takenSlugs.has(slug) || (await tx.location.findUnique({ where: { slug }, select: { id: true } })); n += 1) {
        slug = `${base}-${n}`;
      }
      takenSlugs.add(slug);
      const loc = await tx.location.create({
        data: {
          packageId: pkg.id,
          name,
          slug,
          village: m.village,
          district: m.district,
          regency: m.regency,
          province: m.province,
          gpsLat: m.latitude,
          gpsLng: m.longitude,
          status: "persiapan",
          isActive: true,
        },
        select: { id: true },
      });
      await tx.masterLocation.update({
        where: { id: m.id },
        data: { assignedLocationId: loc.id },
      });
      await tx.locationStatusHistory.create({
        data: {
          locationId: loc.id,
          fromStatus: null,
          toStatus: "persiapan",
          changedById: actor.id,
          note: `Jalur cepat – kontrak ${d.contractNumber}`,
        },
      });
    }

    return { packageId: pkg.id, locationCount: masters.length };
  });

  if ("error" in result) return { error: result.error };

  await audit(actor.id, "package.bypass_create", "package", result.packageId, {
    contractNumber: d.contractNumber,
    contractValue,
    locationCount: result.locationCount,
  });
  revalidatePath("/paket");
  redirect(`/paket/${result.packageId}`);
}

/* ------------------------------------------------------------------ */
/* KOREKSI KONTRAK (super_admin) — betulkan data termasuk WAKTU.        */
/* Beda dari adendum (perubahan resmi). Bila waktu berubah → kurva-S    */
/* di-regenerate otomatis per lokasi.                                   */
/* ------------------------------------------------------------------ */

const DAY_MS = 86_400_000;

const editContractSchema = z.object({
  packageId: z.uuid("ID paket tidak valid"),
  packageName: z.string().trim().min(3, "Nama paket minimal 3 karakter").max(200),
  // Nomor PAKET (bukan nomor kontrak). Opsional, dan boleh dikosongkan lagi.
  // Satu-satunya jalan mengisinya sesudah paket berkontrak — form tender
  // terkunci begitu kontrak ada, dan paket jalur bypass lahir langsung
  // berkontrak sehingga form itu tidak pernah muncul sekali pun
  // (DECISIONS 249).
  packageNumber: z.string().trim().max(100).optional(),
  workTitle: z.string().trim().max(300).optional(),
  contractNumber: z.string().trim().min(3, "Nomor kontrak wajib diisi").max(150),
  ppnPercent: z.preprocess(
    (v) => (v === "" || v == null ? 11 : Number(v)),
    z.number().min(0, "PPN minimal 0").max(100, "PPN maksimal 100"),
  ),
  signedDate: z.string().min(1, "Tanggal TTD wajib diisi"),
  durationDays: z.preprocess(
    (v) => (v === "" || v == null ? undefined : Number(v)),
    z.number({ message: "Masa pelaksanaan wajib diisi" }).int().min(1).max(3650),
  ),
  // SPMK / tanggal mulai. Kosong = SPMK belum terbit (startDate null).
  startDate: z.string().optional(),
});

export async function editContractAction(
  _prev: PackageActionState,
  formData: FormData,
): Promise<PackageActionState> {
  const actor = await requireCapability("contract.edit");
  const parsed = editContractSchema.safeParse({
    packageId: formData.get("packageId"),
    packageName: formData.get("packageName"),
    packageNumber: optionalText(formData.get("packageNumber"), 100) ?? undefined,
    workTitle: optionalText(formData.get("workTitle"), 300) ?? undefined,
    contractNumber: formData.get("contractNumber"),
    ppnPercent: formData.get("ppnPercent"),
    signedDate: formData.get("signedDate"),
    durationDays: formData.get("durationDays"),
    startDate: optionalText(formData.get("startDate"), 20) ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const contractValue = parseRupiah(formData.get("contractValue"));
  if (contractValue === null || contractValue <= 0n) return { error: "Nilai kontrak wajib > 0." };
  const signedDate = parseDateKey(d.signedDate);
  if (!signedDate) return { error: "Format tanggal TTD tidak valid." };
  const startDate = d.startDate ? parseDateKey(d.startDate) : null;
  if (d.startDate && !startDate) return { error: "Format tanggal SPMK tidak valid." };
  const endDate = startDate ? new Date(startDate.getTime() + d.durationDays * DAY_MS) : null;

  const pkg = await db.package.findFirst({
    where: { id: d.packageId, orgId: actor.orgId },
    select: {
      id: true,
      contract: { select: { id: true, durationDays: true, startDate: true } },
      locations: { select: { id: true } },
    },
  });
  if (!pkg?.contract) return { error: "Paket belum berkontrak." };

  // Nomor kontrak unik (kecuali dirinya sendiri).
  const dupe = await db.contract.findFirst({
    where: { contractNumber: d.contractNumber, id: { not: pkg.contract.id } },
    select: { id: true },
  });
  if (dupe) return { error: "Nomor kontrak sudah dipakai kontrak lain." };

  const prevStart = pkg.contract.startDate ? pkg.contract.startDate.toISOString().slice(0, 10) : null;
  const newStart = startDate ? startDate.toISOString().slice(0, 10) : null;
  const timeChanged = pkg.contract.durationDays !== d.durationDays || prevStart !== newStart;

  await db.$transaction(async (tx) => {
    await tx.package.update({
      where: { id: pkg.id },
      // `?? null` disengaja: mengosongkan kolom harus BISA, jadi nilai kosong
      // ditulis sebagai null, bukan diam-diam mempertahankan yang lama.
      data: { name: d.packageName, packageNumber: d.packageNumber ?? null },
    });
    await tx.contract.update({
      where: { id: pkg.contract!.id },
      data: {
        contractNumber: d.contractNumber,
        workTitle: d.workTitle ?? null,
        contractValue,
        ppnPercent: d.ppnPercent,
        signedDate,
        durationDays: d.durationDays,
        startDate,
        endDate,
      },
    });
  });

  // Bila waktu berubah → kurva-S/baseline ikut berubah (jumlah minggu & peta
  // tanggal). Regenerate per lokasi yang punya RAB aktif; lewati yang belum.
  let recomputed = 0;
  if (timeChanged) {
    for (const loc of pkg.locations) {
      try {
        await regenerateBaseline(loc.id, {
          source: "auto",
          note: "Koreksi kontrak (waktu) – hitung ulang kurva-S",
          userId: actor.id,
        });
        recomputed++;
      } catch {
        /* lokasi tanpa RAB aktif → lewati */
      }
    }
  }

  await audit(actor.id, "contract.edit", "package", pkg.id, {
    contractId: pkg.contract.id,
    packageNumber: d.packageNumber ?? null,
    contractNumber: d.contractNumber,
    contractValue,
    durationDays: d.durationDays,
    startDate: newStart,
    timeChanged,
    baselinesRecomputed: recomputed,
  });
  revalidatePath("/paket");
  revalidatePath(`/paket/${pkg.id}`, "layout");
  return {
    success: timeChanged
      ? `Kontrak dikoreksi. Waktu berubah → ${recomputed} kurva-S lokasi dihitung ulang.`
      : "Kontrak dikoreksi.",
  };
}

/* ------------------------------------------------------------------ */
/* Penanda tangan kontrak (bisa diubah kapan saja — pergantian personel) */
/* ------------------------------------------------------------------ */

const signatoriesSchema = z.object({
  contractId: z.uuid("ID kontrak tidak valid"),
  ppkName: z.string().trim().max(150).optional(),
  ppkNip: z.string().trim().max(60).optional(),
  supervisorName: z.string().trim().max(150).optional(),
  supervisorFirm: z.string().trim().max(200).optional(),
  contractorSignerName: z.string().trim().max(150).optional(),
  contractorSignerTitle: z.string().trim().max(120).optional(),
  // Pelaksana Lapangan ikut formulir ini (DECISIONS 404) walau tersimpan di
  // PAKET, bukan kontrak: yang disatukan formulirnya, bukan tempat simpannya.
  pelaksanaName: z.string().trim().max(150).optional(),
  pelaksanaTitle: z.string().trim().max(120).optional(),
});

/** Perbarui nama penanda tangan dokumen KKP (PPK / pengawas / penyedia). */
export async function updateContractSignatories(
  _prev: PackageActionState,
  formData: FormData,
): Promise<PackageActionState> {
  const actor = await requireCapability("contract.manage");
  const parsed = signatoriesSchema.safeParse({
    contractId: formData.get("contractId"),
    ppkName: optionalText(formData.get("ppkName"), 150) ?? undefined,
    ppkNip: optionalText(formData.get("ppkNip"), 60) ?? undefined,
    supervisorName: optionalText(formData.get("supervisorName"), 150) ?? undefined,
    supervisorFirm: optionalText(formData.get("supervisorFirm"), 200) ?? undefined,
    contractorSignerName: optionalText(formData.get("contractorSignerName"), 150) ?? undefined,
    contractorSignerTitle: optionalText(formData.get("contractorSignerTitle"), 120) ?? undefined,
    pelaksanaName: optionalText(formData.get("pelaksanaName"), 150) ?? undefined,
    pelaksanaTitle: optionalText(formData.get("pelaksanaTitle"), 120) ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const contract = await db.contract.findFirst({
    where: { id: d.contractId, package: { orgId: actor.orgId } },
    select: { id: true, packageId: true },
  });
  if (!contract) return { error: "Kontrak tidak ditemukan." };

  /*
   * Satu transaksi untuk DUA tabel: nama penanda tangan kontrak di `contracts`,
   * Pelaksana Lapangan di `packages`. Satu formulir yang menulis separuh lalu
   * gagal akan meninggalkan blok tanda tangan yang setengah diperbarui — dan
   * ketidakcocokannya baru terlihat pada kertas yang sudah dicetak.
   */
  await db.$transaction([
    db.contract.update({
      where: { id: d.contractId },
      data: {
        ppkName: d.ppkName ?? null,
        ppkNip: d.ppkNip ?? null,
        supervisorName: d.supervisorName ?? null,
        supervisorFirm: d.supervisorFirm ?? null,
        contractorSignerName: d.contractorSignerName ?? null,
        contractorSignerTitle: d.contractorSignerTitle ?? null,
      },
    }),
    db.package.update({
      where: { id: contract.packageId },
      data: {
        pelaksanaName: d.pelaksanaName ?? null,
        pelaksanaTitle: d.pelaksanaTitle ?? null,
      },
    }),
  ]);

  await audit(actor.id, "contract.signatories", "package", contract.packageId, {
    contractId: contract.id,
    ppkName: d.ppkName ?? null,
    supervisorName: d.supervisorName ?? null,
    contractorSignerName: d.contractorSignerName ?? null,
    pelaksanaName: d.pelaksanaName ?? null,
  });
  revalidatePath(`/paket/${contract.packageId}`, "layout");
  return { success: "Penanda tangan kontrak diperbarui." };
}

/* ------------------------------------------------------------------ */
/* Mulai pelaksanaan                                                   */
/* ------------------------------------------------------------------ */

export async function startPelaksanaan(
  packageId: string,
  spmkDateStr: string,
): Promise<PackageActionState> {
  const actor = await requireCapability("contract.manage");
  const id = z.uuid().safeParse(packageId);
  if (!id.success) return { error: "ID paket tidak valid." };
  const spmkDate = parseDateKey(spmkDateStr);
  if (!spmkDate) return { error: "Tanggal SPMK wajib diisi." };

  const result = await db.$transaction(async (tx) => {
    const pkg = await tx.package.findFirst({
      where: { id: id.data, orgId: actor.orgId },
      select: {
        stage: true,
        contract: { select: { id: true, durationDays: true } },
        locations: { select: { id: true, status: true } },
      },
    });
    if (!pkg) return { error: "Paket tidak ditemukan." as string };
    if (!pkg.contract) return { error: "Belum ada kontrak – konversi kontrak dulu." };
    if (!canTransitionPackage(pkg.stage, "pelaksanaan")) {
      return {
        error: `Transisi ${PACKAGE_STAGE_LABEL[pkg.stage]} → Pelaksanaan tidak diizinkan.`,
      };
    }

    // SPMK menetapkan tanggal mulai; tanggal selesai = SPMK + masa pelaksanaan.
    const DAY_MS = 86_400_000;
    const endDate = new Date(spmkDate.getTime() + pkg.contract.durationDays * DAY_MS);
    await tx.contract.update({
      where: { id: pkg.contract.id },
      data: { startDate: spmkDate, endDate },
    });

    // SPMK BERTANGGAL MASA DEPAN: dicatat, tapi pelaksanaannya BELUM dimulai
    // (DECISIONS 202). Dulu status langsung naik apa pun tanggalnya — mengisi
    // SPMK 3 Agustus pada 1 Agustus membuat semua lokasi Berjalan dua hari
    // lebih awal, kurva-S menghitung Minggu 1, dan deviasi negatif muncul untuk
    // hari yang pekerjaannya belum boleh dimulai. Aktivasinya dijalankan
    // penjadwal harian pada tanggal SPMK-nya.
    if (spmkDate.getTime() > parseDateKey(jakartaDateKey(new Date()))!.getTime()) {
      return { terjadwal: spmkDateStr as string };
    }

    await tx.package.update({ where: { id: id.data }, data: { stage: "pelaksanaan" } });
    await tx.packageStageHistory.create({
      data: {
        packageId: id.data,
        fromStage: pkg.stage,
        toStage: "pelaksanaan",
        changedById: actor.id,
        note: "Mulai pelaksanaan",
      },
    });

    const startable = pkg.locations.filter((l) => canTransitionLocation(l.status, "berjalan"));
    if (startable.length > 0) {
      await tx.location.updateMany({
        where: { id: { in: startable.map((l) => l.id) } },
        data: { status: "berjalan", isActive: true },
      });
      await tx.locationStatusHistory.createMany({
        data: startable.map((l) => ({
          locationId: l.id,
          fromStatus: l.status,
          toStatus: "berjalan" as const,
          changedById: actor.id,
          note: "Mulai pelaksanaan paket",
        })),
      });
    }
    return { started: startable.length };
  });
  if ("error" in result) return { error: result.error };

  if ("terjadwal" in result) {
    await audit(actor.id, "package.spmk_scheduled", "package", id.data, { spmkDate: spmkDateStr });
    revalidatePath("/paket");
    revalidatePath(`/paket/${id.data}`, "layout");
    return {
      success:
        `SPMK ${spmkDateStr} dicatat. Pelaksanaan BELUM dimulai – status paket & lokasi ` +
        `berubah otomatis pada tanggal tersebut, supaya kurva-S tidak menghitung hari ` +
        `sebelum pekerjaan dimulai.`,
    };
  }

  await audit(actor.id, "package.start_pelaksanaan", "package", id.data, {
    locationsStarted: result.started,
    spmkDate: spmkDateStr,
  });
  revalidatePath("/paket");
  revalidatePath(`/paket/${id.data}`, "layout");
  return { success: `Pelaksanaan dimulai (SPMK ${spmkDateStr}) – ${result.started} lokasi berstatus Berjalan.` };
}

/* ------------------------------------------------------------------ */
/* Adendum (append-only)                                               */
/* ------------------------------------------------------------------ */

const amendmentSchema = z.object({
  contractId: z.uuid("ID kontrak tidak valid"),
  ccoNumber: z.string().trim().min(1, "Nomor CCO/adendum wajib diisi").max(150),
  endDateDelta: z.preprocess(
    (v) => (v === "" || v == null ? 0 : Number(v)),
    z.number().int("Perubahan waktu harus bilangan bulat (hari)").min(-3650).max(3650),
  ),
  effectiveDate: z.string().min(1, "Tanggal berlaku wajib diisi"),
  reason: z.string().trim().min(5, "Alasan adendum wajib diisi (min 5 karakter)").max(2000),
});

export async function addAmendment(
  _prev: PackageActionState,
  formData: FormData,
): Promise<PackageActionState> {
  const actor = await requireCapability("amendment.manage");
  const parsed = amendmentSchema.safeParse({
    contractId: formData.get("contractId"),
    ccoNumber: formData.get("ccoNumber"),
    endDateDelta: formData.get("endDateDelta"),
    effectiveDate: formData.get("effectiveDate"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const valueDelta = parseRupiahSigned(formData.get("valueDelta"));
  if (valueDelta === null) {
    return { error: "Perubahan nilai wajib diisi (boleh 0, gunakan tanda minus untuk pengurangan)." };
  }
  const effectiveDate = parseDateKey(d.effectiveDate);
  if (!effectiveDate) return { error: "Format tanggal berlaku tidak valid." };

  const result = await db.$transaction(async (tx) => {
    const contract = await tx.contract.findFirst({
      where: { id: d.contractId, package: { orgId: actor.orgId } },
      select: { id: true, packageId: true },
    });
    if (!contract) return { error: "Kontrak tidak ditemukan." as string };
    const dupe = await tx.contractAmendment.findUnique({
      where: { contractId_ccoNumber: { contractId: d.contractId, ccoNumber: d.ccoNumber } },
      select: { id: true },
    });
    if (dupe) return { error: `Adendum "${d.ccoNumber}" sudah tercatat untuk kontrak ini.` };
    const amendment = await tx.contractAmendment.create({
      data: {
        contractId: d.contractId,
        ccoNumber: d.ccoNumber,
        valueDelta,
        endDateDelta: d.endDateDelta,
        effectiveDate,
        reason: d.reason,
        createdById: actor.id,
      },
      select: { id: true },
    });
    return { amendmentId: amendment.id, packageId: contract.packageId };
  });
  if ("error" in result) return { error: result.error };

  await audit(actor.id, "amendment.add", "package", result.packageId, {
    amendmentId: result.amendmentId,
    contractId: d.contractId,
    ccoNumber: d.ccoNumber,
    valueDelta,
    endDateDelta: d.endDateDelta,
  });
  revalidatePath("/paket");
  revalidatePath(`/paket/${result.packageId}`, "layout");
  return {
    success: `Adendum ${d.ccoNumber} tercatat. Revisi RAB lokasi (bila nilai berubah) dilakukan di modul RAB.`,
  };
}

/* ------------------------------------------------------------------ */
/* Vendor util                                                         */
/* ------------------------------------------------------------------ */

const vendorSchema = z.object({
  name: z.string().trim().min(3, "Nama vendor minimal 3 karakter").max(200),
  npwp: z.string().trim().max(50).optional(),
  contact: z.string().trim().max(200).optional(),
});

export async function createVendor(
  _prev: PackageActionState,
  formData: FormData,
): Promise<PackageActionState> {
  const actor = await requireCapability("contract.manage");
  const parsed = vendorSchema.safeParse({
    name: formData.get("name"),
    npwp: optionalText(formData.get("npwp"), 50) ?? undefined,
    contact: optionalText(formData.get("contact")) ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const vendor = await db.vendor.upsert({
    where: { orgId_name: { orgId: actor.orgId, name: d.name } },
    update: { npwp: d.npwp ?? undefined, contact: d.contact ?? undefined },
    create: { orgId: actor.orgId, name: d.name, npwp: d.npwp ?? null, contact: d.contact ?? null },
    select: { id: true },
  });
  await audit(actor.id, "vendor.upsert", "vendor", vendor.id, { name: d.name });
  revalidatePath("/paket");
  return { success: `Vendor "${d.name}" tersimpan.` };
}


/* ------------------------------------------------------------------ */
/* KOREKSI susunan lokasi paket berkontrak (super_admin) — DECISIONS 187 */
/* ------------------------------------------------------------------ */

/** Tahap paket yang masih boleh dikoreksi susunan lokasinya. */
const KOREKSI_LOKASI_STAGES: PackageStage[] = ["kontrak", "pelaksanaan"];

const correctLocationSchema = z.object({
  packageId: z.uuid(),
  /** Dari katalog master (pilih ID) ATAU isian manual. */
  masterLocationId: z.union([z.uuid(), z.literal("")]).transform((v) => v || undefined),
  name: z.string().trim().max(120).optional(),
  village: z.string().trim().max(120).optional(),
  district: z.string().trim().max(100).optional(),
  regency: z.string().trim().max(120).optional(),
  province: z.string().trim().max(120).optional(),
  gpsLat: z.string().trim().optional(),
  gpsLng: z.string().trim().optional(),
  reason: z
    .string()
    .trim()
    .min(10, "Alasan koreksi wajib diisi (minimal 10 karakter) – tercatat di audit.")
    .max(500, "Alasan maksimal 500 karakter"),
});

/**
 * Tambah lokasi yang KETINGGALAN saat input paket yang sudah berkontrak.
 *
 * Ini KOREKSI DATA, bukan adendum: nilai kontrak tidak disentuh sama sekali,
 * karena nilainya memang sudah benar sejak awal — yang salah cuma jumlah lokasi
 * yang terinput. Memakai adendum untuk kasus ini akan mengarang riwayat
 * perubahan kontrak yang tidak pernah terjadi (deltanya nol, dokumennya tidak
 * ada) dan mencemari laporan ke KKP.
 *
 * Pengaman: super_admin SAJA (`location.correct`), wajib alasan tertulis,
 * hanya untuk paket berkontrak yang belum serah terima, ditolak bila lokasinya
 * sudah ada, dan setiap koreksi meninggalkan jejak di audit + histori paket.
 */
export async function correctAddLocationAction(
  _prev: PackageActionState,
  formData: FormData,
): Promise<PackageActionState> {
  const actor = await requireCapability("location.correct");
  const parsed = correctLocationSchema.safeParse({
    packageId: formData.get("packageId"),
    masterLocationId: formData.get("masterLocationId") ?? "",
    name: optionalText(formData.get("name"), 120) ?? undefined,
    village: optionalText(formData.get("village"), 120) ?? undefined,
    district: optionalText(formData.get("district"), 100) ?? undefined,
    regency: optionalText(formData.get("regency"), 120) ?? undefined,
    gpsLat: String(formData.get("gpsLat") ?? "").trim() || undefined,
    gpsLng: String(formData.get("gpsLng") ?? "").trim() || undefined,
    province: optionalText(formData.get("province"), 120) ?? undefined,
    reason: formData.get("reason") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  const manual = !d.masterLocationId;
  if (manual && !(d.name && d.village && d.regency && d.province)) {
    return { error: "Pilih lokasi dari katalog, atau isi nama, desa, kabupaten, dan provinsi." };
  }
  // Koordinat hanya relevan di jalur manual; dari katalog ikut titik master.
  const manualCoord = parseCoordinatePair(d.gpsLat, d.gpsLng);
  if (!manualCoord.ok) return { error: manualCoord.error };

  const ip = (await requestIp()) ?? null;
  const result = await db.$transaction(async (tx) => {
    const pkg = await tx.package.findFirst({
      where: { id: d.packageId, orgId: actor.orgId },
      select: { id: true, name: true, stage: true, contract: { select: { id: true } } },
    });
    if (!pkg) return { error: "Paket tidak ditemukan." as string };
    if (!pkg.contract || PRA_KONTRAK.includes(pkg.stage)) {
      return {
        error:
          "Paket ini belum berkontrak – pakai jalur normal “Tambah lokasi target”, koreksi ini khusus paket yang sudah berkontrak.",
      };
    }
    if (!KOREKSI_LOKASI_STAGES.includes(pkg.stage)) {
      return {
        error: `Koreksi lokasi hanya sampai tahap pelaksanaan (paket ini: ${pkg.stage}). Setelah serah terima, susunan lokasi mengikuti laporan yang sudah final.`,
      };
    }

    // Sumber data lokasi: katalog master atau isian manual.
    let src: {
      name: string;
      village: string;
      district: string | null;
      regency: string;
      province: string;
      lat: unknown;
      lng: unknown;
      masterId?: string;
    };
    if (d.masterLocationId) {
      const m = await tx.masterLocation.findFirst({
        where: { id: d.masterLocationId, orgId: actor.orgId },
        select: {
          id: true, province: true, regency: true, district: true, village: true,
          latitude: true, longitude: true, assignedLocationId: true,
        },
      });
      if (!m) return { error: "Lokasi katalog tidak ditemukan." };
      if (m.assignedLocationId) return { error: "Lokasi katalog itu sudah dipakai proyek lain." };
      src = {
        name: m.village, village: m.village, district: m.district, regency: m.regency,
        province: m.province, lat: m.latitude, lng: m.longitude, masterId: m.id,
      };
    } else {
      src = {
        name: d.name!, village: d.village!, district: d.district ?? null,
        regency: d.regency!, province: d.province!,
        lat: coordinateForDb(manualCoord.lat), lng: coordinateForDb(manualCoord.lng),
      };
    }

    // Cegah lokasi ganda (kunci alami desa+kabupaten+provinsi).
    const existing = await existingLocationIndex(actor.orgId);
    if (existing.has(src)) {
      return { error: `Lokasi "${src.village} (${src.regency})" sudah ada di sistem.` };
    }

    const base = slugify(`${src.name}-${src.village}`);
    let slug = base;
    for (
      let n = 2;
      await tx.location.findUnique({ where: { slug }, select: { id: true } });
      n += 1
    ) {
      slug = `${base}-${n}`;
    }

    const loc = await tx.location.create({
      data: {
        packageId: pkg.id,
        name: src.name,
        slug,
        village: src.village,
        district: src.district,
        regency: src.regency,
        province: src.province,
        gpsLat: (src.lat ?? null) as never,
        gpsLng: (src.lng ?? null) as never,
        status: "persiapan",
        // Paket sudah berkontrak: lokasi hasil koreksi langsung aktif, sejajar
        // dengan lokasi lain yang diaktifkan saat konversi kontrak.
        isActive: true,
      },
      select: { id: true, slug: true, name: true },
    });
    if (src.masterId) {
      await tx.masterLocation.update({
        where: { id: src.masterId },
        data: { assignedLocationId: loc.id },
      });
    }

    // Jejak di histori paket: stage TIDAK berubah (from = to), catatannya yang
    // menjelaskan — supaya koreksi kelihatan di lini masa paket, bukan hanya di
    // audit log yang jarang dibuka.
    await tx.packageStageHistory.create({
      data: {
        packageId: pkg.id,
        fromStage: pkg.stage,
        toStage: pkg.stage,
        changedById: actor.id,
        note: `Koreksi data (bukan adendum): lokasi "${loc.name}" ditambahkan – ${d.reason}`,
      },
    });
    await auditIn(
      tx,
      actor.id,
      "package.location_correct_add",
      "package",
      pkg.id,
      {
        locationId: loc.id,
        slug: loc.slug,
        name: loc.name,
        stage: pkg.stage,
        sumber: src.masterId ? "katalog" : "manual",
        alasan: d.reason,
      },
      ip,
    );
    return { loc };
  });
  if ("error" in result) return { error: result.error };

  revalidatePath(`/paket/${d.packageId}`, "layout");
  revalidatePath("/lokasi");
  return {
    success: `Lokasi "${result.loc.name}" ditambahkan sebagai koreksi data. Nilai kontrak TIDAK diubah.`,
    warning:
      "Koreksi belum selesai: lokasi baru belum punya RAB & baseline, jadi total nilai RAB paket masih timpang terhadap nilai kontrak sampai RAB lokasi ini diimpor. Impor RAB pertamanya tercatat sebagai HPS awal, bukan adendum.",
  };
}

/* ------------------------------------------------------------------ */
/* Gambar tanda tangan & stempel kontrak (DECISIONS 328)               */
/* ------------------------------------------------------------------ */

/**
 * Kenapa gambar tanda tangan menempel pada KONTRAK, bukan pada pengguna.
 *
 * Permintaan user: *"orang lapangan kuno dan konservatif, tetap minta untuk
 * laporan di tanda tangan manual dan dicetak / orang lapangan dari pengawas dan
 * kkp"*. Yang menandatangani laporan KKP bukan pengguna aplikasi, melainkan
 * tiga jabatan yang DITUNJUK KONTRAK — nama-namanya sudah ada di kontrak
 * (`ppkName`, `supervisorName`, `contractorSignerName`). Menaruh gambarnya di
 * profil pengguna akan memisahkan gambar dari nama, cacat yang sama persis
 * dengan yang diperbaiki DECISIONS 267 ("Administrator" di atas "Direktur").
 *
 * Ganti personel ⇒ ganti nama DAN gambarnya di satu tempat yang sama.
 *
 * Stempel penyedia boleh dikosongkan di sini: pembacanya
 * (`lib/export/ttd-laporan.ts`) jatuh ke `Vendor.stempelKey`.
 */

const BERKAS_TTD_MAKS = 2 * 1024 * 1024;

/**
 * Medan gambar pada KONTRAK; nama medan = nama field form.
 *
 * Pelaksana Lapangan TIDAK di sini karena tersimpan di paket — lihat
 * {@link MEDAN_TTD_PAKET}. Formulirnya satu, tempat simpannya dua
 * (DECISIONS 404).
 */
const MEDAN_TTD = [
  "ppkTtdKey",
  "ppkStempelKey",
  "supervisorTtdKey",
  "supervisorStempelKey",
  "contractorTtdKey",
  "contractorStempelKey",
] as const;

/** Medan gambar Pelaksana Lapangan — tersimpan di `packages`. */
/*
 * HANYA tanda tangan (DECISIONS 408). Stempel milik PERUSAHAAN, bukan orang,
 * jadi Pelaksana Lapangan memakai stempel penyedia yang sama – kolomnya
 * `pelaksana_stempel_key` masih ada di basis data tapi tidak lagi ditulis
 * maupun dibaca; datanya sengaja tidak dihapus.
 */
const MEDAN_TTD_PAKET = ["pelaksanaTtdKey"] as const;
type MedanTtdPaket = (typeof MEDAN_TTD_PAKET)[number];

type MedanTtd = (typeof MEDAN_TTD)[number];

const LABEL_TTD: Record<MedanTtd, string> = {
  ppkTtdKey: "tanda tangan PPK",
  ppkStempelKey: "stempel PPK",
  supervisorTtdKey: "tanda tangan konsultan pengawas",
  supervisorStempelKey: "stempel konsultan pengawas",
  contractorTtdKey: "tanda tangan penyedia",
  contractorStempelKey: "stempel penyedia",
};

const LABEL_TTD_PAKET: Record<MedanTtdPaket, string> = {
  pelaksanaTtdKey: "tanda tangan pelaksana lapangan",
};

/** Unggah/hapus gambar tanda tangan & stempel pada kontrak. */
export async function updateContractSignatureImages(
  _prev: PackageActionState,
  formData: FormData,
): Promise<PackageActionState> {
  const actor = await requireCapability("contract.manage");
  const contractId = String(formData.get("contractId") ?? "");
  if (!z.uuid().safeParse(contractId).success) return { error: "ID kontrak tidak valid." };

  const contract = await db.contract.findFirst({
    where: { id: contractId, package: { orgId: actor.orgId } },
    select: {
      id: true,
      packageId: true,
      ppkTtdKey: true,
      ppkStempelKey: true,
      supervisorTtdKey: true,
      supervisorStempelKey: true,
      contractorTtdKey: true,
      contractorStempelKey: true,
      package: { select: { id: true, pelaksanaTtdKey: true, pelaksanaStempelKey: true } },
    },
  });
  if (!contract) return { error: "Kontrak tidak ditemukan." };

  const { isR2Configured, r2Put } = await import("@/lib/r2");
  const data: Partial<Record<MedanTtd, string | null>> = {};
  const dataPaket: Partial<Record<MedanTtdPaket, string | null>> = {};
  const berubah: string[] = [];

  /** Olah satu berkas gambar jadi WebP 800px – aturan yang sama untuk semua pihak. */
  const olah = async (berkas: File, label: string, key: string): Promise<string | { error: string }> => {
    if (berkas.size > BERKAS_TTD_MAKS) return { error: `Berkas ${label} terlalu besar (maks 2 MB).` };
    if (!/^image\/(png|jpe?g|webp)$/i.test(berkas.type)) {
      return { error: `Format ${label} harus PNG/JPG/WebP.` };
    }
    if (!isR2Configured()) {
      return { error: "Penyimpanan berkas (R2) belum dikonfigurasi – gambar tidak dapat diunggah." };
    }
    const sharp = (await import("sharp")).default;
    const buf = await sharp(Buffer.from(await berkas.arrayBuffer()), { failOn: "none" })
      .resize(800, 800, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 92 })
      .toBuffer();
    await r2Put(key, buf, "image/webp");
    return key;
  };

  for (const medan of MEDAN_TTD) {
    if (formData.get(`hapus_${medan}`) === "1") {
      // Berkas lama TIDAK dihapus dari R2 — jejak dokumen yang sudah tercetak
      // memakai gambar itu; yang dilepas hanya kaitannya ke kontrak.
      if (contract[medan] !== null) {
        data[medan] = null;
        berubah.push(`${LABEL_TTD[medan]} dilepas`);
      }
      continue;
    }
    const berkas = formData.get(medan);
    if (!(berkas instanceof File) || berkas.size === 0) continue;
    if (berkas.size > BERKAS_TTD_MAKS) {
      return { error: `Berkas ${LABEL_TTD[medan]} terlalu besar (maks 2 MB).` };
    }
    if (!/^image\/(png|jpe?g|webp)$/i.test(berkas.type)) {
      return { error: `Format ${LABEL_TTD[medan]} harus PNG/JPG/WebP.` };
    }
    if (!isR2Configured()) {
      return { error: "Penyimpanan berkas (R2) belum dikonfigurasi – gambar tidak dapat diunggah." };
    }
    const sharp = (await import("sharp")).default;
    // 800px sisi terpanjang: cukup tajam untuk cetak A4 pada ruang ±2 cm,
    // masih ringan untuk dimuat di halaman cetak yang berisi 3 blok.
    const buf = await sharp(Buffer.from(await berkas.arrayBuffer()), { failOn: "none" })
      .resize(800, 800, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 92 })
      .toBuffer();
    const key = `kontrak/${contract.id}/${medan}.webp`;
    await r2Put(key, buf, "image/webp");
    data[medan] = key;
    berubah.push(`${LABEL_TTD[medan]} diperbarui`);
  }

  /*
   * Pelaksana Lapangan diproses di gelanggang yang sama walau tersimpan di
   * PAKET (DECISIONS 402/404). Aturan ukuran, format, dan penamaan berkasnya
   * persis sama; yang berbeda cuma tabel tujuannya.
   */
  for (const medan of MEDAN_TTD_PAKET) {
    if (formData.get(`hapus_${medan}`) === "1") {
      if (contract.package[medan] !== null) {
        dataPaket[medan] = null;
        berubah.push(`${LABEL_TTD_PAKET[medan]} dilepas`);
      }
      continue;
    }
    const berkas = formData.get(medan);
    if (!(berkas instanceof File) || berkas.size === 0) continue;
    const hasil = await olah(
      berkas,
      LABEL_TTD_PAKET[medan],
      `paket/${contract.package.id}/${medan}.webp`,
    );
    if (typeof hasil !== "string") return hasil;
    dataPaket[medan] = hasil;
    berubah.push(`${LABEL_TTD_PAKET[medan]} diperbarui`);
  }

  if (berubah.length === 0) {
    return { error: "Tidak ada berkas yang dipilih – pilih gambar atau centang “lepas”." };
  }

  // Satu transaksi: formulirnya satu, jadi hasilnya tidak boleh setengah jadi.
  await db.$transaction([
    db.contract.update({ where: { id: contract.id }, data }),
    db.package.update({ where: { id: contract.package.id }, data: dataPaket }),
  ]);
  await audit(actor.id, "contract.ttd", "package", contract.packageId, {
    contractId: contract.id,
    berubah,
  });
  revalidatePath(`/paket/${contract.packageId}`, "layout");
  return { success: `${berubah.join("; ")}.` };
}
