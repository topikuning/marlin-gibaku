"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { Badge, Banner, Button, Card, CardBody, CardHeader, Combobox, useDismissable } from "@/components/ui";
import { runAnalysisAction, type AiHubState } from "@/lib/ai-hub/actions";
import { READINESS_GRADE_LABEL } from "@/lib/ai-hub/readiness";
import type { PulseRow, SourceRef } from "@/lib/ai-hub/types";

/**
 * Tabel Portfolio Pulse + panel scope aksi + drawer sumber. Checkbox memilih
 * lokasi → tombol aksi menjalankan run AI atas scope terpilih. Semua angka di
 * tabel = angka resmi server (serialized); klien tidak menghitung apa pun.
 */

const SEV_TONE = { kritis: "danger", tinggi: "warning", sedang: "info" } as const;
const GRADE_TONE = { poor: "danger", limited: "warning", adequate: "info", strong: "success" } as const;

const ACTIONS: { kind: string; label: string; desc: string }[] = [
  { kind: "pulse", label: "Cari yang perlu ditangani", desc: "Ringkas kondisi dan lokasi yang paling menuntut perhatian." },
  { kind: "deviasi", label: "Terangkan penyebab deviasi", desc: "Pisahkan kekurangan data dari keterlambatan fisik." },
  { kind: "risiko", label: "Susun urutan risiko", desc: "Urutkan fokus berdasarkan skor aturan MARLIN." },
  { kind: "kualitas_data", label: "Periksa kelayakan data", desc: "Periksa laporan, volume, foto, GPS, dan transaksi." },
];

