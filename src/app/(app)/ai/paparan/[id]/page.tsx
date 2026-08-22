import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { Badge, Banner, Card, CardBody, CardHeader } from "@/components/ui";
import { accessibleLocationIds, requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { scopeCoveredBy } from "@/lib/ai-hub/read-scope";
import { isR2Configured, r2PresignGet } from "@/lib/r2";
import { AI_ARTIFACT_STATUS_LABEL, AI_ARTIFACT_STATUS_TONE } from "@/lib/lifecycle";
import { parsePaparanContent, susunSlides } from "@/lib/paparan/susun";
import { SlidePreview } from "./slide-preview";
import { PaparanReviewClient, TombolTransisi } from "./review-client";

export const metadata: Metadata = { title: "AI Intelligence – Detail Paparan" };
export const dynamic = "force-dynamic";

/**
 * PREVIEW & REVIEW PAPARAN (DECISIONS 416): satu kartu 16:9 per slide, dibaca
 * dari structured content kanonik yang SAMA dengan renderer PDF. Edit manusia
 * terbatas pada narasi & foto; angka tidak pernah bisa diedit dari sini.
 */
export default async function PaparanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  requireCapabilityPage(user.role, "ai.view");

  const artifact = await db.aiArtifact.findUnique({
    where: { id },
    select: {
      id: true,
      kind: true,
      status: true,
      version: true,
      frozenAt: true,
      structuredContent: true,
      updatedAt: true,
      package: { select: { orgId: true, name: true } },
      run: { select: { scopeIds: true, errorCode: true } },
    },
  });
  if (!artifact || artifact.kind !== "paparan" || artifact.package?.orgId !== user.orgId) notFound();
  if (!scopeCoveredBy(await accessibleLocationIds(user), artifact.run?.scopeIds ?? null)) notFound();

  let content;
  try {
    content = parsePaparanContent(artifact.structuredContent);
  } catch {
    notFound();
  }

  const draf = !(artifact.frozenAt && (artifact.status === "beku" || artifact.status === "terkirim"));
  const slides = susunSlides(content, { draf });
  const bolehReview = can(user.role, "ai.report_review");
  const bolehApprove = can(user.role, "ai.report_approve");
  const bisaDiedit = draf && !artifact.frozenAt && artifact.status !== "beku" && artifact.status !== "terkirim";

  // Thumbnail foto: presigned R2 sementara, hanya untuk kandidat snapshot.
  const thumbUrl = new Map<string, string>();
  if (isR2Configured()) {
    for (const f of content.snapshot.fotoKandidat) {
      try {
        thumbUrl.set(f.id, await r2PresignGet(f.thumbnailKey ?? f.r2Key, 300));
      } catch {
        /* thumbnail gagal → kartu tanpa gambar; PDF tetap jalan sendiri */
      }
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-ink-muted">
            <Link href="/ai/paparan" className="hover:underline">
              Paparan KKP
            </Link>{" "}
            / {artifact.package?.name} · Minggu ke-{content.weekNumber} · v{artifact.version}
          </p>
          <h2 className="truncate text-lg font-semibold text-ink">{content.humanEdits?.title ?? content.narasi.title}</h2>
        </div>
        <Badge tone={AI_ARTIFACT_STATUS_TONE[artifact.status]}>{AI_ARTIFACT_STATUS_LABEL[artifact.status]}</Badge>
        <a
          href={`/api/paparan/${artifact.id}/pdf`}
          target="_blank"
          rel="noopener"
          className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-white hover:bg-primary-800"
        >
          <Download aria-hidden className="size-4" />
          {draf ? "Unduh PDF (draf ber-watermark)" : "Unduh PDF final"}
        </a>
      </div>

      {content.narasiSumber === "deterministik" ? (
        <Banner
          tone="info"
          title="Narasi disusun deterministik (AI tidak tersedia / gugur grounding)"
          description={artifact.run?.errorCode ? `Kode: ${artifact.run.errorCode}. Angka tidak terpengaruh – semuanya dari MARLIN.` : "Angka tidak terpengaruh – semuanya dari MARLIN."}
        />
      ) : null}
      {content.snapshot.periode.berjalan ? (
        <Banner tone="warning" title="Minggu berjalan – belum genap" description="Angka masih akan bergerak sampai minggunya tuntas." />
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          {slides.map((sl, i) => (
            <SlidePreview key={i} slide={sl} nomor={i + 1} total={slides.length} thumbUrl={Object.fromEntries(thumbUrl)} />
          ))}
        </div>
        <div className="space-y-4 self-start">
          {bisaDiedit && bolehReview ? (
            <PaparanReviewClient
              artifactId={artifact.id}
              content={content}
              thumbUrl={Object.fromEntries(thumbUrl)}
            />
          ) : null}
          <PanelLifecycle
            artifactId={artifact.id}
            status={artifact.status}
            frozen={!!artifact.frozenAt}
            bolehReview={bolehReview}
            bolehApprove={bolehApprove}
          />
          <Card>
            <CardHeader title="Sumber data" subtitle="Setiap angka & butir bisa ditelusuri kembali." />
            <CardBody className="max-h-80 space-y-1.5 overflow-y-auto">
              {content.snapshot.sourceRefs.slice(0, 60).map((r) => (
                <p key={r.id} className="text-xs text-ink-muted">
                  {r.href ? (
                    <Link href={r.href} className="font-medium text-primary hover:underline">
                      {r.label}
                    </Link>
                  ) : (
                    <span className="font-medium text-ink">{r.label}</span>
                  )}
                  {r.value ? <span> – {r.value}</span> : null}
                </p>
              ))}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

function PanelLifecycle({
  artifactId,
  status,
  frozen,
  bolehReview,
  bolehApprove,
}: {
  artifactId: string;
  status: string;
  frozen: boolean;
  bolehReview: boolean;
  bolehApprove: boolean;
}) {
  return (
    <Card>
      <CardHeader
        title="Lifecycle"
        subtitle="draft → direview → disetujui → beku. PDF final hanya dari artefak beku; koreksi setelah beku = versi baru."
      />
      <CardBody className="flex flex-wrap gap-2">
        {status === "draft" && bolehReview ? (
          <TombolTransisi artifactId={artifactId} ke="direview" label="Kirim untuk review" />
        ) : null}
        {status === "direview" && bolehReview ? (
          <TombolTransisi artifactId={artifactId} ke="draft" label="Kembalikan ke draft" varian="secondary" />
        ) : null}
        {status === "direview" && bolehApprove ? (
          <TombolTransisi artifactId={artifactId} ke="disetujui" label="Setujui" />
        ) : null}
        {status === "disetujui" && bolehApprove && !frozen ? (
          <TombolTransisi artifactId={artifactId} ke="beku" label="Bekukan (final)" varian="danger" />
        ) : null}
        {frozen ? (
          <p className="text-sm text-ink-muted">Paparan sudah dibekukan – immutable. Perubahan berikutnya lewat versi baru.</p>
        ) : null}
        {!bolehReview && !bolehApprove ? (
          <p className="text-sm text-ink-muted">Anda dapat melihat dan mengunduh; review/persetujuan butuh kapabilitasnya.</p>
        ) : null}
      </CardBody>
    </Card>
  );
}
