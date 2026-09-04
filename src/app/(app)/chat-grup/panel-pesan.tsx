"use client";

import { useAksi } from "@/lib/aksi-klien";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Badge, Button, Card, CardBody, EmptyState } from "@/components/ui";
import { MessageSquareText, MoreVertical, Paperclip, Star } from "lucide-react";
import type { ChatMessageView, MarlinDispatch } from "@/lib/waha/chat-summary";
import { CATEGORY_LABEL, RELEVANCE_LABEL, RELEVANCE_TONE, type Relevance } from "@/lib/waha/message-classify";
import { setMessageRelevanceAction, type RelevansiState } from "@/lib/waha/relevansi-actions";
import { SenderAliasForm } from "./sender-alias-form";
import { toggleFavorite, useFavorites } from "./sidebar-grup";

const PER_PAGE = 20;

/** Label relevansi di layar baru: "perlu interpretasi" dibaca "Perlu review". */
function relevanceBadge(r: Relevance): { label: string; tone: "danger" | "success" | "warning" | "neutral" } {
  if (r === "perlu_interpretasi") return { label: "Perlu review", tone: "warning" };
  return { label: RELEVANCE_LABEL[r], tone: RELEVANCE_TONE[r] };
}

/** Warna avatar inisial — deterministik dari nama, token tema (tanpa hex). */
const AVATAR_CLASS = [
  "bg-info-soft text-info",
  "bg-success-soft text-success",
  "bg-warning-soft text-warning",
  "bg-danger-soft text-danger",
  "bg-surface-inset text-ink-muted",
] as const;

function avatarOf(name: string): { initials: string; cls: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials =
    parts.length === 0
      ? "?"
      : parts.length === 1
        ? parts[0].slice(0, 2).toUpperCase()
        : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { initials, cls: AVATAR_CLASS[h % AVATAR_CLASS.length] };
}

type TabId = "relevan" | "marlin" | "arsip";

/**
 * Panel tengah workspace chat grup: header grup (bintang favorit + tanggal
 * aktif), tiga tab (Pesan relevan | Kiriman MARLIN | Arsip lengkap), bilah
 * kurasi massal (tandai relevan / abaikan / kembali otomatis), baris pesan
 * ber-checkbox + badge relevansi + menu per-pesan, dan paginasi.
 */
