import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardBody, CardHeader, KpiCard, StatusPill } from "@/components/ui";
import { cn } from "@/lib/cn";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { can } from "@/lib/authz";
import {
  PACKAGE_STAGE_LABEL,
  PACKAGE_STAGE_ORDER,
  PACKAGE_STAGE_TONE,
} from "@/lib/lifecycle";
import { formatPct, formatRupiahShort, formatTanggalWaktu } from "@/lib/format";
import { getLocationsProgress } from "@/lib/progress";
import {
  getPackageWorkspace,
  getStageHistory,
  runningContractValue,
} from "@/lib/package/queries";
import type { PackageStage } from "@/generated/prisma/enums";
import {
  AdvanceStageButton,
  StartPelaksanaanButton,
} from "./stage-actions";

export const metadata: Metadata = { title: "Ringkasan Paket" };
export const dynamic = "force-dynamic";

/** Stepper lifecycle horizontal — stage batal ditandai banner di layout. */
function StageStepper({ current }: { current: PackageStage }) {
  const currentIdx = PACKAGE_STAGE_ORDER.indexOf(current);
  return (
    <ol className="flex flex-wrap items-center gap-y-2">
      {PACKAGE_STAGE_ORDER.map((stage, i) => {
        const done = currentIdx >= 0 && i < currentIdx;
        const active = i === currentIdx;
        return (
          <li key={stage} className="flex items-center">
            {i > 0 ? (
              <span
                aria-hidden
                className={cn("mx-2 h-px w-5 sm:w-8", done || active ? "bg-primary" : "bg-border")}
              />
            ) : null}
            <span
              className={cn(
                "flex items-center gap-1.5 text-[13px] whitespace-nowrap",
                active ? "font-semibold text-primary" : done ? "text-ink" : "text-ink-faint",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "inline-flex size-5 items-center justify-center rounded-full border text-[11px] tabular",
                  active
                    ? "border-primary bg-primary text-white"
                    : done
                      ? "border-primary text-primary"
                      : "border-border text-ink-faint",
                )}
              >
                {i + 1}
              </span>
              {PACKAGE_STAGE_LABEL[stage]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default async function RingkasanPaketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  requireCapabilityPage(user.role, "package.view");
  const { id } = await params;

  const pkg = await getPackageWorkspace(id);
  if (!pkg) notFound();

  const [progressMap, history] = await Promise.all([
    getLocationsProgress(pkg.locations.map((l) => l.id)),
    getStageHistory(pkg.id),
  ]);

  // Progress agregat: rata-rata tertimbang grandTotal RAB aktif.
  let totalRab = 0n;
  let weighted = 0;
  for (const p of progressMap.values()) {
    totalRab += p.grandTotal;
    weighted += p.realizedPct * Number(p.grandTotal);
  }
  const aggregatePct = Number(totalRab) > 0 ? weighted / Number(totalRab) : 0;

  const running = pkg.contract
    ? runningContractValue(pkg.contract.contractValue, pkg.contract.amendments)
    : null;

  const canProspect = can(user.role, "prospect.manage");
  const canContract = can(user.role, "contract.manage");

  const nextAction = (() => {
    switch (pkg.stage) {
      case "prospek":
        return {
          hint: "Prospek aktif — naikkan ke Tender saat proses pemilihan dimulai.",
          action: canProspect ? (
            <AdvanceStageButton packageId={pkg.id} toStage="tender" label="Naikkan ke Tender" />
          ) : null,
        };
      case "tender":
        return {
          hint: "Sedang tender — lengkapi administrasi pemilihan di tab Tender, lalu naikkan ke Penetapan saat pemenang ditetapkan.",
          action: canProspect ? (
            <AdvanceStageButton
              packageId={pkg.id}
              toStage="penetapan"
              label="Naikkan ke Penetapan"
            />
          ) : null,
        };
      case "penetapan":
        return {
          hint: "Pemenang ditetapkan — input data kontrak untuk konversi ke tahap Kontrak.",
          action: canContract ? (
            <Link
              href={`/paket/${pkg.id}/kontrak`}
              className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-white hover:bg-primary-800"
            >
              Input Kontrak
            </Link>
          ) : null,
        };
      case "kontrak":
        return {
          hint: "Kontrak tercatat — mulai pelaksanaan untuk mengaktifkan status Berjalan di semua lokasi.",
          action: canContract ? <StartPelaksanaanButton packageId={pkg.id} /> : null,
        };
      case "pelaksanaan":
        return {
          hint: "Pelaksanaan berjalan — pantau progress lokasi. Tandai Serah Terima saat pekerjaan fisik selesai.",
          action: canProspect ? (
            <AdvanceStageButton
              packageId={pkg.id}
              toStage="serah_terima"
              label="Tandai Serah Terima"
              variant="secondary"
            />
          ) : null,
        };
      case "serah_terima":
        return {
          hint: "Serah terima berlangsung — tandai Selesai setelah FHO/administrasi tuntas.",
          action: canProspect ? (
            <AdvanceStageButton
              packageId={pkg.id}
              toStage="selesai"
              label="Tandai Selesai"
              variant="secondary"
            />
          ) : null,
        };
      case "selesai":
        return { hint: "Paket selesai.", action: null };
      case "batal":
        return { hint: `Paket dibatalkan. ${pkg.cancelReason ?? ""}`.trim(), action: null };
    }
  })();

  return (
    <div className="space-y-6">
      <Card>
        <CardBody>
          <StageStepper current={pkg.stage} />
        </CardBody>
      </Card>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Nilai HPS" value={formatRupiahShort(pkg.hpsValue)} />
        <KpiCard
          label="Nilai kontrak berjalan"
          value={running !== null ? formatRupiahShort(running) : "—"}
          sub={
            pkg.contract
              ? `${pkg.contract.amendments.length} adendum`
              : "Belum berkontrak"
          }
        />
        <KpiCard
          label="Jumlah lokasi"
          value={pkg.locations.length}
          href={`/paket/${pkg.id}/lokasi`}
          sub={`${pkg.locations.filter((l) => l.isActive).length} aktif`}
        />
        <KpiCard
          label="Progress agregat"
          value={formatPct(aggregatePct)}
          sub="tertimbang RAB aktif"
        />
      </section>

      <Card>
        <CardHeader title="Langkah berikutnya" />
        <CardBody className="space-y-3">
          <p className="text-sm text-ink-muted">{nextAction.hint}</p>
          {nextAction.action}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Aktivitas terakhir"
          subtitle="Transisi stage paket"
          action={
            <Link
              href={`/paket/${pkg.id}/aktivitas`}
              className="text-[13px] font-medium text-primary hover:underline"
            >
              Lihat semua
            </Link>
          }
        />
        <CardBody>
          {history.length === 0 ? (
            <p className="text-sm text-ink-muted">Belum ada aktivitas.</p>
          ) : (
            <ul className="divide-y divide-border">
              {history.slice(0, 5).map((h) => (
                <li key={h.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <StatusPill
                    tone={PACKAGE_STAGE_TONE[h.toStage]}
                    label={PACKAGE_STAGE_LABEL[h.toStage]}
                  />
                  <span className="text-ink">
                    {h.fromStage ? `dari ${PACKAGE_STAGE_LABEL[h.fromStage]}` : "stage awal"}
                  </span>
                  {h.note ? <span className="text-ink-muted">— {h.note}</span> : null}
                  <span className="ml-auto text-xs text-ink-muted">
                    {h.changedByName} · {formatTanggalWaktu(h.changedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
