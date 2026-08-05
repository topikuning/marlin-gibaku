import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Banner, Card, CardBody, CardHeader, PageHeader, StatusPill } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { canViewDocument, PHASE_LABEL, TYPE_LABEL } from "@/lib/documents";
import { documentDisplayName } from "@/lib/document-label";
import { formatTanggal, formatTanggalWaktu, jakartaDateKey } from "@/lib/format";
import {
  DeleteDocumentForm,
  DocumentEditForm,
  RestoreDocumentForm,
  VoidDocumentForm,
  type ManageTarget,
} from "./manage-forms";

export const metadata: Metadata = { title: "Detail Dokumen" };
export const dynamic = "force-dynamic";

/** yyyy-mm-dd untuk <input type="date"> (kolom @db.Date, zona Jakarta). */
function dateInputValue(d: Date | null): string {
  return d ? jakartaDateKey(d) : "";
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border py-2 sm:flex-row sm:gap-3">
      <dt className="w-full text-xs uppercase text-ink-muted sm:w-52 sm:shrink-0">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

/**
 * Detail satu dokumen: metadata lengkap, asal berkas (unggahan / Drive KKP),
 * koreksi metadata, dan zona bahaya (batalkan / pulihkan / hapus permanen).
 * DECISIONS 183.
 */
export default async function DokumenDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const user = await requireUser();
  requireCapabilityPage(user.role, "document.view");

  const doc = await db.document.findUnique({
    where: { id },
    select: {
      id: true,
      orgId: true,
      title: true,
      type: true,
      phase: true,
      docNumber: true,
      docDate: true,
      expiryDate: true,
      description: true,
      fileName: true,
      mimeType: true,
      bytes: true,
      sha256: true,
      status: true,
      voidedAt: true,
      voidedById: true,
      voidReason: true,
      source: true,
      driveWebLink: true,
      drivePath: true,
      driveModifiedAt: true,
      supersedesId: true,
      uploadedById: true,
      uploadedAt: true,
      packageId: true,
      package: { select: { id: true, name: true } },
      location: { select: { id: true, name: true, slug: true } },
      milestone: { select: { id: true, name: true, status: true } },
    },
  });
  if (!doc) notFound();
  if (!(await canViewDocument(user, { orgId: doc.orgId, locationId: doc.location?.id ?? null, status: doc.status })))
    notFound();

  const people = await db.user.findMany({
    where: { id: { in: [doc.uploadedById, doc.voidedById].filter((v): v is string => Boolean(v)) } },
    select: { id: true, fullName: true },
  });
  const nameById = new Map(people.map((p) => [p.id, p.fullName]));

  const label = documentDisplayName({
    type: doc.type,
    title: doc.title,
    docNumber: doc.docNumber,
    docDate: doc.docDate,
    locationName: doc.location?.name ?? null,
    packageName: doc.package?.name ?? null,
  });

  const target: ManageTarget = {
    documentId: doc.id,
    locationSlug: doc.location?.slug ?? "",
    packageId: doc.packageId ?? "",
  };
  const dibatalkan = doc.status === "dibatalkan";
  const bolehEdit = can(user.role, "document.edit");
  const bolehVoid = can(user.role, "document.void");
  const bolehHapus = can(user.role, "document.delete");

  return (
    <div className="space-y-6">
      <PageHeader
        title={label.name}
        description={label.secondary ?? `Judul tersimpan: ${doc.title}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <a
              href={`/api/documents/${doc.id}`}
              target="_blank"
              rel="noopener"
              className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-surface-2"
            >
              Buka berkas
            </a>
            <Link
              href="/dokumen-laporan/dokumen"
              className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-surface-2"
            >
              Kembali ke arsip
            </Link>
          </div>
        }
      />

      {dibatalkan ? (
        <Banner
          tone="warning"
          title="Dokumen ini DIBATALKAN"
          description={`${doc.voidReason ?? "Tanpa alasan tercatat"} — dibatalkan ${
            doc.voidedAt ? formatTanggalWaktu(doc.voidedAt) : "—"
          } oleh ${doc.voidedById ? (nameById.get(doc.voidedById) ?? "—") : "—"}. Tidak muncul di daftar dokumen dan tidak dihitung sebagai bukti milestone.`}
        />
      ) : null}

      <Card>
        <CardHeader title="Data dokumen" />
        <CardBody>
          <dl>
            <Row label="Status">
              <StatusPill
                tone={dibatalkan ? "warning" : "success"}
                label={dibatalkan ? "Dibatalkan" : "Aktif"}
              />
            </Row>
            <Row label="Jenis">{TYPE_LABEL[doc.type]}</Row>
            <Row label="Fase">{PHASE_LABEL[doc.phase]}</Row>
            <Row label="Nomor">{doc.docNumber ?? "—"}</Row>
            <Row label="Tanggal dokumen">{doc.docDate ? formatTanggal(doc.docDate) : "—"}</Row>
            <Row label="Kadaluarsa">{doc.expiryDate ? formatTanggal(doc.expiryDate) : "—"}</Row>
            <Row label="Paket">
              {doc.package ? (
                <Link href={`/proyek/paket/${doc.package.id}`} className="text-primary hover:underline">
                  {doc.package.name}
                </Link>
              ) : (
                "—"
              )}
            </Row>
            <Row label="Lokasi">
              {doc.location ? (
                <Link href={`/proyek/lokasi/${doc.location.slug}`} className="text-primary hover:underline">
                  {doc.location.name}
                </Link>
              ) : (
                "—"
              )}
            </Row>
            <Row label="Milestone administrasi">
              {doc.milestone ? `${doc.milestone.name} (${doc.milestone.status})` : "—"}
            </Row>
            <Row label="Keterangan">{doc.description ?? "—"}</Row>
            <Row label="Berkas">
              {doc.fileName} · {Math.max(1, Math.round(doc.bytes / 1024))} KB · {doc.mimeType}
            </Row>
            <Row label="Asal berkas">
              {doc.source === "drive_kkp" ? (
                <span>
                  Impor dari Google Drive KKP
                  {doc.drivePath ? ` — ${doc.drivePath}` : ""}
                  {doc.driveModifiedAt ? ` (diubah di Drive ${formatTanggalWaktu(doc.driveModifiedAt)})` : ""}
                  {doc.driveWebLink ? (
                    <>
                      {" · "}
                      <a
                        href={doc.driveWebLink}
                        target="_blank"
                        rel="noopener"
                        className="text-primary hover:underline"
                      >
                        buka di Drive
                      </a>
                    </>
                  ) : null}
                </span>
              ) : (
                "Unggahan langsung di MARLIN"
              )}
            </Row>
            <Row label="Diunggah">
              {formatTanggalWaktu(doc.uploadedAt)} oleh {nameById.get(doc.uploadedById) ?? "—"}
            </Row>
            <Row label="Checksum (sha256)">
              <span className="break-all font-mono text-xs">{doc.sha256}</span>
            </Row>
            {doc.supersedesId ? (
              <Row label="Menggantikan">
                <Link href={`/dokumen-laporan/dokumen/${doc.supersedesId}`} className="text-primary hover:underline">
                  dokumen versi sebelumnya
                </Link>
              </Row>
            ) : null}
          </dl>
        </CardBody>
      </Card>

      {bolehEdit && !dibatalkan ? (
        <Card>
          <CardHeader
            title="Koreksi metadata"
            subtitle="Isi berkas tidak ditukar di sini. Berkas yang keliru: batalkan, lalu unggah yang benar."
          />
          <CardBody>
            <DocumentEditForm
              target={target}
              current={{
                title: doc.title,
                phase: doc.phase,
                type: doc.type,
                docNumber: doc.docNumber ?? "",
                docDate: dateInputValue(doc.docDate),
                expiryDate: dateInputValue(doc.expiryDate),
                description: doc.description ?? "",
              }}
            />
          </CardBody>
        </Card>
      ) : null}

      {bolehVoid || bolehHapus ? (
        <Card>
          <CardHeader
            title="Zona bahaya"
            subtitle={
              dibatalkan
                ? "Dokumen sudah dibatalkan — bisa dipulihkan, atau dihapus permanen oleh super admin."
                : "Membatalkan dokumen tidak menghapus file: ia hilang dari daftar, bisa dipulihkan."
            }
          />
          <CardBody className="space-y-6">
            {bolehVoid && !dibatalkan ? <VoidDocumentForm target={target} displayName={label.name} /> : null}
            {bolehVoid && dibatalkan ? <RestoreDocumentForm target={target} /> : null}
            {bolehHapus && dibatalkan ? (
              <div className="border-t border-border pt-4">
                <DeleteDocumentForm target={target} displayName={label.name} />
              </div>
            ) : null}
            {bolehHapus && !dibatalkan ? (
              <p className="text-xs text-ink-muted">
                Hapus permanen hanya tersedia setelah dokumen dibatalkan.
              </p>
            ) : null}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
