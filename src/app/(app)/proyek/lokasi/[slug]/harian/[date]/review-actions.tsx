"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Printer, Undo2 } from "lucide-react";
import { Banner, Button, Label, Textarea } from "@/components/ui";
import {
  AREA_KOREKSI,
  ARTI_AREA_KOREKSI,
  LABEL_AREA_KOREKSI,
} from "@/lib/daily-report/area-koreksi";
import {
  addIssueAction,
  approveReportAction,
  finalizeReportAction,
  unfinalizeReportAction,
  returnReportAction,
  type DailyActionState,
} from "@/lib/daily-report/actions";
import { ISSUE_SEVERITY_LABEL } from "@/lib/daily-report/constants";
import { Combobox } from "@/components/ui";
import { withBackTo } from "@/lib/print-back";

/**
 * Aksi reviewer atas sebuah laporan.
 *
 * - `verifikasi` (status DIKIRIM): Setujui / Kembalikan.
 * - `koreksi` (status DISETUJUI): hanya Kembalikan. Ini satu-satunya jalan
 *   membuat laporan yang sudah disetujui — termasuk yang baru dibuka kuncinya
 *   dari final — bisa DIEDIT lagi. Tanpa ini, membuka kunci final berhenti di
 *   status disetujui yang tidak bisa diedit sama sekali (laporan user
 *   2026-07-31, DECISIONS 192).
 */
