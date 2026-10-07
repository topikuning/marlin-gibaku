import type { RingkasanRincian } from "@/lib/rab/rincian/baca";

/**
 * RINGKASAN BACKUP VOLUME & ANALISA sebuah berkas RAB (DECISIONS baru
 * 2026-10-06). Dipakai pratinjau impor dan halaman pelengkapan dari arsip.
 *
 * Yang lemah disebut lebih dulu daripada yang beres: item yang tidak tertaut,
 * yang dicocokkan lewat harga, dan yang harganya berbeda dari analisa – itu
 * yang perlu diperiksa orang, bukan jumlah yang berhasil.
 */
export function RincianBerkasRingkas({
  r,
  tersembunyiDibaca,
}: {
  r: RingkasanRincian;
  tersembunyiDibaca: string[];
}) {
  const n = (x: number) => x.toLocaleString("id-ID");
  const tanpaBackup = r.volumeAngkaLangsung + r.volumeKosong + r.volumeTidakTerbaca;
  return (
    <ul className="list-disc space-y-1 pl-4 text-sm text-ink">
      <li>
        <span className="font-medium">Backup volume:</span> {n(r.volumeTertaut)} dari {n(r.item)} item tertaut ke sheet
        backup.
        {tanpaBackup > 0 ? (
          <>
            {" "}
            {n(tanpaBackup)} item tanpa backup karena volumenya diketik langsung di sheet RAB
            {r.volumeTidakTerbaca > 0 ? `, ${n(r.volumeTidakTerbaca)} di antaranya rumusnya menunjuk sheet yang tidak ada` : ""}.
          </>
        ) : null}
      </li>
      {r.volumeDiolah > 0 ? (
        <li>
          {n(r.volumeDiolah)} item volumenya diolah lagi di rumus RAB (misalnya 1/3 × backup, atau MC-0 + tambah). Angkanya
          memang tidak sama dengan sheet backup. Rumusnya ikut disimpan.
        </li>
      ) : null}
      {r.volumeBeda > 0 ? (
        <li className="text-warning">
          {n(r.volumeBeda)} item menunjuk sel backup yang angkanya berbeda dari volume di RAB. Biasanya berkasnya belum
          dihitung ulang di Excel.
        </li>
      ) : null}
      <li>
        <span className="font-medium">Analisa:</span> {n(r.analisaRumus)} item tertaut lewat rumus
        {r.analisaTidakAda > 0 ? `, ${n(r.analisaTidakAda)} item tanpa analisa` : ""}.
        {r.analisaCocokHarga > 0 ? (
          <span className="text-warning">
            {" "}
            {n(r.analisaCocokHarga)} item dicocokkan lewat harga satuan yang sama persis dengan satu baris Resume Analisa,
            karena baris RAB-nya tidak menunjuk analisa.
          </span>
        ) : null}
      </li>
      {r.hargaBeda > 0 ? (
        <li>
          {n(r.hargaBeda)} item harga satuan kontraknya berbeda dari harga analisa (biasanya karena negosiasi). Keduanya
          disimpan, tidak disamakan.
        </li>
      ) : null}
      <li>
        {n(r.blokAnalisa)} analisa dan {n(r.hargaDasar)} bahan & upah yang dipakai analisa ikut disimpan.
      </li>
      {tersembunyiDibaca.length > 0 ? (
        <li>
          Ikut dibaca karena dirujuk rumus RAB, walaupun disembunyikan di Excel: {tersembunyiDibaca.join(", ")}.
        </li>
      ) : null}
    </ul>
  );
}
