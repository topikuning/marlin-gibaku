import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, CardBody, CardHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { db } from "@/lib/db";
import { AI_RUN_STATUS_LABEL, AI_RUN_STATUS_TONE } from "@/lib/lifecycle";
import { formatTanggalWaktu } from "@/lib/format";

export const metadata: Metadata = { title: "AI Intelligence — Riwayat & Audit" };
export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  pulse: "Portfolio Pulse",
  deviasi: "Explain Variance",
  risiko: "Risk Intelligence",
  kualitas_data: "Audit Kualitas Data",
  laporan: "Report Studio",
  tanya: "Ask MARLIN",
};

/** Riwayat run AI: siapa, kapan, scope, provider/model, token, latency, biaya. */
export default async function AiHistoryPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "ai.view");

  const runs = await db.aiRun.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
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
      inputTokens: true,
      outputTokens: true,
      latencyMs: true,
      estimatedCostUsd: true,
      createdAt: true,
    },
  });
  const users = await db.user.findMany({
    where: { id: { in: [...new Set(runs.map((r) => r.userId))] } },
    select: { id: true, fullName: true },
  });
  const nameOf = new Map(users.map((u) => [u.id, u.fullName]));

  return (
    <Card>
      <CardHeader
        title="Riwayat run & audit"
        subtitle="Setiap generate/pertanyaan tercatat: pembuat, scope, usage token, latency, dan estimasi biaya (bila pricing diatur). Jejak lengkap ada di audit log sistem."
      />
      <CardBody>
        {runs.length === 0 ? (
          <p className="text-sm text-ink-muted">Belum ada run AI.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-ink-muted uppercase">
                  <th className="px-3 py-2">Waktu</th>
                  <th className="px-3 py-2">Jenis</th>
                  <th className="px-3 py-2">Scope</th>
                  <th className="px-3 py-2">Pembuat</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Provider/model</th>
                  <th className="px-3 py-2 text-right">Token in/out</th>
                  <th className="px-3 py-2 text-right">Latency</th>
                  <th className="px-3 py-2 text-right">± Biaya</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-b border-border-muted hover:bg-surface-muted">
                    <td className="px-3 py-2 whitespace-nowrap">{formatTanggalWaktu(r.createdAt)}</td>
                    <td className="px-3 py-2">{KIND_LABEL[r.runKind] ?? r.runKind}</td>
                    <td className="px-3 py-2">
                      {(r.scopeIds as string[]).length} lokasi · {r.periodStart.toISOString().slice(0, 10)}–
                      {r.periodEnd.toISOString().slice(0, 10)}
                    </td>
                    <td className="px-3 py-2">{nameOf.get(r.userId) ?? "—"}</td>
                    <td className="px-3 py-2">
                      <Badge tone={AI_RUN_STATUS_TONE[r.status]} label={AI_RUN_STATUS_LABEL[r.status]} />
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {r.provider ? `${r.provider} / ${r.model}` : "—"}
                      <span className="block text-ink-faint">{r.promptVersion}</span>
                    </td>
                    <td className="tabular px-3 py-2 text-right">
                      {r.inputTokens != null ? `${r.inputTokens}/${r.outputTokens ?? 0}` : "—"}
                    </td>
                    <td className="tabular px-3 py-2 text-right">{r.latencyMs != null ? `${(r.latencyMs / 1000).toFixed(1)}s` : "—"}</td>
                    <td className="tabular px-3 py-2 text-right">
                      {r.estimatedCostUsd != null ? `$${Number(r.estimatedCostUsd).toFixed(4)}` : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <Link href={`/ai/run/${r.id}`} className="text-primary hover:underline">
                        Buka
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
