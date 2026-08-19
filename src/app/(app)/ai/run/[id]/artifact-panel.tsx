"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Badge, Banner, Button, Card, CardBody, CardHeader, Combobox } from "@/components/ui";
import {
  distributeArtifactAction,
  editArtifactAction,
  transitionArtifactAction,
  type AiHubState,
} from "@/lib/ai-hub/actions";
import { AI_ARTIFACT_STATUS_LABEL, AI_ARTIFACT_STATUS_TONE } from "@/lib/lifecycle";
import type { AiArtifactStatus } from "@/generated/prisma/enums";

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
          <p className="whitespace-pre-wrap text-ink">{a.executiveSummary}</p>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-border-muted pt-3">
          <Link href={`/cetak/ai/${a.id}`} target="_blank" className="text-xs text-primary hover:underline">
            Pratinjau / Cetak (PDF) →
          </Link>
          <a href={`/api/ai-artifact/${a.id}/excel`} className="text-xs text-primary hover:underline">
            Unduh Excel →
          </a>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {editable && !editing ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Edit ringkasan
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
