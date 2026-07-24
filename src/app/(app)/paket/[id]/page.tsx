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
  revertTargetFor,
} from "@/lib/lifecycle";
import { formatPct, formatRupiah, formatRupiahShort, formatTanggalWaktu } from "@/lib/format";
import { getLocationsProgress } from "@/lib/progress";
import {
  getPackageWorkspace,
  getStageHistory,
  runningContractValue,
} from "@/lib/package/queries";
import type { PackageStage } from "@/generated/prisma/enums";
import {
  AdvanceStageButton,
  RevertStageButton,
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

  // Rekonsiliasi: nilai kontrak (INPUT, incl PPN) vs Σ RAB semua lokasi (pra-PPN).
  // Kontrak incl-PPN, RAB pra-PPN (konvensi uang) → banding pada basis pra-PPN.
  const recon = (() => {
    if (!pkg.contract || running == null) return null;
    const ppn = Number(pkg.contract.ppnPercent);
    const runningNum = Number(running);
    const basePraPpn = ppn > 0 ? runningNum / (1 + ppn / 100) : runningNum;
    const rabSum = Number(totalRab);
    const selisih = basePraPpn - rabSum;
    const rows = pkg.locations
      .map((l) => ({ name: l.name, rab: Number(progressMap.get(l.id)?.grandTotal ?? 0n) }))
      .sort((a, b) => b.rab - a.rab);
    const withRab = rows.filter((r) => r.rab > 0).length;
    const alokasiPct = basePraPpn > 0 ? (rabSum / basePraPpn) * 100 : 0;
    const semuaBerRab = withRab === rows.length && rows.length > 0;
    const cocok = semuaBerRab && Math.abs(selisih) <= basePraPpn * 0.01;
    return { ppn, running: runningNum, basePraPpn, rabSum, selisih, rows, withRab, alokasiPct, semuaBerRab, cocok };
  })();

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
          hint: "Pelaksanaan berjalan — pantau progress lokasi. Tandai Serah Terima saat pekerjaan fisik selesai (100%).",
          action: canProspect ? (
            <AdvanceStageButton
              packageId={pkg.id}
              toStage="serah_terima"
              label="Tandai Serah Terima"
              variant="secondary"
              warn={
                aggregatePct < 99.95
                  ? `Progress agregat baru ${formatPct(aggregatePct)}. Serah terima hanya diizinkan saat 100% — tindakan ini akan ditolak sampai pekerjaan tuntas.`
                  : undefined
              }
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

  // Tahap sebelumnya yang aman untuk dimundurkan (koreksi salah-klik), bila ada.
  const revertTo = revertTargetFor(pkg.stage);

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

      {recon ? (
        <Card>
          <CardHeader
            title="Rekonsiliasi: nilai kontrak (input) vs RAB semua lokasi"
            subtitle="“Nilai kontrak berjalan” di atas adalah INPUT kamu (nilai kontrak + adendum), termasuk PPN — bukan jumlah lokasi. Di sini dibandingkan dengan jumlah RAB semua lokasi (pra-PPN) untuk verifikasi alokasi."
          />
          <CardBody className="space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <div className="text-[12px] text-ink-muted">Kontrak berjalan (incl PPN {recon.ppn}%)</div>
                <div className="text-sm font-semibold text-ink tabular">{formatRupiah(running!)}</div>
                <div className="text-[11px] text-ink-faint">input kamu</div>
              </div>
              <div>
                <div className="text-[12px] text-ink-muted">Nilai dasar (pra-PPN)</div>
                <div className="text-sm font-semibold text-ink tabular">{formatRupiah(BigInt(Math.round(recon.basePraPpn)))}</div>
                <div className="text-[11px] text-ink-faint">kontrak ÷ (1+PPN)</div>
              </div>
              <div>
                <div className="text-[12px] text-ink-muted">Σ RAB semua lokasi</div>
                <div className="text-sm font-semibold text-ink tabular">{formatRupiah(BigInt(Math.round(recon.rabSum)))}</div>
                <div className="text-[11px] text-ink-faint">pra-PPN, RAB aktif</div>
              </div>
              <div>
                <div className="text-[12px] text-ink-muted">Selisih (dasar − RAB)</div>
                <div className="text-sm font-semibold tabular text-ink">{formatRupiah(BigInt(Math.round(recon.selisih)))}</div>
                <div className="text-[11px] text-ink-faint">idealnya ~0</div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <StatusPill
                tone={recon.cocok ? "success" : recon.semuaBerRab ? "warning" : "info"}
                label={
                  recon.cocok
                    ? "Teralokasi penuh (±1%)"
                    : recon.semuaBerRab
                      ? "Ada selisih — periksa nilai kontrak / RAB / PPN"
                      : "Belum semua lokasi ber-RAB — selisih wajar"
                }
              />
              <span className="text-[13px] text-ink-muted">
                {recon.withRab}/{recon.rows.length} lokasi ber-RAB · alokasi {formatPct(recon.alokasiPct)} dari nilai dasar
              </span>
            </div>

            <details>
              <summary className="cursor-pointer text-[13px] font-medium text-primary hover:underline">
                Rincian per lokasi
              </summary>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase text-ink-muted">
                      <th className="py-1.5 pr-3">Lokasi</th>
                      <th className="py-1.5 pr-3 text-right">RAB (pra-PPN)</th>
                      <th className="py-1.5 text-right">% thd nilai dasar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {recon.rows.map((r) => (
                      <tr key={r.name}>
                        <td className="py-1.5 pr-3">{r.name}</td>
                        <td className="tabular py-1.5 pr-3 text-right">
                          {r.rab > 0 ? formatRupiah(BigInt(Math.round(r.rab))) : <span className="text-ink-faint">belum ada RAB</span>}
                        </td>
                        <td className="tabular py-1.5 text-right text-ink-muted">
                          {recon.basePraPpn > 0 ? formatPct((r.rab / recon.basePraPpn) * 100) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>

            <p className="text-xs text-ink-muted">
              Kontrak dicatat termasuk PPN, RAB pra-PPN — perbandingan pada basis pra-PPN.
              Selisih besar biasanya karena belum semua lokasi impor RAB, atau nilai kontrak
              input belum sesuai total RAB (perbaiki via Koreksi Kontrak / revisi RAB).
            </p>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Langkah berikutnya" />
        <CardBody className="space-y-3">
          <p className="text-sm text-ink-muted">{nextAction.hint}</p>
          {nextAction.action}
          {canProspect && revertTo ? (
            <div className="border-t border-border pt-3">
              <p className="mb-2 text-xs text-ink-muted">
                Salah menaikkan tahap? Mundurkan untuk koreksi (tercatat di histori).
              </p>
              <RevertStageButton
                packageId={pkg.id}
                fromLabel={PACKAGE_STAGE_LABEL[pkg.stage]}
                toLabel={PACKAGE_STAGE_LABEL[revertTo]}
              />
            </div>
          ) : null}
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
