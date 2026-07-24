import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FolderOpen } from "lucide-react";
import { Card, CardBody, CardHeader, CollapsibleCard, EmptyState, StatusPill } from "@/components/ui";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { can } from "@/lib/authz";
import { formatTanggal } from "@/lib/format";
import { getPackageWorkspace } from "@/lib/package/queries";
import type { AdminPhase } from "@/generated/prisma/enums";
import { PackageDocUploadForm } from "./upload-form";

export const metadata: Metadata = { title: "Dokumen Paket" };
export const dynamic = "force-dynamic";

const PHASE_LABEL: Record<AdminPhase, string> = {
  pemilihan: "Pemilihan",
  penunjukan: "Penunjukan",
  kontrak: "Kontrak",
  mulai_kerja: "Mulai Kerja",
  pelaksanaan: "Pelaksanaan",
  adendum: "Adendum",
  serah_terima: "Serah Terima",
  pembayaran: "Pembayaran",
  lainnya: "Lainnya",
};

const PHASE_ORDER: AdminPhase[] = [
  "pemilihan",
  "penunjukan",
  "kontrak",
  "mulai_kerja",
  "pelaksanaan",
  "adendum",
  "serah_terima",
  "pembayaran",
  "lainnya",
];

const UPPER = new Set(["hps", "spmk", "sppbj", "mc0", "pcm", "ba", "bast", "pho", "fho"]);

/** "ba_serah_terima_lapangan" → "BA Serah Terima Lapangan". */
function docTypeLabel(type: string): string {
  return type
    .split("_")
    .map((w) => (UPPER.has(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

export default async function DokumenPaketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  requireCapabilityPage(user.role, "package.view");
  requireCapabilityPage(user.role, "document.view");
  const { id } = await params;

  const pkg = await getPackageWorkspace(id);
  if (!pkg) notFound();
  const canUpload = can(user.role, "document.upload");

  const documents = await db.document.findMany({
    where: { packageId: pkg.id },
    orderBy: { uploadedAt: "desc" },
    select: {
      id: true,
      phase: true,
      type: true,
      title: true,
      docNumber: true,
      docDate: true,
      fileName: true,
      uploadedAt: true,
    },
  });

  const byPhase = new Map<AdminPhase, typeof documents>();
  for (const doc of documents) {
    const list = byPhase.get(doc.phase) ?? [];
    list.push(doc);
    byPhase.set(doc.phase, list);
  }

  return (
    <div className="space-y-6">
      {canUpload ? (
        <CollapsibleCard
          title="Unggah dokumen ke paket ini"
          subtitle="Langsung dari sini — paket sudah terisi otomatis, tak perlu ke Document Center. Fase & jenis dokumen pakai kategori resmi."
          defaultOpen={documents.length === 0}
        >
          <PackageDocUploadForm
            packageId={pkg.id}
            locations={pkg.locations.map((l) => ({ id: l.id, name: l.name }))}
          />
        </CollapsibleCard>
      ) : null}

      <Card>
        <CardHeader
          title="Dokumen paket"
          subtitle={`${documents.length} dokumen — per fase`}
          action={
            <Link href="/dokumen" className="text-[13px] font-medium text-primary hover:underline">
              Buka Document Center
            </Link>
          }
        />
        <CardBody>
          {documents.length === 0 ? (
            <EmptyState
              icon={FolderOpen}
              title="Belum ada dokumen paket"
              description={
                canUpload
                  ? "Gunakan formulir “Unggah dokumen ke paket ini” di atas — undangan, BA, SPPBJ, kontrak, dst."
                  : "Belum ada dokumen administrasi untuk paket ini."
              }
            />
          ) : (
            <div className="space-y-5">
              {PHASE_ORDER.filter((phase) => byPhase.has(phase)).map((phase) => (
                <div key={phase}>
                  <h3 className="mb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">
                    {PHASE_LABEL[phase]}
                  </h3>
                  <ul className="divide-y divide-border rounded-md border border-border">
                    {byPhase.get(phase)!.map((doc) => (
                      <li
                        key={doc.id}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                      >
                        <div className="min-w-0">
                          <p className="font-medium text-ink">{doc.title}</p>
                          <p className="text-xs text-ink-muted">
                            {doc.fileName}
                            {doc.docNumber ? ` · No. ${doc.docNumber}` : ""}
                            {doc.docDate ? ` · ${formatTanggal(doc.docDate)}` : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <StatusPill tone="neutral" label={docTypeLabel(doc.type)} />
                          <span className="text-xs text-ink-muted">
                            {formatTanggal(doc.uploadedAt)}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
