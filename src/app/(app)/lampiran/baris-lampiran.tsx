"use client";

import { useActionState, useState } from "react";
import { Badge, Button, Combobox, Input, Label, type BadgeTone } from "@/components/ui";
import { FileText, Paperclip, Sparkles } from "lucide-react";
import {
  lampiranJadiSuratAction,
  tetapkanLampiranAction,
  usulkanIsiLampiranAction,
  type LampiranState,
} from "@/lib/surat/lampiran-actions";

export type BarisLampiranProps = {
  id: string;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  statusLabel: string;
  gagal: boolean;
  failReason: string | null;
  kindLabel: string;
  kindTone: BadgeTone;
  saranAlasan: string | null;
  saranRingkas: string | null;
  keputusanLabel: string;
  sudahDitetapkan: boolean;
  terarsip: boolean;
  /** Tampilkan kotak centang untuk penandaan massal (hanya yang belum ditetapkan). */
  bisaDipilih?: boolean;
  paketNama: string | null;
  pengirim: string | null;
  caption: string;
  waktu: string;
};

function ukuran(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Satu baris antrean lampiran. Usul mesin ditampilkan BESERTA ALASANNYA —
 * orang harus bisa menilai usulnya, bukan disodori vonis tanpa dasar.
 */
export function BarisLampiran(p: BarisLampiranProps) {
  const [tetapkanState, tetapkanAction, tetapkanPending] = useActionState<LampiranState, FormData>(
    tetapkanLampiranAction,
    undefined,
  );
  const [aiState, aiAction, aiPending] = useActionState<LampiranState, FormData>(
    usulkanIsiLampiranAction,
    undefined,
  );
  const [suratState, suratAction, suratPending] = useActionState<LampiranState, FormData>(
    lampiranJadiSuratAction,
    undefined,
  );
  const [formSurat, setFormSurat] = useState(false);
  const [butuhJawaban, setButuhJawaban] = useState(false);

  const pesan = tetapkanState ?? aiState ?? suratState;

  return (
    <li className="rounded-md border border-border bg-surface p-3">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        {p.bisaDipilih ? (
          // Kotaknya milik borang pembersih massal di sekeliling daftar; baris
          // ini tidak perlu tahu apa pun soal aksinya.
          <input
            type="checkbox"
            name="attachmentId"
            value={p.id}
            aria-label={`Pilih ${p.fileName ?? "berkas tanpa nama"}`}
            className="mt-1 size-4 shrink-0 rounded border-border accent-primary"
          />
        ) : null}
        <span aria-hidden className="mt-0.5 text-ink-faint">
          {p.mimeType?.startsWith("image/") ? (
            <Paperclip className="size-4" />
          ) : (
            <FileText className="size-4" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          {/*
            Nama berkas = TAUTAN membuka berkasnya. Sebelumnya layar ini meminta
            orang memilih "surat / dokumen / bukan bahan kerja" atas berkas yang
            tidak bisa mereka buka — satu-satunya cara melihat isinya adalah
            membuka WhatsApp sendiri, yang membuat layar ini tidak menghemat apa
            pun. Berkas gagal tangkap tidak ditautkan: tidak ada yang dibuka.
          */}
          <p className="truncate text-sm font-medium text-ink">
            {p.gagal ? (
              p.fileName || <span className="italic text-ink-muted">(tanpa nama berkas)</span>
            ) : (
              <a
                href={`/api/waha/lampiran/${p.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-dotted underline-offset-2 hover:text-primary-700"
              >
                {p.fileName || "(tanpa nama berkas) – buka"}
              </a>
            )}
          </p>
          <p className="mt-0.5 text-xs text-ink-faint">
            {[p.paketNama, p.pengirim, p.waktu, ukuran(p.sizeBytes)].filter(Boolean).join(" · ")}
          </p>
        </div>
        <span className="flex flex-wrap items-center gap-1">
          <Badge tone={p.kindTone} label={p.kindLabel} />
          {p.sudahDitetapkan ? <Badge tone="success" label={p.keputusanLabel} /> : null}
          {p.terarsip ? <Badge tone="neutral" label="Terarsip" /> : null}
          {p.gagal ? <Badge tone="danger" label={p.statusLabel} /> : null}
        </span>
      </div>

      {p.caption.trim() ? (
        <p className="mt-2 line-clamp-3 text-sm whitespace-pre-wrap text-ink-muted">{p.caption}</p>
      ) : null}

      <p className="mt-1 text-[11px] text-ink-faint">
        Dugaan sistem: {p.saranAlasan ?? "–"}
        {p.gagal && p.failReason ? ` · ${p.failReason}` : ""}
      </p>

      {p.saranRingkas ? (
        <div className="mt-2 rounded-md border border-dashed border-border bg-surface-inset p-2">
          <p className="mb-1 text-[11px] font-medium tracking-wide text-ink-muted uppercase">
            Usulan AI – periksa sebelum menetapkan
          </p>
          <p className="text-xs whitespace-pre-wrap text-ink-muted">{p.saranRingkas}</p>
        </div>
      ) : null}

      {/* Aksi hanya untuk berkas yang benar-benar tertangkap. */}
      {!p.gagal ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <form action={aiAction}>
            <input type="hidden" name="attachmentId" value={p.id} />
            <Button type="submit" size="sm" variant="ghost" disabled={aiPending} loading={aiPending}>
              <Sparkles aria-hidden className="size-3.5" />
              {p.saranRingkas ? "Minta usul ulang" : "Minta usul AI"}
            </Button>
          </form>
          <Button size="sm" variant="secondary" onClick={() => setFormSurat((v) => !v)}>
            {formSurat ? "Batal catat surat" : "Catat sebagai surat"}
          </Button>
          <form action={tetapkanAction} className="flex gap-1.5">
            <input type="hidden" name="attachmentId" value={p.id} />
            <Button
              type="submit"
              name="keputusan"
              value="jadi_dokumen"
              size="sm"
              variant="secondary"
              disabled={tetapkanPending}
            >
              Simpan sebagai dokumen
            </Button>
            <Button
              type="submit"
              name="keputusan"
              value="bukan_apa_apa"
              size="sm"
              variant="ghost"
              disabled={tetapkanPending}
            >
              Bukan bahan kerja
            </Button>
          </form>
        </div>
      ) : null}

      {formSurat ? (
        <form action={suratAction} className="mt-3 space-y-2 rounded-md border border-border bg-surface-muted p-3">
          <input type="hidden" name="attachmentId" value={p.id} />
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <Label htmlFor={`arah-${p.id}`} required>
                Arah
              </Label>
              <Combobox
                id={`arah-${p.id}`}
                name="direction"
                defaultValue="masuk"
                options={[
                  { value: "masuk", label: "Surat masuk" },
                  { value: "keluar", label: "Surat keluar" },
                ]}
              />
            </div>
            <div>
              <Label htmlFor={`pihak-${p.id}`} required>
                Pihak
              </Label>
              <Combobox
                id={`pihak-${p.id}`}
                name="party"
                defaultValue="penyedia"
                options={[
                  { value: "penyedia", label: "Penyedia" },
                  { value: "wakil_ppk", label: "Wakil PPK" },
                  { value: "ppk", label: "PPK" },
                  { value: "konsultan", label: "Konsultan pengawas" },
                  { value: "dinas", label: "Dinas/instansi" },
                  { value: "internal", label: "Internal" },
                  { value: "lainnya", label: "Lainnya" },
                ]}
              />
            </div>
          </div>
          <div>
            <Label htmlFor={`perihal-${p.id}`} required>
              Perihal
            </Label>
            <Input id={`perihal-${p.id}`} name="subject" defaultValue={p.fileName ?? ""} required />
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div>
              <Label htmlFor={`nomor-${p.id}`}>Nomor surat</Label>
              <Input id={`nomor-${p.id}`} name="letterNumber" />
            </div>
            <div>
              <Label htmlFor={`tgl-${p.id}`}>Tanggal surat</Label>
              <Input id={`tgl-${p.id}`} name="letterDate" type="date" />
            </div>
            <div>
              <Label htmlFor={`kat-${p.id}`} required>
                Perihal soal
              </Label>
              <Combobox
                id={`kat-${p.id}`}
                name="category"
                defaultValue="administrasi"
                options={[
                  { value: "mutu", label: "Mutu" },
                  { value: "jadwal", label: "Jadwal" },
                  { value: "pembayaran", label: "Pembayaran" },
                  { value: "administrasi", label: "Administrasi" },
                  { value: "koordinasi", label: "Koordinasi" },
                  { value: "k3", label: "K3" },
                  { value: "lainnya", label: "Lainnya" },
                ]}
              />
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <Label htmlFor={`jawab-${p.id}`}>Menuntut jawaban?</Label>
              <Combobox
                id={`jawab-${p.id}`}
                name="needsReply"
                defaultValue="tidak"
                onChange={(v) => setButuhJawaban(v === "ya")}
                options={[
                  { value: "tidak", label: "Tidak" },
                  { value: "ya", label: "Ya – pasang tenggat" },
                ]}
              />
            </div>
            {butuhJawaban ? (
              <div>
                <Label htmlFor={`tenggat-${p.id}`}>Tenggat jawaban</Label>
                <Input id={`tenggat-${p.id}`} name="replyDueDate" type="date" />
              </div>
            ) : null}
          </div>
          <Button type="submit" size="sm" disabled={suratPending} loading={suratPending}>
            Catat surat &amp; arsipkan berkas
          </Button>
        </form>
      ) : null}

      {pesan?.error ? <p className="mt-1 text-xs text-danger">{pesan.error}</p> : null}
      {pesan?.success ? <p className="mt-1 text-xs text-success">{pesan.success}</p> : null}
    </li>
  );
}
