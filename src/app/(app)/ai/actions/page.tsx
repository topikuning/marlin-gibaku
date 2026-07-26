import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, EmptyState, KpiCard } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { can } from "@/lib/authz";
import { buildPortfolioPulse, resolveAiScope } from "@/lib/ai-hub/source";
import { RISK_CATEGORY_LABEL } from "@/lib/ai-hub/risk";
import { jakartaToday } from "@/lib/format";
import { db } from "@/lib/db";
import { SuggestionButton } from "./suggestion-button";

export const metadata: Metadata = { title: "AI Intelligence — Perlu Tindakan" };
export const dynamic = "force-dynamic";

const SEV_TONE = { kritis: "danger", tinggi: "warning", sedang: "info" } as const;

/**
 * Perlu Tindakan — antrean lintas lokasi exception-first, SEPENUHNYA
 * deterministik (berfungsi walau provider AI mati). Tombol menyimpan item
 * sebagai DRAFT artefak saran — tidak pernah menulis Issue/Recovery domain.
 * DECISIONS 133.
 */
export default async function AiActionsPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "ai.view");

  const today = jakartaToday().toISOString().slice(0, 10);
  const start = new Date(`${today}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - 13);
  const startKey = start.toISOString().slice(0, 10);

  const scope = await resolveAiScope(user, []);
  const [pulse, savedDrafts] = await Promise.all([
    buildPortfolioPulse(user, scope.ids, startKey, today),
    db.aiArtifact.count({ where: { kind: "saran", status: "draft" } }),
  ]);

  const queue = pulse.risks;
  const kritis = queue.filter((r) => r.severity === "kritis").length;
  const overdue = queue.filter((r) => r.overdue).length;
  const canSave = can(user.role, "ai.generate");

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
      <Card>
        <CardHeader
          title="Perlu Tindakan"
          subtitle={`Antrean deterministik dari rule risiko (periode data ${startKey} – ${today}), diurutkan dampak. Menyimpan = membuat DRAFT saran, bukan mengubah data.`}
        />
        <CardBody className="space-y-2">
          {queue.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="Tidak ada item perlu tindakan"
              description="Rule risiko tidak menemukan masalah pada scope Anda."
            />
          ) : (
            queue.map((item, i) => (
              <div
                key={`${item.locationId}-${item.category}-${i}`}
                className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={SEV_TONE[item.severity]} label={`${item.severity} · ${item.ruleScore}`} />
                    <Badge tone="neutral" label={RISK_CATEGORY_LABEL[item.category]} />
                    {item.overdue ? <Badge tone="danger" label="overdue" /> : null}
                  </div>
                  <p className="mt-1 text-sm font-medium text-ink">
                    {item.locationName} — {item.title}
                  </p>
                  <p className="text-xs text-ink-muted">{item.evidence}</p>
                </div>
                {canSave ? (
                  <SuggestionButton
                    title={`${item.locationName}: ${item.title}`}
                    detail={item.evidence}
                    category={item.category}
                    severity={item.severity}
                    locationId={item.locationId}
                    locationName={item.locationName}
                    suggestKind={item.category === "schedule" || item.category === "compliance" ? "recovery" : "action"}
                  />
                ) : null}
              </div>
            ))
          )}
        </CardBody>
      </Card>

      <div className="space-y-3 self-start">
        <div className="grid grid-cols-2 gap-3">
          <KpiCard label="Kritis" value={String(kritis)} tone={kritis > 0 ? "danger" : "success"} />
          <KpiCard label="Overdue" value={String(overdue)} tone={overdue > 0 ? "warning" : "success"} />
          <KpiCard label="Total item" value={String(queue.length)} />
          <KpiCard label="Draft saran" value={String(savedDrafts)} sub="menunggu tindak lanjut manual" />
        </div>
        <p className="rounded-md border border-warning-border bg-warning-soft px-3 py-2 text-xs leading-snug text-warning">
          Draft saran TIDAK membuat Issue/Recovery otomatis. Eksekusi tetap manual di workspace lokasi → Kendala,
          dengan permission domain masing-masing.
        </p>
      </div>
    </div>
  );
}
