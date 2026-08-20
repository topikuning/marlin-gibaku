"use client";

import { useActionState, useMemo, useState } from "react";
import { Banner, Button, Card, CardBody, CardHeader, Combobox, StatusPill } from "@/components/ui";
import { ALL_DOC_TYPES, TYPE_LABEL } from "@/lib/documents-meta";
import { documentDisplayName } from "@/lib/document-label";
import { parseDateKey } from "@/lib/format";
import { commitImportAction, previewImportAction, type PreviewState } from "./actions";
import type { DriveImportRow } from "@/lib/gdrive/import";
import type { DocumentType } from "@/generated/prisma/enums";

/**
 * Pratinjau + impor berkas Drive KKP. Alurnya sengaja dua langkah dengan mata
 * manusia di tengah: klasifikasi otomatis hanya USULAN, dan tiap baris bisa
 * diubah jenis & desanya sebelum apa pun masuk arsip (DECISIONS 184).
 */

type Override = { type: DocumentType; locationId: string };

const KEYAKINAN_TONE = { tinggi: "success", sedang: "warning", rendah: "neutral" } as const;

export function ImporDriveClient({
  packageId,
  packageName,
  locations,
  maxPerBatch,
}: {
  packageId: string;
  packageName: string;
  locations: { id: string; name: string }[];
  maxPerBatch: number;
}) {
  const [previewState, runPreview, previewPending] = useActionState<PreviewState, FormData>(
    previewImportAction,
    undefined,
  );
  const [commitState, runCommit, commitPending] = useActionState<PreviewState, FormData>(
    commitImportAction,
    undefined,
  );

  const rows = previewState?.preview?.rows ?? [];
  const [dipilih, setDipilih] = useState<Set<string>>(new Set());
  const [override, setOverride] = useState<Record<string, Override>>({});
  /** Pratinjau terakhir yang sudah "dipasang" ke state pilihan. */
  const [terpasang, setTerpasang] = useState<string | null>(null);

  // Pratinjau baru → centang semua yang siap, buang pilihan lama.
  const tandaPratinjau = previewState?.preview
    ? `${previewState.preview.folderId}:${rows.length}:${rows.map((r) => r.driveFileId).join(",").length}`
    : null;
  if (tandaPratinjau && tandaPratinjau !== terpasang) {
    setTerpasang(tandaPratinjau);
    setDipilih(new Set(rows.filter((r) => !r.dilewati).map((r) => r.driveFileId)));
    setOverride(
      Object.fromEntries(
        rows.map((r) => [r.driveFileId, { type: r.type, locationId: r.locationId ?? "" }]),
      ),
    );
  }

  const siap = rows.filter((r) => !r.dilewati);
  const terpilih = siap.filter((r) => dipilih.has(r.driveFileId));
  const kelebihan = terpilih.length > maxPerBatch;

  const selectionsJson = useMemo(
    () =>
      JSON.stringify(
        terpilih.slice(0, maxPerBatch).map((r) => ({
          driveFileId: r.driveFileId,
          type: override[r.driveFileId]?.type ?? r.type,
          locationId: override[r.driveFileId]?.locationId ?? "",
          path: r.path,
        })),
      ),
    [terpilih, override, maxPerBatch],
  );

  function toggle(id: string) {
    setDipilih((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function namaTampilan(r: DriveImportRow): string {
    const ov = override[r.driveFileId];
    const locId = ov?.locationId ?? r.locationId ?? "";
    return documentDisplayName({
      type: ov?.type ?? r.type,
      docDate: r.docDate ? parseDateKey(r.docDate) : null,
      locationName: locations.find((l) => l.id === locId)?.name ?? null,
      packageName,
    }).name;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Langkah 1 – baca folder Drive"
          subtitle="MARLIN menelusuri folder KKP paket ini (sampai 4 lapis, 500 berkas) lalu menebak jenis & desa tiap berkas. Tidak ada yang masuk arsip sebelum Anda menyetujuinya."
        />
        <CardBody className="space-y-3">
          <form action={runPreview}>
            <input type="hidden" name="packageId" value={packageId} />
            <Button type="submit" loading={previewPending}>
              {previewState?.preview ? "Baca ulang folder" : "Baca folder Drive"}
            </Button>
          </form>
          {previewState?.error ? <Banner tone="error" title={previewState.error} /> : null}
          {previewState?.preview ? (
            <div className="space-y-2 text-sm">
              <p>
                Ditemukan <strong>{previewState.preview.jumlah.total}</strong> berkas –{" "}
                <strong>{previewState.preview.jumlah.siap}</strong> siap diimpor,{" "}
                {previewState.preview.jumlah.sudahAda} sudah pernah diimpor,{" "}
                {previewState.preview.jumlah.dilewati} dilewati.
              </p>
              {/* Yang disembunyikan harus disebut jumlahnya — jangan sampai
                  "tidak muncul" terbaca "tidak ada". */}
              {previewState.preview.jumlah.terbitanSendiri > 0 ? (
                <p className="text-[13px] text-ink-muted">
                  {previewState.preview.jumlah.terbitanSendiri} berkas tidak ditampilkan karena
                  terbitan MARLIN sendiri (laporan yang diunggah dari sini) – datanya sudah ada,
                  tidak perlu diimpor balik.
                </p>
              ) : null}
              {previewState.preview.terpotong ? (
                <Banner
                  tone="warning"
                  title="Belum semua berkas terbaca"
                  description="Batas kedalaman/jumlah tercapai – impor yang tampil dulu, lalu baca ulang folder untuk sisanya."
                />
              ) : null}
            </div>
          ) : null}
        </CardBody>
      </Card>

      {rows.length > 0 ? (
        <Card>
          <CardHeader
            title="Langkah 2 – periksa & impor"
            subtitle="Perbaiki jenis dokumen atau desa yang salah tebak. Kolom “nama di MARLIN” memperlihatkan hasilnya sebelum disimpan."
          />
          <CardBody className="space-y-4">
            {commitState?.error ? <Banner tone="error" title={commitState.error} /> : null}
            {commitState?.result ? (
              <div className="space-y-2">
                <Banner
                  tone={commitState.result.gagal.length === 0 ? "success" : "warning"}
                  title={`${commitState.result.berhasil.length} berkas diimpor${
                    commitState.result.gagal.length > 0
                      ? `, ${commitState.result.gagal.length} gagal`
                      : ""
                  }`}
                  description="Berkas yang berhasil sudah tersalin ke arsip MARLIN (R2) – tidak lagi bergantung pada file di Drive. Baca ulang folder untuk melihat status terbaru."
                />
                {commitState.result.gagal.length > 0 ? (
                  <ul className="list-inside list-disc space-y-1 text-xs text-ink-muted">
                    {commitState.result.gagal.map((g) => (
                      <li key={g.fileName}>
                        <span className="font-medium">{g.fileName}</span>: {g.sebab}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span>
                Terpilih <strong>{terpilih.length}</strong> dari {siap.length} berkas siap.
              </span>
              <button
                type="button"
                onClick={() => setDipilih(new Set(siap.map((r) => r.driveFileId)))}
                className="text-primary hover:underline"
              >
                pilih semua
              </button>
              <button
                type="button"
                onClick={() => setDipilih(new Set())}
                className="text-primary hover:underline"
              >
                kosongkan
              </button>
            </div>
            {kelebihan ? (
              <Banner
                tone="warning"
                title={`Sekali impor maksimum ${maxPerBatch} berkas`}
                description={`${maxPerBatch} berkas teratas yang akan diimpor; sisanya bisa diimpor setelah ini.`}
              />
            ) : null}

            <div className="overflow-x-auto">
              <table className="w-full min-w-[56rem] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-ink-muted">
                    <th className="py-2 pr-2" />
                    <th className="py-2 pr-3">Berkas di Drive</th>
                    <th className="py-2 pr-3">Jenis</th>
                    <th className="py-2 pr-3">Desa / lokasi</th>
                    <th className="py-2 pr-3">Nama di MARLIN</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => {
                    const ov = override[r.driveFileId];
                    return (
                      <tr key={r.driveFileId} className={r.dilewati ? "text-ink-muted" : undefined}>
                        <td className="py-2 pr-2 align-top">
                          <input
                            type="checkbox"
                            aria-label={`Impor ${r.fileName}`}
                            disabled={Boolean(r.dilewati)}
                            checked={dipilih.has(r.driveFileId)}
                            onChange={() => toggle(r.driveFileId)}
                          />
                        </td>
                        <td className="py-2 pr-3 align-top">
                          <div className="font-medium break-words">{r.fileName}</div>
                          <div className="text-xs text-ink-muted">
                            {r.path || "(akar folder paket)"}
                            {r.bytes !== null ? ` · ${Math.max(1, Math.round(r.bytes / 1024))} KB` : ""}
                          </div>
                          {r.dilewati ? (
                            <div className="text-xs">Dilewati: {r.dilewati}</div>
                          ) : (
                            <div className="mt-1 flex items-center gap-2 text-xs">
                              <StatusPill tone={KEYAKINAN_TONE[r.keyakinan]} label={`tebakan ${r.keyakinan}`} />
                              <span className="text-ink-muted">{r.alasan}</span>
                            </div>
                          )}
                        </td>
                        <td className="py-2 pr-3 align-top">
                          <Combobox
                            aria-label={`Jenis dokumen ${r.fileName}`}
                            value={ov?.type ?? r.type}
                            disabled={Boolean(r.dilewati)}
                            onChange={(value) =>
                              setOverride((prev) => ({
                                ...prev,
                                [r.driveFileId]: {
                                  type: value as DocumentType,
                                  locationId: prev[r.driveFileId]?.locationId ?? r.locationId ?? "",
                                },
                              }))
                            }
                          >
                            {ALL_DOC_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {TYPE_LABEL[t]}
                              </option>
                            ))}
                          </Combobox>
                        </td>
                        <td className="py-2 pr-3 align-top">
                          <Combobox
                            aria-label={`Lokasi ${r.fileName}`}
                            value={ov?.locationId ?? r.locationId ?? ""}
                            disabled={Boolean(r.dilewati)}
                            onChange={(value) =>
                              setOverride((prev) => ({
                                ...prev,
                                [r.driveFileId]: {
                                  type: prev[r.driveFileId]?.type ?? r.type,
                                  locationId: value,
                                },
                              }))
                            }
                          >
                            <option value="">– tingkat paket (bukan per desa) –</option>
                            {locations.map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.name}
                              </option>
                            ))}
                          </Combobox>
                        </td>
                        <td className="py-2 pr-3 align-top text-xs">
                          {r.dilewati ? "–" : namaTampilan(r)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <form action={runCommit}>
              <input type="hidden" name="packageId" value={packageId} />
              <input type="hidden" name="selections" value={selectionsJson} />
              <Button type="submit" loading={commitPending} disabled={terpilih.length === 0}>
                Impor {Math.min(terpilih.length, maxPerBatch)} berkas terpilih
              </Button>
            </form>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
