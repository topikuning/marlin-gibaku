"use client";

import { useActionState, useState } from "react";
import { Banner, Button, Combobox, ConfirmSubmit, Input, Label, Textarea } from "@/components/ui";
import type { FindingStatus } from "@/generated/prisma/enums";
import {
  addFollowUpAction,
  askClarificationAction,
  linkEvidenceAction,
  rejectVerificationAction,
  reopenFindingAction,
  respondClarificationAction,
  submitForVerificationAction,
  verifyCloseAction,
  verifyEvidenceAction,
  type FindingActionState,
} from "@/lib/findings/actions";

function HasilAksi({ state }: { state: FindingActionState }) {
  if (state?.error) return <Banner tone="error" title={state.error} className="mt-2" />;
  if (state?.success) return <Banner tone="success" title={state.success} className="mt-2" />;
  return null;
}

/** Panel aksi kontekstual detail temuan — hanya menampilkan yang sah untuk peran & status. */
export function AksiTemuan({
  findingId,
  status,
  bolehRespond,
  bolehVerify,
  klarifikasiTerbuka,
}: {
  findingId: string;
  status: FindingStatus;
  bolehRespond: boolean;
  bolehVerify: boolean;
  klarifikasiTerbuka: { id: string; question: string }[];
}) {
  const terbuka = status !== "selesai";

  if (!bolehRespond && !bolehVerify) {
    return <p className="text-sm text-ink-muted">Anda hanya bisa melihat temuan ini.</p>;
  }

  return (
    <div className="space-y-4">
      {bolehRespond && terbuka ? (
        <>
          {klarifikasiTerbuka.map((k) => (
            <FormJawabKlarifikasi key={k.id} clarificationId={k.id} question={k.question} />
          ))}
          <FormTindakLanjut findingId={findingId} />
          {status !== "menunggu_verifikasi" ? <FormAjukanVerifikasi findingId={findingId} /> : null}
        </>
      ) : null}

      {bolehVerify ? (
        <>
          {terbuka ? <FormMintaKlarifikasi findingId={findingId} /> : null}
          {terbuka ? <FormTutup findingId={findingId} tolak={status === "menunggu_verifikasi"} /> : null}
          {status === "selesai" ? <FormBukaKembali findingId={findingId} /> : null}
        </>
      ) : null}

      {!terbuka && !bolehVerify ? <p className="text-sm text-ink-muted">Temuan sudah ditutup.</p> : null}
    </div>
  );
}

function FormTindakLanjut({ findingId }: { findingId: string }) {
  const [state, action, pending] = useActionState<FindingActionState, FormData>(addFollowUpAction, undefined);
  return (
    <form action={action} className="space-y-2 rounded-lg border border-border p-3">
      <input type="hidden" name="findingId" value={findingId} />
      <Label htmlFor={`tl-${findingId}`}>Catat tindak lanjut</Label>
      <Textarea id={`tl-${findingId}`} name="note" rows={2} required placeholder="Apa yang sudah dikerjakan" />
      <Button type="submit" size="sm" loading={pending}>Simpan tindak lanjut</Button>
      <HasilAksi state={state} />
    </form>
  );
}

function FormAjukanVerifikasi({ findingId }: { findingId: string }) {
  const [state, action, pending] = useActionState<FindingActionState, FormData>(submitForVerificationAction, undefined);
  return (
    <form action={action} className="space-y-2 rounded-lg border border-border p-3">
      <input type="hidden" name="findingId" value={findingId} />
      <Label htmlFor={`av-${findingId}`}>Ajukan verifikasi penutupan</Label>
      <Input id={`av-${findingId}`} name="note" placeholder="catatan (opsional)" />
      <Button type="submit" size="sm" variant="secondary" loading={pending}>Ajukan – sudah ditindaklanjuti</Button>
      <HasilAksi state={state} />
    </form>
  );
}

