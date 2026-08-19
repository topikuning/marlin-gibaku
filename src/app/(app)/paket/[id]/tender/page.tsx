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
import { getPackageWorkspace, listVendors } from "@/lib/package/queries";
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
    // Milestone INDUK (pemilihan/penunjukan selalu scope paket → locationId null).
    where: { packageId: pkg.id, locationId: null, phase: { in: ["pemilihan", "penunjukan"] } },
    orderBy: [{ phase: "asc" }, { sortOrder: "asc" }],
    select: { id: true, name: true, phase: true, status: true, dueDate: true, note: true },
  });

  /*
   * Kelompok per fase, urut sesuai urutan proses (pemilihan → penunjukan).
   * `selesai` memakai definisi yang sama dengan papan kepatuhan: "tidak
   * berlaku" ikut dihitung tuntas, karena item yang memang tidak berlaku bukan
   * pekerjaan yang tertinggal.
   */
  const kelompokMilestone = (["pemilihan", "penunjukan"] as const)
    .map((phase) => {
      const items = milestones.filter((m) => m.phase === phase);
      return {
        phase,
        label: PHASE_LABEL[phase] ?? phase,
        items,
        selesai: items.filter((m) => m.status === "selesai" || m.status === "tidak_berlaku").length,
      };
    })
    .filter((g) => g.items.length > 0);

  const praKontrak = !pkg.contract && ["prospek", "tender", "penetapan"].includes(pkg.stage);
  const canEdit = can(user.role, "package.edit");
  const vendorNames = canEdit && praKontrak ? (await listVendors()).map((v) => v.name) : [];
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
                ? "Identitas paket, HPS, dan kandidat vendor – bisa diubah sampai berkontrak."
                : "Paket sudah berkontrak – identitas tender dikunci dan tinggal jadi rekam proses."
            }
            /* Lencana ini menjawab pertanyaan yang timbul saat form-nya tidak
               ada: "kenapa saya tidak bisa mengubah ini?" – terkunci karena
               tahapnya, bukan karena hak akses. */
            action={
              praKontrak && canEdit ? null : <StatusPill tone="neutral" label="Read-only" />
            }
          />
          <CardBody>
            {praKontrak && canEdit ? (
              <TenderForm
                packageId={pkg.id}
                vendorNames={vendorNames}
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
                  <dd className="font-medium text-ink">{pkg.packageNumber ?? "–"}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Provinsi</dt>
                  <dd className="font-medium text-ink">{pkg.province ?? "–"}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Kandidat vendor</dt>
                  <dd className="font-medium text-ink">{pkg.candidateVendorName ?? "–"}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Instansi pemilik</dt>
                  <dd className="font-medium text-ink">{pkg.ownerAgency}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-ink-muted">Catatan</dt>
                  <dd className="text-ink">{pkg.note ?? "–"}</dd>
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
          subtitle="Milestone administrasi PBJ (read-only – kelola di modul Administrasi)"
        />
        <CardBody>
          {milestones.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="Belum ada milestone administrasi"
              description="Milestone fase pemilihan/penunjukan akan muncul setelah template administrasi paket dibuat."
            />
          ) : (
            /*
              Dikelompokkan per fase, dengan hitungan "n/m selesai" di tiap
              kepala kelompok. Daftar rata sebelumnya menuntut orang menghitung
              sendiri lencana hijau untuk menjawab satu-satunya pertanyaan yang
              biasanya diajukan: fase mana yang belum tuntas.
            */
            <div className="divide-y divide-border">
              {kelompokMilestone.map((g) => (
                <section key={g.phase} className="py-2.5 first:pt-0 last:pb-0">
                  <header className="flex items-baseline justify-between gap-2">
                    <h3 className="text-[13px] font-semibold text-ink">{g.label}</h3>
                    <span className="tabular text-[12px] text-ink-muted">
                      {g.selesai}/{g.items.length} selesai
                    </span>
                  </header>
                  <ul className="mt-1.5 space-y-1.5">
                    {g.items.map((m) => (
                      <li
                        key={m.id}
                        className="flex flex-wrap items-start justify-between gap-2 text-sm"
                      >
                        <div className="min-w-[10rem] flex-1">
                          <p className="text-ink">{m.name}</p>
                          {m.dueDate || m.note ? (
                            <p className="text-xs text-ink-muted">
                              {[
                                m.dueDate ? `jatuh tempo ${formatTanggal(m.dueDate)}` : null,
                                m.note,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          ) : null}
                        </div>
                        <StatusPill
                          tone={MILESTONE_STATUS_TONE[m.status]}
                          label={MILESTONE_STATUS_LABEL[m.status]}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
