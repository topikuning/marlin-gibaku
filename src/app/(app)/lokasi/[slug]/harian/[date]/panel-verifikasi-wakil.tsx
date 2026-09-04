"use client";

import { useAksi } from "@/lib/aksi-klien";

import { useState } from "react";
import { Banner, Button, Card, CardBody, CardHeader, Combobox, Label, StatusPill, Textarea } from "@/components/ui";
import type { ReportVerifStatus } from "@/generated/prisma/enums";
import { REPORT_VERIF_STATUS_LABEL, REPORT_VERIF_STATUS_TONE } from "@/lib/lifecycle";
import { verifyReportExternalAction, type VerifikasiActionState } from "@/lib/verifikasi/actions";

type BarisRiwayat = {
  id: string;
  status: ReportVerifStatus;
  note: string | null;
  oleh: string;
  pada: string; // ISO
};

/**
 * Panel VERIFIKASI WAKIL PPK di workspace harian (DECISIONS 426).
 * Baris teratas = keadaan terkini; riwayat lengkap di bawahnya.
 * Ini jejak pemeriksaan pemberi kerja — TIDAK mengubah status laporan.
 */
export function PanelVerifikasiWakil({
  reportId,
  bolehVerifikasi,
  riwayat,
}: {
  reportId: string;
  bolehVerifikasi: boolean;
  riwayat: BarisRiwayat[];
}) {
  const [state, action, pending] = useAksi<VerifikasiActionState>(verifyReportExternalAction, undefined);
  const [status, setStatus] = useState("diverifikasi");
  const terkini = riwayat[0] ?? null;

  return (
    <Card>
      <CardHeader
        title="Verifikasi Wakil PPK"
        subtitle="Jejak pemeriksaan pemberi kerja – tidak mengubah status laporan"
        action={
          terkini ? (
            <StatusPill tone={REPORT_VERIF_STATUS_TONE[terkini.status]} label={REPORT_VERIF_STATUS_LABEL[terkini.status]} />
          ) : (
            <StatusPill tone="neutral" label="Belum diperiksa" />
          )
        }
      />
      <CardBody className="space-y-3">
        {riwayat.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {riwayat.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2">
                <StatusPill tone={REPORT_VERIF_STATUS_TONE[r.status]} label={REPORT_VERIF_STATUS_LABEL[r.status]} />
                {r.note ? <span className="text-ink-muted">{r.note}</span> : null}
                <span className="text-xs text-ink-faint">
                  {r.oleh} · {new Date(r.pada).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {bolehVerifikasi ? (
          <form action={action} className="space-y-2 rounded-lg border border-border p-3">
            <input type="hidden" name="reportId" value={reportId} />
            <div>
              <Label htmlFor={`vw-status-${reportId}`}>Hasil pemeriksaan</Label>
              <Combobox
                id={`vw-status-${reportId}`}
                name="status"
                value={status}
                onChange={setStatus}
                options={[
                  { value: "diverifikasi", label: "Diverifikasi" },
                  { value: "perlu_klarifikasi", label: "Perlu klarifikasi" },
                  { value: "ditolak", label: "Ditolak – perlu koreksi" },
                ]}
              />
            </div>
            <div>
              <Label htmlFor={`vw-note-${reportId}`}>Catatan{status !== "diverifikasi" ? " (wajib)" : ""}</Label>
              <Textarea
                id={`vw-note-${reportId}`}
                name="note"
                rows={2}
                required={status !== "diverifikasi"}
                placeholder={status === "diverifikasi" ? "opsional" : "sebutkan apa yang perlu diklarifikasi/dikoreksi"}
              />
            </div>
            <Button type="submit" size="sm" loading={pending}>
              Catat hasil pemeriksaan
            </Button>
            {state?.error ? <Banner tone="error" title={state.error} /> : null}
            {state?.success ? <Banner tone="success" title={state.success} /> : null}
          </form>
        ) : null}
      </CardBody>
    </Card>
  );
}