function fmtPp(v: number): string {
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}`;
}

export function PulseClient({
  rows,
  sourceRefs,
  period,
  preselect,
  aiReady,
  canGenerate,
  dataAsOf,
}: {
  rows: PulseRow[];
  sourceRefs: SourceRef[];
  period: string;
  preselect: string[];
  aiReady: boolean;
  canGenerate: boolean;
  dataAsOf: string | null;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(preselect));
  const [q, setQ] = useState("");
  const [gradeFilter, setGradeFilter] = useState("");
  const [drawer, setDrawer] = useState<PulseRow | null>(null);
  // Escape menutup drawer + fokus kembali ke baris pemicu (audit UI 2026-07-27).
  const dismiss = useDismissable(drawer != null, () => setDrawer(null));
  const [state, formAction, pending] = useActionState<AiHubState, FormData>(runAnalysisAction, undefined);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!term || `${r.name} ${r.packageName} ${r.province}`.toLowerCase().includes(term)) &&
        (!gradeFilter || r.readiness.grade === gradeFilter),
    );
  }, [rows, q, gradeFilter]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const refsByLoc = useMemo(() => {
    const m = new Map<string, SourceRef[]>();
    for (const s of sourceRefs) {
      const slug = s.id.split(":")[0];
      const arr = m.get(slug) ?? [];
      arr.push(s);
      m.set(slug, arr);
    }
    return m;
  }, [sourceRefs]);

  const selectedRows = rows.filter((r) => selected.has(r.locationId));

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
      <Card>
        <CardHeader
          title="Daftar lokasi dan indikator resmi"
          subtitle={`Urutan exception-first (risiko → readiness → deviasi). Data terakhir berubah: ${dataAsOf ? new Date(dataAsOf).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" }) + " WIB" : "belum ada data"}.`}
        />
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari lokasi / paket / provinsi…"
            aria-label="Cari lokasi"
            className="h-9 w-56 rounded-md border border-border bg-surface px-2 text-sm"
          />
          <Combobox value={gradeFilter} onChange={setGradeFilter} className="w-44" placeholder="Semua readiness">
            <option value="">Semua readiness</option>
            <option value="poor">Buruk</option>
            <option value="limited">Terbatas</option>
            <option value="adequate">Memadai</option>
            <option value="strong">Kuat</option>
          </Combobox>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              setSelected(new Set(rows.filter((r) => r.riskSeverity === "kritis").map((r) => r.locationId)))
            }
          >
            Pilih kritis
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            Kosongkan
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-ink-muted uppercase">
                <th className="px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Pilih semua lokasi tampil"
                    checked={filtered.length > 0 && filtered.every((r) => selected.has(r.locationId))}
                    onChange={(e) =>
                      setSelected(e.target.checked ? new Set(filtered.map((r) => r.locationId)) : new Set())
                    }
                  />
                </th>
                <th className="px-3 py-2">Lokasi</th>
                <th className="px-3 py-2 text-right">Rencana</th>
                <th className="px-3 py-2 text-right">Realisasi</th>
                <th className="px-3 py-2 text-right">Deviasi</th>
                <th className="px-3 py-2">Risiko</th>
                <th className="px-3 py-2">Readiness</th>
                <th className="px-3 py-2 text-right">Lap. final</th>
                <th className="px-3 py-2 text-right">Kendala</th>
                <th className="px-3 py-2" aria-label="aksi baris" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.locationId} className="border-b border-border-muted hover:bg-surface-muted">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Pilih ${r.name}`}
                      checked={selected.has(r.locationId)}
                      onChange={() => toggle(r.locationId)}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      className="text-left hover:underline"
                      onClick={() => {
                        dismiss.capture();
                        setDrawer(r);
                      }}
                      aria-haspopup="dialog"
                    >
                      <span className="block font-medium text-ink">{r.name}</span>
                      <span className="block text-xs text-ink-muted">
                        {r.packageName} · {r.province}
                      </span>
                    </button>
                  </td>
                  <td className="tabular px-3 py-2 text-right">{r.hasActiveBaseline ? `${r.planPct.toFixed(1)}%` : "–"}</td>
                  <td className="tabular px-3 py-2 text-right">{r.hasActiveBaseline ? `${r.actualPct.toFixed(1)}%` : "–"}</td>
                  <td className={`tabular px-3 py-2 text-right font-semibold ${r.deviationPp < -0.05 ? "text-danger" : "text-ink"}`}>
                    {r.hasActiveBaseline ? `${fmtPp(r.deviationPp)} pp` : "–"}
                  </td>
                  <td className="px-3 py-2">
                    {r.riskSeverity ? (
                      <Badge tone={SEV_TONE[r.riskSeverity]} label={`${r.riskSeverity} ${r.riskScore}`} />
                    ) : (
                      <Badge tone="success" label="rendah" />
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={GRADE_TONE[r.readiness.grade]} label={`${r.readiness.score}% ${READINESS_GRADE_LABEL[r.readiness.grade]}`} />
                  </td>
                  <td className="tabular px-3 py-2 text-right">
                    {r.finalReports}/{r.expectedReports}
                  </td>
                  <td className="tabular px-3 py-2 text-right">
                    {r.openIssues}
                    {r.overdueRecoveries > 0 ? <span className="text-danger"> · {r.overdueRecoveries} ovd</span> : null}
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/lokasi/${r.slug}`} className="text-xs text-primary hover:underline">
                      Workspace
                    </Link>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-sm text-ink-muted">
                    Tidak ada lokasi cocok filter.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="self-start xl:sticky xl:top-4">
        <CardHeader title="Pilih lokasi untuk dianalisis" subtitle={`${selected.size} lokasi dipilih`} />
        <CardBody className="space-y-3">
          {state?.error ? <Banner tone="error" title={state.error} /> : null}
          {selectedRows.length === 0 ? (
            <p className="text-sm text-ink-muted">
              Centang lokasi di tabel (atau &ldquo;Pilih kritis&rdquo;), lalu jalankan aksi AI terhadap scope tsb.
            </p>
          ) : (
            <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
              {selectedRows.map((r) => (
                <li key={r.locationId} className="flex items-center justify-between gap-2">
                  <span className="truncate">{r.name}</span>
                  <button
                    type="button"
                    aria-label={`Hapus ${r.name} dari pilihan`}
                    className="text-ink-faint hover:text-danger"
                    onClick={() => toggle(r.locationId)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!aiReady ? (
            <p className="text-xs text-ink-muted">Provider AI nonaktif – aksi analisis dimatikan; data tabel tetap berlaku.</p>
          ) : null}
          <div className="space-y-2">
            {ACTIONS.map((a) => (
              <form key={a.kind} action={formAction}>
                <input type="hidden" name="kind" value={a.kind} />
                <input type="hidden" name="period" value={period} />
                {selectedRows.map((r) => (
                  <input key={r.locationId} type="hidden" name="locationId" value={r.locationId} />
                ))}
                <Button
                  type="submit"
                  variant={a.kind === "pulse" ? "primary" : "secondary"}
                  size="sm"
                  className="w-full justify-start"
                  disabled={!aiReady || !canGenerate || pending || selectedRows.length === 0}
                >
                  {pending ? "Menjalankan…" : a.label}
                </Button>
                <p className="mt-0.5 mb-1.5 text-[11px] leading-snug text-ink-faint">{a.desc}</p>
              </form>
            ))}
          </div>
          <p className="rounded-md border border-warning-border bg-warning-soft px-2 py-1.5 text-[11px] leading-snug text-warning">
            AI tidak pernah mengubah data. Semua usulan tersimpan sebagai draft dan butuh persetujuan manusia.
          </p>
        </CardBody>
      </Card>

      {drawer ? (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`Detail sumber ${drawer.name}`}>
          <button
            type="button"
            aria-label="Tutup"
            className="absolute inset-0 bg-black/40"
            onClick={dismiss.close}
          />
          <div className="absolute inset-y-0 right-0 w-full max-w-md overflow-y-auto bg-surface p-4 shadow-lg">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-ink">{drawer.name}</h3>
                <p className="text-xs text-ink-muted">
                  {drawer.packageName} · {drawer.province} · status {drawer.status}
                </p>
              </div>
              <Button type="button" variant="ghost" size="sm" autoFocus onClick={dismiss.close}>
                Tutup
              </Button>
            </div>
            <div className="space-y-3 text-sm">
              <div>
                <h4 className="mb-1 font-medium text-ink">Readiness {drawer.readiness.score}% ({READINESS_GRADE_LABEL[drawer.readiness.grade]})</h4>
                {drawer.readiness.blockers.length + drawer.readiness.warnings.length === 0 ? (
                  <p className="text-ink-muted">Semua pemeriksaan lulus.</p>
                ) : (
                  <ul className="space-y-1">
                    {drawer.readiness.blockers.map((b) => (
                      <li key={b.key} className="text-danger">
                        ⛔ {b.label}
                        {b.detail ? <span className="text-ink-muted"> – {b.detail}</span> : null}
                      </li>
                    ))}
                    {drawer.readiness.warnings.map((b) => (
                      <li key={b.key} className="text-warning">
                        ⚠ {b.label}
                        {b.detail ? <span className="text-ink-muted"> – {b.detail}</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h4 className="mb-1 font-medium text-ink">Sumber data (angka resmi)</h4>
                <ul className="space-y-2">
                  {(refsByLoc.get(drawer.slug) ?? []).map((s) => (
                    <li key={s.id} className="rounded-md border border-border px-2 py-1.5">
                      <span className="block text-xs text-ink-faint">{s.id}</span>
                      <span className="block">{s.value ?? s.label}</span>
                      {s.href ? (
                        <Link href={s.href} className="text-xs text-primary hover:underline">
                          Buka detail →
                        </Link>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
