import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, ButtonLink, Card, CardBody, CardHeader, PageHeader, StatusPill } from "@/components/ui";
import { hasLocationAccess, requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { documentDisplayName } from "@/lib/document-label";
import { formatTanggal, formatTanggalWaktu } from "@/lib/format";
import {
  EVIDENCE_VERIF_STATUS_LABEL,
  EVIDENCE_VERIF_STATUS_TONE,
  FINDING_STATUS_LABEL,
  FINDING_STATUS_TONE,
  INSPECTION_STATUS_LABEL,
  INSPECTION_STATUS_TONE,
  ISSUE_SEVERITY_LABEL,
  ISSUE_SEVERITY_TONE,
} from "@/lib/lifecycle";
import { isR2Configured, r2PresignGet } from "@/lib/r2";
import { AksiInspeksi, FormBuktiInspeksi } from "./aksi-inspeksi";

export const metadata: Metadata = { title: "Detail Inspeksi" };
export const dynamic = "force-dynamic";

export default async function DetailInspeksiPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  requireCapabilityPage(user.role, "finding.view");
  const { id } = await params;

  const insp = await db.inspection.findUnique({
    where: { id },
    include: {
      location: { select: { id: true, name: true, slug: true } },
      findings: { orderBy: { createdAt: "asc" }, select: { id: true, title: true, status: true, severity: true } },
      evidences: {
        orderBy: { createdAt: "asc" },
        include: {
          photo: { select: { id: true, thumbnailKey: true, r2Key: true, stampPhotoId: true } },
          document: { select: { id: true, type: true, title: true, fileName: true, docNumber: true, docDate: true, locationId: true, packageId: true, uploadedAt: true } },
        },
      },
    },
  });
  if (!insp) notFound();
  if (!(await hasLocationAccess(user, insp.locationId))) notFound();

  const inspector = await db.user.findUnique({ where: { id: insp.inspectorId }, select: { fullName: true } });
  const bolehKelola = can(user.role, "inspection.manage") && insp.inspectorId === user.id && insp.status === "draft";
  const bolehTemuan = can(user.role, "finding.create");

  const thumbs = new Map<string, string>();
  if (isR2Configured()) {
    await Promise.all(
      insp.evidences
        .filter((e) => e.photo)
        .map(async (e) => {
          try {
            thumbs.set(e.id, await r2PresignGet(e.photo!.thumbnailKey ?? e.photo!.r2Key));
          } catch {
            // Tanpa pratinjau — baris tetap tampil.
          }
        }),
    );
  }

  const fotoLokasi = await db.photo.findMany({
    where: { locationId: insp.locationId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, stampPhotoId: true, createdAt: true },
  });

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={[{ label: "Verifikasi", href: "/verifikasi?bagian=inspeksi" }, { label: insp.title }]}
        title={insp.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill tone={INSPECTION_STATUS_TONE[insp.status]} label={INSPECTION_STATUS_LABEL[insp.status]} />
            <span className="text-sm text-ink-muted">
              {insp.location.name} · {formatTanggal(insp.inspectionDate)} · pemeriksa {inspector?.fullName ?? "(tidak dikenal)"}
            </span>
          </span>
        }
        actions={
          bolehTemuan && insp.status === "draft" ? (
            <ButtonLink href={`/temuan/baru?inspeksi=${insp.id}`} variant="secondary">
              Angkat temuan
            </ButtonLink>
          ) : undefined
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Catatan pemeriksaan" />
          <CardBody className="space-y-3 text-sm">
            {insp.notes ? <p className="whitespace-pre-wrap">{insp.notes}</p> : <p className="text-ink-muted">Tanpa catatan.</p>}
            {insp.recommendation ? (
              <div>
                <div className="font-medium text-ink">Rekomendasi</div>
                <p className="whitespace-pre-wrap">{insp.recommendation}</p>
              </div>
            ) : null}
            {insp.finalizedAt ? (
              <p className="text-xs text-ink-muted">Difinalkan {formatTanggalWaktu(insp.finalizedAt)}.</p>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Aksi" />
          <CardBody>
            {bolehKelola ? (
              <AksiInspeksi
                inspectionId={insp.id}
                title={insp.title}
                notes={insp.notes}
                recommendation={insp.recommendation}
                dateKey={insp.inspectionDate.toISOString().slice(0, 10)}
              />
            ) : (
              <p className="text-sm text-ink-muted">
                {insp.status === "final"
                  ? "Inspeksi sudah final."
                  : "Hanya pemeriksanya sendiri yang bisa mengubah draft ini."}
              </p>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title={`Temuan dari inspeksi ini (${insp.findings.length})`} />
        <CardBody>
          {insp.findings.length === 0 ? (
            <p className="text-sm text-ink-muted">Belum ada temuan yang diangkat dari inspeksi ini.</p>
          ) : (
            <ul className="divide-y divide-border">
              {insp.findings.map((f) => (
                <li key={f.id}>
                  <Link href={`/temuan/${f.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2 hover:bg-surface-muted">
                    <span className="font-medium text-ink">{f.title}</span>
                    <span className="flex items-center gap-2">
                      <Badge tone={ISSUE_SEVERITY_TONE[f.severity]} label={ISSUE_SEVERITY_LABEL[f.severity]} />
                      <StatusPill tone={FINDING_STATUS_TONE[f.status]} label={FINDING_STATUS_LABEL[f.status]} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={`Bukti (${insp.evidences.length})`} />
        <CardBody className="space-y-3">
          {insp.evidences.length === 0 ? (
            <p className="text-sm text-ink-muted">Belum ada bukti yang ditautkan.</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {insp.evidences.map((e) => {
                const thumb = thumbs.get(e.id);
                const label = e.photo ? `Foto ${e.photo.stampPhotoId ?? e.photo.id.slice(0, 8)}` : documentDisplayName(e.document!).name;
                return (
                  <li key={e.id} className="flex items-start gap-3 rounded-lg border border-border p-2">
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumb} alt={label} className="h-16 w-16 rounded object-cover" />
                    ) : (
                      <div className="flex h-16 w-16 items-center justify-center rounded bg-surface-muted text-xs text-ink-faint">{e.photo ? "foto" : "dok"}</div>
                    )}
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="truncate font-medium text-ink">{label}</div>
                      {e.caption ? <div className="text-xs text-ink-muted">{e.caption}</div> : null}
                      <StatusPill tone={EVIDENCE_VERIF_STATUS_TONE[e.verifStatus]} label={EVIDENCE_VERIF_STATUS_LABEL[e.verifStatus]} className="mt-1" />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {insp.status === "draft" && can(user.role, "inspection.manage") ? (
            <FormBuktiInspeksi
              inspectionId={insp.id}
              foto={fotoLokasi.map((p) => ({ value: p.id, label: `${p.stampPhotoId ?? p.id.slice(0, 8)} – ${formatTanggal(p.createdAt)}` }))}
            />
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
