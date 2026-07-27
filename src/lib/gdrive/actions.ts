"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { ForbiddenError, requireCapability, requireLocationAccess } from "@/lib/auth/session";
import { GDriveError, driveAbout, probeDriveFolder } from "./client";
import { clearGDriveToken, saveGDriveClient } from "./config";
import { parseDriveFolderId } from "./parse";
import {
  activityPath,
  dailyPhotoPath,
  dailyReportPath,
  documentPath,
  periodReportPath,
  safeFileName,
} from "./folders";
import { documentItem, photoItems, summarize, uploadBatch, type UploadTarget } from "./upload";

/** Server action integrasi Google Drive (upload manual laporan). DECISIONS 141. */

export type GDriveActionState = { error?: string; success?: string } | undefined;

function fail(err: unknown): GDriveActionState {
  if (err instanceof ForbiddenError || err instanceof GDriveError) return { error: err.message };
  return { error: err instanceof Error ? err.message : "Terjadi kesalahan." };
}

const PDF_MIME = "application/pdf";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/* ── Konfigurasi (Sistem) ───────────────────────────────────────────────── */

export async function saveGDriveClientAction(
  _prev: GDriveActionState,
  formData: FormData,
): Promise<GDriveActionState> {
  try {
    const user = await requireCapability("system.manage");
    const schema = z.object({
      clientId: z.string().trim().min(10, "Client ID tidak valid"),
      clientSecret: z.string().trim(),
    });
    const parsed = schema.safeParse({
      clientId: formData.get("clientId"),
      clientSecret: formData.get("clientSecret"),
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    await saveGDriveClient(parsed.data.clientId, parsed.data.clientSecret || null);
    await audit(user.id, "gdrive.config", "app_setting", null, { clientId: parsed.data.clientId });
    revalidatePath("/sistem");
    return { success: "Konfigurasi Google tersimpan. Lanjutkan dengan “Hubungkan akun Google”." };
  } catch (err) {
    return fail(err);
  }
}

export async function disconnectGDriveAction(): Promise<GDriveActionState> {
  try {
    const user = await requireCapability("system.manage");
    await clearGDriveToken();
    await audit(user.id, "gdrive.disconnect", "app_setting", null, {});
    revalidatePath("/sistem");
    return { success: "Akun Google diputus." };
  } catch (err) {
    return fail(err);
  }
}

export async function testGDriveAction(): Promise<GDriveActionState> {
  try {
    await requireCapability("system.manage");
    const about = await driveAbout();
    return { success: `Terhubung sebagai ${about.email ?? about.name ?? "akun Google"}.` };
  } catch (err) {
    return fail(err);
  }
}

/* ── Folder Drive per paket ─────────────────────────────────────────────── */

export async function setPackageDriveFolderAction(
  _prev: GDriveActionState,
  formData: FormData,
): Promise<GDriveActionState> {
  try {
    const user = await requireCapability("wa.configure");
    const schema = z.object({ packageId: z.uuid(), folder: z.string().trim() });
    const parsed = schema.safeParse({
      packageId: formData.get("packageId"),
      folder: formData.get("folder"),
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const { packageId, folder } = parsed.data;

    const pkg = await db.package.findFirst({
      where: { id: packageId, orgId: user.orgId },
      select: { id: true },
    });
    if (!pkg) return { error: "Paket tidak ditemukan." };

    if (!folder) {
      await db.package.update({ where: { id: packageId }, data: { driveFolderId: null } });
      await audit(user.id, "gdrive.folder.hapus", "package", packageId, {});
      revalidatePath(`/paket/${packageId}`);
      return { success: "Folder Drive paket dihapus." };
    }

    const folderId = parseDriveFolderId(folder);
    if (!folderId) return { error: "Tidak dikenali — tempel link folder Drive atau ID-nya." };
    // Validasi akses hanya bila akun sudah terhubung; kalau belum, tetap simpan.
    let folderName: string | null = null;
    try {
      folderName = (await probeDriveFolder(folderId)).name;
    } catch (err) {
      if (err instanceof GDriveError && /belum diberi akses|tidak ditemukan|bukan folder/i.test(err.message)) {
        return { error: err.message };
      }
      // Akun belum terhubung / error jaringan: simpan dulu, validasi menyusul.
    }
    await db.package.update({ where: { id: packageId }, data: { driveFolderId: folderId } });
    await audit(user.id, "gdrive.folder.simpan", "package", packageId, { folderId, folderName });
    revalidatePath(`/paket/${packageId}`);
    return {
      success: folderName
        ? `Folder Drive tersimpan: “${folderName}”.`
        : "Folder Drive tersimpan (akses belum tervalidasi — hubungkan akun Google di Sistem).",
    };
  } catch (err) {
    return fail(err);
  }
}


/* ── Upload ke struktur folder KKP ──────────────────────────────────────── */

type Ctx = { target: UploadTarget; locationName: string; slug: string };

/** Resolusi lokasi + folder paket + guard akses. Dipakai semua aksi upload. */
async function ctxFor(
  by: { slug?: string; locationId?: string },
  kind: UploadTarget["kind"],
  refKey: string,
  userId: string,
): Promise<Ctx | { error: string }> {
  const loc = await db.location.findFirst({
    where: by.slug ? { slug: by.slug } : { id: by.locationId },
    select: { id: true, slug: true, name: true, package: { select: { id: true, driveFolderId: true } } },
  });
  if (!loc) return { error: "Lokasi tidak ditemukan." };
  if (!loc.package.driveFolderId)
    return { error: "Paket ini belum punya folder Google Drive — atur di halaman paket." };
  return {
    locationName: loc.name,
    slug: loc.slug,
    target: {
      packageId: loc.package.id,
      locationId: loc.id,
      rootFolderId: loc.package.driveFolderId,
      kind,
      refKey,
      byId: userId,
    },
  };
}

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal tidak valid");

/**
 * Laporan harian → "3. LAPORAN HARIAN/<Lokasi>/<bulan>": PDF laporan + semua
 * foto laporan itu (subfolder "Foto"). Foto ikut karena KKP menilai bukti
 * visual, bukan hanya narasi.
 */
export async function uploadDailyReportToDriveAction(
  _prev: GDriveActionState,
  formData: FormData,
): Promise<GDriveActionState> {
  const parsed = z
    .object({ slug: z.string().trim().min(1), dateKey: dateSchema })
    .safeParse({ slug: formData.get("slug"), dateKey: formData.get("dateKey") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { slug, dateKey } = parsed.data;

  try {
    const user = await requireCapability("report.export");
    const c = await ctxFor({ slug }, "laporan_harian", `${slug}:${dateKey}`, user.id);
    if ("error" in c) return { error: c.error };
    await requireLocationAccess(user, c.target.locationId!);

    const { renderHarianPdf } = await import("@/lib/pdf/harian");
    const pdf = await renderHarianPdf(slug, dateKey);
    if (!pdf) return { error: "Laporan harian tidak ditemukan." };

    const report = await db.dailyReport.findUnique({
      where: {
        locationId_reportDate: {
          locationId: c.target.locationId!,
          reportDate: new Date(`${dateKey}T00:00:00.000Z`),
        },
      },
      select: { photos: { select: { r2Key: true }, orderBy: { createdAt: "asc" } } },
    });

    const outcomes = [
      await uploadBatch(c.target, dailyReportPath({ locationName: c.locationName, dateKey }), [
        {
          fileName: safeFileName(`Laporan Harian - ${c.locationName} - ${dateKey}.pdf`),
          mime: PDF_MIME,
          data: pdf.buffer,
        },
      ]),
    ];

    let skipped = 0;
    const photos = report?.photos ?? [];
    if (photos.length > 0) {
      const got = await photoItems(photos, { dateKey, locationName: c.locationName });
      skipped = got.skipped;
      outcomes.push(
        await uploadBatch(c.target, dailyPhotoPath({ locationName: c.locationName, dateKey }), got.items),
      );
    }

    await audit(user.id, "gdrive.upload", "daily_report", null, {
      locationId: c.target.locationId,
      dateKey,
      files: outcomes.reduce((s, o) => s + o.ok, 0),
      photos: photos.length,
    });
    revalidatePath(`/lokasi/${slug}/laporan-lokasi`);
    const err = outcomes.find((o) => o.firstError)?.firstError;
    const msg = summarize("Laporan harian", outcomes, skipped);
    return err ? { error: `${msg} Penyebab: ${err}` } : { success: msg };
  } catch (err) {
    return fail(err);
  }
}

/** Laporan mingguan/bulanan → "4./5. …/<Lokasi>": PDF + Excel. */
export async function uploadPeriodReportToDriveAction(
  _prev: GDriveActionState,
  formData: FormData,
): Promise<GDriveActionState> {
  const parsed = z
    .object({
      locationId: z.uuid(),
      kind: z.enum(["mingguan", "bulanan"]),
      n: z.coerce.number().int().min(1).max(520),
    })
    .safeParse({
      locationId: formData.get("locationId"),
      kind: formData.get("kind"),
      n: formData.get("n"),
    });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { locationId, kind, n } = parsed.data;

  try {
    const user = await requireCapability("report.export");
    const c = await ctxFor(
      { locationId },
      kind === "mingguan" ? "laporan_mingguan" : "laporan_bulanan",
      `${locationId}:${kind}-${n}`,
      user.id,
    );
    if ("error" in c) return { error: c.error };
    await requireLocationAccess(user, locationId);

    const [{ renderPeriodikPdf }, { getPeriodReport }, { buildPeriodReportXlsx }] = await Promise.all([
      import("@/lib/pdf/periodik"),
      import("@/lib/periodic-report"),
      import("@/lib/export/xlsx"),
    ]);
    const [pdf, report] = await Promise.all([
      renderPeriodikPdf(locationId, kind, n),
      getPeriodReport(locationId, kind, n),
    ]);
    if (!pdf || !report) return { error: "Laporan untuk periode ini tidak tersedia." };
    const xlsx = await buildPeriodReportXlsx(report);

    const label = kind === "mingguan" ? `Minggu ke-${n}` : `Bulan ke-${n}`;
    const base = `Laporan ${kind === "mingguan" ? "Mingguan" : "Bulanan"} ${label} - ${c.locationName}`;
    const outcome = await uploadBatch(c.target, periodReportPath(kind, c.locationName), [
      { fileName: safeFileName(`${base}.pdf`), mime: PDF_MIME, data: pdf.buffer },
      { fileName: safeFileName(`${base}.xlsx`), mime: XLSX_MIME, data: xlsx },
    ]);

    await audit(user.id, "gdrive.upload", "location", locationId, { kind, n, files: outcome.ok });
    revalidatePath(`/lokasi/${c.slug}/laporan-lokasi`);
    const msg = summarize(`Laporan ${kind} ${label}`, [outcome]);
    return outcome.firstError ? { error: `${msg} Penyebab: ${outcome.firstError}` } : { success: msg };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Kegiatan lapangan → "6. DOKUMENTASI/<Lokasi>/<bulan>/<tanggal judul>":
 * PDF kegiatan + seluruh fotonya, satu folder per kegiatan.
 */
export async function uploadActivityToDriveAction(
  _prev: GDriveActionState,
  formData: FormData,
): Promise<GDriveActionState> {
  const parsed = z.object({ activityId: z.uuid() }).safeParse({ activityId: formData.get("activityId") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { activityId } = parsed.data;

  try {
    const user = await requireCapability("field_activity.manage");
    const act = await db.fieldActivity.findUnique({
      where: { id: activityId },
      select: {
        title: true,
        activityDate: true,
        locationId: true,
        location: { select: { slug: true } },
        photos: { select: { r2Key: true }, orderBy: { createdAt: "asc" } },
      },
    });
    if (!act) return { error: "Kegiatan tidak ditemukan." };
    await requireLocationAccess(user, act.locationId);

    const dateKey = act.activityDate.toISOString().slice(0, 10);
    const c = await ctxFor({ locationId: act.locationId }, "kegiatan", activityId, user.id);
    if ("error" in c) return { error: c.error };

    const { renderKegiatanPdf } = await import("@/lib/pdf/kegiatan");
    const pdf = await renderKegiatanPdf(activityId);
    if (!pdf) return { error: "Kegiatan tidak bisa dirender." };

    const path = activityPath({ locationName: c.locationName, dateKey, title: act.title });
    const outcomes = [
      await uploadBatch(c.target, path, [
        {
          fileName: safeFileName(`Kegiatan - ${act.title} - ${dateKey}.pdf`),
          mime: PDF_MIME,
          data: pdf.buffer,
        },
      ]),
    ];
    let skipped = 0;
    if (act.photos.length > 0) {
      const got = await photoItems(act.photos, { dateKey, locationName: c.locationName });
      skipped = got.skipped;
      outcomes.push(await uploadBatch(c.target, path, got.items));
    }

    await audit(user.id, "gdrive.upload", "field_activity", activityId, {
      files: outcomes.reduce((s, o) => s + o.ok, 0),
      photos: act.photos.length,
    });
    revalidatePath(`/lokasi/${act.location.slug}/kegiatan`);
    const err = outcomes.find((o) => o.firstError)?.firstError;
    const msg = summarize("Kegiatan lapangan", outcomes, skipped);
    return err ? { error: `${msg} Penyebab: ${err}` } : { success: msg };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Dokumen administrasi → folder KKP sesuai JENIS dokumen (1/2/7/8/9).
 * Jenis yang tidak dipetakan (dokumen proses tender internal) ditolak dengan
 * pesan jelas — bukan ditaruh sembarangan.
 */
export async function uploadDocumentToDriveAction(
  _prev: GDriveActionState,
  formData: FormData,
): Promise<GDriveActionState> {
  const parsed = z.object({ documentId: z.uuid() }).safeParse({ documentId: formData.get("documentId") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { documentId } = parsed.data;

  try {
    const user = await requireCapability("document.upload");
    const doc = await db.document.findFirst({
      where: { id: documentId, orgId: user.orgId },
      select: {
        type: true,
        title: true,
        fileName: true,
        mimeType: true,
        r2Key: true,
        packageId: true,
        locationId: true,
        location: { select: { name: true, packageId: true } },
        package: { select: { id: true, driveFolderId: true } },
        milestone: { select: { templateKey: true } },
      },
    });
    if (!doc) return { error: "Dokumen tidak ditemukan." };

    const path = documentPath({
      type: doc.type,
      milestoneKey: doc.milestone?.templateKey ?? null,
      locationName: doc.location?.name ?? null,
    });
    if (!path)
      return {
        error: `Jenis dokumen ini tidak punya folder di struktur KKP — tidak perlu dishare ke Drive.`,
      };

    // Folder Drive diambil dari paket dokumen, atau paket pemilik lokasinya.
    const packageId = doc.packageId ?? doc.location?.packageId ?? null;
    if (!packageId) return { error: "Dokumen tidak terhubung ke paket mana pun." };
    const pkg = await db.package.findFirst({
      where: { id: packageId, orgId: user.orgId },
      select: { id: true, driveFolderId: true },
    });
    if (!pkg?.driveFolderId)
      return { error: "Paket ini belum punya folder Google Drive — atur di halaman paket." };
    if (doc.locationId) await requireLocationAccess(user, doc.locationId);

    const target: UploadTarget = {
      packageId: pkg.id,
      locationId: doc.locationId,
      rootFolderId: pkg.driveFolderId,
      kind: "dokumen",
      refKey: documentId,
      byId: user.id,
    };
    const outcome = await uploadBatch(target, path, [await documentItem(doc)]);

    await audit(user.id, "gdrive.upload", "document", documentId, {
      type: doc.type,
      folder: path[0],
      ok: outcome.ok,
    });
    revalidatePath("/dokumen");
    const msg = summarize(`Dokumen “${doc.title}”`, [outcome]);
    return outcome.firstError ? { error: `${msg} Penyebab: ${outcome.firstError}` } : { success: msg };
  } catch (err) {
    return fail(err);
  }
}
