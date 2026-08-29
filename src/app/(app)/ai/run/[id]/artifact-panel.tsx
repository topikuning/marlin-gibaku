"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Badge, Banner, Button, Card, CardBody, CardHeader, Combobox, TautanUnduh } from "@/components/ui";
import {
  distributeArtifactAction,
  editArtifactAction,
  transitionArtifactAction,
  type AiHubState,
} from "@/lib/ai-hub/actions";
import { AI_ARTIFACT_STATUS_LABEL, AI_ARTIFACT_STATUS_TONE } from "@/lib/lifecycle";
import type { AiArtifactStatus } from "@/generated/prisma/enums";
import type { ReportOutput } from "@/lib/ai-hub/schemas";
import { MAKS_ANALISIS, MAKS_KEPUTUSAN, buildExecutiveBrief, type AiReportContent } from "@/lib/ai-hub/render";

type ArtifactView = {
  id: string;
  kind: string;
  status: AiArtifactStatus;
  title: string;
  version: number;
  templateKey: string | null;
  frozen: boolean;
  executiveSummary: string;
  waSummary: string;
  report: ReportOutput | null;
  official: AiReportContent["official"] | null;
  humanEdited: boolean;
  renderedText: string | null;
  distributions: { at: string; target: string }[];
};

/**
 * Panel lifecycle artefak laporan AI: edit ringkasan (draft/direview) →
 * kirim review → setujui → bekukan (immutable) → distribusi WA. Tiap tombol
 * server action ber-capability sendiri; frontend hanya menyembunyikan.
 */
export function ArtifactPanel({
  artifacts,
  contacts,
  canReview,
  canApprove,
  canSend,
}: {
  artifacts: ArtifactView[];
  contacts: { id: string; name: string }[];
  canReview: boolean;
  canApprove: boolean;
  canSend: boolean;
}) {
  return (
    <div className="space-y-3">
      {artifacts.map((a) => (
        <ArtifactCard key={a.id} a={a} contacts={contacts} canReview={canReview} canApprove={canApprove} canSend={canSend} />
      ))}
    </div>
  );
}

function TransitionButton({
  artifactId,
  to,
  label,
  variant = "secondary",
}: {
  artifactId: string;
  to: AiArtifactStatus;
  label: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
}) {
  const [state, formAction, pending] = useActionState<AiHubState, FormData>(transitionArtifactAction, undefined);
  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="artifactId" value={artifactId} />
      <input type="hidden" name="to" value={to} />
      <Button type="submit" size="sm" variant={variant} disabled={pending}>
        {pending ? "…" : label}
      </Button>
      {state?.error ? <span className="ml-2 text-xs text-danger">{state.error}</span> : null}
    </form>
  );
}

