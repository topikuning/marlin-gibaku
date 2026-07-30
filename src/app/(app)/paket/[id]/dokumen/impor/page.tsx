import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Banner, PageHeader } from "@/components/ui";
import { requireUser, accessibleLocationIds } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { db } from "@/lib/db";
import { getGDriveConfigDisplay } from "@/lib/gdrive/config";
import { MAX_IMPORT_PER_BATCH } from "@/lib/gdrive/import";
import { ImporDriveClient } from "./impor-client";

export const metadata: Metadata = { title: "Impor Dokumen dari Drive" };
export const dynamic = "force-dynamic";

/**
 * Impor dokumen dari folder Google Drive KKP ke Document Center (DECISIONS 184).
 * Halaman ini TIDAK memanggil Drive saat dibuka — pembacaan folder dipicu tombol.
 */
export default async function ImporDokumenDrivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  requireCapabilityPage(user.role, "document.upload");

  const pkg = await db.package.findUnique({
    where: { id },
    select: {
      id: true,
      orgId: true,
      name: true,
      driveFolderId: true,
      locations: { select: { id: true, name: true }, orderBy: { name: "asc" } },
    },
  });
  if (!pkg || pkg.orgId !== user.orgId) notFound();

  const scoped = await accessibleLocationIds(user);
  const locations =
    scoped === null ? pkg.locations : pkg.locations.filter((l) => scoped.includes(l.id));
  const drive = await getGDriveConfigDisplay();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Impor dokumen dari Google Drive"
        description={`Menarik berkas yang sudah ada di folder KKP paket ${pkg.name} ke arsip MARLIN. Isi berkas disalin ke penyimpanan MARLIN, jadi dokumen tetap ada walau file di Drive dipindah atau dihapus.`}
        actions={
          <Link
            href={`/paket/${pkg.id}/dokumen`}
            className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-surface-2"
          >
            Kembali ke dokumen paket
          </Link>
        }
      />

      {!drive.connected ? (
        <Banner
          tone="warning"
          title="Google Drive belum terhubung"
          description="Hubungkan akun Google di menu Sistem → Integrasi sebelum mengimpor."
        />
      ) : null}
      {!pkg.driveFolderId ? (
        <Banner
          tone="warning"
          title="Paket ini belum punya folder Drive"
          description="Isi ID folder KKP paket ini di halaman paket dulu — impor membaca folder itu."
        />
      ) : null}

      {drive.connected && pkg.driveFolderId ? (
        <ImporDriveClient
          packageId={pkg.id}
          packageName={pkg.name}
          locations={locations}
          maxPerBatch={MAX_IMPORT_PER_BATCH}
        />
      ) : null}
    </div>
  );
}
