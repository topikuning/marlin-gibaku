"use client";

import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Combobox = pengganti <Select> yang BISA DICARI (ketik untuk filter), tapi tetap
 * drop-in untuk form Server Action: terima <option> sebagai children ATAU prop
 * `options`, dan menaruh nilai terpilih di <input type="hidden" name=…> supaya
 * ikut FormData. Kotak pencarian OTOMATIS muncul bila opsi > `searchThreshold`
 * (default 7) — daftar pendek tetap ringkas. Mobile-friendly: target ketuk besar,
 * panel selebar kontrol. A11y: role combobox/listbox + navigasi keyboard.
 */

export type ComboOption = { value: string; label: string; disabled?: boolean };

/** Ekstrak teks dari ReactNode (string/number/array of them) untuk label opsi. */
function nodeText(node: ReactNode): string {
  if (node == null || node === false) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (isValidElement(node)) return nodeText((node.props as { children?: ReactNode }).children);
  return "";
}

function optionsFromChildren(children: ReactNode): ComboOption[] {
  const out: ComboOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child) || child.type !== "option") return;
    const props = child.props as { value?: unknown; children?: ReactNode; disabled?: boolean };
    const value = props.value != null ? String(props.value) : "";
    out.push({ value, label: nodeText(props.children) || value, disabled: props.disabled });
  });
  return out;
}

export interface ComboboxProps {
  name?: string;
  id?: string;
  /** Terkontrol: nilai + onChange. */
  value?: string;
  /** Tak-terkontrol: nilai awal. */
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** Sumber opsi — pakai ini ATAU children <option>. */
  options?: ComboOption[];
  children?: ReactNode;
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  /** Tampilkan kotak cari bila jumlah opsi melebihi ini (default 7). */
  searchThreshold?: number;
}

const CONTROL =
  "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 text-base sm:text-sm text-ink " +
  "focus-visible:outline-2 focus-visible:outline-primary-600 disabled:cursor-not-allowed disabled:bg-surface-inset disabled:text-ink-faint";

export function Combobox({
  name,
  id,
  value,
  defaultValue,
  onChange,
  options,
  children,
  placeholder = "Pilih…",
  invalid,
  disabled,
  required,
  className,
  searchThreshold = 7,
}: ComboboxProps) {
  const items = useMemo(() => options ?? optionsFromChildren(children), [options, children]);
  const isControlled = value !== undefined;
  const [internal, setInternal] = useState(defaultValue ?? "");
  const selected = isControlled ? value : internal;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const showSearch = items.length > searchThreshold;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((o) => o.label.toLowerCase().includes(q)) : items;
  }, [items, query]);

  const selectedLabel = items.find((o) => o.value === selected)?.label ?? "";

  // Tutup saat klik luar.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (open && showSearch) searchRef.current?.focus();
  }, [open, showSearch]);

  function commit(v: string) {
    if (!isControlled) setInternal(v);
    onChange?.(v);
    setOpen(false);
    setQuery("");
  }

  function openMenu() {
    if (disabled) return;
    setOpen(true);
    const idx = filtered.findIndex((o) => o.value === selected);
    setActive(idx >= 0 ? idx : 0);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = filtered[active];
      if (opt && !opt.disabled) commit(opt.value);
    }
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      {name ? <input type="hidden" name={name} value={selected} /> : null}
      <button
        type="button"
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-invalid={invalid || undefined}
        aria-required={required || undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
        className={cn(CONTROL, invalid && "border-danger")}
      >
        <span className={cn("truncate", !selectedLabel && "text-ink-faint")}>
          {selectedLabel || placeholder}
        </span>
        <ChevronDown aria-hidden className="size-4 shrink-0 text-ink-muted" />
      </button>

      {open ? (
        <div
          /**
           * Panel BOLEH lebih lebar daripada pemicunya.
           *
           * Dulu `w-full` mengunci lebarnya ke lebar tombol, jadi pilihan
           * panjang terpotong jadi "Rapat Persiapan ...", "Pengukuran / Uit...",
           * "Mutual Check a..." — dan justru bagian yang membedakan pilihanlah
           * yang hilang. Daftar pilihan yang tidak terbaca bukan daftar pilihan.
           *
           * `w-max` menumbuhkannya seukuran isi terpanjang, `min-w-full` menjaga
           * tetap serapi tombolnya, dan batas atasnya mengikuti lebar layar
           * supaya di ponsel tidak keluar tepi.
           */
          className="absolute z-50 mt-1 w-max min-w-full max-w-[min(32rem,calc(100vw-2rem))] overflow-hidden rounded-md border border-border bg-surface shadow-lg"
        >
          {showSearch ? (
            <div className="flex items-center gap-2 border-b border-border px-2.5">
              <Search aria-hidden className="size-4 shrink-0 text-ink-muted" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onKeyDown}
                placeholder="Cari…"
                // text-base di ponsel — kotak cari ini diketik, jadi kena aturan
                // zoom iOS yang sama (DECISIONS 246).
                className="h-9 w-full bg-transparent text-base sm:text-sm text-ink outline-none placeholder:text-ink-faint"
              />
            </div>
          ) : null}
          <ul id={listId} role="listbox" className="max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-ink-faint">Tak ada hasil</li>
            ) : (
              filtered.map((o, i) => {
                const isSel = o.value === selected;
                return (
                  <li key={o.value || `_${i}`} role="option" aria-selected={isSel}>
                    <button
                      type="button"
                      disabled={o.disabled}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => commit(o.value)}
                      className={cn(
                        "flex w-full items-start justify-between gap-2 px-3 py-2 text-left text-sm text-ink",
                        i === active && "bg-surface-muted",
                        o.disabled && "cursor-not-allowed text-ink-faint",
                      )}
                    >
                      {/* Label TIDAK dipotong: teks panjang dibiarkan turun baris. Lebih
                          baik satu pilihan memakan dua baris daripada dua pilihan
                          tampak sama karena ekornya sama-sama hilang. */}
                      <span className="break-words whitespace-normal">{o.label}</span>
                      {isSel ? <Check aria-hidden className="size-4 shrink-0 text-primary-600" /> : null}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
