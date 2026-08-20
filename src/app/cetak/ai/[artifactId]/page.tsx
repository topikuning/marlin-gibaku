import { notFound } from "next/navigation";
import { PrintToolbar } from "@/components/print/print-toolbar";
import { accessibleLocationIds, requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { db } from "@/lib/db";
import { scopeCoveredBy } from "@/lib/ai-hub/read-scope";
import { parseAiReportContent, renderAiReportHtml } from "@/lib/ai-hub/render";

export const dynamic = "force-dynamic";

/**
 * Cetak artefak laporan AI — A4 tanpa shell (PDF via print browser, pola
 * /cetak existing). HTML dari renderer deterministik yang SAMA dengan
 * pratinjau/WA/Excel → angka identik. DECISIONS 133.
 */
export default async function CetakAiPage({ params }: { params: Promise<{ artifactId: string }> }) {
  const { artifactId } = await params;
  const user = await requireUser();
  requireCapabilityPage(user.role, "ai.view");

  const artifact = await db.aiArtifact.findUnique({
    where: { id: artifactId },
    select: { kind: true, status: true, structuredContent: true, runId: true, run: { select: { scopeIds: true } } },
  });
  if (!artifact || artifact.kind !== "laporan") notFound();
  // Scope baca = scope run asal artefak (audit 2026-07-27, B9). Artefak tanpa
  // run → hanya role lintas lokasi.
  if (!scopeCoveredBy(await accessibleLocationIds(user), artifact.run?.scopeIds ?? null)) notFound();

  let html: string;
  try {
    html = renderAiReportHtml(
      parseAiReportContent(artifact.structuredContent),
      artifact.status === "beku" || artifact.status === "terkirim",
    );
  } catch {
    notFound();
  }

  return (
    <>
      <PrintToolbar backHref={artifact.runId ? `/ai/run/${artifact.runId}` : "/ai/reports"} />
      <main className="mx-auto max-w-[900px] bg-white p-6 print:p-0">
        {artifact.status === "draft" || artifact.status === "direview" ? (
          <p className="no-print mb-3 rounded-md border border-warning bg-warning-soft px-3 py-2 text-sm">
            Draf AI – belum disetujui/beku. Jangan distribusikan versi ini.
          </p>
        ) : null}
        <div
          className="ai-report-print [&_h1]:text-xl [&_h1]:font-bold [&_h3]:mt-4 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold [&_p]:my-1.5 [&_p]:text-[13px] [&_p]:leading-relaxed [&_table]:w-full [&_table]:border-collapse [&_table]:text-[12px] [&_th]:border [&_th]:border-neutral-300 [&_th]:bg-neutral-100 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:border-neutral-300 [&_td]:px-2 [&_td]:py-1 [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:text-[13px] [&_.meta]:text-neutral-500 [&_.limits]:mt-3 [&_.limits]:rounded [&_.limits]:border [&_.limits]:border-amber-300 [&_.limits]:bg-amber-50 [&_.limits]:p-2 [&_.limits]:text-[12px] [&_footer]:mt-4 [&_footer]:border-t [&_footer]:pt-2 [&_footer]:text-[11px] [&_footer]:text-neutral-500 [&_.summary]:my-3 [&_.summary]:border-l-4 [&_.summary]:border-sky-600 [&_.summary]:bg-sky-50 [&_.summary]:p-2"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </main>
    </>
  );
}
