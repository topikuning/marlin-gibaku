"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireCapability } from "@/lib/auth/session";
import {
  canTransitionPackage,
  canTransitionLocation,
  PACKAGE_STAGE_LABEL,
} from "@/lib/lifecycle";
import { parseDateKey } from "@/lib/format";
import type { PackageStage } from "@/generated/prisma/enums";

/**
 * Server actions modul Paket (lifecycle prospek → kontrak → pelaksanaan).
 * Semua mutasi: requireCapability + audit(resourceType "package", resourceId
 * = packageId agar tab Aktivitas paket membaca satu feed).
 * Transisi stage SELALU lewat canTransitionPackage + PackageStageHistory
 * dalam satu $transaction.
 */

export type PackageActionState = { error?: string; success?: string } | undefined;

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
    .replace(/[̀-ͯ]/g, "")
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

  const pkg = await db.package.findUnique({
    where: { id: d.packageId },
    select: { stage: true, contract: { select: { id: true } } },
  });
  if (!pkg) return { error: "Paket tidak ditemukan." };
  if (pkg.contract || !PRA_KONTRAK.includes(pkg.stage)) {
    return { error: "Paket sudah berkontrak/terkunci — identitas dan HPS tidak bisa diubah." };
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

  const result = await db.$transaction(async (tx) => {
    const pkg = await tx.package.findUnique({
      where: { id: id.data },
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

/* ------------------------------------------------------------------ */
/* Lokasi target (pra-kontrak)                                         */
/* ------------------------------------------------------------------ */

const addLocationSchema = z.object({
  packageId: z.uuid("ID paket tidak valid"),
  name: z.string().trim().min(3, "Nama lokasi minimal 3 karakter").max(150),
  village: z.string().trim().min(2, "Desa/kelurahan wajib diisi").max(100),
  regency: z.string().trim().min(2, "Kabupaten/kota wajib diisi").max(100),
  province: z.string().trim().min(2, "Provinsi wajib diisi").max(100),
  gpsLat: z.preprocess(
    (v) => (v === "" || v == null ? undefined : Number(v)),
    z.number().min(-90).max(90).optional(),
  ),
  gpsLng: z.preprocess(
    (v) => (v === "" || v == null ? undefined : Number(v)),
    z.number().min(-180).max(180).optional(),
  ),
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
    regency: formData.get("regency"),
    province: formData.get("province"),
    gpsLat: formData.get("gpsLat"),
    gpsLng: formData.get("gpsLng"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const result = await db.$transaction(async (tx) => {
    const pkg = await tx.package.findUnique({
      where: { id: d.packageId },
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
        regency: d.regency,
        province: d.province,
        gpsLat: d.gpsLat ?? null,
        gpsLng: d.gpsLng ?? null,
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

/** Hapus lokasi target: hanya bila belum aktif dan belum punya RAB. */
export async function removeTargetLocation(locationId: string): Promise<PackageActionState> {
  const actor = await requireCapability("prospect.manage");
  const id = z.uuid().safeParse(locationId);
  if (!id.success) return { error: "ID lokasi tidak valid." };

  const result = await db.$transaction(async (tx) => {
    const loc = await tx.location.findUnique({
      where: { id: id.data },
      select: {
        id: true,
        name: true,
        packageId: true,
        isActive: true,
        _count: { select: { rabRevisions: true, statusHistory: true, dailyReports: true } },
      },
    });
    if (!loc) return { error: "Lokasi tidak ditemukan." as string };
    if (loc.isActive) return { error: "Lokasi sudah aktif — tidak bisa dihapus." };
    if (loc._count.rabRevisions > 0) {
      return { error: "Lokasi sudah punya RAB — tidak bisa dihapus." };
    }
    if (loc._count.statusHistory > 0 || loc._count.dailyReports > 0) {
      return { error: "Lokasi sudah punya riwayat — tidak bisa dihapus." };
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

/* ------------------------------------------------------------------ */
/* Konversi kontrak (idempotent)                                       */
/* ------------------------------------------------------------------ */

const convertSchema = z
  .object({
    packageId: z.uuid("ID paket tidak valid"),
    vendorId: z.uuid().optional(),
    vendorName: z.string().trim().min(3, "Nama vendor minimal 3 karakter").max(200).optional(),
    contractNumber: z.string().trim().min(3, "Nomor kontrak wajib diisi").max(150),
    ppnPercent: z.preprocess(
      (v) => (v === "" || v == null ? 11 : Number(v)),
      z.number().min(0, "PPN minimal 0").max(100, "PPN maksimal 100"),
    ),
    signedDate: z.string().min(1, "Tanggal tanda tangan wajib diisi"),
    startDate: z.string().min(1, "Tanggal mulai wajib diisi"),
    endDate: z.string().min(1, "Tanggal selesai wajib diisi"),
    advancePercent: percentSchema,
    retentionPercent: percentSchema,
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
    contractNumber: formData.get("contractNumber"),
    ppnPercent: formData.get("ppnPercent"),
    signedDate: formData.get("signedDate"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    advancePercent: formData.get("advancePercent"),
    retentionPercent: formData.get("retentionPercent"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const contractValue = parseRupiah(formData.get("contractValue"));
  if (contractValue === null || contractValue <= 0n) {
    return { error: "Nilai kontrak wajib diisi dan lebih dari 0." };
  }
  const signedDate = parseDateKey(d.signedDate);
  const startDate = parseDateKey(d.startDate);
  const endDate = parseDateKey(d.endDate);
  if (!signedDate || !startDate || !endDate) return { error: "Format tanggal tidak valid." };
  if (endDate < startDate) return { error: "Tanggal selesai harus setelah tanggal mulai." };

  const result = await db.$transaction(async (tx) => {
    const pkg = await tx.package.findUnique({
      where: { id: d.packageId },
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
      return { error: `Paket di tahap ${PACKAGE_STAGE_LABEL[pkg.stage]} — konversi kontrak tidak berlaku.` };
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
      const vendor = await tx.vendor.findUnique({ where: { id: vendorId }, select: { id: true } });
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
        contractValue,
        ppnPercent: d.ppnPercent,
        advancePercent: d.advancePercent ?? null,
        retentionPercent: d.retentionPercent ?? null,
        signedDate,
        startDate,
        endDate,
      },
      select: { id: true },
    });

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
    return { success: "Kontrak untuk paket ini sudah tercatat — tidak dibuat duplikat." };
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
    success: `Kontrak ${d.contractNumber} tercatat. ${result.locationCount} lokasi diaktifkan — lanjut import RAB per lokasi.`,
  };
}

/* ------------------------------------------------------------------ */
/* Mulai pelaksanaan                                                   */
/* ------------------------------------------------------------------ */

export async function startPelaksanaan(packageId: string): Promise<PackageActionState> {
  const actor = await requireCapability("contract.manage");
  const id = z.uuid().safeParse(packageId);
  if (!id.success) return { error: "ID paket tidak valid." };

  const result = await db.$transaction(async (tx) => {
    const pkg = await tx.package.findUnique({
      where: { id: id.data },
      select: {
        stage: true,
        contract: { select: { id: true } },
        locations: { select: { id: true, status: true } },
      },
    });
    if (!pkg) return { error: "Paket tidak ditemukan." as string };
    if (!pkg.contract) return { error: "Belum ada kontrak — konversi kontrak dulu." };
    if (!canTransitionPackage(pkg.stage, "pelaksanaan")) {
      return {
        error: `Transisi ${PACKAGE_STAGE_LABEL[pkg.stage]} → Pelaksanaan tidak diizinkan.`,
      };
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

  await audit(actor.id, "package.start_pelaksanaan", "package", id.data, {
    locationsStarted: result.started,
  });
  revalidatePath("/paket");
  revalidatePath(`/paket/${id.data}`, "layout");
  return { success: `Pelaksanaan dimulai — ${result.started} lokasi berstatus Berjalan.` };
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
    const contract = await tx.contract.findUnique({
      where: { id: d.contractId },
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