export function PanelPesan({
  packageId,
  dateKey,
  groupTitle,
  subTitle,
  messages,
  dispatches,
}: {
  packageId: string;
  dateKey: string;
  groupTitle: string;
  subTitle: string;
  messages: ChatMessageView[];
  dispatches: MarlinDispatch[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>("relevan");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menuId, setMenuId] = useState<string | null>(null);
  const fav = useFavorites().includes(packageId);
  const [state, dispatchAction, pending] = useAksi<RelevansiState>(
    setMessageRelevanceAction,
    undefined,
  );
  const [, startTransition] = useTransition();

  const member = useMemo(() => messages.filter((m) => !m.fromMe), [messages]);
  const relevant = useMemo(() => member.filter((m) => m.dipakai), [member]);
  const marlinMsgs = useMemo(() => messages.filter((m) => m.fromMe), [messages]);

  const rows = tab === "relevan" ? relevant : tab === "arsip" ? messages : marlinMsgs;
  const pageRows = rows.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const selectable = pageRows.filter((m) => !m.fromMe).map((m) => m.id);
  const allChecked = selectable.length > 0 && selectable.every((id) => selected.has(id));

  const submit = (aksi: "relevan" | "diabaikan" | "reset", ids: string[]) => {
    if (ids.length === 0) return;
    const fd = new FormData();
    fd.set("packageId", packageId);
    fd.set("dateKey", dateKey);
    fd.set("aksi", aksi);
    for (const id of ids) fd.append("ids", id);
    setMenuId(null);
    setSelected(new Set());
    startTransition(() => dispatchAction(fd));
  };

  const tabs: { id: TabId; label: string; count: number }[] = [
    { id: "relevan", label: "Pesan relevan", count: relevant.length },
    { id: "marlin", label: "Kiriman MARLIN", count: dispatches.length + marlinMsgs.length },
    { id: "arsip", label: "Arsip lengkap", count: messages.length },
  ];

  return (
    <Card className="min-w-0">
      <CardBody className="space-y-3">
        {/* Header grup */}
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border-muted pb-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h2 className="truncate text-base font-semibold text-ink">{groupTitle}</h2>
              <button
                type="button"
                onClick={() => toggleFavorite(packageId)}
                aria-label={fav ? "Hapus dari favorit" : "Jadikan favorit"}
                aria-pressed={fav}
                className="rounded p-0.5 text-ink-faint hover:text-warning"
              >
                <Star aria-hidden className={`size-4 ${fav ? "fill-warning text-warning" : ""}`} />
              </button>
            </div>
            <p className="truncate text-xs text-ink-muted">{subTitle}</p>
          </div>
          <label className="flex items-center gap-2 text-xs text-ink-muted">
            Tanggal aktif
            <input
              type="date"
              value={dateKey}
              onChange={(e) => {
                if (e.target.value) router.push(`/chat-grup?p=${packageId}&d=${e.target.value}`);
              }}
              className="h-8 rounded-md border border-border bg-surface px-2 text-sm text-ink focus:border-primary focus:outline-none"
            />
          </label>
        </div>

        {/* Tab */}
        <div className="flex gap-1 border-b border-border-muted" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => {
                // Ganti tab = konteks baru: seleksi & halaman kembali ke awal.
                setTab(t.id);
                setPage(1);
                setSelected(new Set());
                setMenuId(null);
              }}
              className={`-mb-px border-b-2 px-3 py-1.5 text-sm font-medium ${
                tab === t.id
                  ? "border-primary text-primary"
                  : "border-transparent text-ink-muted hover:text-ink"
              }`}
            >
              {t.label} <span className="text-xs text-ink-faint">({t.count})</span>
            </button>
          ))}
        </div>

        {/* Bilah kurasi massal */}
        {tab !== "marlin" ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-muted px-2.5 py-1.5">
            <label className="flex items-center gap-1.5 text-sm text-ink-muted">
              <input
                type="checkbox"
                checked={allChecked}
                onChange={(e) => {
                  const next = new Set(selected);
                  for (const id of selectable) {
                    if (e.target.checked) next.add(id);
                    else next.delete(id);
                  }
                  setSelected(next);
                }}
                disabled={selectable.length === 0}
                className="size-4 accent-[var(--color-primary)]"
              />
              Pilih semua ({selected.size})
            </label>
            <span className="ml-auto flex flex-wrap gap-1.5">
              <Button
                size="sm"
                variant="secondary"
                disabled={pending || selected.size === 0}
                onClick={() => submit("relevan", [...selected])}
              >
                Tandai relevan
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={pending || selected.size === 0}
                onClick={() => submit("diabaikan", [...selected])}
              >
                Abaikan
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending || selected.size === 0}
                onClick={() => submit("reset", [...selected])}
              >
                Kembali otomatis
              </Button>
            </span>
            {state?.error ? <span className="w-full text-xs text-danger">{state.error}</span> : null}
            {state?.success ? <span className="w-full text-xs text-success">{state.success}</span> : null}
          </div>
        ) : null}

        {/* Isi tab */}
        {tab === "marlin" ? (
          <div className="space-y-4">
            <div>
              <p className="mb-1.5 text-[11px] font-medium tracking-wide text-ink-muted uppercase">
                Menurut data MARLIN ({dispatches.length})
              </p>
              {dispatches.length === 0 ? (
                <p className="text-sm text-ink-muted">
                  Tidak ada laporan/kegiatan yang dikirim MARLIN ke grup pada tanggal ini.
                </p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {dispatches.map((d, i) => (
                    <li key={`${d.kind}-${i}`} className="flex gap-2">
                      <span className="tabular shrink-0 text-xs text-ink-faint">{d.timeLabel ?? "--:--"}</span>
                      <span className="text-ink-muted">{d.label}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="mb-1.5 text-[11px] font-medium tracking-wide text-ink-muted uppercase">
                Terekam di grup ({marlinMsgs.length})
              </p>
              {marlinMsgs.length === 0 ? (
                <p className="text-sm text-ink-muted">
                  Belum ada pesan keluar yang tertangkap webhook. Pastikan event WAHA
                  <code className="mx-1 rounded bg-surface-inset px-1">message.any</code>
                  aktif agar kiriman MARLIN ikut terarsip.
                </p>
              ) : (
                <ul className="space-y-2">
                  {pageRows.map((m) => (
                    <BarisPesan key={m.id} m={m} checked={false} onCheck={null} menuOpen={false} onMenu={null} onAksi={submit} />
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : pageRows.length === 0 ? (
          <EmptyState
            icon={MessageSquareText}
            title={tab === "relevan" ? "Tidak ada pesan relevan" : "Tidak ada pesan"}
            description={
              tab === "relevan"
                ? "Tidak ada obrolan anggota yang dipakai ringkasan pada tanggal ini – cek tab Arsip lengkap untuk menandai manual."
                : "Belum ada pesan terarsip pada tanggal ini."
            }
            className="py-8"
          />
        ) : (
          <ul className="space-y-2">
            {pageRows.map((m) => (
              <BarisPesan
                key={m.id}
                m={m}
                checked={selected.has(m.id)}
                onCheck={
                  m.fromMe
                    ? null
                    : (v) => {
                        const next = new Set(selected);
                        if (v) next.add(m.id);
                        else next.delete(m.id);
                        setSelected(next);
                      }
                }
                menuOpen={menuId === m.id}
                onMenu={m.fromMe ? null : () => setMenuId((cur) => (cur === m.id ? null : m.id))}
                onAksi={submit}
              />
            ))}
          </ul>
        )}

        {/* Paginasi */}
        {rows.length > PER_PAGE ? (
          <div className="flex items-center justify-between border-t border-border-muted pt-2 text-xs text-ink-muted">
            <span>
              Menampilkan {(page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, rows.length)} dari {rows.length}
            </span>
            <span className="flex gap-1">
              <Button size="sm" variant="ghost" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                Sebelumnya
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={page * PER_PAGE >= rows.length}
                onClick={() => setPage((p) => p + 1)}
              >
                Berikutnya
              </Button>
            </span>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function BarisPesan({
  m,
  checked,
  onCheck,
  menuOpen,
  onMenu,
  onAksi,
}: {
  m: ChatMessageView;
  checked: boolean;
  onCheck: ((v: boolean) => void) | null;
  menuOpen: boolean;
  onMenu: (() => void) | null;
  onAksi: (aksi: "relevan" | "diabaikan" | "reset", ids: string[]) => void;
}) {
  const av = avatarOf(m.sender.displayName);
  const dim = !m.fromMe && !m.dipakai;
  const badge = m.fromMe
    ? { label: "Sudah dikirim MARLIN", tone: "info" as const }
    : m.override === "relevan"
      ? { label: "Ditandai relevan", tone: "success" as const }
      : m.override === "diabaikan"
        ? { label: "Diabaikan", tone: "neutral" as const }
        : relevanceBadge(m.class.relevance);

  return (
    <li
      className={`relative flex gap-2.5 rounded-md border px-3 py-2 ${
        dim ? "border-dashed border-border-muted bg-surface-inset/40" : "border-border bg-surface"
      }`}
    >
      {onCheck ? (
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onCheck(e.target.checked)}
          aria-label={`Pilih pesan ${m.sender.displayName} ${m.timeLabel}`}
          className="mt-1.5 size-4 shrink-0 accent-[var(--color-primary)]"
        />
      ) : null}
      <span
        aria-hidden
        className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${av.cls}`}
      >
        {av.initials}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`text-sm font-medium ${dim ? "text-ink-muted" : "text-ink"}`}>
            {m.sender.displayName}
          </span>
          <span className="tabular text-xs text-ink-faint">{m.timeLabel}</span>
          <Badge tone={badge.tone} label={badge.label} />
          {!m.fromMe && m.class.category !== "lainnya" ? (
            <Badge tone="neutral" label={CATEGORY_LABEL[m.class.category]} />
          ) : null}
        </div>
        <p className={`mt-1 text-sm whitespace-pre-wrap ${dim ? "text-ink-faint" : "text-ink-muted"}`}>
          {m.body || <span className="italic">(tanpa teks)</span>}
        </p>
        {m.hasMedia ? (
          <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-border bg-surface-inset px-2 py-0.5 text-xs text-ink-muted">
            <Paperclip aria-hidden className="size-3" />
            Lampiran berkas
          </span>
        ) : null}
        <p className="mt-1 text-[11px] text-ink-faint">
          {m.override
            ? m.override === "relevan"
              ? "Ditandai relevan oleh reviewer"
              : "Diabaikan oleh reviewer"
            : m.class.reason}
        </p>
        {m.sender.needsAlias && m.sender.senderKey ? (
          <SenderAliasForm senderKey={m.sender.senderKey} hint={m.sender.displayName} />
        ) : null}
      </div>
      {onMenu ? (
        <div className="shrink-0">
          <button
            type="button"
            onClick={onMenu}
            aria-label="Aksi pesan"
            aria-expanded={menuOpen}
            className="rounded p-1 text-ink-faint hover:bg-surface-muted hover:text-ink"
          >
            <MoreVertical aria-hidden className="size-4" />
          </button>
          {menuOpen ? (
            <div className="absolute top-8 right-2 z-10 w-44 rounded-md border border-border bg-surface py-1 shadow-lg">
              <button
                type="button"
                onClick={() => onAksi("relevan", [m.id])}
                className="block w-full px-3 py-1.5 text-left text-sm text-ink hover:bg-surface-muted"
              >
                Tandai relevan
              </button>
              <button
                type="button"
                onClick={() => onAksi("diabaikan", [m.id])}
                className="block w-full px-3 py-1.5 text-left text-sm text-ink hover:bg-surface-muted"
              >
                Abaikan
              </button>
              {m.override ? (
                <button
                  type="button"
                  onClick={() => onAksi("reset", [m.id])}
                  className="block w-full px-3 py-1.5 text-left text-sm text-ink-muted hover:bg-surface-muted"
                >
                  Kembali ke otomatis
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
