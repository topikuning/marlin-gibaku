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
      {/* Ukuran kertas ditentukan di sini, bukan diserahkan ke bawaan peramban
          — kalau tidak, hasil cetaknya berbeda tergantung siapa yang menekan
          Cetak. DECISIONS 395. */}
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 12mm; }
          .page-break { break-before: page; }
          .executive-grid, .priority, .kpi { break-inside: avoid; }
        }
      `}</style>
      <PrintToolbar backHref={artifact.runId ? `/ai/run/${artifact.runId}` : "/ai/reports"} />
      <main className="mx-auto max-w-[900px] bg-white p-6 print:p-0">
        {artifact.status === "draft" || artifact.status === "direview" ? (
          <p className="no-print mb-3 rounded-md border border-warning bg-warning-soft px-3 py-2 text-sm">
            Draf AI – belum disetujui/beku. Jangan distribusikan versi ini.
          </p>
        ) : null}
        <div
          className="ai-report-print [&_h1]:mt-1 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-4 [&_h3]:text-sm [&_h3]:font-semibold [&_p]:my-1.5 [&_p]:text-[12px] [&_p]:leading-relaxed [&_table]:w-full [&_table]:border-collapse [&_table]:text-[10px] [&_th]:border [&_th]:border-neutral-300 [&_th]:bg-neutral-100 [&_th]:px-1.5 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:border-neutral-300 [&_td]:px-1.5 [&_td]:py-1 [&_.eyebrow]:m-0 [&_.eyebrow]:text-[10px] [&_.eyebrow]:font-bold [&_.eyebrow]:tracking-[0.18em] [&_.eyebrow]:text-sky-700 [&_.meta]:text-neutral-500 [&_.status]:my-3 [&_.status]:flex [&_.status]:items-center [&_.status]:justify-between [&_.status]:rounded-md [&_.status]:border [&_.status]:px-3 [&_.status]:py-2 [&_.status]:text-xs [&_.status-normal]:border-emerald-300 [&_.status-normal]:bg-emerald-50 [&_.status-perhatian]:border-amber-300 [&_.status-perhatian]:bg-amber-50 [&_.status-kritis]:border-red-300 [&_.status-kritis]:bg-red-50 [&_.status-data_kurang]:border-neutral-300 [&_.status-data_kurang]:bg-neutral-100 [&_.data-warning]:my-3 [&_.data-warning]:rounded-md [&_.data-warning]:border [&_.data-warning]:border-amber-300 [&_.data-warning]:bg-amber-50 [&_.data-warning]:p-3 [&_.data-warning]:text-xs [&_.summary]:my-3 [&_.summary]:border-l-4 [&_.summary]:border-sky-600 [&_.summary]:bg-sky-50 [&_.summary]:p-3 [&_.summary_span]:text-[10px] [&_.summary_span]:font-bold [&_.summary_span]:uppercase [&_.summary_span]:tracking-wide [&_.summary_p]:text-sm [&_.summary_p]:font-medium [&_.kpi-grid]:grid [&_.kpi-grid]:grid-cols-5 [&_.kpi-grid]:gap-2 [&_.kpi]:rounded-md [&_.kpi]:border [&_.kpi]:border-neutral-200 [&_.kpi]:p-2 [&_.kpi_span]:block [&_.kpi_span]:text-[9px] [&_.kpi_span]:text-neutral-500 [&_.kpi_strong]:my-1 [&_.kpi_strong]:block [&_.kpi_strong]:text-lg [&_.kpi_small]:block [&_.kpi_small]:text-[9px] [&_.kpi_small]:text-neutral-500 [&_.executive-grid]:grid [&_.executive-grid]:grid-cols-2 [&_.executive-grid]:gap-5 [&_.priority]:mb-2 [&_.priority]:flex [&_.priority]:gap-2 [&_.priority]:rounded-md [&_.priority]:border [&_.priority]:border-neutral-200 [&_.priority]:p-2 [&_.priority-danger]:border-red-300 [&_.priority-warning]:border-amber-300 [&_.priority-rank]:flex [&_.priority-rank]:size-5 [&_.priority-rank]:shrink-0 [&_.priority-rank]:items-center [&_.priority-rank]:justify-center [&_.priority-rank]:rounded-full [&_.priority-rank]:bg-neutral-100 [&_.priority-rank]:text-[10px] [&_.priority_small]:block [&_.priority_small]:text-[9px] [&_.priority_small]:text-neutral-500 [&_.priority-numbers]:text-[9px] [&_.priority-numbers]:text-neutral-500 [&_.sisa]:mt-2 [&_.sisa]:text-[10px] [&_.sisa]:italic [&_.sisa]:text-neutral-500 [&_.empty]:text-[11px] [&_.empty]:italic [&_.empty]:text-neutral-500 [&_.decision-list]:m-0 [&_.decision-list]:space-y-2 [&_.decision-list]:pl-5 [&_.decision-list]:text-[12px] [&_.limits]:mt-3 [&_.limits]:rounded [&_.limits]:border [&_.limits]:border-amber-300 [&_.limits]:bg-amber-50 [&_.limits]:p-2 [&_.limits]:text-[11px] [&_.limits_ul]:my-1 [&_.limits_ul]:list-disc [&_.limits_ul]:pl-5 [&_footer]:mt-4 [&_footer]:border-t [&_footer]:pt-2 [&_footer]:text-[10px] [&_footer]:text-neutral-500"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </main>
    </>
  );
}
