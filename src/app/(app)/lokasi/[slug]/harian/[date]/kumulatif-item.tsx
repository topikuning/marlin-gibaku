import { formatNumber } from "@/lib/format";
import type { WorkspaceItem } from "@/lib/daily-report/queries";

/**
 * KONTRAK DAN DRAFT ADENDUM TERPISAH di baris laporan harian (DECISIONS 742).
 *
 * Keluhan user 2026-11-06 dengan tangkapan layar laporan terkirim: baris urugan
 * tampil "220 m³ · 317,97 / 3.045,152 (10,4%) · Rp 49.199.282" – kumulatif
 * kontrak dibagi volume draft, tanpa penanda, nilainya seperti angka resmi.
 * *"harus ditampilkan dengan jelas mana yang berdasar kontrak dan draft
 * adendum, kalau begini rancu"*.
 *
 * Tanpa hook: dipakai editor (klien) dan tabel laporan terkirim (server).
 */

const pct = (p: number | null) => (p != null ? ` (${p.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%)` : "");

export function PenandaDraftAdendum({ item }: { item: Pick<WorkspaceItem, "basis"> }) {
  if (item.basis !== "draft_adendum") return null;
  return (
    <div className="mt-0.5 inline-block rounded bg-warning-soft px-1.5 py-0.5 text-[11px] font-medium text-warning">
      Draft adendum – belum resmi, tidak masuk progres
    </div>
  );
}

export function KumulatifItem({
  item,
  satuan = false,
  rataKiri = false,
}: {
  item: Pick<WorkspaceItem, "basis" | "kontrak" | "volumeCumulative" | "volumeContract" | "pctCumulative" | "unit">;
  /** Tulis satuan di belakang angka (baris editor). */
  satuan?: boolean;
  /** Bertumpuk rata kiri (daftar editor di ponsel); bawaannya rata kanan (kolom tabel). */
  rataKiri?: boolean;
}) {
  const u = satuan && item.unit ? ` ${item.unit}` : "";
  const ukuran = `${formatNumber(item.volumeCumulative)}${item.volumeContract != null ? ` / ${formatNumber(item.volumeContract)}` : ""}${u}${pct(item.pctCumulative)}`;
  if (item.basis !== "draft_adendum") return <>{ukuran}</>;
  return (
    <span className={`inline-flex flex-col gap-0.5 ${rataKiri ? "items-start text-left" : "items-end text-right"}`}>
      {item.kontrak ? (
        <span>
          <span className="text-ink-muted">Kontrak </span>
          {formatNumber(item.kontrak.kumulatif)}
          {item.kontrak.volume != null ? ` / ${formatNumber(item.kontrak.volume)}` : ""}
          {u}
          {pct(item.kontrak.pct)}
        </span>
      ) : null}
      <span className="text-warning">
        <span className="font-medium">Draft adendum </span>
        {ukuran}
      </span>
    </span>
  );
}
