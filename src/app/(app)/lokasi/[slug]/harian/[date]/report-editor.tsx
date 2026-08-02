"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { Search, Send, Trash2 } from "lucide-react";
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
import type { PhotoView } from "@/lib/photos";
import { removeReportPhotoAction } from "@/lib/daily-report/actions";
import { PhotoSourceInput } from "@/components/knmp/photo-source-input";

/**
 * Editor laporan (draft/perlu_koreksi) — MOBILE-FIRST untuk SM/pelaksana:
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
  photosTanpaItem,
  bolehHapusFoto,
}: {
  locationId: string;
  slug: string;
  dateKey: string;
  reportId: string | null;
  nodes: LeafNodeOption[];
  items: WorkspaceItem[];
  correctionReason: string | null;
  photoEnabled: boolean;
  /** Foto yang item-nya sudah dihapus — ditampilkan supaya bisa dibersihkan. */
  photosTanpaItem: PhotoView[];
  /** Laporan masih bisa diedit (draft / perlu koreksi). */
  bolehHapusFoto: boolean;
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
      <ItemList
        reportId={reportId}
        slug={slug}
        dateKey={dateKey}
        items={items}
        bolehHapusFoto={bolehHapusFoto}
      />
      {photosTanpaItem.length > 0 ? (
        <section className="rounded-lg border border-border bg-surface p-3">
          <h3 className="text-sm font-semibold">Foto tanpa pekerjaan</h3>
          <p className="mt-0.5 text-xs text-muted">
            Foto ini ikut terlepas saat pekerjaannya dihapus. Hapus bila tidak dipakai.
          </p>
          <div className="mt-2">
            <PhotoGallery
              photos={photosTanpaItem}
              thumbClass="h-14 w-14"
              canDelete={bolehHapusFoto}
              deleteAction={removeReportPhotoAction}
            />
          </div>
        </section>
      ) : null}
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
  const [photoKey, setPhotoKey] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

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
      setPhotoKey((k) => k + 1);
      formRef.current?.reset();
      // Fokus ULANG setelah kolom kembali berukuran penuh. Ini yang membuat
      // papan ketik muncul di Android; di iOS yang menahannya tetap fokus
      // pertama di dalam gestur ketukan tombol Simpan (lihat onClick).
      searchRef.current?.focus();
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

      {/* 1 · Pekerjaan */}
      <div>
        <Label htmlFor="dr-search" required>
          1 · Pekerjaan
        </Label>
        {picked ? (
          <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-primary bg-primary-50 px-4 py-3">
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
              {picked.basis === "draft_adendum" ? (
                <p className="mt-1 text-[13px] font-medium text-warning">
                  Item ini dari draft adendum yang belum resmi. Volumenya tercatat dan terlihat di
                  laporan pengajuan adendum, tetapi TIDAK masuk progres resmi, kurva-S, maupun
                  termin sampai adendumnya disahkan.
                </p>
              ) : null}
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={() => setPicked(null)}>
              Ganti
            </Button>
          </div>
        ) : null}

        {/* Kolom cari SELALU terpasang, hanya diciutkan saat sudah ada pilihan.
            Kalau ia dilepas dari DOM, tidak ada yang bisa difokuskan saat tombol
            Simpan diketuk — dan begitu fokus baru dipasang SESUDAH server action
            selesai, gestur pengguna sudah habis dan papan ketik mobile tidak
            mau muncul lagi. Laporan user 2026-08-02: "simpan berhasil, langsung
            inputan pekerjaan aktif lagi buka keyboard siap ketik."
            tabIndex -1 saat diciutkan supaya tidak jadi perhentian Tab siluman.
            SENGAJA TANPA aria-hidden: menaruh elemen yang difokuskan program di
            dalam subpohon aria-hidden memutus pelacakan fokus pembaca layar. */}
        <div className={picked ? "h-0 overflow-hidden opacity-0" : ""}>
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-faint" />
            <Input
              ref={searchRef}
              id="dr-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              inputMode="search"
              tabIndex={picked ? -1 : undefined}
              placeholder="Ketik nama / kode pekerjaan…"
              className="h-11 pl-9 text-base"
            />
          </div>
          {!picked && query ? (
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
                    {/* Item dari draft adendum ditandai — pelapor harus tahu
                        ia mencatat pekerjaan yang belum punya dasar kontrak
                        (DECISIONS 210). */}
                    {n.basis === "draft_adendum" ? (
                      <div className="mt-0.5 inline-block rounded bg-warning-soft px-1.5 py-0.5 text-[11px] font-medium text-warning">
                        Pengajuan adendum — belum resmi
                      </div>
                    ) : null}
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
        </div>
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
        <Label>3 · Foto bukti (opsional)</Label>
        {!photoEnabled ? (
          <p className="rounded-lg border border-warning bg-warning-soft px-3 py-2 text-sm text-ink">
            Penyimpanan foto (Cloudflare R2) belum diaktifkan — unggah foto sementara tidak tersedia.
            Volume tetap bisa disimpan. Hubungi admin untuk mengaktifkan (menu Sistem → tes R2).
          </p>
        ) : (
          <PhotoSourceInput key={photoKey} latName="photoLat" lngName="photoLng" />
        )}
      </div>

      {/* Catatan */}
      <div>
        <Label htmlFor="dr-notes">Catatan (opsional)</Label>
        <Input id="dr-notes" name="notes" maxLength={500} placeholder="mis. cor kolom L2 utara" className="h-11 text-base" />
      </div>

      {/* Fokus dipindah ke kolom cari DI DALAM gestur ketukan ini — bukan
          sesudah server action selesai. Itu satu-satunya cara papan ketik
          mobile tetap terbuka: begitu gesturnya habis, `focus()` hanya
          memindahkan kursor tanpa memunculkan papan ketik. */}
      <Button
        type="submit"
        loading={pending}
        disabled={!picked}
        onClick={() => searchRef.current?.focus()}
        className="h-12 w-full text-base"
      >
        Simpan Progres
      </Button>
      <p className="text-center text-[11px] text-ink-muted">
        Pekerjaan yang sama disimpan ulang = volume diperbarui (tidak dobel).
      </p>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────

function ItemRow({
  reportId,
  slug,
  dateKey,
  item,
  bolehHapusFoto,
}: {
  reportId: string | null;
  slug: string;
  dateKey: string;
  item: WorkspaceItem;
  bolehHapusFoto: boolean;
}) {
  const [state, formAction, pending] = useActionState<DailyActionState, FormData>(removeItemAction, undefined);

  // Setelah item dihapus: buang draft lokal volume untuk node ini supaya saat
  // pekerjaan yang sama dipilih ulang di form, kolom volume TIDAK terisi angka
  // lama (mencegah kesan volume terakumulasi setelah hapus + input ulang).
  useEffect(() => {
    if (!state?.success) return;
    try {
      window.localStorage.removeItem(draftKey(slug, dateKey, item.rabNodeId));
    } catch {
      /* localStorage bisa nonaktif — abaikan */
    }
  }, [state, slug, dateKey, item.rabNodeId]);

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
      {item.photos.length > 0 ? (
        <PhotoGallery
          photos={item.photos}
          thumbClass="h-14 w-14"
          canDelete={bolehHapusFoto}
          deleteAction={removeReportPhotoAction}
        />
      ) : null}
    </li>
  );
}

function ItemList({
  reportId,
  slug,
  dateKey,
  items,
  bolehHapusFoto,
}: {
  reportId: string | null;
  slug: string;
  dateKey: string;
  items: WorkspaceItem[];
  bolehHapusFoto: boolean;
}) {
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
          <ItemRow
            key={it.id}
            reportId={reportId}
            slug={slug}
            dateKey={dateKey}
            item={it}
            bolehHapusFoto={bolehHapusFoto}
          />
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
