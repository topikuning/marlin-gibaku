"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export type EvidenceTab = {
  id: string;
  label: string;
  count: number;
  content: ReactNode;
};

/**
 * Tab bukti percakapan (WAI-ARIA tabs pattern: roving tabindex + panah kiri/kanan
 * + Home/End). Isi tiap panel dirender di server dan dilewatkan sebagai children
 * — komponen ini hanya mengurus perpindahan tab. DECISIONS 139.
 */
export function EvidenceTabs({ tabs }: { tabs: EvidenceTab[] }) {
  const [active, setActive] = useState(0);
  const baseId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function focusTab(i: number) {
    const next = (i + tabs.length) % tabs.length;
    setActive(next);
    refs.current[next]?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      focusTab(i + 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      focusTab(i - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusTab(0);
    } else if (e.key === "End") {
      e.preventDefault();
      focusTab(tabs.length - 1);
    }
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label="Bukti percakapan"
        className="flex flex-wrap gap-1 border-b border-border px-1"
      >
        {tabs.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${baseId}-tab-${t.id}`}
            aria-selected={active === i}
            aria-controls={`${baseId}-panel-${t.id}`}
            tabIndex={active === i ? 0 : -1}
            onClick={() => setActive(i)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "-mb-px flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active === i
                ? "border-primary text-primary"
                : "border-transparent text-ink-muted hover:border-border-strong hover:text-ink",
            )}
          >
            {t.label}
            <span
              className={cn(
                "tabular rounded-full px-1.5 py-0.5 text-[11px]",
                active === i ? "bg-info-soft text-primary" : "bg-surface-inset text-ink-faint",
              )}
            >
              {t.count}
            </span>
          </button>
        ))}
      </div>
      {tabs.map((t, i) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`${baseId}-panel-${t.id}`}
          aria-labelledby={`${baseId}-tab-${t.id}`}
          hidden={active !== i}
          tabIndex={0}
          className="pt-3 focus-visible:outline-none"
        >
          {t.content}
        </div>
      ))}
    </div>
  );
}
