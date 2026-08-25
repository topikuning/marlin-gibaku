"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore } from "react";
import { Badge, Card, CardBody, CardHeader, type BadgeTone } from "@/components/ui";
import { Search, Star } from "lucide-react";

export type GrupItem = {
  id: string;
  name: string;
  workTitle: string | null;
  waGroupName: string | null;
  vendorName: string | null;
  msgCount: number;
  /** Tanggal pesan terakhir grup (label pendek), null bila belum ada pesan. */
  lastLabel: string | null;
};

export type HariItem = {
  dateKey: string;
  label: string;
  count: number;
  statusLabel: string | null;
  statusTone: BadgeTone | null;
};

const FAV_KEY = "marlin.chatgrup.fav";
export const FAV_EVENT = "marlin:chatgrup-fav";

export function readFavorites(): string[] {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function toggleFavorite(id: string): string[] {
  const cur = readFavorites();
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(next));
  } catch {
    /* penyimpanan browser bisa diblokir — favorit memang hanya kenyamanan lokal */
  }
  try {
    window.dispatchEvent(new Event(FAV_EVENT));
  } catch {
    /* noop */
  }
  return next;
}

/* Store eksternal kecil untuk favorit: snapshot di-cache supaya
   useSyncExternalStore tidak melihat array baru tiap render. */
const FAV_EMPTY: string[] = [];
let favSnapshot: string[] | null = null;
function getFavSnapshot(): string[] {
  if (favSnapshot === null) favSnapshot = readFavorites();
  return favSnapshot;
}
function subscribeFav(cb: () => void): () => void {
  const sync = () => {
    favSnapshot = readFavorites();
    cb();
  };
  window.addEventListener(FAV_EVENT, sync);
  return () => window.removeEventListener(FAV_EVENT, sync);
}

/** Daftar id grup favorit (per-browser), sinkron antar komponen halaman ini. */
export function useFavorites(): string[] {
  return useSyncExternalStore(subscribeFav, getFavSnapshot, () => FAV_EMPTY);
}

const RINGKAS = 8; // grup yang tampil sebelum "Lihat semua"

/**
 * Kolom kiri workspace chat grup: cari grup/paket, tab Semua|Favorit
 * (favorit per-browser via localStorage), daftar grup ber-jumlah pesan +
 * tanggal terakhir, dan kartu Tanggal dengan kalender loncat cepat.
 */
export function SidebarGrup({
  groups,
  activeId,
  days,
  dateKey,
}: {
  groups: GrupItem[];
  activeId: string | null;
  days: HariItem[];
  dateKey: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"semua" | "favorit">("semua");
  const favs = useFavorites();
  const [showAll, setShowAll] = useState(false);
  const [showCal, setShowCal] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let rows = groups;
    if (needle) {
      rows = rows.filter((g) =>
        [g.name, g.workTitle, g.waGroupName, g.vendorName]
          .filter(Boolean)
          .some((s) => s!.toLowerCase().includes(needle)),
      );
    }
    if (tab === "favorit") rows = rows.filter((g) => favs.includes(g.id));
    return rows;
  }, [groups, q, tab, favs]);

  const visible = showAll ? filtered : filtered.slice(0, RINGKAS);
  const hidden = filtered.length - visible.length;

  return (
    <div className="space-y-3">
      <Card>
        <CardBody className="space-y-2">
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-ink-faint" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cari grup atau paket…"
              aria-label="Cari grup atau paket"
              className="h-9 w-full rounded-md border border-border bg-surface pr-2 pl-8 text-sm text-ink placeholder:text-ink-faint focus:border-primary focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-1 rounded-md bg-surface-inset p-0.5 text-sm" role="tablist">
            {(
              [
                ["semua", "Semua Grup"],
                ["favorit", "Favorit"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`rounded px-2 py-1 font-medium ${
                  tab === id ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <ul className="space-y-1">
            {visible.length === 0 ? (
              <li className="px-1 py-2 text-sm text-ink-muted">
                {tab === "favorit"
                  ? "Belum ada grup favorit – klik bintang pada grup."
                  : "Tidak ada grup yang cocok dengan pencarian."}
              </li>
            ) : (
              visible.map((g) => {
                const on = g.id === activeId;
                const fav = favs.includes(g.id);
                return (
                  <li key={g.id} className="relative">
                    <Link
                      href={`/chat-grup?p=${g.id}`}
                      aria-current={on ? "page" : undefined}
                      className={`block rounded-md border py-2 pr-8 pl-2.5 text-sm ${
                        on
                          ? "border-primary bg-info-soft text-primary"
                          : "border-transparent text-ink-muted hover:bg-surface-muted"
                      }`}
                    >
                      <span className="block truncate font-medium">{g.name}</span>
                      <span className="mt-0.5 block truncate text-xs text-ink-faint">
                        {g.waGroupName ?? "grup WA"}
                        {g.vendorName ? ` · ${g.vendorName}` : ""}
                      </span>
                      <span className="mt-0.5 block text-xs text-ink-faint">
                        {g.msgCount} pesan{g.lastLabel ? ` · ${g.lastLabel}` : ""}
                      </span>
                    </Link>
                    <button
                      type="button"
                      onClick={() => toggleFavorite(g.id)}
                      aria-label={fav ? `Hapus ${g.name} dari favorit` : `Jadikan ${g.name} favorit`}
                      aria-pressed={fav}
                      className="absolute top-2 right-2 rounded p-0.5 text-ink-faint hover:text-warning"
                    >
                      <Star aria-hidden className={`size-4 ${fav ? "fill-warning text-warning" : ""}`} />
                    </button>
                  </li>
                );
              })
            )}
          </ul>
          {hidden > 0 ? (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="w-full text-left text-xs text-primary hover:underline"
            >
              Lihat semua grup ({filtered.length})
            </button>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Tanggal" subtitle="Hari yang punya pesan." />
        <CardBody className="space-y-1">
          {days.length === 0 ? (
            <p className="text-sm text-ink-muted">Belum ada pesan terarsip.</p>
          ) : (
            days.map((d) => (
              <Link
                key={d.dateKey}
                href={activeId ? `/chat-grup?p=${activeId}&d=${d.dateKey}` : "/chat-grup"}
                aria-current={d.dateKey === dateKey ? "page" : undefined}
                className={`flex items-center justify-between gap-1 rounded-md px-2 py-1.5 text-sm ${
                  d.dateKey === dateKey ? "bg-info-soft text-primary" : "hover:bg-surface-muted"
                }`}
              >
                <span>{d.label}</span>
                <span className="flex items-center gap-1 text-xs text-ink-faint">
                  {d.statusLabel && d.statusTone ? <Badge tone={d.statusTone} label={d.statusLabel} /> : null}
                  <Badge tone="neutral" label={String(d.count)} />
                </span>
              </Link>
            ))
          )}
          {showCal ? (
            <input
              type="date"
              defaultValue={dateKey}
              aria-label="Loncat ke tanggal"
              onChange={(e) => {
                if (e.target.value && activeId) router.push(`/chat-grup?p=${activeId}&d=${e.target.value}`);
              }}
              className="mt-1 h-9 w-full rounded-md border border-border bg-surface px-2 text-sm text-ink focus:border-primary focus:outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => setShowCal(true)}
              className="w-full text-left text-xs text-primary hover:underline"
            >
              Lihat kalender
            </button>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