function ArtifactCard({
  a,
  contacts,
  canReview,
  canApprove,
  canSend,
}: {
  a: ArtifactView;
  contacts: { id: string; name: string }[];
  canReview: boolean;
  canApprove: boolean;
  canSend: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [sections, setSections] = useState(() =>
    (a.report?.sections ?? []).map((section, originalIndex) => ({ ...section, originalIndex })),
  );
  const [recommendations, setRecommendations] = useState(() =>
    (a.report?.recommendations ?? []).map((recommendation, originalIndex) => ({ ...recommendation, originalIndex })),
  );
  const [editState, editFormAction, editPending] = useActionState<AiHubState, FormData>(editArtifactAction, undefined);
  const [distState, distFormAction, distPending] = useActionState<AiHubState, FormData>(distributeArtifactAction, undefined);

  if (a.kind === "saran") {
    // Isi draft DULU tidak ditampilkan sama sekali — kartunya hanya judul, dan
    // subtitle-nya menyuruh "tindak lanjut manual" tanpa memberi jalannya.
    // Sekarang isinya terbaca dan tombol penerapannya ada di antrean tindakan
    // (DECISIONS 195/196).
    return (
      <Card>
        <CardHeader
          title={`Draft saran – ${a.title}`}
          subtitle={
            a.status === "terkirim"
              ? "Sudah diterapkan menjadi Kendala di lokasi."
              : "Belum menjadi apa pun sampai diterapkan di antrean Perlu Tindakan."
          }
          action={<Badge tone={AI_ARTIFACT_STATUS_TONE[a.status]} label={AI_ARTIFACT_STATUS_LABEL[a.status]} />}
        />
        <CardBody className="space-y-2 text-sm">
          {a.executiveSummary ? <p className="whitespace-pre-wrap text-ink">{a.executiveSummary}</p> : null}
          {a.status !== "terkirim" ? (
            <Link href="/ai/actions" className="text-xs text-primary hover:underline">
              Terapkan jadi Kendala di Perlu Tindakan →
            </Link>
          ) : null}
        </CardBody>
      </Card>
    );
  }

  const editable = canReview && !a.frozen && (a.status === "draft" || a.status === "direview" || a.status === "disetujui");
  const brief =
    a.report && a.official
      ? buildExecutiveBrief({
          templateKey: a.templateKey ?? "exec_portfolio",
          templateVersion: a.version,
          humanEdited: a.humanEdited,
          report: a.report,
          official: a.official,
        })
      : null;
  const briefTone = { normal: "success", perhatian: "warning", kritis: "danger", data_kurang: "neutral" } as const;
  const priorityTone = { danger: "danger", warning: "warning", neutral: "neutral" } as const;
  const priorityLabel = { danger: "Mendesak", warning: "Perhatian", neutral: "Pantau" } as const;

  return (
    <Card>
      <CardHeader
        title={`Artefak laporan v${a.version} – ${a.title}`}
        subtitle={`Template ${a.templateKey ?? "–"} · lifecycle: draft → direview → disetujui → beku → terkirim`}
        action={<Badge tone={AI_ARTIFACT_STATUS_TONE[a.status]} label={AI_ARTIFACT_STATUS_LABEL[a.status]} />}
      />
      <CardBody className="space-y-3 text-sm">
        {editState?.error ? <Banner tone="error" title={editState.error} /> : null}
        {editState?.ok ? <Banner tone="success" title={editState.ok} /> : null}

        {editing && editable ? (
          <form action={editFormAction} className="space-y-2">
            <input type="hidden" name="artifactId" value={a.id} />
            <input type="hidden" name="sectionCount" value={sections.length} />
            <input type="hidden" name="recommendationCount" value={recommendations.length} />
            <label className="block text-xs font-medium text-ink-muted" htmlFor={`title-${a.id}`}>
              Judul laporan
            </label>
            <input
              id={`title-${a.id}`}
              name="title"
              defaultValue={a.report?.title ?? a.title}
              className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
            />
            <label className="block text-xs font-medium text-ink-muted" htmlFor={`sum-${a.id}`}>
              Ringkasan eksekutif (editan manusia tercatat)
            </label>
            <textarea
              id={`sum-${a.id}`}
              name="executiveSummary"
              defaultValue={a.executiveSummary}
              rows={5}
              className="w-full rounded-md border border-border bg-surface p-2 text-sm"
            />
            <label className="block text-xs font-medium text-ink-muted" htmlFor={`wa-${a.id}`}>
              Ringkasan WhatsApp
            </label>
            <textarea
              id={`wa-${a.id}`}
              name="waSummary"
              defaultValue={a.waSummary}
              rows={4}
              className="w-full rounded-md border border-border bg-surface p-2 text-sm"
            />
            <div className="space-y-2 border-t border-border-muted pt-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-ink">Analisis pendukung (maks {MAKS_ANALISIS} bagian)</p>
                {sections.length < MAKS_ANALISIS ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setSections((current) => [
                        ...current,
                        { heading: "Bagian baru", body: "", locationId: null, sourceRefIds: [], originalIndex: -1 },
                      ])
                    }
                  >
                    Tambah bagian
                  </Button>
                ) : null}
              </div>
              {sections.map((section, index) => (
                <div key={`${section.originalIndex}-${index}`} className="space-y-2 rounded-md border border-border-muted p-3">
                  <input type="hidden" name={`sectionOriginalIndex:${index}`} value={section.originalIndex} />
                  <input
                    name={`sectionHeading:${index}`}
                    value={section.heading}
                    onChange={(event) =>
                      setSections((current) => current.map((item, i) => (i === index ? { ...item, heading: event.target.value } : item)))
                    }
                    aria-label={`Judul bagian ${index + 1}`}
                    className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm font-medium"
                  />
                  <textarea
                    name={`sectionBody:${index}`}
                    value={section.body}
                    onChange={(event) =>
                      setSections((current) => current.map((item, i) => (i === index ? { ...item, body: event.target.value } : item)))
                    }
                    aria-label={`Isi bagian ${index + 1}`}
                    rows={5}
                    className="w-full rounded-md border border-border bg-surface p-2 text-sm"
                  />
                  {sections.length > 1 ? (
                    <Button type="button" size="sm" variant="ghost" onClick={() => setSections((current) => current.filter((_, i) => i !== index))}>
                      Hapus bagian
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
            <div className="space-y-2 border-t border-border-muted pt-3">
              <div className="flex items-center justify-between gap-2">
                {/* Batasnya sama dengan yang benar-benar tampil di layar, PDF,
                    Excel, dan WA – supaya reviewer tidak menulis butir yang
                    tidak pernah dibaca siapa pun (DECISIONS 454). */}
                <p className="text-xs font-medium text-ink">Keputusan yang diminta (maks {MAKS_KEPUTUSAN})</p>
                {recommendations.length < MAKS_KEPUTUSAN ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setRecommendations((current) => [
                        ...current,
                        { title: "Keputusan baru", reason: "", locationId: null, sourceRefIds: [], originalIndex: -1 },
                      ])
                    }
                  >
                    Tambah keputusan
                  </Button>
                ) : null}
              </div>
              {recommendations.map((recommendation, index) => (
                <div key={`${recommendation.originalIndex}-${index}`} className="space-y-2 rounded-md border border-border-muted p-3">
                  <input type="hidden" name={`recommendationOriginalIndex:${index}`} value={recommendation.originalIndex} />
                  <input
                    name={`recommendationTitle:${index}`}
                    value={recommendation.title}
                    onChange={(event) =>
                      setRecommendations((current) => current.map((item, i) => (i === index ? { ...item, title: event.target.value } : item)))
                    }
                    aria-label={`Judul keputusan ${index + 1}`}
                    className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm font-medium"
                  />
                  <textarea
                    name={`recommendationReason:${index}`}
                    value={recommendation.reason}
                    onChange={(event) =>
                      setRecommendations((current) => current.map((item, i) => (i === index ? { ...item, reason: event.target.value } : item)))
                    }
                    aria-label={`Alasan keputusan ${index + 1}`}
                    rows={3}
                    className="w-full rounded-md border border-border bg-surface p-2 text-sm"
                  />
                  <Button type="button" size="sm" variant="ghost" onClick={() => setRecommendations((current) => current.filter((_, i) => i !== index))}>
                    Hapus keputusan
                  </Button>
                </div>
              ))}
            </div>
            <input name="note" placeholder="Catatan edit (opsional)" className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm" />
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={editPending}>
                {editPending ? "Menyimpan…" : "Simpan edit"}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Batal
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            {brief ? (
              <>
                {/* Peringatan data kosong tampil di layar juga, bukan hanya di
                    PDF/WA – pembaca layar tidak boleh menilai kinerja fisik
                    dari deviasi yang sebenarnya cuma laporan belum masuk. */}
                {brief.dataWarning ? (
                  <Banner tone="warning" title="Jangan menilai kinerja fisik dulu" description={brief.dataWarning} />
                ) : null}
                <div className="rounded-lg border border-border bg-surface-inset p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Kesimpulan 30 detik</p>
                    <Badge tone={briefTone[brief.status]} label={brief.statusLabel} />
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-base font-medium leading-relaxed text-ink">{brief.headline}</p>
                  <p className="mt-2 text-xs text-ink-faint">{brief.evidenceLabel}</p>
                </div>

                <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
                  {brief.kpis.map((kpi) => (
                    <div key={kpi.label} className="rounded-md border border-border-muted p-3">
                      <p className="text-xs text-ink-muted">{kpi.label}</p>
                      <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{kpi.value}</p>
                      <p className="text-xs text-ink-muted">{kpi.note}</p>
                    </div>
                  ))}
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <section>
                    <h4 className="mb-2 font-semibold text-ink">3 prioritas utama</h4>
                    <div className="space-y-2">
                      {brief.priorities.map((priority, index) => (
                        <div key={`${priority.name}-${index}`} className="flex gap-3 rounded-md border border-border-muted p-3">
                          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-inset text-xs font-semibold text-ink">
                            {index + 1}
                          </span>
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium text-ink">{priority.name}</p>
                              <Badge tone={priorityTone[priority.tone]} label={priorityLabel[priority.tone]} />
                            </div>
                            <p className="text-xs text-ink-muted">{priority.packageName} · {priority.province}</p>
                            <p className="mt-1 text-ink-muted">{priority.reason}</p>
                            <p className="mt-1 text-xs tabular-nums text-ink-muted">
                              Realisasi {priority.actualPct.toFixed(1)}% · rencana {priority.planPct.toFixed(1)}% · laporan {priority.finalReports}/{priority.expectedReports}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section>
                    <h4 className="mb-2 font-semibold text-ink">Keputusan yang diminta</h4>
                    {brief.decisions.length ? (
                      <>
                        <ol className="space-y-2">
                          {brief.decisions.map((decision, index) => (
                            <li key={`${decision.title}-${index}`} className="rounded-md border border-border-muted p-3">
                              <p className="font-medium text-ink">{index + 1}. {decision.title}</p>
                              <p className="mt-1 text-xs font-medium text-ink-muted">Fokus: {decision.scopeLabel}</p>
                              <p className="mt-1 text-ink-muted">{decision.reason}</p>
                            </li>
                          ))}
                        </ol>
                        {/* Yang disembunyikan disebut jumlahnya – "tidak muncul"
                            tidak boleh terbaca "tidak ada". */}
                        {brief.decisionsHidden > 0 ? (
                          <p className="mt-2 text-xs text-ink-faint">
                            {brief.decisionsHidden} usulan lain di luar tiga teratas tidak ditampilkan – buka “Edit seluruh
                            laporan” untuk melihat atau menghapusnya.
                          </p>
                        ) : null}
                      </>
                    ) : (
                      <p className="rounded-md border border-border-muted p-3 text-ink-muted">Tidak ada keputusan yang diminta pada periode ini.</p>
                    )}
                  </section>
                </div>
              </>
            ) : (
              <p className="whitespace-pre-wrap text-ink">{a.executiveSummary}</p>
            )}

            {a.report?.sections.length ? (
              <details className="rounded-md border border-border-muted">
                <summary className="cursor-pointer px-3 py-2 font-medium text-ink">Buka analisis pendukung</summary>
                <div className="space-y-2 border-t border-border-muted p-3">
                  {a.report.sections.map((section, index) => (
                    <section key={index}>
                      <h4 className="font-medium text-ink">{section.heading}</h4>
                      <p className="mt-1 whitespace-pre-wrap text-ink-muted">{section.body}</p>
                    </section>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-border-muted pt-3">
          <Link href={`/cetak/ai/${a.id}`} target="_blank" className="text-xs text-primary hover:underline">
            Pratinjau / Cetak (PDF) →
          </Link>
          <TautanUnduh
            href={`/api/ai-artifact/${a.id}/excel`}
            labelSibuk="Menyiapkan Excel…"
            className="text-xs text-primary hover:underline"
          >
            Unduh Excel →
          </TautanUnduh>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {editable && !editing ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Edit seluruh laporan
            </Button>
          ) : null}
          {a.status === "draft" && canReview ? (
            <TransitionButton artifactId={a.id} to="direview" label="Kirim untuk review" variant="primary" />
          ) : null}
          {a.status === "direview" && canApprove ? (
            <>
              <TransitionButton artifactId={a.id} to="disetujui" label="Setujui" variant="primary" />
              <TransitionButton artifactId={a.id} to="draft" label="Minta perbaikan" />
            </>
          ) : null}
          {a.status === "disetujui" && canApprove ? (
            <TransitionButton artifactId={a.id} to="beku" label="Bekukan (final)" variant="primary" />
          ) : null}
        </div>

        {(a.status === "beku" || a.status === "terkirim") && canSend ? (
          <form action={distFormAction} className="space-y-2 border-t border-border-muted pt-3">
            <input type="hidden" name="artifactId" value={a.id} />
            <p className="text-xs font-medium text-ink">Distribusi WhatsApp</p>
            {/* Kontak tersimpan ATAU tujuan bebas (nomor / id grup) — fungsi
                bawaan menu Laporan → WA yang dilebur ke sini (DECISIONS 194).
                Isi salah satu; kontak menang bila dua-duanya terisi. */}
            <div className="flex flex-wrap items-center gap-2">
              <Combobox
                id={`dist-${a.id}`}
                name="contactId"
                defaultValue=""
                placeholder="– kontak tersimpan –"
                className="w-56"
              >
                <option value="">– tanpa kontak (isi tujuan manual) –</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Combobox>
              <span className="text-xs text-ink-muted">atau</span>
              <input
                name="destChatId"
                placeholder="628xxx / 12036…@g.us"
                className="h-9 w-52 rounded-md border border-border bg-surface px-3 text-sm"
              />
              <input
                name="destName"
                placeholder="nama tujuan (opsional)"
                className="h-9 w-44 rounded-md border border-border bg-surface px-3 text-sm"
              />
              <Button type="submit" size="sm" disabled={distPending}>
                {distPending ? "Mengirim…" : "Kirim"}
              </Button>
            </div>
            {distState?.error ? <span className="text-xs text-danger">{distState.error}</span> : null}
            {distState?.ok ? <span className="text-xs text-success">{distState.ok}</span> : null}
          </form>
        ) : null}

        {a.distributions.length > 0 ? (
          <p className="text-xs text-ink-faint">
            Riwayat distribusi: {a.distributions.map((d) => `${d.target} (${d.at.slice(0, 16).replace("T", " ")})`).join("; ")}
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}
