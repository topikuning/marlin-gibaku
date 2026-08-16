import type { TtdLaporan, TtdPihak } from "@/lib/export/ttd-laporan";
import { ukuranTtd } from "@/lib/export/ttd-ukuran";

/**
 * RUANG TANDA TANGAN + STEMPEL pada dokumen cetak (DECISIONS 328).
 *
 * Permintaan user: *"orang lapangan kuno dan konservatif, tetap minta untuk
 * laporan di tanda tangan manual dan dicetak"* — lalu *"pastikan semua dokumen
 * itu stempel dan ttdnya proporsional di posisinya"*.
 *
 * ### Kenapa satu komponen, bukan tempelan per dokumen
 *
 * Laporan harian, rencana mingguan, laporan periodik, dan lembar kurva-S punya
 * ukuran huruf yang berbeda-beda (8,5px sampai 10px) dan tinggi ruang tanda
 * tangan yang berbeda pula. Kalau tiap dokumen menempelkan `<img>` sendiri
 * dengan ukuran piksel tetap, stempel yang pas di laporan harian akan melimpah
 * keluar kolom di lembar kurva-S. Karena itu SEMUA ukuran di sini diturunkan
 * dari SATU angka — `tinggi` ruang tanda tangannya — memakai perbandingan
 * benda aslinya:
 *
 *   - stempel bundar dinas ≈ 4 cm garis tengah
 *   - coretan tanda tangan ≈ 3 cm tinggi, ≈ 5–6 cm lebar
 *
 * → stempel setinggi ruang, tanda tangan 0,82 dari itu, lebar tanda tangan
 *   dibatasi 2,4× tingginya. Perbandingannya tetap di dokumen mana pun.
 *
 * ### Kenapa stempel digeser ke kiri dan di BELAKANG tanda tangan
 *
 * Meniru cara orang membubuhkannya: stempel dicap menimpa sisi kiri tanda
 * tangan, tinta tanda tangan tetap terbaca di atasnya. `mix-blend-multiply`
 * membuat latar putih hasil pindaian tidak menutupi apa pun — tanpa itu kotak
 * putih stempel akan menghapus garis nama di bawahnya.
 *
 * ### Yang TIDAK dilakukan
 *
 * Komponen ini tidak memutuskan BOLEH TIDAKNYA tanda tangan ditempel. Ia hanya
 * menggambar apa yang diberikan. Pemanggil yang menentukan (mis. hanya laporan
 * berstatus final yang dikirimi gambar) — kalau `ttd` dan `stempel` null,
 * hasilnya persis seperti sebelum fitur ini ada: ruang kosong untuk
 * ditandatangani dengan pena.
 */

export type { TtdLaporan, TtdPihak };

export function RuangTtd({
  tinggi,
  ttd,
  stempel,
}: {
  /** Tinggi ruang tanda tangan dalam piksel CSS — semua ukuran lain turunannya. */
  tinggi: number;
  ttd?: { url: string } | null;
  stempel?: { url: string } | null;
}) {
  // Tanpa gambar: ruang kosong biasa. Tidak ada bingkai, tidak ada penanda —
  // dokumennya harus terlihat sama persis dengan sebelum fitur ini ada.
  if (!ttd && !stempel) return <div style={{ height: tinggi }} />;

  // Perbandingannya milik `lib/export/ttd-ukuran` — dipakai bersama penyaji PDF
  // supaya kertas dan layar tidak bisa berbeda ukuran.
  const u = ukuranTtd(tinggi);

  return (
    <div className="relative overflow-visible" style={{ height: tinggi }}>
      {stempel ? (
        // eslint-disable-next-line @next/next/no-img-element -- URL presigned R2 sementara
        <img
          src={stempel.url}
          alt=""
          aria-hidden
          className="absolute left-1/2 object-contain"
          style={{
            // `bottom: naik` — diangkat dari garis pijak supaya sisi ATASnya
            // menimpa baris teks di atasnya, seperti stempel yang dicap di
            // kertas. Lihat catatan `NAIK` di lib/export/ttd-ukuran.
            bottom: u.naik,
            height: u.stempel.tinggi,
            width: u.stempel.lebar,
            transform: `translateX(calc(-50% - ${u.geser}px))`,
            mixBlendMode: "multiply",
            // Tanpa ini Chrome membuang gambar latar saat mencetak.
            printColorAdjust: "exact",
            WebkitPrintColorAdjust: "exact",
          }}
        />
      ) : null}
      {ttd ? (
        // eslint-disable-next-line @next/next/no-img-element -- URL presigned R2 sementara
        <img
          src={ttd.url}
          alt=""
          aria-hidden
          className="absolute left-1/2 -translate-x-1/2 object-contain"
          style={{
            bottom: u.naik,
            height: u.ttd.tinggi,
            maxWidth: u.ttd.lebarMaks,
            mixBlendMode: "multiply",
            printColorAdjust: "exact",
            WebkitPrintColorAdjust: "exact",
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Ambil gambar satu pihak dari berkas TTD, aman terhadap `undefined`.
 * Dipakai penyaji supaya tidak perlu menulis rantai `?.` di setiap blok.
 */
export function gambarPihak(
  t: TtdLaporan | null | undefined,
  pihak: "ppk" | "pengawas" | "penyedia",
): { ttd: { url: string } | null; stempel: { url: string } | null } {
  const p = t?.[pihak];
  return { ttd: p?.ttd ?? null, stempel: p?.stempel ?? null };
}
