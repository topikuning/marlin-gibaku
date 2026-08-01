import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Banner, Card, CardBody, CardHeader } from "@/components/ui";
import { accessibleLocationIds, requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { scopeCoveredBy } from "@/lib/ai-hub/read-scope";
import { getActiveAiConfig } from "@/lib/ai/config";
import { getAiGuardConfig } from "@/lib/ai-hub/guard";
import { resolveAiScope } from "@/lib/ai-hub/source";
import { AI_ARTIFACT_STATUS_LABEL, AI_ARTIFACT_STATUS_TONE } from "@/lib/lifecycle";
import { formatTanggalWaktu } from "@/lib/format";
import { ReportStudioClient } from "./studio-client";

export const metadata: Metadata = { title: "AI Intelligence — Report Studio" };
export const dynamic = "force-dynamic";

/**
 * Report Studio: pilih template + scope + periode → generate structured report
 * (satu run AI) → artefak draft ber-lifecycle (draft → direview → disetujui →
 * beku → terkirim). Satu konten kanonik utk semua format. DECISIONS 133.
 */
export default async function AiReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  // Jembatan masuk (DECISIONS 193/194): ?template= dari pengalihan /laporan-wa
  // dan Ask MARLIN, ?scopeIds= dari halaman run "Jadikan laporan".
  const initialTemplate = typeof sp.template === "string" ? sp.template : undefined;
  const initialScopeIds =
    typeof sp.scopeIds === "string" ? sp.scopeIds.split(",").filter(Boolean) : [];
  const user = await requireUser();
  requireCapabilityPage(user.role, "ai.view");

  const [scope, aiCfg, guard] = await Promise.all([resolveAiScope(user, []), getActiveAiConfig(), getAiGuardConfig()]);
  const [locations, allArtifacts] = await Promise.all([
    db.location.findMany({
      where: { id: { in: scope.ids } },
      select: { id: true, name: true, package: { select: { name: true } } },
      orderBy: { name: "asc" },
    }),
    db.aiArtifact.findMany({
      where: { kind: "laporan" },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        title: true,
        templateKey: true,
        version: true,
        status: true,
        updatedAt: true,
        runId: true,
        run: { select: { scopeIds: true } },
      },
    }),
  ]);
  // Daftar difilter per scope BACA — user ber-scope sempit tidak boleh melihat
  // judul/keberadaan laporan lokasi lain (audit 2026-07-27, B9).
  const accessible = await accessibleLocationIds(user);
  const artifacts = allArtifacts
    .filter((a) => scopeCoveredBy(accessible, a.run?.scopeIds ?? null))
    .slice(0, 15);

  const aiReady = guard.enabled && !!aiCfg;

  return (
    <div className="space-y-4">
      {!aiReady ? (
        <Banner
          tone="warning"
          title={
            guard.enabled
              ? "Provider AI belum dikonfigurasi (Sistem → AI) — generate draf dinonaktifkan."
              : "Fitur AI dinonaktifkan admin (kill switch)."
          }
        />
      ) : null}

      <ReportStudioClient
        locations={locations.map((l) => ({ id: l.id, name: l.name, packageName: l.package.name }))}
        aiReady={aiReady && can(user.role, "ai.generate")}
        initialTemplate={initialTemplate}
        initialScopeIds={initialScopeIds}
      />

      <Card>
        <CardHeader title="Artefak laporan terbaru" subtitle="Regenerate selalu membuat versi baru; artefak beku bersifat immutable." />
        <CardBody>
          {artifacts.length === 0 ? (
            <p className="text-sm text-ink-muted">Belum ada artefak — generate draf pertama di atas.</p>
          ) : (
            <ul className="divide-y divide-border-muted">
              {artifacts.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <Link href={a.runId ? `/ai/run/${a.runId}` : "/ai/reports"} className="font-medium text-ink hover:underline">
                      {a.title}
                    </Link>
                    <p className="text-xs text-ink-muted">
                      {a.templateKey} · v{a.version} · {formatTanggalWaktu(a.updatedAt)}
                    </p>
                  </div>
                  <Badge tone={AI_ARTIFACT_STATUS_TONE[a.status]} label={AI_ARTIFACT_STATUS_LABEL[a.status]} />
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
