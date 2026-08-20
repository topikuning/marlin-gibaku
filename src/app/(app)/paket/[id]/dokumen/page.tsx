import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FolderOpen } from "lucide-react";
import {
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  Drawer,
  EmptyState,
  MiniStat,
  ProgressBar,
  StatusPill,
} from "@/components/ui";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { can } from "@/lib/authz";
import { documentDisplayNames } from "@/lib/document-label";
import { formatPct, formatTanggal } from "@/lib/format";
import { getPackageWorkspace } from "@/lib/package/queries";
import { ensureMilestones } from "@/lib/milestones/actions";
import { milestoneBoard, MILESTONE_STATUS_LABEL, MILESTONE_STATUS_TONE } from "@/lib/milestones/queries";
import type { AdminPhase } from "@/generated/prisma/enums";
import { MilestonePanel, SyncComplianceButton } from "@/app/(app)/lokasi/[slug]/dokumen/kepatuhan-client";
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
  const canManage = can(user.role, "compliance.manage");
  const canVerify = can(user.role, "document.verify");

  // Papan milestone administrasi INDUK (satu untuk paket — locationId null).
  await ensureMilestones(pkg.id);
  const [indukBoard, picOptions] = await Promise.all([
    milestoneBoard({ packageId: pkg.id }),
    db.user.findMany({
      where: {
        isActive: true,
        OR: [
          { role: { in: ["super_admin", "program_director", "regional_manager", "project_manager"] } },
          { assignments: { some: { location: { packageId: pkg.id }, unassignedAt: null } } },
        ],
      },
      select: { id: true, fullName: true },
      orderBy: { fullName: "asc" },
    }),
  ]);

  // Dokumen yang DIBATALKAN tidak ikut: ia bukan berkas resmi lagi & tidak
  // dihitung sebagai bukti kepatuhan (DECISIONS 183).
  const documents = await db.document.findMany({
    where: { packageId: pkg.id, status: "aktif" },
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
      locationId: true,
      location: { select: { name: true } },
    },
  });
  const docLabels = documentDisplayNames(
    documents.map((d) => ({ ...d, packageId: pkg.id, packageName: pkg.name, locationName: d.location?.name ?? null })),
  );

  const byPhase = new Map<AdminPhase, typeof documents>();
  for (const doc of documents) {
    const list = byPhase.get(doc.phase) ?? [];
    list.push(doc);
    byPhase.set(doc.phase, list);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Kepatuhan administrasi induk (paket)"
          subtitle="Berlaku untuk seluruh lokasi. Status diturunkan otomatis dari dokumen yang diunggah."
          action={
            <div className="flex flex-wrap gap-2">
              {/*
                Form unggah pindah ke balik tombol (DECISIONS 386). Sebelumnya
                ia kartu tersendiri di antara papan kepatuhan dan daftar
                dokumen – memisahkan dua hal yang justru dibaca berurutan,
                demi form yang dipakai sesekali.
              */}
              {canUpload ? (
                <Drawer
                  trigger="+ Unggah dokumen"
                  triggerVariant="primary"
                  title="Unggah dokumen ke paket ini"
                  subtitle="Paket sudah terisi otomatis. Fase & jenis dokumen memakai kategori resmi."
                >
                  <PackageDocUploadForm
                    packageId={pkg.id}
                    locations={pkg.locations.map((l) => ({ id: l.id, name: l.name }))}
                  />
                </Drawer>
              ) : null}
              {canManage ? <SyncComplianceButton packageId={pkg.id} /> : null}
            </div>
          }
        />
        <CardBody className="space-y-5">
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="tabular font-semibold text-ink">
                {indukBoard.done} / {indukBoard.total} selesai
              </span>
              <span className="tabular text-[13px] text-ink-muted">
                {formatPct(indukBoard.completenessPct)} lengkap
              </span>
            </div>
            <ProgressBar
              value={indukBoard.completenessPct}
              tone={indukBoard.late > 0 ? "warning" : "success"}
              label="Kelengkapan administrasi paket"
            />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {/*
                "Terlambat" berdiri sendiri, tidak dilebur ke dalam kalimat
                subtitle seperti sebelumnya. Ia satu-satunya angka di kartu ini
                yang menuntut tindakan, dan angka yang menuntut tindakan tidak
                boleh dibaca sambil lalu di tengah kalimat.
              */}
              <MiniStat
                label="Terlambat"
                value={indukBoard.late}
                className={indukBoard.late > 0 ? "border-warning-border bg-warning-soft" : undefined}
              />
              <MiniStat label="Belum selesai" value={indukBoard.total - indukBoard.done} />
              <MiniStat label="Dokumen terunggah" value={documents.length} />
            </div>
          </div>

          {indukBoard.phases.map((phase) => (
            <section key={phase.phase}>
              <h3 className="mb-2 flex items-center justify-between text-sm font-semibold text-ink">
                {phase.label}
                <span className="tabular text-xs font-normal text-ink-muted">
                  {phase.done}/{phase.total} selesai
                </span>
              </h3>
              <MilestonePanel
                packageId={pkg.id}
                items={phase.items.map((m) => ({
                  id: m.id,
                  name: m.name,
                  status: m.status,
                  statusLabel: m.isLate ? "Terlambat" : MILESTONE_STATUS_LABEL[m.status],
                  statusTone: m.isLate ? ("danger" as const) : MILESTONE_STATUS_TONE[m.status],
                  requiresVerification: m.requiresVerification,
                  verified: m.verifiedById !== null,
                  picUserId: m.picUserId,
                  picName: m.picName,
                  dueDate: m.dueDate ? m.dueDate.toISOString().slice(0, 10) : null,
                  note: m.note,
                  documents: m.documents.map((d) => ({ id: d.id, title: d.title })),
                }))}
                picOptions={picOptions}
                canManage={canManage}
                canVerify={canVerify}
                canUpload={canUpload}
              />
            </section>
          ))}
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(18rem,0.4fr)]">
      <Card>
        <CardHeader
          title="Dokumen paket"
          subtitle={`${documents.length} dokumen – dikelompokkan per fase`}
          action={<ButtonLink href="/dokumen">Document Center</ButtonLink>}
        />
        <CardBody>
          {documents.length === 0 ? (
            <EmptyState
              icon={FolderOpen}
              title="Belum ada dokumen paket"
              description={
                canUpload
                  ? "Pakai tombol “+ Unggah dokumen” di kartu kepatuhan di atas – undangan, BA, SPPBJ, kontrak, dst."
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
                          <Link
                            href={`/dokumen/${doc.id}`}
                            className="font-medium text-ink hover:text-primary hover:underline"
                          >
                            {docLabels.get(doc.id)?.name ?? doc.title}
                          </Link>
                          <p className="text-xs text-ink-muted">
                            {docLabels.get(doc.id)?.secondary
                              ? `${docLabels.get(doc.id)!.secondary} · `
                              : ""}
                            <a
                              href={`/api/documents/${doc.id}`}
                              target="_blank"
                              rel="noopener"
                              className="text-primary hover:underline"
                            >
                              buka berkas
                            </a>
                            {` · ${doc.fileName}`}
                          </p>
                        </div>
                        <div className="flex min-w-0 items-center gap-2">
                          <StatusPill tone="neutral" label={docTypeLabel(doc.type)} />
                          <span className="text-xs whitespace-nowrap text-ink-muted">
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

      {canUpload ? (
        <Card className="self-start">
          <CardHeader
            title="Impor dari folder Drive KKP"
            subtitle="Berkas yang sudah ada di folder KKP ditarik masuk: MARLIN membaca folder itu, menebak jenis & desanya, lalu menyalin yang Anda setujui."
            /* Keadaannya disebut di kepala kartu, bukan disembunyikan sebagai
               catatan kecil di bawah tombol yang ternyata belum bisa dipakai. */
            action={
              <StatusPill
                tone={pkg.driveFolderId ? "success" : "warning"}
                label={pkg.driveFolderId ? "Folder tertaut" : "Belum tertaut"}
              />
            }
          />
          <CardBody className="space-y-2">
            {pkg.driveFolderId ? (
              <>
                <p className="text-[13px] text-ink-muted">
                  Kontrak, SPMK, BA PCM, MC-0, dan berkas termin adalah yang paling sering
                  ditemukan di sana.
                </p>
                <ButtonLink href={`/dokumen/impor?paket=${pkg.id}`} className="w-full">
                  Buka impor dari Drive
                </ButtonLink>
              </>
            ) : (
              <>
                <p className="text-[13px] text-ink-muted">
                  Paket ini belum punya folder Google Drive, jadi impor belum punya tempat untuk
                  membaca. Tautkan dulu di Ringkasan → Komunikasi paket.
                </p>
                <ButtonLink href={`/paket/${pkg.id}`} className="w-full">
                  Tautkan folder dulu
                </ButtonLink>
              </>
            )}
          </CardBody>
        </Card>
      ) : null}
      </div>
    </div>
  );
}
