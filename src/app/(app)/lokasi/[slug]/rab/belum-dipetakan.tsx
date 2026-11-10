import Link from "next/link";
import { formatNumber } from "@/lib/format";

/**
 * Peringatan di dekat tombol AKTIFKAN: item yang sudah dilaporkan tetapi belum
 * dipasangkan ke item draft (DECISIONS 754). Pilihan user 2026-11-10: *"cukup
 * minta konfirmasi saat aktivasi"* – jadi ini peringatan + konfirmasi, bukan
 * penghalang. Server memeriksa ulang (`tolakTanpaKonfirmasiPadanan`).
 */

export type BelumDipetakanRingkas = {
  lineageKey: string;
  jalur: string;
  name: string;
  realisasi: number;
  unit: string | null;
  /** Laporan atas item draft lama yang menunggu sebagai catatan di luar RAB (DECISIONS 755). */
  catatan?: boolean;
};

/**
 * Jangkar tujuan "Pasangkan dulu": item kontrak dipasangkan di panel pemetaan,
 * catatan berasal-draft di panel "Pekerjaan di luar RAB" (DECISIONS 755).
 */
export function jangkarPemetaan(items: readonly BelumDipetakanRingkas[]): string {
  return items.some((i) => !i.catatan) ? "#pemetaan" : "#panel-luar-rab";
}

export function PeringatanBelumDipetakan({
  items,
  hrefPemetaan,
  batas = 6,
}: {
  items: BelumDipetakanRingkas[];
  /** Tautan ke panel pemetaan; null bila sudah di halaman yang sama dan tidak perlu. */
  hrefPemetaan: string | null;
  batas?: number;
}) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-md border border-warning-border bg-warning-soft px-3 py-2.5 text-left text-[13px]">
      <p className="font-medium text-ink">
        {items.length} item yang sudah dilaporkan belum dipasangkan ke item draft
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-muted">
        {items.slice(0, batas).map((i) => (
          <li key={i.lineageKey}>
            {i.jalur} {i.name} – {formatNumber(i.realisasi)}
            {i.unit ? ` ${i.unit}` : ""}
          </li>
        ))}
        {items.length > batas ? <li>+{items.length - batas} lainnya</li> : null}
      </ul>
      <p className="mt-1 text-ink">
        Sesudah aktivasi, realisasinya tidak dihitung di progres. Laporan dan fotonya tetap ada.
        {hrefPemetaan ? (
          <>
            {" "}
            <Link href={hrefPemetaan} className="font-medium text-primary hover:underline">
              Pasangkan dulu
            </Link>
            , atau konfirmasi untuk tetap mengaktifkan.
          </>
        ) : (
          " Pasangkan dulu di panel di atas, atau konfirmasi untuk tetap mengaktifkan."
        )}
        {items.some((i) => i.catatan)
          ? " Yang berlabel catatan di luar RAB tetap menunggu dan bisa dipadankan ke draft berikutnya."
          : null}
      </p>
    </div>
  );
}

/** Kalimat untuk dialog konfirmasi bawaan peramban. */
export function kalimatKonfirmasiBelumDipetakan(items: BelumDipetakanRingkas[], batas = 5): string {
  if (items.length === 0) return "";
  const daftar = items
    .slice(0, batas)
    .map((i) => `• ${i.jalur} ${i.name} (${formatNumber(i.realisasi)}${i.unit ? ` ${i.unit}` : ""})`)
    .join("\n");
  return (
    `PERHATIAN: ${items.length} item yang sudah dilaporkan belum dipasangkan ke item draft:\n${daftar}` +
    `${items.length > batas ? `\n+${items.length - batas} lainnya` : ""}\n` +
    `Sesudah aktivasi, realisasinya tidak dihitung di progres (laporan dan fotonya tetap ada).\n\n`
  );
}
