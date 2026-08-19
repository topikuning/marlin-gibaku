import type { Metadata } from "next";
import { Banner, KpiCard } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { can } from "@/lib/authz";
import { getActiveAiConfig } from "@/lib/ai/config";
import { getAiGuardConfig } from "@/lib/ai-hub/guard";
import { buildPortfolioPulse, resolveAiScope } from "@/lib/ai-hub/source";
import { jakartaToday } from "@/lib/format";
import { PulseClient } from "./pulse-client";

export const metadata: Metadata = { title: "AI Intelligence — Portfolio Pulse" };
export const dynamic = "force-dynamic";

function shiftKey(key: string, deltaDays: number): string {
  const d = new Date(`${key}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

/**
 * Portfolio Pulse — halaman awal /ai. KPI + tabel + readiness DETERMINISTIK
 * (tetap berfungsi penuh saat provider AI mati); AI hanya menambah narasi
 * lewat tombol analisis. Query string cuma preset pilihan — scope diverifikasi
 * ulang server (resolveAiScope). DECISIONS 133.
 */
export default async function AiPulsePage({
  searchParams,
}: {
  searchParams: Promise<{ scopeIds?: string; period?: string }>;
}) {
  const user = await requireUser();
  requireCapabilityPage(user.role, "ai.view");
  const sp = await searchParams;

  const today = jakartaToday().toISOString().slice(0, 10);
  const period = sp.period === "14hari" ? "14hari" : sp.period === "30hari" ? "30hari" : "7hari";
  const days = period === "30hari" ? 29 : period === "14hari" ? 13 : 6;
  const startKey = shiftKey(today, -days);

  const [scope, aiCfg, guard] = await Promise.all([
    resolveAiScope(user, []),
    getActiveAiConfig(),
    getAiGuardConfig(),
  ]);
  const pulse = await buildPortfolioPulse(user, scope.ids, startKey, today);

  // Preselect dari deep-link (?scopeIds=a,b) — hanya yang lolos izin.
  const allowed = new Set(pulse.rows.map((r) => r.locationId));
  const preselect = (sp.scopeIds ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => allowed.has(s));

  const aiReady = guard.enabled && !!aiCfg;
  const t = pulse.totals;

  return (
    <div className="space-y-4">
      {!guard.enabled ? (
        <Banner
          tone="warning"
          title="Fitur AI sedang dinonaktifkan admin (kill switch)"
          description="Data deterministik di bawah tetap berlaku."
        />
      ) : !aiCfg ? (
        <Banner
          tone="info"
          title="Provider AI belum dikonfigurasi (Sistem → AI)"
          description="Pulse deterministik tetap berfungsi; narasi AI nonaktif."
        />
      ) : null}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Lokasi dalam scope" value={String(t.locations)} sub={`periode ${pulse.periodStart} – ${pulse.periodEnd}`} />
        <KpiCard
          label="Laporan final"
          value={`${t.reportsFinal}/${t.reportsExpected}`}
          tone={t.reportsExpected > 0 && t.reportsFinal / t.reportsExpected < 0.5 ? "warning" : "default"}
          sub="vs diharapkan"
        />
        <KpiCard
          label="Deviasi negatif"
          value={String(t.negativeDeviationLocations)}
          tone={t.negativeDeviationLocations > 0 ? "danger" : "success"}
          sub="lokasi tertinggal"
        />
        <KpiCard label="Kendala terbuka" value={String(t.openIssues)} tone={t.openIssues > 0 ? "warning" : "success"} sub="lintas scope" />
        <KpiCard
          label="Recovery overdue"
          value={String(t.overdueRecoveries)}
          tone={t.overdueRecoveries > 0 ? "danger" : "success"}
          sub="melewati target"
        />
        <KpiCard
          label="Readiness rendah"
          value={String(t.lowReadinessLocations)}
          tone={t.lowReadinessLocations > 0 ? "warning" : "success"}
          sub="data belum layak analisis"
        />
      </div>

      <PulseClient
        rows={pulse.rows}
        sourceRefs={pulse.sourceRefs}
        period={period}
        preselect={preselect}
        aiReady={aiReady}
        canGenerate={can(user.role, "ai.generate")}
        dataAsOf={pulse.dataAsOf}
      />
    </div>
  );
}
