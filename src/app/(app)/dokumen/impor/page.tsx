import type { Metadata } from "next";
import Link from "next/link";
import { Banner, Card, CardBody, CardHeader, Combobox, EmptyState, PageHeader } from "@/components/ui";
import { FolderOpen } from "lucide-react";
import { requireUser, accessibleLocationIds } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { db } from "@/lib/db";
import { getGDriveConfigDisplay } from "@/lib/gdrive/config";
import { MAX_IMPORT_PER_BATCH } from "@/lib/gdrive/import";
import { ImporDriveClient } from "./impor-client";

export const metadata: Metadata = { title: "Impor Dokumen dari Drive" };
export const dynamic = "force-dynamic";

/**
 * Impor dokumen dari folder Google Drive KKP (DECISIONS 184). Hidup di menu
 * Dokumen — bukan terselip di dalam halaman paket — karena inilah tempat orang
 * mencarinya. Paket dipilih di sini; halaman TIDAK memanggil Drive saat dibuka.
 */
export default async function ImporDokumenDrivePage({
  searchParams,
}: {
  searchParams: Promise<{ paket?: string }>;
}) {
  const user = await requireUser();
  requireCapabilityPage(user.role, "document.upload");
  const sp = await searchParams;

  const scoped = await accessibleLocationIds(user);
  const packages = await db.package.findMany({
    where: {
      orgId: user.orgId,
      ...(scoped === null ? {} : { locations: { some: { id: { in: scoped } } } }),
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      driveFolderId: true,
      locations: { select: { id: true, name: true }, orderBy: { name: "asc" } },
    },
  });

  const selected = sp.paket ? (packages.find((p) => p.id === sp.paket) ?? null) : null;
  const locations =
    selected === null
      ? []
      : scoped === null
        ? selected.locations
        : selected.locations.filter((l) => scoped.includes(l.id));
  const drive = await getGDriveConfigDisplay();
  const withDrive = packages.filter((p) => p.driveFolderId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Impor dokumen dari Google Drive"
        description="Menarik berkas yang sudah ada di folder KKP ke arsip MARLIN. Isi berkas disalin ke penyimpanan MARLIN, jadi dokumen tetap ada walau file di Drive dipindah atau dihapus."
        actions={
          <Link
            href="/dokumen"
            className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-surface-2"
          >
            Kembali ke arsip
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

      <Card>
        <CardHeader
          title="Pilih paket"
          subtitle="Impor membaca folder Drive milik paket. Paket tanpa ID folder Drive belum bisa diimpor – isi ID folder KKP di halaman paket dulu."
        />
        <CardBody className="space-y-3">
          <form method="GET" className="grid gap-2 text-sm sm:grid-cols-[minmax(0,24rem)_auto]">
            <Combobox name="paket" defaultValue={sp.paket ?? ""} placeholder="Pilih paket…">
              <option value="">– pilih paket –</option>
              {packages.map((p) => (
                <option key={p.id} value={p.id} disabled={!p.driveFolderId}>
                  {p.name}
                  {p.driveFolderId ? "" : " (belum ada folder Drive)"}
                </option>
              ))}
            </Combobox>
            <button
              type="submit"
              className="rounded-md bg-primary px-3 py-1.5 font-medium text-white hover:bg-primary-800"
            >
              Buka
            </button>
          </form>
          {packages.length === 0 ? (
            <EmptyState
              icon={FolderOpen}
              title="Belum ada paket"
              description="Buat paket dulu, isi ID folder Drive KKP-nya, baru impor bisa dipakai."
            />
          ) : withDrive.length === 0 ? (
            <Banner
              tone="warning"
              title="Belum ada paket yang punya folder Drive"
              description="Buka halaman paket → isi ID folder Google Drive KKP, lalu kembali ke sini."
            />
          ) : null}
          {selected && !selected.driveFolderId ? (
            <Banner
              tone="warning"
              title={`Paket "${selected.name}" belum punya folder Drive`}
              description="Isi ID folder KKP paket ini di halaman paket dulu – impor membaca folder itu."
            />
          ) : null}
        </CardBody>
      </Card>

      {selected?.driveFolderId && drive.connected ? (
        <ImporDriveClient
          packageId={selected.id}
          packageName={selected.name}
          locations={locations}
          maxPerBatch={MAX_IMPORT_PER_BATCH}
        />
      ) : null}
    </div>
  );
}
