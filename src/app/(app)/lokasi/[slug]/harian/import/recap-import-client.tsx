"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, FileUp, Upload } from "lucide-react";
import { Banner, Button, Card, CardBody, CardHeader, StatusPill, useAksiKlik } from "@/components/ui";
import type { BadgeTone } from "@/components/ui/badge";
import { formatNumber } from "@/lib/format";
import {
  previewRecapAction,
  commitRecapAction,
  type RecapImportState,
} from "./actions";
import type { RecapRowStatus } from "@/lib/daily-report/recap-import";

const STATUS_META: Record<RecapRowStatus, { label: string; tone: BadgeTone }> = {
  ok: { label: "Siap", tone: "success" },
  unmatched: { label: "Tak dikenali", tone: "danger" },
  bad_date: { label: "Tanggal salah", tone: "danger" },
  future_date: { label: "Tanggal depan", tone: "warning" },
  zero_volume: { label: "Volume 0", tone: "warning" },
  over_volume: { label: "Lebih RAB", tone: "warning" },
};

const rupiah = new Intl.NumberFormat("id-ID");

export function RecapImportClient({ locationId, slug, hasRab }: { locationId: string; slug: string; hasRab: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /*
   * `useAksiKlik`, BUKAN `useActionState` telanjang: kedua aksi ini dijalankan
   * dari `onClick`, dan di situ `isPending` milik `useActionState` tidak pernah
   * menyala (DECISIONS 401). Impor rekap membaca berkas Excel dan menulis
   * puluhan laporan harian – justru yang paling lama, dan paling mahal kalau
   * ditekan dua kali.
   */
  // Keadaan impor ini bukan `{error}` biasa melainkan union ber-`ok`, jadi cara
  // menyatakan gagal kirim disebutkan di sini — pembungkusnya tidak menebak.
  const gagalKirim = (pesan: string): RecapImportState => ({ ok: false, error: pesan });
  const [preview, previewAction, previewing] = useAksiKlik<RecapImportState>(
    previewRecapAction,
    undefined,
    gagalKirim,
  );
  const [commit, commitAction, committing] = useAksiKlik<RecapImportState>(
    commitRecapAction,
    undefined,
    gagalKirim,
  );

  const buildForm = () => {
    const fd = new FormData();
    if (file) fd.set("file", file);
    fd.set("locationId", locationId);
    fd.set("slug", slug);
    return fd;
  };

  const done = commit?.ok && commit.phase === "done" ? commit.result : null;
  const previewData = preview?.ok && preview.phase === "preview" && !done ? preview.preview : null;

  if (!hasRab) {
    return <Banner tone="warning" title="Lokasi ini belum punya RAB revisi aktif – impor rekap butuh item RAB untuk dicocokkan." />;
  }

  if (done) {
    return (
      <Card>
        <CardHeader title="Rekap tersimpan" />
        <CardBody className="space-y-3">
          <div className="flex items-center gap-2 text-success">
            <CheckCircle2 aria-hidden className="size-5" />
            <span className="font-medium">
              {done.itemsSaved} item disimpan ke {done.reportsTouched} laporan · {done.reportsSubmitted} laporan dikirim untuk verifikasi.
            </span>
          </div>
          {done.skipped > 0 && (
            <Banner tone="warning" title={`${done.skipped} baris dilewati (lihat detail di bawah).`} />
          )}
          {done.errors.length > 0 && (
            <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border bg-surface-muted p-3 text-xs text-ink-muted">
              {done.errors.map((e) => (
                <li key={e.rowNum}>Baris {e.rowNum}: {e.message}</li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <Link
              href={`/lokasi/${slug}/harian`}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-800"
            >
              Ke Pelaksanaan Harian
            </Link>
            <Link href={`/lokasi/${slug}/harian/import`} className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-muted">
              Impor lagi
            </Link>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="Unggah file rekap" subtitle="Format .xlsx dari template. Pratinjau dulu sebelum menyimpan." />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <Button type="button" size="sm" variant="ghost" onClick={() => inputRef.current?.click()}>
            <FileUp aria-hidden className="size-3.5" /> Pilih file Excel…
          </Button>
          {file ? <span className="max-w-64 truncate text-xs text-ink-muted">{file.name}</span> : null}
          <Button type="button" size="sm" loading={previewing} disabled={!file} onClick={() => previewAction(buildForm())}>
            <Upload aria-hidden className="size-3.5" /> Pratinjau
          </Button>
        </div>

        {preview && !preview.ok ? <Banner tone="error" title={preview.error} /> : null}
        {commit && !commit.ok ? <Banner tone="error" title={commit.error} /> : null}

        {previewData && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="font-medium text-ink">{previewData.okCount} baris siap</span>
              {previewData.problemCount > 0 && <span className="text-warning">{previewData.problemCount} bermasalah (dilewati)</span>}
              <span className="text-ink-muted">{previewData.dates.length} tanggal</span>
              <span className="text-ink-muted">Total nilai ≈ Rp {rupiah.format(previewData.totalValue)}</span>
            </div>

            <div className="max-h-[28rem] overflow-auto rounded-md border border-border">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-surface-muted text-xs text-ink-muted">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Status</th>
                    <th className="px-2 py-1.5 font-medium">Tanggal</th>
                    <th className="px-2 py-1.5 font-medium">Pekerjaan</th>
                    <th className="px-2 py-1.5 text-right font-medium">Volume</th>
                    <th className="px-2 py-1.5 font-medium">Catatan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {previewData.rows.map((r) => {
                    const meta = STATUS_META[r.status];
                    return (
                      <tr key={r.rowNum} className={r.status === "ok" ? "" : "bg-surface-muted/40"}>
                        <td className="px-2 py-1.5"><StatusPill tone={meta.tone} label={meta.label} /></td>
                        <td className="px-2 py-1.5 whitespace-nowrap text-ink-muted">{r.dateKey ?? (r.rawDate || "–")}</td>
                        <td className="px-2 py-1.5">
                          <span className="text-ink">{r.matchedName ?? (r.name || r.code || "–")}</span>
                          {r.matchedCode ? <span className="ml-1 text-xs text-ink-muted">{r.matchedCode}</span> : null}
                        </td>
                        <td className="px-2 py-1.5 text-right whitespace-nowrap text-ink">
                          {formatNumber(r.volume)} {r.unit ?? ""}
                        </td>
                        <td className="px-2 py-1.5 text-xs text-ink-muted">{r.message ?? ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {previewData.okCount > 0 ? (
              <Button loading={committing} onClick={() => commitAction(buildForm())}>
                Simpan {previewData.okCount} item ke {previewData.dates.length} laporan (kirim untuk verifikasi)
              </Button>
            ) : (
              <Banner tone="warning" title="Tidak ada baris yang siap disimpan – perbaiki file lalu pratinjau ulang." />
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
