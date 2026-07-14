"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { Camera, Search, Send, Trash2 } from "lucide-react";
import { Banner, Button, Input, Label } from "@/components/ui";
import { formatNumber, formatRupiah } from "@/lib/format";
import {
  removeItemAction,
  saveItemAction,
  submitReportAction,
  type DailyActionState,
} from "@/lib/daily-report/actions";
import type { LeafNodeOption, WorkspaceItem } from "@/lib/daily-report/queries";
import { PhotoGallery } from "@/components/knmp/photo-gallery";

/**
 * Editor laporan (draft/perlu_koreksi) — MOBILE-FIRST untuk SM/mandor:
 * cari item RAB → volume besar (inputmode=decimal) → foto (capture) → simpan.
 * Draft lokal: volume tersimpan di localStorage per (slug,date,nodeId),
 * dihapus setelah kirim laporan sukses.
 */

const draftPrefix = (slug: string, dateKey: string) => `marlin.harian.${slug}.${dateKey}.`;
const draftKey = (slug: string, dateKey: string, nodeId: string) =>
  `${draftPrefix(slug, dateKey)}${nodeId}`;

function clearLocalDrafts(slug: string, dateKey: string) {
  try {
    const prefix = draftPrefix(slug, dateKey);
    const toRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(prefix)) toRemove.push(k);
    }
    toRemove.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    /* localStorage bisa nonaktif (private mode) — draft lokal saja yang hilang */
  }
}

