import Link from "next/link";
import { formatPct } from "@/lib/format";
import type { ProgresDraftAdendum } from "@/lib/progress";

/**
 * Progres menurut DRAFT adendum di kartu Realisasi (DECISIONS 732, permintaan
 * user 2026-11-01: *"kenapa tidak dibuat saja ada informasi di card yang sudah
 * ada, bobot berdasar draft adendum?"*). Angkanya dari `getProgresDraftAdendum`
 * (kanonik, DECISIONS 210) – tidak ada rumus di sini. Bukan angka resmi:
 * termin, kurva-S, dan blanko KKP tetap memakai RAB kontrak.
 */
export function BarisDraftAdendum({ slug, draft }: { slug: string; draft: ProgresDraftAdendum }) {
  return (
    <Link
      href={`/lokasi/${slug}/progress`}
      title={`Terpasang menurut RAB draft adendum #${draft.revisionNo} yang belum disetujui. Pantauan internal, bukan angka resmi.`}
      className="mt-1 block text-[11px] leading-snug font-medium text-warning hover:underline"
    >
      Menurut draft adendum #{draft.revisionNo}: <span className="tabular">{formatPct(draft.realizedPct)}</span>
      <span className="font-normal text-ink-muted"> · belum resmi</span>
    </Link>
  );
}
