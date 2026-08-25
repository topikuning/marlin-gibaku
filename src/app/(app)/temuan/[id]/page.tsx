import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardBody, CardHeader, PageHeader, StatusPill } from "@/components/ui";
import { hasLocationAccess, requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { detailTemuan } from "@/lib/findings/queries";
import { documentDisplayName } from "@/lib/document-label";
import { formatTanggal, formatTanggalWaktu } from "@/lib/format";
import {
  EVIDENCE_VERIF_STATUS_LABEL,
  EVIDENCE_VERIF_STATUS_TONE,
  FINDING_CATEGORY_LABEL,
  FINDING_STATUS_LABEL,
  FINDING_STATUS_TONE,
  ISSUE_SEVERITY_LABEL,
  ISSUE_SEVERITY_TONE,
} from "@/lib/lifecycle";
import { isR2Configured, r2PresignGet } from "@/lib/r2";
import { AksiTemuan, FormBukti, FormVerifikasiBukti } from "./aksi-temuan";

export const metadata: Metadata = { title: "Detail Temuan" };
export const dynamic = "force-dynamic";

const SOURCE_LABEL: Record<string, string> = {
  inspeksi: "Inspeksi lapangan", laporan_harian: "Laporan harian", dokumen: "Pemeriksaan dokumen", manual: "Dicatat langsung",
};

export default async function DetailTemuanPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  requireCapabilityPage(user.role, "finding.view");
  const { id } = await params;

  const t = await detailTemuan(id);
  if (!t) notFound();
  if (!(await hasLocationAccess(user, t.locationId))) notFound();

  const bolehRespond = can(user.role, "finding.respond");
  const bolehVerify = can(user.role, "finding.verify");

  // Pratinjau foto bukti (URL presign, kadaluarsa singkat).
  const thumbs = new Map<string, string>();
  if (isR2Configured()) {
    await Promise.all(
      t.evidences
        .filter((e) => e.photo)
        .map(async (e) => {
          const key = e.photo!.thumbnailKey ?? e.photo!.r2Key;
          try {
            thumbs.set(e.id, await r2PresignGet(key));
          } catch {
            // Foto tidak bisa dipratinjau — barisnya tetap tampil tanpa gambar.
          }
        }),
    );
  }

  // Pilihan bukti yang bisa ditautkan (foto & dokumen lokasi ini).
  const [fotoLokasi, dokumenLokasi] = await Promise.all([
    db.photo.findMany({
      where: { locationId: t.locationId },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, stampPhotoId: true, createdAt: true },
    }),
    db.document.findMany({
      where: { locationId: t.locationId, status: "aktif" },
      orderBy: { uploadedAt: "desc" },
      take: 100,
      select: { id: true, type: true, title: true, docNumber: true, docDate: true, fileName: true, locationId: true, packageId: true, uploadedAt: true },
    }),
  ]);

  const nama = (uid: string | null | undefined) => (uid ? (t.nama.get(uid) ?? "(tidak dikenal)") : "–");

  // Linimasa gabungan: histori status + klarifikasi + tindak lanjut, urut waktu.
  type Baris = { at: Date; jenis: string; teks: string; oleh: string };
  const linimasa: Baris[] = [
    ...t.statusHistory.map((h) => ({
      at: h.changedAt,
      jenis: h.fromStatus ? `${FINDING_STATUS_LABEL[h.fromStatus]} → ${FINDING_STATUS_LABEL[h.toStatus]}` : "Dicatat",
      teks: h.note ?? "",
      oleh: nama(h.changedById),
    })),
    ...t.notes.map((n) => ({ at: n.createdAt, jenis: "Tindak lanjut", teks: n.note, oleh: nama(n.createdById) })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={[{ label: "Temuan", href: "/temuan" }, { label: t.title }]}
        title={t.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill tone={FINDING_STATUS_TONE[t.status]} label={FINDING_STATUS_LABEL[t.status]} />
            <Badge tone={ISSUE_SEVERITY_TONE[t.severity]} label={ISSUE_SEVERITY_LABEL[t.severity]} />
            <Badge tone="neutral" label={FINDING_CATEGORY_LABEL[t.category]} />
            {t.reopenCount > 0 ? <Badge tone="warning" label={`Dibuka ulang ${t.reopenCount}×`} /> : null}
          </span>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Rincian" />
          <CardBody>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-ink-muted">Lokasi</dt>
              <dd><Link className="text-primary underline" href={`/lokasi/${t.location.slug}`}>{t.location.name}</Link></dd>
              <dt className="text-ink-muted">Paket</dt>
              <dd>{t.location.package.name}</dd>
              <dt className="text-ink-muted">Sumber</dt>
              <dd>
                {SOURCE_LABEL[t.source] ?? t.source}
                {t.report ? (
                  <> · <Link className="text-primary underline" href={`/lokasi/${t.report.location.slug}/harian/${t.report.reportDate.toISOString().slice(0, 10)}`}>laporan {formatTanggal(t.report.reportDate)}</Link></>
                ) : null}
                {t.inspection ? <> · inspeksi {formatTanggal(t.inspection.inspectionDate)}</> : null}
              </dd>
              <dt className="text-ink-muted">Tanggal temuan</dt>
              <dd>{formatTanggal(t.findingDate)}</dd>
              <dt className="text-ink-muted">Tenggat</dt>
              <dd>{t.dueDate ? formatTanggal(t.dueDate) : "–"}</dd>
              <dt className="text-ink-muted">Item pekerjaan</dt>
              <dd>{t.workItemName ?? "–"}</dd>
              <dt className="text-ink-muted">Dicatat oleh</dt>
              <dd>{nama(t.raisedById)}</dd>
              <dt className="text-ink-muted">PIC tindak lanjut</dt>
              <dd>{t.assignedToId ? nama(t.assignedToId) : (t.assignedName ?? "belum ditetapkan")}</dd>
              {t.closedAt ? (
                <>
                  <dt className="text-ink-muted">Ditutup</dt>
                  <dd>{formatTanggalWaktu(t.closedAt)} oleh {nama(t.closedById)}</dd>
                </>
              ) : null}
            </dl>
            {t.description ? <p className="mt-3 whitespace-pre-wrap text-sm text-ink">{t.description}</p> : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Aksi" subtitle="Sesuai peran Anda" />
          <CardBody>
            <AksiTemuan
              findingId={t.id}
              status={t.status}
              bolehRespond={bolehRespond}
              bolehVerify={bolehVerify}
              klarifikasiTerbuka={t.clarifications.filter((c) => !c.response).map((c) => ({ id: c.id, question: c.question }))}
            />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title={`Bukti (${t.evidences.length})`} subtitle="Tautan ke foto / dokumen yang sudah ada – tidak ada berkas ganda" />
        <CardBody className="space-y-3">
          {t.evidences.length === 0 ? (
            <p className="text-sm text-ink-muted">Belum ada bukti yang ditautkan.</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {t.evidences.map((e) => {
                const thumb = thumbs.get(e.id);
                const label = e.photo
                  ? `Foto ${e.photo.stampPhotoId ?? e.photo.id.slice(0, 8)}`
                  : documentDisplayName(e.document!).name;
                return (
                  <li key={e.id} className="flex items-start gap-3 rounded-lg border border-border p-2">
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumb} alt={label} className="h-16 w-16 rounded object-cover" />
                    ) : (
                      <div className="flex h-16 w-16 items-center justify-center rounded bg-surface-muted text-xs text-ink-faint">
                        {e.photo ? "foto" : "dok"}
                      </div>
                    )}
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="truncate font-medium text-ink">
                        {e.document ? (
                          <Link className="text-primary underline" href={`/dokumen/${e.document.id}`}>{label}</Link>
                        ) : (
                          label
                        )}
                      </div>
                      {e.caption ? <div className="text-xs text-ink-muted">{e.caption}</div> : null}
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        <StatusPill tone={EVIDENCE_VERIF_STATUS_TONE[e.verifStatus]} label={EVIDENCE_VERIF_STATUS_LABEL[e.verifStatus]} />
                        {e.verifNote ? <span className="text-xs text-ink-muted">{e.verifNote}</span> : null}
                      </div>
                      {bolehVerify && e.verifStatus === "belum" ? <FormVerifikasiBukti linkId={e.id} /> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {bolehRespond || bolehVerify ? (
            <FormBukti
              findingId={t.id}
              foto={fotoLokasi.map((p) => ({ value: p.id, label: `${p.stampPhotoId ?? p.id.slice(0, 8)} – ${formatTanggal(p.createdAt)}` }))}
              dokumen={dokumenLokasi.map((d) => ({ value: d.id, label: documentDisplayName(d).name }))}
            />
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Klarifikasi" subtitle="Pertanyaan verifikator dan jawabannya" />
        <CardBody>
          {t.clarifications.length === 0 ? (
            <p className="text-sm text-ink-muted">Belum ada permintaan klarifikasi.</p>
          ) : (
            <ul className="space-y-3">
              {t.clarifications.map((c) => (
                <li key={c.id} className="rounded-lg border border-border p-3 text-sm">
                  <div className="font-medium text-ink">{c.question}</div>
                  <div className="text-xs text-ink-muted">
                    ditanya {nama(c.askedById)} · {formatTanggalWaktu(c.askedAt)}
                    {c.dueDate ? <> · tenggat {formatTanggal(c.dueDate)}</> : null}
                  </div>
                  {c.response ? (
                    <div className="mt-2 rounded bg-surface-muted p-2">
                      <div className="whitespace-pre-wrap">{c.response}</div>
                      <div className="mt-1 text-xs text-ink-muted">
                        dijawab {nama(c.respondedById)} · {c.respondedAt ? formatTanggalWaktu(c.respondedAt) : ""}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 text-xs text-warning">Belum dijawab.</div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Linimasa" />
        <CardBody>
          <ul className="space-y-2 text-sm">
            {linimasa.map((b, i) => (
              <li key={i} className="flex gap-3">
                <span className="w-36 shrink-0 text-xs text-ink-muted">{formatTanggalWaktu(b.at)}</span>
                <span className="min-w-0">
                  <span className="font-medium text-ink">{b.jenis}</span>
                  {b.teks ? <span className="text-ink-muted"> – {b.teks}</span> : null}
                  <span className="text-xs text-ink-faint"> · {b.oleh}</span>
                </span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