function FormJawabKlarifikasi({ clarificationId, question }: { clarificationId: string; question: string }) {
  const [state, action, pending] = useActionState<FindingActionState, FormData>(respondClarificationAction, undefined);
  return (
    <form action={action} className="space-y-2 rounded-lg border border-warning-border bg-warning-soft p-3">
      <input type="hidden" name="clarificationId" value={clarificationId} />
      <Label htmlFor={`jk-${clarificationId}`}>Jawab klarifikasi: {question}</Label>
      <Textarea id={`jk-${clarificationId}`} name="response" rows={2} required />
      <Button type="submit" size="sm" loading={pending}>Kirim jawaban</Button>
      <HasilAksi state={state} />
    </form>
  );
}

function FormMintaKlarifikasi({ findingId }: { findingId: string }) {
  const [state, action, pending] = useActionState<FindingActionState, FormData>(askClarificationAction, undefined);
  return (
    <form action={action} className="space-y-2 rounded-lg border border-border p-3">
      <input type="hidden" name="findingId" value={findingId} />
      <Label htmlFor={`mk-${findingId}`}>Minta klarifikasi</Label>
      <Textarea id={`mk-${findingId}`} name="question" rows={2} required placeholder="Pertanyaan untuk pelaksana" />
      <div>
        <Label htmlFor={`mk-due-${findingId}`}>Target jawaban</Label>
        <Input id={`mk-due-${findingId}`} name="dueDateKey" type="date" />
      </div>
      <Button type="submit" size="sm" variant="secondary" loading={pending}>Kirim permintaan</Button>
      <HasilAksi state={state} />
    </form>
  );
}

function FormTutup({ findingId, tolak }: { findingId: string; tolak: boolean }) {
  const [stateTutup, actionTutup, pendingTutup] = useActionState<FindingActionState, FormData>(verifyCloseAction, undefined);
  const [stateTolak, actionTolak, pendingTolak] = useActionState<FindingActionState, FormData>(rejectVerificationAction, undefined);
  return (
    <div className="space-y-3">
      <form action={actionTutup} className="space-y-2 rounded-lg border border-border p-3">
        <input type="hidden" name="findingId" value={findingId} />
        <Label htmlFor={`tp-${findingId}`}>Tutup temuan (verifikasi selesai)</Label>
        <Textarea id={`tp-${findingId}`} name="note" rows={2} required placeholder="Catatan penutup – wajib" />
        <ConfirmSubmit
          label="Tutup temuan"
          title="Tutup temuan ini?"
          description="Temuan dinyatakan selesai atas nama Anda sebagai verifikator dan hilang dari daftar terbuka. Membatalkannya hanya bisa lewat buka kembali, yang tercatat sebagai riwayat."
          loading={pendingTutup}
        />
        <HasilAksi state={stateTutup} />
      </form>
      {tolak ? (
        <form action={actionTolak} className="space-y-2 rounded-lg border border-border p-3">
          <input type="hidden" name="findingId" value={findingId} />
          <Label htmlFor={`to-${findingId}`}>Tolak pengajuan – kembalikan</Label>
          <Textarea id={`to-${findingId}`} name="reason" rows={2} required placeholder="Alasan penolakan – wajib" />
          <ConfirmSubmit
            label="Tolak – belum selesai"
            title="Tolak pengajuan verifikasi?"
            description="Temuan dikembalikan ke status tindak lanjut dan pelaksana harus mengajukan ulang. Alasan penolakan Anda tercatat di linimasa."
            variant="danger"
            loading={pendingTolak}
          />
          <HasilAksi state={stateTolak} />
        </form>
      ) : null}
    </div>
  );
}

