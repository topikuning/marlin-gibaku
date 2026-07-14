import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ClipboardList } from "lucide-react";
import {
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  StatusPill,
  type BadgeTone,
} from "@/components/ui";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { can } from "@/lib/authz";
import { canTransitionPackage } from "@/lib/lifecycle";
import { formatTanggal } from "@/lib/format";
import { getPackageWorkspace } from "@/lib/package/queries";
import type { MilestoneStatus } from "@/generated/prisma/enums";
import { AdvanceStageButton, CancelPackageForm } from "../stage-actions";
import { TenderForm } from "./tender-form";

export const metadata: Metadata = { title: "Tender & Administrasi" };
export const dynamic = "force-dynamic";

const MILESTONE_STATUS_LABEL: Record<MilestoneStatus, string> = {
  belum_dimulai: "Belum Dimulai",
  berjalan: "Berjalan",
  menunggu_pihak_lain: "Menunggu Pihak Lain",
  perlu_perbaikan: "Perlu Perbaikan",
  selesai: "Selesai",
  tidak_berlaku: "Tidak Berlaku",
};

const MILESTONE_STATUS_TONE: Record<MilestoneStatus, BadgeTone> = {
  belum_dimulai: "neutral",
  berjalan: "info",
  menunggu_pihak_lain: "warning",
  perlu_perbaikan: "warning",
  selesai: "success",
  tidak_berlaku: "neutral",
};

const PHASE_LABEL: Record<string, string> = {
  pemilihan: "Pemilihan",
  penunjukan: "Penunjukan",
};

export default async function TenderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  requireCapabilityPage(user.role, "package.view");
  const { id } = await params;

  const pkg = await getPackageWorkspace(id);
  if (!pkg) notFound();

  const milestones = await db.adminMilestone.findMany({
    where: { packageId: pkg.id, phase: { in: ["pemilihan", "penunjukan"] } },
    orderBy: [{ phase: "asc" }, { sortOrder: "asc" }],
    select: { id: true, name: true, phase: true, status: true, dueDate: true, note: true },
  });

  const praKontrak = !pkg.contract && ["prospek", "tender", "penetapan"].includes(pkg.stage);
  const canEdit = can(user.role, "package.edit");
  const canProspect = can(user.role, "prospect.manage");
  const cancellable = canTransitionPackage(pkg.stage, "batal");

  return (
    <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
      <div className="space-y-6">
        <Card>
          <CardHeader
            title="Data tender"
            subtitle={
              praKontrak
                ? "Identitas paket, HPS, dan kandidat vendor — bisa diubah sampai berkontrak."
                : "Paket sudah berkontrak — data terkunci."
            }
          />
          <CardBody>
            {praKontrak && canEdit ? (
              <TenderForm
                packageId={pkg.id}
                defaults={{
                  name: pkg.name,
                  packageNumber: pkg.packageNumber ?? "",
                  province: pkg.province ?? "",
                  hpsValue: pkg.hpsValue.toString(),
                  candidateVendorName: pkg.candidateVendorName ?? "",
                  note: pkg.note ?? "",
                }}
              />
            ) : (
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-ink-muted">Nomor paket</dt>
                  <dd className="font-medium text-ink">{pkg.packageNumber ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Provinsi</dt>
                  <dd className="font-medium text-ink">{pkg.province ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Kandidat vendor</dt>
                  <dd className="font-medium text-ink">{pkg.candidateVendorName ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Instansi pemilik</dt>
                  <dd className="font-medium text-ink">{pkg.ownerAgency}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-ink-muted">Catatan</dt>
                  <dd className="text-ink">{pkg.note ?? "—"}</dd>
                </div>
              </dl>
            )}
          </CardBody>
        </Card>

        {canProspect && (pkg.stage === "prospek" || pkg.stage === "tender" || cancellable) ? (
          <Card>
            <CardHeader title="Aksi tahap" />
            <CardBody className="space-y-4">
              {pkg.stage === "prospek" ? (
                <AdvanceStageButton packageId={pkg.id} toStage="tender" label="Naikkan ke Tender" />
              ) : null}
              {pkg.stage === "tender" ? (
                <AdvanceStageButton
                  packageId={pkg.id}
                  toStage="penetapan"
                  label="Naikkan ke Penetapan"
                />
              ) : null}
              {cancellable ? <CancelPackageForm packageId={pkg.id} /> : null}
            </CardBody>
          </Card>
        ) : null}
      </div>

      <Card className="self-start">
        <CardHeader
          title="Administrasi pemilihan & penunjukan"
          subtitle="Milestone administrasi PBJ (read-only — kelola di modul Administrasi)"
        />
        <CardBody>
          {milestones.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="Belum ada milestone administrasi"
              description="Milestone fase pemilihan/penunjukan akan muncul setelah template administrasi paket dibuat."
            />
          ) : (
            <ul className="divide-y divide-border">
              {milestones.map((m) => (
                <li key={m.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="text-ink">{m.name}</p>
                    <p className="text-xs text-ink-muted">
                      {PHASE_LABEL[m.phase] ?? m.phase}
                      {m.dueDate ? ` · jatuh tempo ${formatTanggal(m.dueDate)}` : ""}
                      {m.note ? ` · ${m.note}` : ""}
                    </p>
                  </div>
                  <StatusPill
                    tone={MILESTONE_STATUS_TONE[m.status]}
                    label={MILESTONE_STATUS_LABEL[m.status]}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
