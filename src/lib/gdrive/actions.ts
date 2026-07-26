"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { ForbiddenError, requireCapability, requireLocationAccess } from "@/lib/auth/session";
import { GDriveError, driveAbout, probeDriveFolder, uploadToDrive } from "./client";
import { clearGDriveToken, saveGDriveClient } from "./config";
import { parseDriveFolderId, type GDriveUploadKind } from "./parse";

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

/* ── Upload laporan ─────────────────────────────────────────────────────── */

async function logUpload(input: {
  packageId: string;
  locationId: string | null;
  kind: GDriveUploadKind;
  refKey: string;
  fileName: string;
  fileId?: string | null;
  webLink?: string | null;
  status: "sukses" | "gagal";
  error?: string | null;
  byId: string;
}): Promise<void> {
  await db.gDriveUpload
    .create({
      data: {
        packageId: input.packageId,
        locationId: input.locationId,
        kind: input.kind,
        refKey: input.refKey,
        fileName: input.fileName,
        fileId: input.fileId ?? null,
        webLink: input.webLink ?? null,
        status: input.status,
        error: input.error ?? null,
        createdById: input.byId,
      },
    })
    .catch(() => {});
}

async function locationWithFolder(slugOrId: { slug?: string; locationId?: string }) {
  const loc = await db.location.findFirst({
    where: slugOrId.slug ? { slug: slugOrId.slug } : { id: slugOrId.locationId },
    select: {
      id: true,
      slug: true,
      name: true,
      package: { select: { id: true, driveFolderId: true } },
    },
  });
  if (!loc) return { error: "Lokasi tidak ditemukan." as const };
  if (!loc.package.driveFolderId)
    return {
      error: "Paket ini belum punya folder Google Drive — atur di halaman paket." as const,
    };
  return { loc, packageId: loc.package.id, folderId: loc.package.driveFolderId };
}

/** Upload PDF laporan harian ke folder Drive paket. */
export async function uploadDailyReportToDriveAction(
  _prev: GDriveActionState,
  formData: FormData,
): Promise<GDriveActionState> {
  const schema = z.object({
    slug: z.string().trim().min(1),
    dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal tidak valid"),
  });
  const parsed = schema.safeParse({ slug: formData.get("slug"), dateKey: formData.get("dateKey") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { slug, dateKey } = parsed.data;

  try {
    const user = await requireCapability("report.export");
    const r = await locationWithFolder({ slug });
    if ("error" in r) return { error: r.error };
    await requireLocationAccess(user, r.loc.id);

    const { renderHarianPdf } = await import("@/lib/pdf/harian");
    const pdf = await renderHarianPdf(slug, dateKey);
    if (!pdf) return { error: "Laporan harian tidak ditemukan." };

    const fileName = `Laporan Harian - ${r.loc.name} - ${dateKey}.pdf`;
    try {
      const file = await uploadToDrive({
        folderId: r.folderId,
        fileName,
        mime: PDF_MIME,
        data: pdf.buffer,
      });
      await logUpload({
        packageId: r.packageId,
        locationId: r.loc.id,
        kind: "laporan_harian",
        refKey: `${slug}:${dateKey}`,
        fileName,
        fileId: file.id,
        webLink: file.webViewLink,
        status: "sukses",
        byId: user.id,
      });
      await audit(user.id, "gdrive.upload", "daily_report", null, {
        locationId: r.loc.id,
        dateKey,
        fileId: file.id,
      });
      revalidatePath(`/lokasi/${slug}/laporan-lokasi`);
      return { success: `Laporan harian terupload ke Drive.` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload gagal.";
      await logUpload({
        packageId: r.packageId,
        locationId: r.loc.id,
        kind: "laporan_harian",
        refKey: `${slug}:${dateKey}`,
        fileName,
        status: "gagal",
        error: msg,
        byId: user.id,
      });
      return { error: msg };
    }
  } catch (err) {
    return fail(err);
  }
}

/** Upload laporan mingguan/bulanan (PDF + Excel) ke folder Drive paket. */
export async function uploadPeriodReportToDriveAction(
  _prev: GDriveActionState,
  formData: FormData,
): Promise<GDriveActionState> {
  const schema = z.object({
    locationId: z.uuid(),
    kind: z.enum(["mingguan", "bulanan"]),
    n: z.coerce.number().int().min(1).max(520),
  });
  const parsed = schema.safeParse({
    locationId: formData.get("locationId"),
    kind: formData.get("kind"),
    n: formData.get("n"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { locationId, kind, n } = parsed.data;

  try {
    const user = await requireCapability("report.export");
    const r = await locationWithFolder({ locationId });
    if ("error" in r) return { error: r.error };
    await requireLocationAccess(user, r.loc.id);

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
    const gKind: GDriveUploadKind = kind === "mingguan" ? "laporan_mingguan" : "laporan_bulanan";
    const refKey = `${r.loc.slug}:${kind}-${n}`;
    const base = `Laporan ${kind === "mingguan" ? "Mingguan" : "Bulanan"} ${label} - ${r.loc.name}`;

    const results: string[] = [];
    for (const f of [
      { fileName: `${base}.pdf`, mime: PDF_MIME, data: pdf.buffer },
      { fileName: `${base}.xlsx`, mime: XLSX_MIME, data: xlsx },
    ]) {
      try {
        const file = await uploadToDrive({ folderId: r.folderId, ...f });
        await logUpload({
          packageId: r.packageId,
          locationId: r.loc.id,
          kind: gKind,
          refKey,
          fileName: f.fileName,
          fileId: file.id,
          webLink: file.webViewLink,
          status: "sukses",
          byId: user.id,
        });
        results.push(f.fileName.endsWith(".pdf") ? "PDF" : "Excel");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Upload gagal.";
        await logUpload({
          packageId: r.packageId,
          locationId: r.loc.id,
          kind: gKind,
          refKey,
          fileName: f.fileName,
          status: "gagal",
          error: msg,
          byId: user.id,
        });
        return {
          error:
            results.length > 0
              ? `${results.join(" & ")} terupload, tapi ${f.fileName.endsWith(".pdf") ? "PDF" : "Excel"} gagal: ${msg}`
              : msg,
        };
      }
    }
    await audit(user.id, "gdrive.upload", "location", locationId, { kind, n });
    revalidatePath(`/lokasi/${r.loc.slug}/laporan-lokasi`);
    return { success: `Laporan ${kind} (PDF + Excel) terupload ke Drive.` };
  } catch (err) {
    return fail(err);
  }
}