function FormBukaKembali({ findingId }: { findingId: string }) {
  const [state, action, pending] = useActionState<FindingActionState, FormData>(reopenFindingAction, undefined);
  return (
    <form action={action} className="space-y-2 rounded-lg border border-danger-border p-3">
      <input type="hidden" name="findingId" value={findingId} />
      <Label htmlFor={`bk-${findingId}`}>Buka kembali</Label>
      <Textarea id={`bk-${findingId}`} name="reason" rows={2} required placeholder="Alasan dibuka kembali – wajib" />
      <ConfirmSubmit
        label="Buka kembali temuan"
        title="Buka kembali temuan yang sudah ditutup?"
        description="Status kembali ke tindak lanjut, hitungan dibuka-ulang bertambah, dan penutupan sebelumnya tetap tercatat di linimasa."
        variant="danger"
        loading={pending}
      />
      <HasilAksi state={state} />
    </form>
  );
}

/** Tautkan bukti (foto ATAU dokumen lokasi ini). */
export function FormBukti({
  findingId,
  foto,
  dokumen,
}: {
  findingId: string;
  foto: { value: string; label: string }[];
  dokumen: { value: string; label: string }[];
}) {
  const [state, action, pending] = useActionState<FindingActionState, FormData>(linkEvidenceAction, undefined);
  const [jenis, setJenis] = useState<"foto" | "dokumen">("foto");
  return (
    <form action={action} className="space-y-2 rounded-lg border border-border p-3">
      <input type="hidden" name="findingId" value={findingId} />
      <div className="grid gap-2 sm:grid-cols-3">
        <div>
          <Label htmlFor={`jb-${findingId}`}>Jenis bukti</Label>
          <Combobox
            id={`jb-${findingId}`}
            value={jenis}
            onChange={(v) => setJenis(v === "dokumen" ? "dokumen" : "foto")}
            options={[
              { value: "foto", label: "Foto" },
              { value: "dokumen", label: "Dokumen" },
            ]}
          />
        </div>
        <div>
          <Label htmlFor={`pb-${findingId}`}>{jenis === "foto" ? "Foto" : "Dokumen"}</Label>
          {jenis === "foto" ? (
            <Combobox key="foto" id={`pb-${findingId}`} name="photoId" defaultValue="" options={foto} placeholder={foto.length ? "Pilih foto" : "Belum ada foto di lokasi ini"} />
          ) : (
            <Combobox key="dokumen" id={`pb-${findingId}`} name="documentId" defaultValue="" options={dokumen} placeholder={dokumen.length ? "Pilih dokumen" : "Belum ada dokumen di lokasi ini"} />
          )}
        </div>
        <div>
          <Label htmlFor={`cb-${findingId}`}>Keterangan</Label>
          <Input id={`cb-${findingId}`} name="caption" maxLength={300} placeholder="opsional" />
        </div>
      </div>
      <Button type="submit" size="sm" variant="secondary" loading={pending}>Tautkan bukti</Button>
      <HasilAksi state={state} />
    </form>
  );
}

/** Verifikator menilai satu bukti. */
export function FormVerifikasiBukti({ linkId }: { linkId: string }) {
  const [state, action, pending] = useActionState<FindingActionState, FormData>(verifyEvidenceAction, undefined);
  const [status, setStatus] = useState("diterima");
  return (
    <form action={action} className="mt-2 flex flex-wrap items-end gap-2">
      <input type="hidden" name="linkId" value={linkId} />
      <div>
        <Label htmlFor={`vb-${linkId}`}>Penilaian</Label>
        <Combobox
          id={`vb-${linkId}`}
          name="status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "diterima", label: "Diterima" },
            { value: "ditolak", label: "Ditolak" },
          ]}
        />
      </div>
      <div>
        <Label htmlFor={`vbn-${linkId}`}>Catatan</Label>
        <Input id={`vbn-${linkId}`} name="note" maxLength={1000} placeholder={status === "ditolak" ? "kenapa ditolak" : "opsional"} />
      </div>
      <Button type="submit" size="sm" variant="secondary" loading={pending}>Simpan</Button>
      <HasilAksi state={state} />
    </form>
  );
}