export function ReviewActions({
  reportId,
  mode = "verifikasi",
}: {
  reportId: string;
  mode?: "verifikasi" | "koreksi";
}) {
  const [approveState, approveAction, approvePending] = useActionState<DailyActionState, FormData>(
    approveReportAction,
    undefined,
  );
  const [returnState, returnAction, returnPending] = useActionState<DailyActionState, FormData>(
    returnReportAction,
    undefined,
  );
  const [showReturn, setShowReturn] = useState(false);

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-4 shadow-xs">
      <h2 className="text-sm font-semibold text-ink">
        {mode === "koreksi" ? "Kembalikan untuk diedit" : "Verifikasi laporan"}
      </h2>
      {mode === "koreksi" ? (
        <p className="text-[13px] text-ink-muted">
          Laporan berstatus Disetujui tidak bisa diedit. Kembalikan ke Perlu Koreksi supaya isinya
          bisa diperbaiki — <strong>volumenya berhenti dihitung di progres &amp; kurva-S</strong>{" "}
          sampai laporan dikirim &amp; disetujui ulang.
        </p>
      ) : null}
      {approveState?.error ? <Banner tone="error" title={approveState.error} /> : null}
      {approveState?.success ? <Banner tone="success" title={approveState.success} /> : null}
      {returnState?.error ? <Banner tone="error" title={returnState.error} /> : null}
      {returnState?.success ? <Banner tone="success" title={returnState.success} /> : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        {mode === "verifikasi" ? (
          <form action={approveAction} className="flex-1">
            <input type="hidden" name="reportId" value={reportId} />
            <Button type="submit" loading={approvePending} className="h-11 w-full">
              <CheckCircle2 aria-hidden className="size-4" />
              Setujui
            </Button>
          </form>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          className="h-11 flex-1"
          onClick={() => setShowReturn((v) => !v)}
        >
          <Undo2 aria-hidden className="size-4" />
          {mode === "koreksi" ? "Kembalikan untuk koreksi" : "Kembalikan"}
        </Button>
      </div>

      {showReturn ? (
        <form action={returnAction} className="space-y-2 rounded-md border border-warning-border bg-warning-soft p-3">
          <input type="hidden" name="reportId" value={reportId} />
          {/*
           * Bagian mana yang salah (DECISIONS 256). Tanpa ini catatan reviewer
           * hanya bisa tampil sebagai spanduk di puncak halaman, dan mandor
           * menggulir seluruh editor sambil menebak apa yang dimaksud "cek
           * ulang zona B". Tidak wajib — memaksa memilih hanya melahirkan
           * pilihan asal supaya tombolnya hidup.
           */}
          <fieldset>
            <legend className="mb-1 text-sm font-medium text-ink">
              Bagian yang perlu diperbaiki{" "}
              <span className="font-normal text-ink-muted">(boleh lebih dari satu)</span>
            </legend>
            <div className="grid gap-1 sm:grid-cols-2">
              {AREA_KOREKSI.map((a) => (
                <label key={a} className="flex items-start gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    name="areas"
                    value={a}
                    className="mt-0.5 rounded border-border"
                  />
                  <span className="min-w-0">
                    <span className="font-medium text-ink">{LABEL_AREA_KOREKSI[a]}</span>
                    <span className="block text-[11px] text-ink-muted">{ARTI_AREA_KOREKSI[a]}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <Label htmlFor="rv-reason" required>
              Alasan pengembalian (dibaca SM di lapangan)
            </Label>
            <Textarea
              id="rv-reason"
              name="reason"
              required
              minLength={3}
              maxLength={1000}
              placeholder="mis. volume pasangan bata tidak sesuai foto — cek ulang zona B"
            />
          </div>
          <Button type="submit" variant="danger" loading={returnPending}>
            Kirim Kembali untuk Koreksi
          </Button>
        </form>
      ) : null}
    </div>
  );
}

/** Aksi finalisasi (disetujui) + link cetak setelah final. */
export function FinalizePanel({
  reportId,
  slug,
  dateKey,
  isFinal,
  canUnfinalize,
}: {
  reportId: string;
  slug: string;
  dateKey: string;
  isFinal: boolean;
  /** Super admin boleh membuka kembali laporan final untuk koreksi. */
  canUnfinalize?: boolean;
}) {
  const [state, formAction, pending] = useActionState<DailyActionState, FormData>(
    finalizeReportAction,
    undefined,
  );

  if (isFinal) {
    return (
      <div className="space-y-2">
        <div className="flex flex-col gap-2 rounded-lg border border-success-border bg-success-soft p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium text-ink">Laporan final — angka dibekukan untuk cetak KKP.</p>
          <Link
            href={withBackTo(`/cetak/harian/${slug}/${dateKey}`, `/proyek/lokasi/${slug}/harian/${dateKey}`)}
            target="_blank"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white hover:bg-primary-800"
          >
            <Printer aria-hidden className="size-4" />
            Cetak Laporan KKP
          </Link>
        </div>
        {canUnfinalize ? <UnfinalizeForm reportId={reportId} /> : null}
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-2 rounded-lg border border-border bg-surface p-4 shadow-xs">
      <h2 className="text-sm font-semibold text-ink">Finalisasi</h2>
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <input type="hidden" name="reportId" value={reportId} />
      <Button type="submit" loading={pending} className="h-11 w-full sm:w-auto">
        Finalisasi Laporan
      </Button>
      <p className="text-[11px] text-ink-muted">
        Finalisasi membekukan snapshot angka (immutable) untuk cetak laporan KKP. Tidak bisa dibatalkan.
      </p>
    </form>
  );
}

/**
 * Buka kunci laporan final untuk koreksi — super admin saja. Sengaja tertutup
 * (harus diklik dulu) + wajib alasan supaya tidak terpakai sambil lalu.
 * DECISIONS 149.
 */
function UnfinalizeForm({ reportId }: { reportId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<DailyActionState, FormData>(
    unfinalizeReportAction,
    undefined,
  );

  if (state?.success) return <Banner tone="success" title={state.success} />;
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[13px] font-medium text-ink-muted underline decoration-dotted underline-offset-4 hover:text-ink"
      >
        Buka kembali untuk koreksi (super admin)
      </button>
    );
  }
  return (
    <form action={formAction} className="space-y-2 rounded-lg border border-warning-border bg-warning-soft p-4">
      <h3 className="text-sm font-semibold text-ink">Buka kembali laporan final</h3>
      <p className="text-[12px] text-ink-muted">
        Status kembali ke <span className="font-medium">Disetujui</span> supaya angka bisa dikoreksi. Snapshot
        cetak dihapus dan dibangun ulang saat difinalkan lagi. Progres &amp; kurva-S tidak berubah oleh aksi ini —
        yang mengubah angka adalah editan setelahnya.
      </p>
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      <input type="hidden" name="reportId" value={reportId} />
      <div>
        <Label htmlFor={`alasan-${reportId}`} required>
          Alasan koreksi
        </Label>
        <Textarea
          id={`alasan-${reportId}`}
          name="reason"
          rows={2}
          placeholder="mis. Volume pekerjaan pagar salah input, seharusnya 25 m bukan 30 m"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="danger" size="sm" loading={pending}>
          Buka kembali
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Batal
        </Button>
      </div>
    </form>
  );
}

/** Form tambah kendala hari itu (menempel ke laporan). */
export function IssueForm({ reportId }: { reportId: string }) {
  const [state, formAction, pending] = useActionState<DailyActionState, FormData>(addIssueAction, undefined);
  return (
    <form action={formAction} className="space-y-2">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <input type="hidden" name="reportId" value={reportId} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="min-w-0 flex-1">
          <Label htmlFor="is-title" required>
            Kendala baru
          </Label>
          <input
            id="is-title"
            name="title"
            required
            minLength={3}
            maxLength={200}
            placeholder="mis. hujan deras sejak siang, cor ditunda"
            className="h-9 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-primary-600"
          />
        </div>
        <div className="w-full sm:w-32">
          <Label htmlFor="is-severity">Tingkat</Label>
          <Combobox id="is-severity" name="severity" defaultValue="sedang">
            {(Object.keys(ISSUE_SEVERITY_LABEL) as (keyof typeof ISSUE_SEVERITY_LABEL)[]).map((s) => (
              <option key={s} value={s}>
                {ISSUE_SEVERITY_LABEL[s]}
              </option>
            ))}
          </Combobox>
        </div>
      </div>
      <div>
        <Label htmlFor="is-desc">Uraian (opsional)</Label>
        <Textarea id="is-desc" name="description" rows={2} maxLength={2000} />
      </div>
      <Button type="submit" variant="secondary" loading={pending}>
        Catat Kendala
      </Button>
    </form>
  );
}
