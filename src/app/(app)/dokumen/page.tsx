import type { Metadata } from "next";
import Link from "next/link";
import { FolderOpen } from "lucide-react";
import { Card, CardBody, CardHeader, Combobox, EmptyState, KpiCard, PageHeader, StatusPill } from "@/components/ui";
import { requireUser, accessibleLocationIds } from "@/lib/auth/session";
import { locationScopeWhere } from "@/lib/auth/scope";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import {
  listDocuments,
  ALL_PHASES,
  ALL_DOC_TYPES,
  PHASE_LABEL,
  TYPE_LABEL,
} from "@/lib/documents";
import { formatTanggal, formatTanggalWaktu } from "@/lib/format";
import { getGDriveConfigDisplay } from "@/lib/gdrive/config";
import { folderForDocumentType, folderForMilestone } from "@/lib/gdrive/folders";
import { UploadDocumentToDrive } from "@/components/knmp/drive-upload-button";
import type { AdminPhase, DocumentType } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Dokumen" };
export const dynamic = "force-dynamic";

// Helper di luar komponen — aturan purity render melarang Date.now() langsung di body.
function countExpiringSoon(expiryDates: (Date | null)[]): number {
  const soon = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  return expiryDates.filter((d) => d !== null && d <= soon).length;
}

/** Document Center: arsip lintas paket/lokasi/fase dengan filter + unduh presigned. */
export default async function DokumenPage({
  searchParams,
}: {
  searchParams: Promise<{ paket?: string; lokasi?: string; fase?: string; tipe?: string; q?: string }>;
}) {
  const user = await requireUser();
  requireCapabilityPage(user.role, "document.view");
  const sp = await searchParams;
  const scoped = await accessibleLocationIds(user);

  const [packages, locations] = await Promise.all([
    db.package.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.location.findMany({
      where: locationScopeWhere(user, scoped),
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const phase = ALL_PHASES.includes(sp.fase as AdminPhase) ? (sp.fase as AdminPhase) : undefined;
  const type = ALL_DOC_TYPES.includes(sp.tipe as DocumentType) ? (sp.tipe as DocumentType) : undefined;
  const documents = await listDocuments({
    orgId: user.orgId,
    packageId: sp.paket || undefined,
    locationId: sp.lokasi || undefined,
    phase,
    type,
    q: sp.q || undefined,
    scopedLocationIds: scoped,
  });

  const expiring = countExpiringSoon(documents.map((d) => d.expiryDate));

  // Kesiapan Drive: hanya dokumen yang paketnya punya folder Drive yang bisa
  // diupload; status upload terakhir diambil dari log (refKey = documentId).
  const driveOn = (await getGDriveConfigDisplay()).connected;
  const docIds = documents.map((d) => d.id);
  const [drivePackages, driveLogs] = driveOn
    ? await Promise.all([
        db.package.findMany({
          where: { orgId: user.orgId, driveFolderId: { not: null } },
          select: { id: true, locations: { select: { id: true } } },
        }),
        db.gDriveUpload.findMany({
          where: { kind: "dokumen", refKey: { in: docIds }, status: "sukses" },
          orderBy: { createdAt: "desc" },
          select: { refKey: true, createdAt: true },
          take: 2000,
        }),
      ])
    : [[], []];
  const drivePackageIds = new Set(drivePackages.map((p) => p.id));
  const driveLocationIds = new Set(drivePackages.flatMap((p) => p.locations.map((l) => l.id)));
  const driveReadyDocIds = new Set(
    documents
      .filter(
        (d) =>
          (d.packageId && drivePackageIds.has(d.packageId)) ||
          (d.locationId && driveLocationIds.has(d.locationId)),
      )
      .map((d) => d.id),
  );
  const driveUploadedAt = new Map<string, string>();
  for (const l of driveLogs) {
    if (!driveUploadedAt.has(l.refKey)) driveUploadedAt.set(l.refKey, formatTanggalWaktu(l.createdAt));
  }
  // Rute folder ikut milestone bila dokumen tertaut — sama dengan saat upload.
  const milestoneKeyById = new Map<string, string>();
  if (driveOn) {
    const withMs = documents.filter((d) => d.milestoneId).map((d) => d.milestoneId!);
    if (withMs.length > 0) {
      const ms = await db.adminMilestone.findMany({
        where: { id: { in: [...new Set(withMs)] } },
        select: { id: true, templateKey: true },
      });
      const keyByMilestone = new Map(ms.map((m) => [m.id, m.templateKey]));
      for (const d of documents) {
        const k = d.milestoneId ? keyByMilestone.get(d.milestoneId) : undefined;
        if (k) milestoneKeyById.set(d.id, k);
      }
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dokumen"
        description="Arsip terhubung ke paket, kontrak, lokasi, adendum, dan milestone. Duplikat dicegah via checksum."
        actions={
          can(user.role, "document.upload") ? (
            <Link
              href="/dokumen/upload"
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-800"
            >
              Unggah Dokumen
            </Link>
          ) : undefined
        }
      />

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Total dokumen (filter aktif)" value={String(documents.length)} />
        <KpiCard label="Kadaluarsa < 30 hari" value={String(expiring)} tone={expiring > 0 ? "warning" : "default"} />
      </section>

      <Card>
        <CardHeader title="Arsip" />
        <CardBody className="space-y-4">
          <form method="GET" className="grid gap-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
            <Combobox name="paket" defaultValue={sp.paket ?? ""} placeholder="Semua paket">
              <option value="">Semua paket</option>
              {packages.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Combobox>
            <Combobox name="lokasi" defaultValue={sp.lokasi ?? ""} placeholder="Semua lokasi">
              <option value="">Semua lokasi</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </Combobox>
            <Combobox name="fase" defaultValue={sp.fase ?? ""} placeholder="Semua fase">
              <option value="">Semua fase</option>
              {ALL_PHASES.map((p) => (
                <option key={p} value={p}>{PHASE_LABEL[p]}</option>
              ))}
            </Combobox>
            <Combobox name="tipe" defaultValue={sp.tipe ?? ""} placeholder="Semua tipe">
              <option value="">Semua tipe</option>
              {ALL_DOC_TYPES.map((t) => (
                <option key={t} value={t}>{TYPE_LABEL[t]}</option>
              ))}
            </Combobox>
            <input
              name="q"
              defaultValue={sp.q ?? ""}
              placeholder="Cari judul/nomor…"
              className="rounded-md border border-border px-2 py-1.5"
            />
            <button type="submit" className="rounded-md bg-primary px-3 py-1.5 font-medium text-white hover:bg-primary-800">
              Terapkan
            </button>
          </form>

          {documents.length === 0 ? (
            <EmptyState icon={FolderOpen} title="Tidak ada dokumen" description="Ubah filter atau unggah dokumen baru." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-ink-muted">
                    <th className="py-2 pr-3">Judul</th>
                    <th className="py-2 pr-3">Tipe</th>
                    <th className="py-2 pr-3">Fase</th>
                    <th className="py-2 pr-3">Nomor</th>
                    <th className="py-2 pr-3">Tanggal</th>
                    <th className="py-2 pr-3">Paket / Lokasi</th>
                    <th className="py-2 pr-3 text-right">Ukuran</th>
                    <th className="py-2 pr-3">Oleh</th>
                    <th className="py-2">Drive KKP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {documents.map((d) => (
                    <tr key={d.id}>
                      <td className="py-1.5 pr-3">
                        <a href={`/api/documents/${d.id}`} target="_blank" rel="noopener" className="font-medium text-primary hover:underline">
                          {d.title}
                        </a>
                        {d.supersedesId && <span className="ml-1 text-xs text-ink-muted">(versi baru)</span>}
                      </td>
                      <td className="py-1.5 pr-3"><StatusPill tone="neutral" label={TYPE_LABEL[d.type]} /></td>
                      <td className="py-1.5 pr-3">{PHASE_LABEL[d.phase]}</td>
                      <td className="py-1.5 pr-3">{d.docNumber ?? "—"}</td>
                      <td className="py-1.5 pr-3 tabular">{d.docDate ? formatTanggal(d.docDate) : "—"}</td>
                      <td className="py-1.5 pr-3 text-ink-muted">{d.locationName ?? d.packageName ?? "—"}</td>
                      <td className="py-1.5 pr-3 text-right tabular">{Math.max(1, Math.round(d.bytes / 1024))} KB</td>
                      <td className="py-1.5 pr-3 text-ink-muted">{d.uploadedByName}</td>
                      <td className="py-1.5">
                        {driveOn && (folderForMilestone(milestoneKeyById.get(d.id)) ?? folderForDocumentType(d.type)) ? (
                          <UploadDocumentToDrive
                            documentId={d.id}
                            hasDrive={driveReadyDocIds.has(d.id)}
                            uploadedAt={driveUploadedAt.get(d.id) ?? null}
                          />
                        ) : (
                          <span className="text-[12px] text-ink-faint">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
