import type { ReactNode } from "react";

/**
 * Kartu aksi – satu pekerjaan kontrak yang jarang dilakukan, dijelaskan dalam
 * satu kalimat, dengan pemicunya sendiri (DECISIONS 386).
 *
 * Kenapa bukan formnya langsung seperti sebelumnya: keempat form kontrak
 * (adendum, koreksi, penanda tangan, tanda tangan & stempel) semuanya panjang,
 * dan menampilkannya sekaligus mendorong RINGKASAN KONTRAK – satu-satunya
 * bagian halaman ini yang dibaca berulang – ke atas layar lalu hilang dari
 * pandangan.
 *
 * Kalimat penjelasnya bukan hiasan. Beda antara "adendum" dan "koreksi data"
 * adalah beda antara perubahan resmi dan pembetulan salah input; kalau bedanya
 * hanya ada di kepala orang yang membangunnya, cepat atau lambat koreksi akan
 * dipakai untuk hal yang seharusnya adendum.
 */
export function AksiTile({
  judul,
  penjelasan,
  aksi,
}: {
  judul: string;
  penjelasan: string;
  aksi: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-lg border border-border bg-surface px-3 py-2.5 shadow-xs">
      <p className="text-[13px] font-semibold text-ink">{judul}</p>
      <p className="mt-0.5 mb-2.5 flex-1 text-[12px] leading-snug text-ink-muted">{penjelasan}</p>
      <div className="flex flex-wrap gap-2">{aksi}</div>
    </div>
  );
}
