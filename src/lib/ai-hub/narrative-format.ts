import type { SourceRef } from "./types";

/**
 * Tipe & formatter MURNI narasi lapangan (tanpa DB) — dipisah dari `narrative.ts`
 * (server-only, fetch DB) supaya bisa diimpor aman oleh modul lain (mis.
 * prompt.ts) dan diuji unit tanpa environment DB. DECISIONS 136.
 */

const NOTE_MAX_CHARS = 240;

export function truncateText(s: string | null | undefined, max = NOTE_MAX_CHARS): string | null {
  if (!s) return null;
  const t = s.trim();
  if (t.length === 0) return null;
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

export type NarrativeReportItem = { itemName: string; unit: string | null; volumeDone: number; notes: string | null };
export type NarrativeReport = {
  id: string;
  date: string; // dateKey
  status: string;
  weather: string | null;
  notes: string | null;
  photoCount: number;
  items: NarrativeReportItem[];
};
export type NarrativeActivity = {
  id: string;
  date: string;
  kindLabel: string;
  title: string;
  notes: string | null;
  kendala: string | null;
  solusi: string | null;
  status: string;
  photoCount: number;
};
export type LocationNarrative = {
  locationId: string;
  locationName: string;
  slug: string;
  reports: NarrativeReport[];
  activities: NarrativeActivity[];
};
export type NarrativeBundle = { locations: LocationNarrative[] };

/** SourceRef granular per entri (laporan/kegiatan) — dipakai grounding + drawer sumber. MURNI. */
export function toNarrativeSourceRefs(bundle: NarrativeBundle): SourceRef[] {
  const refs: SourceRef[] = [];
  for (const loc of bundle.locations) {
    for (const r of loc.reports) {
      refs.push({
        id: `${loc.slug}:laporan:${r.date}`,
        entityType: "daily_report",
        entityId: r.id,
        label: `${loc.locationName} – laporan ${r.date}`,
        value: r.notes ?? "(tanpa catatan naratif)",
        href: `/lokasi/${loc.slug}/harian/${r.date}`,
      });
    }
    for (const a of loc.activities) {
      refs.push({
        id: `${loc.slug}:kegiatan:${a.id}`,
        entityType: "field_activity",
        entityId: a.id,
        label: `${loc.locationName} – ${a.kindLabel} ${a.date}`,
        value: a.notes ?? a.title,
        href: `/lokasi/${loc.slug}/kegiatan`,
      });
    }
  }
  return refs;
}

/** Total entri narasi (utk UI/limitations — "berapa banyak yang dijadikan konteks"). */
export function narrativeEntryCount(bundle: NarrativeBundle): number {
  return bundle.locations.reduce((s, l) => s + l.reports.length + l.activities.length, 0);
}

const NARRATIVE_MAX_CHARS = 18_000;

/**
 * Payload narasi lapangan (laporan harian + kegiatan) — teks apa adanya,
 * BUKAN angka resmi. Setiap baris membawa penanda sumber granular supaya AI
 * mengutip sourceRefId yang tepat (bukan hanya id lokasi). MURNI & unit-tested.
 */
export function buildNarrativePayload(bundle: NarrativeBundle, opts?: { maxChars?: number }): string {
  const maxChars = opts?.maxChars ?? NARRATIVE_MAX_CHARS;
  const withContent = bundle.locations.filter((l) => l.reports.length > 0 || l.activities.length > 0);
  if (withContent.length === 0) {
    return "NARASI LAPANGAN: tidak ada catatan laporan harian/kegiatan pada periode & scope ini.";
  }
  const lines: string[] = [
    "NARASI LAPANGAN (kutip/rangkum apa adanya sebagai konteks kualitatif – BUKAN sumber angka progres; setiap baris punya id sumber granular):",
  ];
  for (const loc of withContent) {
    lines.push(`### ${loc.locationName}`);
    if (loc.reports.length) {
      lines.push("Laporan harian:");
      for (const r of loc.reports) {
        const itemsTxt = r.items.length
          ? " Item: " +
            r.items
              .map((it) => `${it.itemName} ${it.volumeDone}${it.unit ?? ""}${it.notes ? ` (${it.notes})` : ""}`)
              .join("; ")
          : "";
        lines.push(
          `- ${r.date} [${r.status}]${r.weather ? ` cuaca=${r.weather}` : ""}: ${r.notes ?? "(tanpa catatan)"}${itemsTxt} · ${r.photoCount} foto (sumber: ${loc.slug}:laporan:${r.date})`,
        );
      }
    }
    if (loc.activities.length) {
      lines.push("Kegiatan lapangan:");
      for (const a of loc.activities) {
        const extra = [a.kendala ? `Kendala: ${a.kendala}` : null, a.solusi ? `Solusi: ${a.solusi}` : null]
          .filter(Boolean)
          .join(" · ");
        lines.push(
          `- ${a.date} [${a.kindLabel}/${a.status}] ${a.title}: ${a.notes ?? "(tanpa catatan)"}${extra ? ` · ${extra}` : ""} · ${a.photoCount} foto (sumber: ${loc.slug}:kegiatan:${a.id})`,
        );
      }
    }
  }
  let text = lines.join("\n");
  if (text.length > maxChars) {
    text = `${text.slice(0, maxChars).trimEnd()}\n… (narasi terpotong karena batas ukuran – persempit scope/periode untuk narasi lebih lengkap)`;
  }
  return text;
}
