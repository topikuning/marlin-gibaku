import Link from "next/link";
import { notFound } from "next/navigation";
import { FolderOpen } from "lucide-react";
import { Card, CardBody, CardHeader, CollapsibleCard, EmptyState, ProgressBar, StatusPill } from "@/components/ui";
import { requireUser, requireLocationAccess } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { ensureMilestones } from "@/lib/milestones/actions";
import { milestoneBoard, MILESTONE_STATUS_LABEL, MILESTONE_STATUS_TONE } from "@/lib/milestones/queries";
import { listDocuments, PHASE_LABEL, TYPE_LABEL } from "@/lib/documents";
import { formatTanggal } from "@/lib/format";
import { MilestonePanel, QuickUploadForm } from "./kepatuhan-client";

export const dynamic = "force-dynamic";

/** Tab "Dokumen & Kepatuhan": papan milestone KKP per fase + arsip dokumen lokasi. */
export default async function DokumenKepatuhanPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireUser();
  const location = await db.location.findUnique({
    where: { slug },
    select: { id: true, name: true, packageId: true },
  });
  if (!location) notFound();
  await requireLocationAccess(user, location.id);

  await ensureMilestones(location.packageId, location.id);
  const [board, indukBoard, documents, picOptions] = await Promise.all([
    milestoneBoard({ locationId: location.id }),
    milestoneBoard({ packageId: location.packageId }),
    listDocuments({ orgId: user.orgId, locationId: location.id, scopedLocationIds: null }),
    db.user.findMany({
      where: {
        isActive: true,
        OR: [
          { assignments: { some: { locationId: location.id, unassignedAt: null } } },
          { role: { in: ["project_manager", "program_director"] } },
        ],
      },
      select: { id: true, fullName: true },
      orderBy: { fullName: "asc" },
    }),
  ]);

  const canManage = can(user.role, "compliance.manage");
  const canVerify = can(user.role, "document.verify");
  const canUpload = can(user.role, "document.upload");

  return (
    <div className="space-y-6">
      <CollapsibleCard
        title="Administrasi induk (paket)"
        subtitle={`${indukBoard.done}/${indukBoard.total} selesai — SPPBJ, kontrak, jaminan, SPMK, termin, PHO/FHO. Dikelola di paket; status ikut induk.`}
        defaultOpen={false}
      >
        <div className="space-y-4">
          <ProgressBar value={indukBoard.completenessPct} tone={indukBoard.late > 0 ? "warning" : "success"} />
          {indukBoard.phases.map((phase) => (
            <section key={phase.phase}>
              <h3 className="mb-1.5 flex items-center justify-between text-sm font-semibold text-ink">
                {phase.label}
                <span className="text-xs font-normal text-ink-muted">{phase.done}/{phase.total}</span>
              </h3>
              <ul className="divide-y divide-border rounded-md border border-border">
                {phase.items.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-sm">
                    <span className="min-w-0 text-ink">{m.name}</span>
                    <StatusPill
                      tone={m.isLate ? "danger" : MILESTONE_STATUS_TONE[m.status]}
                      label={m.isLate ? "Terlambat" : MILESTONE_STATUS_LABEL[m.status]}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <Link
            href={`/paket/${location.packageId}/dokumen`}
            className="inline-block text-[13px] font-medium text-primary hover:underline"
          >
            Kelola administrasi induk di paket →
          </Link>
        </div>
      </CollapsibleCard>

      <Card>
        <CardHeader
          title="Kepatuhan lokasi — MC-0 & serah terima lokasi"
          subtitle={`${board.done}/${board.total} selesai · ${board.late} terlambat`}
        />
        <CardBody className="space-y-5">
          <ProgressBar value={board.completenessPct} tone={board.late > 0 ? "warning" : "success"} />
          {board.phases.map((phase) => (
            <section key={phase.phase}>
              <h3 className="mb-2 flex items-center justify-between text-sm font-semibold text-ink">
                {phase.label}
                <span className="text-xs font-normal text-ink-muted">
                  {phase.done}/{phase.total}
                </span>
              </h3>
              <MilestonePanel
                slug={slug}
                items={phase.items.map((m) => ({
                  id: m.id,
                  name: m.name,
                  status: m.status,
                  statusLabel: m.isLate ? "Terlambat" : MILESTONE_STATUS_LABEL[m.status],
                  statusTone: m.isLate ? ("danger" as const) : MILESTONE_STATUS_TONE[m.status],
                  requiresVerification: m.requiresVerification,
                  verified: m.verifiedById !== null,
                  picUserId: m.picUserId,
                  picName: m.picName,
                  dueDate: m.dueDate ? m.dueDate.toISOString().slice(0, 10) : null,
                  note: m.note,
                  documents: m.documents.map((d) => ({ id: d.id, title: d.title })),
                }))}
                picOptions={picOptions}
                canManage={canManage}
                canVerify={canVerify}
              />
            </section>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Dokumen lokasi" subtitle={`${documents.length} dokumen`} />
        <CardBody className="space-y-4">
          {canUpload && (
            <QuickUploadForm
              locationId={location.id}
              packageId={location.packageId}
              slug={slug}
              milestones={board.phases.flatMap((p) => p.items.map((m) => ({ id: m.id, name: `${p.label} — ${m.name}` })))}
            />
          )}
          {documents.length === 0 ? (
            <EmptyState icon={FolderOpen} title="Belum ada dokumen" description="Unggah bukti administrasi lewat form di atas." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-ink-muted">
                    <th className="py-2 pr-3">Judul</th>
                    <th className="py-2 pr-3">Fase</th>
                    <th className="py-2 pr-3">Tipe</th>
                    <th className="py-2 pr-3">Tanggal</th>
                    <th className="py-2">Oleh</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {documents.map((d) => (
                    <tr key={d.id}>
                      <td className="py-1.5 pr-3">
                        <a href={`/api/documents/${d.id}`} className="font-medium text-primary hover:underline">
                          {d.title}
                        </a>
                      </td>
                      <td className="py-1.5 pr-3">{PHASE_LABEL[d.phase]}</td>
                      <td className="py-1.5 pr-3">
                        <StatusPill tone="neutral" label={TYPE_LABEL[d.type]} />
                      </td>
                      <td className="py-1.5 pr-3 tabular">{d.docDate ? formatTanggal(d.docDate) : "—"}</td>
                      <td className="py-1.5 text-ink-muted">{d.uploadedByName}</td>
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