export function ReportEditor({
  locationId,
  slug,
  dateKey,
  reportId,
  nodes,
  items,
  correctionReason,
  photoEnabled,
}: {
  locationId: string;
  slug: string;
  dateKey: string;
  reportId: string | null;
  nodes: LeafNodeOption[];
  items: WorkspaceItem[];
  correctionReason: string | null;
  photoEnabled: boolean;
}) {
  return (
    <div className="space-y-4">
      {correctionReason ? (
        <Banner
          tone="warning"
          title="Laporan dikembalikan — perlu koreksi"
          description={correctionReason}
        />
      ) : null}
      <ItemForm locationId={locationId} slug={slug} dateKey={dateKey} nodes={nodes} photoEnabled={photoEnabled} />
      <ItemList reportId={reportId} items={items} />
      {reportId && items.length > 0 ? <SubmitPanel reportId={reportId} slug={slug} dateKey={dateKey} /> : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────

function ItemForm({
  locationId,
  slug,
  dateKey,
  nodes,
  photoEnabled,
}: {
  locationId: string;
  slug: string;
  dateKey: string;
  nodes: LeafNodeOption[];
  photoEnabled: boolean;
}) {
  const [state, formAction, pending] = useActionState<DailyActionState, FormData>(saveItemAction, undefined);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<LeafNodeOption | null>(null);
  const [volume, setVolume] = useState("");
  const [previews, setPreviews] = useState<string[]>([]);
  const [geo, setGeo] = useState<{ lat: number; lng: number } | null>(null);
  const [takenAt, setTakenAt] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Reset form + hapus draft lokal node ini setelah sukses simpan.
  // setState via callback timeout (bukan sinkron di effect) — patuh react-hooks/set-state-in-effect.
  useEffect(() => {
    if (!state?.success) return;
    const timer = window.setTimeout(() => {
      setPicked((prev) => {
        if (prev) {
          try {
            window.localStorage.removeItem(draftKey(slug, dateKey, prev.id));
          } catch {
            /* abaikan */
          }
        }
        return null;
      });
      setQuery("");
      setVolume("");
      setPreviews([]);
      setGeo(null);
      setTakenAt("");
      formRef.current?.reset();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [state, slug, dateKey]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return nodes
      .filter((n) => `${n.code} ${n.name} ${n.category}`.toLowerCase().includes(q))
      .slice(0, 25);
  }, [query, nodes]);

  function pick(node: LeafNodeOption) {
    setPicked(node);
    setQuery("");
    // Draft lokal: pulihkan volume yang pernah diketik untuk node ini.
    try {
      const saved = window.localStorage.getItem(draftKey(slug, dateKey, node.id));
      setVolume(saved ?? "");
    } catch {
      setVolume("");
    }
  }

  function onVolumeChange(v: string) {
    setVolume(v);
    if (!picked) return;
    try {
      if (v) window.localStorage.setItem(draftKey(slug, dateKey, picked.id), v);
      else window.localStorage.removeItem(draftKey(slug, dateKey, picked.id));
    } catch {
      /* abaikan */
    }
  }

  function onFiles() {
    const files = fileRef.current?.files;
    if (!files || files.length === 0) {
      setPreviews([]);
      return;
    }
    const urls: string[] = [];
    for (let i = 0; i < Math.min(files.length, 6); i++) urls.push(URL.createObjectURL(files[i]));
    setPreviews(urls);
    // Cap foto: rekam waktu ambil + koordinat GPS (dibakar ke gambar di server).
    setTakenAt(new Date().toISOString());
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => setGeo(null),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
      );
    }
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      className="space-y-4 rounded-lg border border-border bg-surface p-4 shadow-xs"
    >
      <h2 className="text-sm font-semibold text-ink">Tambah / ubah progres pekerjaan</h2>
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      {state?.warning ? <Banner tone="warning" title="Foto tidak tersimpan" description={state.warning} /> : null}

      <input type="hidden" name="locationId" value={locationId} />
      <input type="hidden" name="dateKey" value={dateKey} />
      <input type="hidden" name="rabNodeId" value={picked?.id ?? ""} />
      <input type="hidden" name="photoLat" value={geo?.lat ?? ""} />
      <input type="hidden" name="photoLng" value={geo?.lng ?? ""} />
      <input type="hidden" name="photoTakenAt" value={takenAt} />

      {/* 1 · Pekerjaan */}
      <div>
        <Label htmlFor="dr-search" required>
          1 · Pekerjaan
        </Label>
        {picked ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-primary bg-primary-50 px-4 py-3">
            <div className="min-w-0">
              {picked.category ? (
                <div className="truncate text-[11px] font-medium text-primary">{picked.category}</div>
              ) : null}
              <div className="truncate text-sm font-semibold text-ink">{picked.name}</div>
              <div className="mt-0.5 text-xs text-ink-muted">
                {picked.code}
                {picked.remaining != null ? (
                  <>
                    {" · sisa "}
                    <span className="font-semibold">
                      {formatNumber(picked.remaining)} {picked.unit}
                    </span>
                  </>
                ) : null}
              </div>
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={() => setPicked(null)}>
              Ganti
            </Button>
          </div>
        ) : (
          <>
            <div className="relative">
              <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-faint" />
              <Input
                id="dr-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                inputMode="search"
                placeholder="Ketik nama / kode pekerjaan…"
                className="h-11 pl-9 text-base"
              />
            </div>
            {query ? (
              <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-border bg-surface">
                {matches.length === 0 ? (
                  <div className="px-4 py-3 text-sm text-ink-muted">Tidak ada yang cocok.</div>
                ) : (
                  matches.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => pick(n)}
                      className="block w-full border-b border-surface-inset px-4 py-3 text-left last:border-0 active:bg-primary-50"
                    >
                      {n.category ? (
                        <div className="truncate text-[11px] font-medium text-primary">{n.category}</div>
                      ) : null}
                      <div className="text-sm font-medium text-ink">{n.name}</div>
                      <div className="text-xs text-ink-muted">
                        {n.code}
                        {n.unit ? ` · ${n.unit}` : ""}
                        {n.remaining != null ? ` · sisa ${formatNumber(n.remaining)} ${n.unit ?? ""}` : ""}
                      </div>
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* 2 · Volume */}
      <div>
        <Label htmlFor="dr-volume" required>
          2 · Volume selesai hari ini
        </Label>
        <div className="relative">
          <Input
            id="dr-volume"
            name="volumeDone"
            type="number"
            inputMode="decimal"
            step="0.001"
            min="0.001"
            required
            value={volume}
            onChange={(e) => onVolumeChange(e.target.value)}
            placeholder="mis. 3,2"
            className="h-13 pr-20 text-2xl font-semibold tabular-nums"
          />
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 rounded-md bg-primary-50 px-2.5 py-1 text-sm font-bold text-primary">
            {picked?.unit ?? "satuan"}
          </span>
        </div>
        {picked?.remaining != null ? (
          <p className="mt-1 text-xs text-ink-muted">
            Sisa yang bisa dilaporkan: {formatNumber(picked.remaining)} {picked.unit} (dari volume RAB{" "}
            {picked.volume != null ? formatNumber(picked.volume) : "—"}).
          </p>
        ) : null}
      </div>

      {/* 3 · Foto */}
      <div>
        <Label htmlFor="dr-photos">3 · Foto bukti (opsional)</Label>
        {!photoEnabled ? (
          <p className="rounded-lg border border-warning bg-warning-soft px-3 py-2 text-sm text-ink">
            Penyimpanan foto (Cloudflare R2) belum diaktifkan — unggah foto sementara tidak tersedia.
            Volume tetap bisa disimpan. Hubungi admin untuk mengaktifkan (menu Sistem → tes R2).
          </p>
        ) : (
          <>
            <input
              ref={fileRef}
              id="dr-photos"
              name="photos"
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              onChange={onFiles}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-primary/40 bg-primary-50 px-4 py-4 text-sm font-semibold text-primary active:bg-primary-100"
            >
              <Camera aria-hidden className="size-4" />
              {previews.length > 0 ? `${previews.length} foto dipilih — ketuk untuk ubah` : "Ambil / pilih foto"}
            </button>
          </>
        )}
        {previews.length > 0 ? (
          <>
            <div className="mt-2 grid grid-cols-4 gap-1.5">
              {previews.map((u, i) => (
                // eslint-disable-next-line @next/next/no-img-element -- object URL lokal untuk pratinjau
                <img key={i} src={u} alt="" className="h-16 w-full rounded-md border border-border object-cover" />
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-ink-muted">
              {geo
                ? `Koordinat tercatat (${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)}) — waktu & koordinat akan dicap ke foto.`
                : "Mengambil koordinat GPS… izinkan akses lokasi agar foto dicap koordinat."}
            </p>
          </>
        ) : null}
      </div>

      {/* Catatan */}
      <div>
        <Label htmlFor="dr-notes">Catatan (opsional)</Label>
        <Input id="dr-notes" name="notes" maxLength={500} placeholder="mis. cor kolom L2 utara" className="h-11 text-base" />
      </div>

      <Button type="submit" loading={pending} disabled={!picked} className="h-12 w-full text-base">
        Simpan Progres
      </Button>
      <p className="text-center text-[11px] text-ink-muted">
        Pekerjaan yang sama disimpan ulang = volume diperbarui (tidak dobel).
      </p>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────

function ItemRow({ reportId, item }: { reportId: string | null; item: WorkspaceItem }) {
  const [state, formAction, pending] = useActionState<DailyActionState, FormData>(removeItemAction, undefined);
  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-ink">{item.name}</div>
          <div className="mt-0.5 text-xs text-ink-muted">
            {item.code} · {formatNumber(item.volumeDone)} {item.unit ?? ""} · {formatRupiah(BigInt(item.valueDone))}
          </div>
          <div className="text-xs text-ink-muted">
            Kumulatif: {formatNumber(item.volumeCumulative)}
            {item.volumeContract != null ? ` / ${formatNumber(item.volumeContract)}` : ""} {item.unit ?? ""}
            {item.pctCumulative != null ? ` (${item.pctCumulative.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%)` : ""}
          </div>
          {item.notes ? <div className="mt-0.5 text-xs text-ink-faint">“{item.notes}”</div> : null}
        </div>
        {reportId ? (
          <form action={formAction}>
            <input type="hidden" name="reportId" value={reportId} />
            <input type="hidden" name="itemId" value={item.id} />
            <Button type="submit" variant="ghost" size="sm" loading={pending} aria-label={`Hapus ${item.name}`}>
              <Trash2 aria-hidden className="size-4 text-danger" />
            </Button>
          </form>
        ) : null}
      </div>
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {item.photos.length > 0 ? <PhotoGallery photos={item.photos} thumbClass="h-14 w-14" /> : null}
    </li>
  );
}

function ItemList({ reportId, items }: { reportId: string | null; items: WorkspaceItem[] }) {
  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border bg-surface px-4 py-6 text-center text-sm text-ink-muted">
        Belum ada item pekerjaan hari ini — mulai dari form di atas.
      </p>
    );
  }
  return (
    <div className="rounded-lg border border-border bg-surface shadow-xs">
      <div className="border-b border-border px-4 py-2.5 text-sm font-semibold text-ink">
        Item hari ini ({items.length})
      </div>
      <ul className="divide-y divide-border">
        {items.map((it) => (
          <ItemRow key={it.id} reportId={reportId} item={it} />
        ))}
      </ul>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────

function SubmitPanel({ reportId, slug, dateKey }: { reportId: string; slug: string; dateKey: string }) {
  const [state, formAction, pending] = useActionState<DailyActionState, FormData>(submitReportAction, undefined);

  // Kirim sukses → draft lokal (slug,date) tidak relevan lagi.
  useEffect(() => {
    if (state?.success) clearLocalDrafts(slug, dateKey);
  }, [state, slug, dateKey]);

  return (
    <form action={formAction} className="space-y-2">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <input type="hidden" name="reportId" value={reportId} />
      <Button type="submit" loading={pending} className="h-13 w-full text-base">
        <Send aria-hidden className="size-4" />
        Kirim Laporan
      </Button>
      <p className="text-center text-[11px] text-ink-muted">
        Setelah dikirim, laporan diverifikasi. Item tidak bisa diubah kecuali dikembalikan untuk koreksi.
      </p>
    </form>
  );
}
