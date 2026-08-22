"use client";

import { useActionState, useState } from "react";
import { Banner, Button, Card, CardBody, CardHeader, Label, Textarea } from "@/components/ui";
import {
  pilihFotoPaparanAction,
  suntingNarasiPaparanAction,
  transisiPaparanAction,
  type PaparanState,
} from "@/lib/paparan/actions";
import type { PaparanContent } from "@/lib/paparan/jenis";

/**
 * Panel review paparan (DECISIONS 416): sunting NARASI (bukan angka) dan pilih
 * FOTO dokumentasi. Angka, periode, nama kontrak, dan tabel selalu dari
 * snapshot — tidak ada jalurnya di sini, dan server action menolak selebihnya.
 */

const BAGIAN: { key: keyof NarasiTeks; label: string }[] = [
  { key: "ringkasanEksekutif", label: "Ringkasan eksekutif (maks 4 butir)" },
  { key: "capaianNaratif", label: "Capaian" },
  { key: "kegiatanNaratif", label: "Kegiatan" },
  { key: "sintesisKendala", label: "Kendala" },
  { key: "rencanaNaratif", label: "Rencana minggu depan" },
  { key: "dukunganDibutuhkan", label: "Dukungan yang dibutuhkan" },
];

type NarasiTeks = {
  ringkasanEksekutif: string;
  capaianNaratif: string;
  kegiatanNaratif: string;
  sintesisKendala: string;
  rencanaNaratif: string;
  dukunganDibutuhkan: string;
};

export function PaparanReviewClient({
  artifactId,
  content,
  thumbUrl,
}: {
  artifactId: string;
  content: PaparanContent;
  thumbUrl: Record<string, string>;
}) {
  const e = content.humanEdits;
  const n = content.narasi;
  const teksAwal = (edit: string[] | undefined, narasi: { text: string }[]) =>
    (edit && edit.length > 0 ? edit : narasi.map((b) => b.text)).join("\n");
  const awal: NarasiTeks = {
    ringkasanEksekutif: teksAwal(e?.ringkasanEksekutif, n.ringkasanEksekutif),
    capaianNaratif: teksAwal(e?.capaianNaratif, n.capaianNaratif),
    kegiatanNaratif: teksAwal(e?.kegiatanNaratif, n.kegiatanNaratif),
    sintesisKendala: teksAwal(e?.sintesisKendala, n.sintesisKendala),
    rencanaNaratif: teksAwal(e?.rencanaNaratif, n.rencanaNaratif),
    dukunganDibutuhkan: teksAwal(e?.dukunganDibutuhkan, n.dukunganDibutuhkan),
  };

  const [narasiState, narasiAction, narasiPending] = useActionState<PaparanState, FormData>(
    suntingNarasiPaparanAction,
    undefined,
  );
  const [fotoState, fotoAction, fotoPending] = useActionState<PaparanState, FormData>(
    pilihFotoPaparanAction,
    undefined,
  );
  const [terpilih, setTerpilih] = useState<Set<string>>(new Set(content.selectedPhotoIds));

  return (
    <>
      <Card>
        <CardHeader
          title="Sunting narasi"
          subtitle="Satu butir per baris. Hanya narasi & judul – angka tidak bisa diedit dari sini."
        />
        <CardBody>
          <form action={narasiAction} className="space-y-3">
            <input type="hidden" name="artifactId" value={artifactId} />
            <div>
              <Label htmlFor="pp-judul" required>
                Judul paparan
              </Label>
              <input
                id="pp-judul"
                name="title"
                required
                minLength={5}
                maxLength={160}
                defaultValue={e?.title ?? n.title}
                className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-primary-600"
              />
            </div>
            {BAGIAN.map((b) => (
              <div key={b.key}>
                <Label htmlFor={`pp-${b.key}`}>{b.label}</Label>
                <Textarea id={`pp-${b.key}`} name={b.key} rows={3} maxLength={4000} defaultValue={awal[b.key]} />
              </div>
            ))}
            {narasiState?.error ? <Banner tone="error" title={narasiState.error} /> : null}
            {narasiState?.ok ? <Banner tone="success" title={narasiState.ok} /> : null}
            <Button type="submit" size="sm" loading={narasiPending}>
              Simpan narasi
            </Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={`Foto dokumentasi (${terpilih.size} dipilih)`}
          subtitle="Hanya foto dari laporan/kegiatan paket pada minggu ini. Maksimal 16; 4–8 per slide."
        />
        <CardBody>
          <form action={fotoAction} className="space-y-3">
            <input type="hidden" name="artifactId" value={artifactId} />
            {[...terpilih].map((id) => (
              <input key={id} type="hidden" name="photoId" value={id} />
            ))}
            {content.snapshot.fotoKandidat.length === 0 ? (
              <p className="text-sm text-ink-muted">Tidak ada foto kandidat pada minggu ini.</p>
            ) : (
              <div className="grid max-h-96 grid-cols-2 gap-2 overflow-y-auto">
                {content.snapshot.fotoKandidat.map((f) => {
                  const aktif = terpilih.has(f.id);
                  return (
                    <div key={f.id} className={`rounded-lg border p-1 ${aktif ? "border-primary bg-info-soft" : "border-border"}`}>
                      <button
                        type="button"
                        aria-pressed={aktif}
                        onClick={() =>
                          setTerpilih((prev) => {
                            const next = new Set(prev);
                            if (next.has(f.id)) next.delete(f.id);
                            else if (next.size < 16) next.add(f.id);
                            return next;
                          })
                        }
                        className="block w-full"
                      >
                        {thumbUrl[f.id] ? (
                          // eslint-disable-next-line @next/next/no-img-element -- presigned URL R2 sementara
                          <img
                            src={thumbUrl[f.id]}
                            alt={f.keterangan ?? f.lokasiNama}
                            className="aspect-video w-full rounded object-cover"
                          />
                        ) : (
                          <div className="flex aspect-video items-center justify-center rounded bg-surface-muted text-[10px] text-ink-muted">
                            Pratinjau tidak tersedia
                          </div>
                        )}
                        <span className="block truncate px-1 pt-0.5 text-left text-[10px] text-ink-muted">
                          {[f.lokasiNama, f.tanggalKey].filter(Boolean).join(" · ")}
                        </span>
                      </button>
                      {aktif ? (
                        <input
                          name={`caption-${f.id}`}
                          maxLength={160}
                          placeholder="Caption (opsional)"
                          defaultValue={content.humanEdits?.captionFoto?.[f.id] ?? ""}
                          className="mt-1 h-7 w-full rounded border border-border bg-surface px-2 text-[11px] text-ink"
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
            {fotoState?.error ? <Banner tone="error" title={fotoState.error} /> : null}
            {fotoState?.ok ? <Banner tone="success" title={fotoState.ok} /> : null}
            <Button type="submit" size="sm" variant="secondary" loading={fotoPending}>
              Simpan pilihan foto
            </Button>
          </form>
        </CardBody>
      </Card>
    </>
  );
}

/** Tombol satu transisi lifecycle — dipakai panel server. */
export function TombolTransisi({
  artifactId,
  ke,
  label,
  varian = "primary",
}: {
  artifactId: string;
  ke: string;
  label: string;
  varian?: "primary" | "secondary" | "danger";
}) {
  const [state, formAction, pending] = useActionState<PaparanState, FormData>(transisiPaparanAction, undefined);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="artifactId" value={artifactId} />
      <input type="hidden" name="to" value={ke} />
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      <Button type="submit" size="sm" variant={varian} loading={pending}>
        {label}
      </Button>
    </form>
  );
}
