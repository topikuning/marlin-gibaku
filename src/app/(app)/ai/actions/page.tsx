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
import { Prisma } from "@/generated/prisma/client";
import { SuggestionButton } from "./suggestion-button";
import { ApplySuggestionButton } from "./apply-suggestion-button";

export const metadata: Metadata = { title: "AI Intelligence – Perlu Tindakan" };
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

  const idUserOrg = (
    await db.user.findMany({ where: { orgId: user.orgId }, select: { id: true } })
  ).map((u) => u.id);
  const scope = await resolveAiScope(user, []);
  const [pulse, draftSaran] = await Promise.all([
    buildPortfolioPulse(user, scope.ids, startKey, today),
    // DAFTAR, bukan sekadar hitungan: dulu draft tersimpan tidak pernah muncul
    // di mana pun sehingga tombol "Simpan Draft" terasa tidak melakukan apa-apa
    // (laporan user 2026-08-01). Juga difilter ke lokasi dalam scope — count
    // lama menghitung lintas organisasi.
    db.aiArtifact.findMany({
      where: {
        kind: "saran",
        status: "draft",
        createdById: { in: idUserOrg },
        structuredContent: { path: ["locationId"], not: Prisma.DbNull },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, title: true, createdAt: true, structuredContent: true },
    }),
  ]);

  const bolehTerapkan = can(user.role, "issue.manage");
  const scopeSet = new Set(scope.ids);
  const antreanDraft = draftSaran
    .map((a) => {
      const isi = (a.structuredContent ?? {}) as {
        detail?: string;
        severity?: string;
        locationId?: string | null;
        locationName?: string | null;
        suggestKind?: string;
      };
      return { id: a.id, title: a.title, createdAt: a.createdAt, ...isi };
    })
    .filter((d) => d.locationId && scopeSet.has(d.locationId));
  const draftTampil = antreanDraft.slice(0, 20);

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
                    {item.locationName} – {item.title}
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
        <div className="grid grid-cols-2 gap-2">
          <KpiCard label="Kritis" value={String(kritis)} tone={kritis > 0 ? "danger" : "success"} />
          <KpiCard label="Overdue" value={String(overdue)} tone={overdue > 0 ? "warning" : "success"} />
          <KpiCard label="Total item" value={String(queue.length)} />
          <KpiCard label="Draft saran" value={String(antreanDraft.length)} sub="belum ditindaklanjuti" />
        </div>
        <p className="rounded-md border border-warning-border bg-warning-soft px-3 py-2 text-xs leading-snug text-warning">
          AI tidak pernah membuat Kendala/Recovery sendiri. Draft di bawah baru menjadi data nyata setelah Anda
          menerapkannya – dan hanya pemegang izin Kendala yang bisa.
        </p>

        <Card>
          <CardHeader
            title="Draft saran tersimpan"
            subtitle="Terapkan → dibuat sebagai Kendala di lokasi (aksi pemulihan ikut dibuat untuk draft recovery)."
          />
          <CardBody className="space-y-2">
            {antreanDraft.length === 0 ? (
              <p className="text-xs text-ink-muted">
                Belum ada draft tersimpan. Tekan “Simpan Draft” pada item antrean di kiri.
              </p>
            ) : (
              draftTampil.map((d) => (
                <div key={d.id} className="rounded-md border border-border px-2.5 py-2">
                  <p className="text-[13px] font-medium text-ink">{d.title}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">{d.locationName ?? "–"}</p>
                  {bolehTerapkan ? (
                    <ApplySuggestionButton
                      artifactId={d.id}
                      recovery={d.suggestKind === "recovery"}
                    />
                  ) : (
                    <p className="mt-1 text-xs text-ink-faint">
                      Perlu izin Kendala untuk menerapkan.
                    </p>
                  )}
                </div>
              ))
            )}
            {antreanDraft.length > draftTampil.length ? (
              <p className="text-xs text-ink-muted">
                +{antreanDraft.length - draftTampil.length} draft lain belum ditampilkan.
              </p>
            ) : null}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
