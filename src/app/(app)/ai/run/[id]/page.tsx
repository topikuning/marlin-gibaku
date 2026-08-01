import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Banner, Card, CardBody, CardHeader, KpiCard } from "@/components/ui";
import { accessibleLocationIds, requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { scopeCoveredBy } from "@/lib/ai-hub/read-scope";
import { listSendableContacts } from "@/lib/contacts/queries";
import { AI_RUN_STATUS_LABEL, AI_RUN_STATUS_TONE } from "@/lib/lifecycle";
import { formatTanggalWaktu } from "@/lib/format";
import { READINESS_GRADE_LABEL } from "@/lib/ai-hub/readiness";
import { RISK_CATEGORY_LABEL } from "@/lib/ai-hub/risk";
import type { SourceRef, PulseRow, RiskItem, QualityFinding, PulseTotals } from "@/lib/ai-hub/types";
import type {
  AskOutput,
  PulseOutput,
  QualityOutput,
  ReportOutput,
  RiskOutput,
  VarianceOutput,
} from "@/lib/ai-hub/schemas";
import { ArtifactPanel } from "./artifact-panel";

export const metadata: Metadata = { title: "AI Intelligence — Detail Run" };
export const dynamic = "force-dynamic";

/** Template Report Studio yang paling cocok per jenis analisis (DECISIONS 194). */
const LAPORAN_TEMPLATE_FOR_KIND: Partial<Record<string, string>> = {
  pulse: "exec_portfolio",
  deviasi: "exec_portfolio",
  risiko: "kendala_recovery",
  kualitas_data: "exec_portfolio",
  tanya: "wa_update",
};

const KIND_LABEL: Record<string, string> = {
  pulse: "Portfolio Pulse",
  deviasi: "Explain Variance",
  risiko: "Risk Intelligence",
  kualitas_data: "Audit Kualitas Data",
  laporan: "Report Studio",
  tanya: "Ask MARLIN",
};

type NarrativeReportView = {
  id: string;
  date: string;
  status: string;
  weather: string | null;
  notes: string | null;
  photoCount: number;
  items: { itemName: string; unit: string | null; volumeDone: number; notes: string | null }[];
};
type NarrativeActivityView = {
  id: string;
  date: string;
  kindLabel: string;
  title: string;
  notes: string | null;
  kendala: string | null;
  solusi: string | null;
  status: string;
  photoCount: number;
};
type LocationNarrativeView = {
  locationId: string;
  locationName: string;
  slug: string;
  reports: NarrativeReportView[];
  activities: NarrativeActivityView[];
};

type Official = {
  totals: PulseTotals;
  rows: PulseRow[];
  risks: RiskItem[];
  quality: QualityFinding[];
  narrative: { locations: LocationNarrativeView[] } | null;
  periodStart: string;
  periodEnd: string;
  dataAsOf: string;
};

const SEV_TONE = { kritis: "danger", tinggi: "warning", sedang: "info" } as const;
const STATUS_TONE = { normal: "success", perhatian: "warning", kritis: "danger", data_kurang: "neutral" } as const;

/** Detail run: output AI + snapshot angka resmi + sumber + artefak + jejak. */
export default async function AiRunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  requireCapabilityPage(user.role, "ai.view");
  const { id } = await params;

  const run = await db.aiRun.findUnique({
    where: { id },
    select: {
      id: true,
      runKind: true,
      status: true,
      scopeIds: true,
      periodStart: true,
      periodEnd: true,
      userId: true,
      provider: true,
      model: true,
      promptVersion: true,
      readinessScore: true,
      confidence: true,
      sourcesJson: true,
      outputJson: true,
      limitations: true,
      inputTokens: true,
      outputTokens: true,
      latencyMs: true,
      estimatedCostUsd: true,
      errorCode: true,
      errorMessage: true,
      createdAt: true,
      finishedAt: true,
      artifacts: {
        orderBy: { version: "desc" },
        select: { id: true, kind: true, status: true, title: true, version: true, templateKey: true, structuredContent: true, renderedText: true, distributions: true, frozenAt: true },
      },
    },
  });
  if (!run) notFound();
  // Jalur BACA wajib se-ketat jalur generate: run di luar scope lokasi user
  // tidak boleh terbaca (audit 2026-07-27, B9).
  if (!scopeCoveredBy(await accessibleLocationIds(user), run.scopeIds)) notFound();


  const [creator, contacts, auditTrail] = await Promise.all([
    db.user.findUnique({ where: { id: run.userId }, select: { fullName: true } }),
    listSendableContacts(user.id),
    db.auditLog.findMany({
      where: { resourceType: { in: ["ai_run", "ai_artifact"] }, resourceId: { in: [run.id, ...run.artifacts.map((a) => a.id)] } },
      orderBy: { createdAt: "asc" },
      select: { id: true, action: true, createdAt: true, userId: true },
    }),
  ]);

  const out = (run.outputJson ?? {}) as Record<string, unknown>;
  const official = (out.official ?? null) as Official | null;
  const sources = ((run.sourcesJson ?? []) as SourceRef[]) ?? [];
  const limitations = ((run.limitations ?? []) as string[]) ?? [];

  const nameOf = new Map(
    (
      await db.user.findMany({
        where: { id: { in: [...new Set(auditTrail.map((a) => a.userId).filter((x): x is string => !!x))] } },
        select: { id: true, fullName: true },
      })
    ).map((u) => [u.id, u.fullName]),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={AI_RUN_STATUS_TONE[run.status]} label={AI_RUN_STATUS_LABEL[run.status]} />
        <h2 className="text-base font-semibold text-ink">{KIND_LABEL[run.runKind] ?? run.runKind}</h2>
        <span className="text-sm text-ink-muted">
          {(run.scopeIds as string[]).length} lokasi · {run.periodStart.toISOString().slice(0, 10)} –{" "}
          {run.periodEnd.toISOString().slice(0, 10)} · oleh {creator?.fullName ?? "—"} ·{" "}
          {formatTanggalWaktu(run.createdAt)}
        </span>
        {/* Doktrin DECISIONS 193: analisis tidak boleh berakhir di layar —
            jembatan ke Report Studio dgn scope run terbawa. Angka dihitung
            ulang dari calc layer saat generate, bukan membekukan run ini. */}
        {run.status === "siap" && LAPORAN_TEMPLATE_FOR_KIND[run.runKind] ? (
          <Link
            href={`/ai/reports?template=${LAPORAN_TEMPLATE_FOR_KIND[run.runKind]}&scopeIds=${(run.scopeIds as string[]).join(",")}`}
            className="ml-auto text-[13px] font-medium text-primary hover:underline"
          >
            Jadikan laporan →
          </Link>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <KpiCard label="Readiness rata-rata" value={run.readinessScore != null ? `${run.readinessScore}%` : "—"} />
        <KpiCard label="Confidence AI" value={run.confidence != null ? `${run.confidence}%` : "—"} />
        <KpiCard label="Provider" value={run.provider ? `${run.provider}` : "—"} sub={run.model ?? undefined} />
        <KpiCard
          label="Token in/out"
          value={run.inputTokens != null ? `${run.inputTokens}/${run.outputTokens ?? 0}` : "—"}
          sub={run.latencyMs != null ? `${(run.latencyMs / 1000).toFixed(1)}s` : undefined}
        />
        <KpiCard
          label="± Biaya"
          value={run.estimatedCostUsd != null ? `$${Number(run.estimatedCostUsd).toFixed(4)}` : "—"}
          sub="estimasi (pricing admin)"
        />
      </div>

      {run.status === "gagal" ? (
        <Banner
          tone="error"
          title={`Analisis AI gagal (${run.errorCode})`}
          description={`${run.errorMessage ?? ""} — data deterministik di bawah tetap berlaku.`}
        />
      ) : null}
      {limitations.length > 0 ? (
        <Banner
          tone="warning"
          title="Keterbatasan analisis"
          description={
            <ul className="list-disc pl-4">
              {limitations.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          }
        />
      ) : null}

      {/* ── Output AI per jenis ── */}
      {run.status === "siap" ? <RunOutput kind={run.runKind} out={out} official={official} /> : null}

      {/* ── Artefak (laporan/saran) ── */}
      {run.artifacts.length > 0 ? (
        <ArtifactPanel
          artifacts={run.artifacts.map((a) => ({
            id: a.id,
            kind: a.kind,
            status: a.status,
            title: a.title,
            version: a.version,
            templateKey: a.templateKey,
            frozen: !!a.frozenAt,
            // Artefak "saran" menyimpan isinya di `detail`, bukan di
            // report.executiveSummary — dulu dipetakan ke "" sehingga kartunya
            // kosong melompong (DECISIONS 196).
            executiveSummary:
              a.kind === "laporan"
                ? ((a.structuredContent as { report?: ReportOutput })?.report?.executiveSummary ?? "")
                : ((a.structuredContent as { detail?: string })?.detail ?? ""),
            waSummary: a.kind === "laporan" ? ((a.structuredContent as { report?: ReportOutput })?.report?.waSummary ?? "") : "",
            renderedText: a.renderedText,
            distributions: (a.distributions as { at: string; target: string }[] | null) ?? [],
          }))}
          contacts={contacts}
          canReview={can(user.role, "ai.report_review")}
          canApprove={can(user.role, "ai.report_approve")}
          canSend={can(user.role, "ai.report_send")}
        />
      ) : null}

      {/* ── Snapshot angka resmi ── */}
      {official ? (
        <Card>
          <CardHeader title="Angka resmi MARLIN (snapshot run)" subtitle={`Data per ${official.dataAsOf.slice(0, 16).replace("T", " ")} UTC — sumber kebenaran KPI, bukan narasi AI.`} />
          <CardBody>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-ink-muted uppercase">
                    <th className="px-3 py-2">Lokasi</th>
                    <th className="px-3 py-2 text-right">Rencana</th>
                    <th className="px-3 py-2 text-right">Realisasi</th>
                    <th className="px-3 py-2 text-right">Deviasi</th>
                    <th className="px-3 py-2 text-right">Lap. final</th>
                    <th className="px-3 py-2">Readiness</th>
                    <th className="px-3 py-2 text-right">Kendala</th>
                  </tr>
                </thead>
                <tbody>
                  {official.rows.map((r) => (
                    <tr key={r.locationId} className="border-b border-border-muted">
                      <td className="px-3 py-1.5">
                        <Link href={`/lokasi/${r.slug}/progress`} className="hover:underline">
                          {r.name}
                        </Link>
                      </td>
                      <td className="tabular px-3 py-1.5 text-right">{r.hasActiveBaseline ? `${r.planPct.toFixed(1)}%` : "—"}</td>
                      <td className="tabular px-3 py-1.5 text-right">{r.hasActiveBaseline ? `${r.actualPct.toFixed(1)}%` : "—"}</td>
                      <td className={`tabular px-3 py-1.5 text-right ${r.deviationPp < -0.05 ? "font-semibold text-danger" : ""}`}>
                        {r.hasActiveBaseline ? `${r.deviationPp >= 0 ? "+" : "−"}${Math.abs(r.deviationPp).toFixed(1)} pp` : "—"}
                      </td>
                      <td className="tabular px-3 py-1.5 text-right">
                        {r.finalReports}/{r.expectedReports}
                      </td>
                      <td className="px-3 py-1.5">
                        {r.readiness.score}% ({READINESS_GRADE_LABEL[r.readiness.grade]})
                      </td>
                      <td className="tabular px-3 py-1.5 text-right">{r.openIssues}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {/* ── Narasi lapangan (mentah — verifikasi kutipan AI) ── */}
      {official?.narrative && official.narrative.locations.some((l) => l.reports.length || l.activities.length) ? (
        <Card>
          <CardHeader
            title="Narasi lapangan (sumber mentah)"
            subtitle="Catatan laporan harian & kegiatan lapangan apa adanya — dasar kutipan AI. Foto TIDAK dianalisis AI (hanya jumlah + tautan); isinya tetap perlu dilihat manusia."
          />
          <CardBody className="space-y-4 text-sm">
            {official.narrative.locations
              .filter((l) => l.reports.length || l.activities.length)
              .map((l) => (
                <div key={l.locationId}>
                  <p className="font-medium text-ink">{l.locationName}</p>
                  {l.reports.length > 0 ? (
                    <ul className="mt-1 space-y-1">
                      {l.reports.map((r) => (
                        <li key={r.id} className="rounded-md border border-border-muted px-2.5 py-1.5">
                          <span className="text-xs text-ink-faint">
                            {r.date} · laporan · {r.status}
                            {r.weather ? ` · cuaca ${r.weather}` : ""} · {r.photoCount} foto
                          </span>
                          <p className="text-ink-muted">{r.notes ?? "(tanpa catatan)"}</p>
                          {r.items.length > 0 ? (
                            <p className="text-xs text-ink-faint">
                              Item: {r.items.map((it) => `${it.itemName} ${it.volumeDone}${it.unit ?? ""}`).join("; ")}
                            </p>
                          ) : null}
                          <Link href={`/lokasi/${l.slug}/harian/${r.date}`} className="text-xs text-primary hover:underline">
                            Buka laporan →
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {l.activities.length > 0 ? (
                    <ul className="mt-1 space-y-1">
                      {l.activities.map((a) => (
                        <li key={a.id} className="rounded-md border border-border-muted px-2.5 py-1.5">
                          <span className="text-xs text-ink-faint">
                            {a.date} · {a.kindLabel} · {a.status} · {a.photoCount} foto
                          </span>
                          <p className="font-medium text-ink">{a.title}</p>
                          <p className="text-ink-muted">{a.notes ?? "(tanpa catatan)"}</p>
                          {a.kendala ? <p className="text-xs text-warning">Kendala: {a.kendala}</p> : null}
                          {a.solusi ? <p className="text-xs text-success">Solusi: {a.solusi}</p> : null}
                          <Link href={`/lokasi/${l.slug}/kegiatan`} className="text-xs text-primary hover:underline">
                            Buka kegiatan →
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ))}
          </CardBody>
        </Card>
      ) : null}

      {/* ── Sumber data ── */}
      <Card>
        <CardHeader title="Sumber data" subtitle="Setiap klaim AI merujuk id sumber di bawah. Buka untuk drill-down ke modul aslinya." />
        <CardBody>
          <ul className="grid gap-2 md:grid-cols-2">
            {sources.map((s) => (
              <li key={s.id} className="rounded-md border border-border px-3 py-2 text-sm">
                <span className="block text-xs text-ink-faint">{s.id}</span>
                <span className="block text-ink">{s.value ?? s.label}</span>
                {s.href ? (
                  <Link href={s.href} className="text-xs text-primary hover:underline">
                    Buka detail →
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      {/* ── Jejak audit ── */}
      <Card>
        <CardHeader title="Jejak audit" subtitle="Semua aksi run & artefak tercatat append-only." />
        <CardBody>
          <ul className="space-y-1 text-sm">
            {auditTrail.map((a) => (
              <li key={a.id} className="flex flex-wrap gap-2 text-ink-muted">
                <span className="tabular">{formatTanggalWaktu(a.createdAt)}</span>
                <span className="font-medium text-ink">{a.action}</span>
                <span>oleh {a.userId ? (nameOf.get(a.userId) ?? "—") : "sistem"}</span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}

/* ── Render output per jenis run ─────────────────────────────────────────── */

function RunOutput({ kind, out, official }: { kind: string; out: Record<string, unknown>; official: Official | null }) {
  const locName = (id: string | null) =>
    id ? (official?.rows.find((r) => r.locationId === id)?.name ?? id.slice(0, 8)) : "Lintas lokasi";

  if (kind === "pulse" && out.pulse) {
    const p = out.pulse as PulseOutput;
    return (
      <Card>
        <CardHeader
          title="Analisis AI — Portfolio Pulse"
          subtitle={
            <span>
              Status keseluruhan: <Badge tone={STATUS_TONE[p.overallStatus]} label={p.overallStatus} /> · confidence {p.confidence}%
            </span>
          }
        />
        <CardBody className="space-y-3 text-sm">
          <p className="whitespace-pre-wrap text-ink">{p.summary}</p>
          {p.whatChanged ? <p className="text-ink-muted">Perubahan: {p.whatChanged}</p> : null}
          {p.priorityLocations.length > 0 ? (
            <div>
              <h4 className="mb-1 font-medium text-ink">Lokasi prioritas</h4>
              <ul className="space-y-1.5">
                {p.priorityLocations.map((x, i) => (
                  <li key={i} className="rounded-md border border-border px-3 py-2">
                    <Badge tone={SEV_TONE[x.severity]} label={x.severity} />{" "}
                    <strong>{locName(x.locationId)}</strong> — {x.reason}
                    <span className="block text-[11px] text-ink-faint">sumber: {x.sourceRefIds.join(", ")}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {p.actionsToConsider.length > 0 ? (
            <div>
              <h4 className="mb-1 font-medium text-ink">Tindakan untuk dipertimbangkan (draft — bukan eksekusi)</h4>
              <ul className="space-y-1.5">
                {p.actionsToConsider.map((x, i) => (
                  <li key={i} className="rounded-md border border-border px-3 py-2">
                    <strong>{x.title}</strong> · {locName(x.locationId)}
                    {x.proposedRole ? ` · PIC usulan: ${x.proposedRole}` : ""}
                    <span className="block text-ink-muted">{x.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardBody>
      </Card>
    );
  }

  if (kind === "deviasi" && out.deviasi) {
    const v = out.deviasi as VarianceOutput;
    return (
      <Card>
        <CardHeader title="Analisis AI — Explain Variance" subtitle={`Confidence ${v.confidence}% · deviasi resmi TIDAK diubah AI`} />
        <CardBody className="space-y-3 text-sm">
          <p className="whitespace-pre-wrap text-ink">{v.summary}</p>
          {v.locations.map((l) => (
            <div key={l.locationId} className="rounded-md border border-border p-3">
              <p className="font-medium text-ink">
                {locName(l.locationId)} <Badge tone="neutral" label={`data ${l.dataConfidence}`} />
              </p>
              {l.confirmedDrivers.length > 0 ? (
                <div className="mt-1.5">
                  <span className="text-xs font-semibold text-success uppercase">Penyebab terkonfirmasi</span>
                  <ul className="list-disc pl-5">
                    {l.confirmedDrivers.map((d, i) => (
                      <li key={i}>
                        [{d.category} · dampak {d.impact}] {d.explanation}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {l.suspectedDrivers.length > 0 ? (
                <div className="mt-1.5">
                  <span className="text-xs font-semibold text-warning uppercase">Diduga (perlu cek lapangan)</span>
                  <ul className="list-disc pl-5">
                    {l.suspectedDrivers.map((d, i) => (
                      <li key={i}>
                        [{d.category} · dampak {d.impact}] {d.explanation}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {l.requiredValidations.length > 0 ? (
                <div className="mt-1.5">
                  <span className="text-xs font-semibold text-info uppercase">Validasi wajib</span>
                  <ul className="list-disc pl-5">
                    {l.requiredValidations.map((d, i) => (
                      <li key={i}>{d.action}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ))}
        </CardBody>
      </Card>
    );
  }

  if (kind === "risiko" && out.risiko) {
    const r = out.risiko as RiskOutput;
    return (
      <Card>
        <CardHeader title="Analisis AI — Risk Intelligence" subtitle={`Confidence ${r.confidence}% · skor risiko dari rule, AI hanya memberi rasional`} />
        <CardBody className="space-y-3 text-sm">
          <p className="whitespace-pre-wrap text-ink">{r.summary}</p>
          <ul className="space-y-1.5">
            {r.rationales.map((x, i) => (
              <li key={i} className="rounded-md border border-border px-3 py-2">
                <Badge tone="neutral" label={RISK_CATEGORY_LABEL[x.category]} /> <strong>{locName(x.locationId)}</strong> —{" "}
                {x.aiRationale}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    );
  }

  if (kind === "kualitas_data") {
    const q = out.kualitas_data as QualityOutput | undefined;
    const findings = official?.quality ?? [];
    const flagged = findings.filter((f) => f.status === "gagal" || f.status === "periksa");
    return (
      <Card>
        <CardHeader title="Audit Kualitas Data" subtitle="Status temuan ditentukan rule deterministik — AI hanya menjelaskan." />
        <CardBody className="space-y-3 text-sm">
          {q ? <p className="whitespace-pre-wrap text-ink">{q.summary}</p> : null}
          <ul className="space-y-1.5">
            {(flagged.length ? flagged : findings).map((f, i) => (
              <li key={i} className="rounded-md border border-border px-3 py-2">
                <Badge
                  tone={f.status === "gagal" ? "danger" : f.status === "periksa" ? "warning" : f.status === "lulus" ? "success" : "neutral"}
                  label={f.status}
                />{" "}
                <strong>{f.locationName}</strong> — {f.label}
                <span className="block text-ink-muted">{f.detail}</span>
                {q?.explanations.find((e) => e.locationId === f.locationId && e.findingKey === f.key) ? (
                  <span className="mt-1 block border-l-2 border-info pl-2 text-ink-muted">
                    AI: {q.explanations.find((e) => e.locationId === f.locationId && e.findingKey === f.key)!.explanation}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    );
  }

  if (kind === "tanya" && out.tanya) {
    const a = out.tanya as AskOutput;
    return (
      <Card>
        <CardHeader title="Jawaban Ask MARLIN" subtitle={`Confidence ${a.confidence}%`} />
        <CardBody className="space-y-2 text-sm">
          <p className="whitespace-pre-wrap text-ink">{a.answer}</p>
          {a.citations.length > 0 ? (
            <p className="text-xs text-ink-faint">Sumber: {a.citations.map((c) => c.sourceRefId).join(", ")}</p>
          ) : null}
        </CardBody>
      </Card>
    );
  }

  return null;
}
