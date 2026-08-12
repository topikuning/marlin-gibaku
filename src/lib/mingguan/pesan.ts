import { formatPct } from "@/lib/format";

/**
 * Teks LAPORAN PROGRES MINGGUAN untuk grup WhatsApp — MODUL MURNI.
 *
 * Permintaan user 2026-08-12: *"aku butuh marlin mengirim rutin laporan
 * mingguan secara otomatis maupun ada trigger manual untuk kirim ke group
 * whatsapp"*, dengan format yang sudah dipakai orang mengetik tangan selama ini.
 *
 * Dipisah dari pengirimnya supaya isinya bisa diuji tanpa DB maupun WAHA, dan
 * supaya kalimatnya cuma ditulis di SATU tempat. Pesan ini masuk ke grup yang
 * dibaca PPK dan konsultan — salah angka di sini bukan bug tampilan, melainkan
 * laporan resmi yang keliru.
 *
 * ### Angkanya DITERIMA, bukan dihitung di sini
 *
 * Target/Realisasi/Deviasi datang apa adanya dari `getLocationProgress`
 * (`src/lib/progress.ts`) — satu-satunya lapisan perhitungan progres. Modul ini
 * hanya memformat. Menghitung ulang di sini, sekecil apa pun, akan membuat WA
 * dan layar bisa berbeda tanpa ada yang tahu mana yang benar (CLAUDE.md).
 *
 * ### Kenapa koma, padahal contoh user memakai titik
 *
 * Contohnya menulis `6.178%`. Seluruh MARLIN — layar, PDF, Excel — memakai
 * format id-ID berkoma (DECISIONS 107), dan user memilih koma saat ditanya.
 * Tiga desimal dipertahankan persis seperti contohnya.
 */

/** Satu desa/KNMP di dalam pesan. Semua angka sudah jadi, tinggal dicetak. */
export type BarisLokasiMingguan = {
  nama: string;
  /** Rencana kurva-S pada minggu ini (%). `null` = lokasi belum punya baseline. */
  targetPct: number | null;
  realisasiPct: number;
  /** realisasi − target. Positif = mendahului. */
  deviasiPct: number;
};

export type IsiPesanMingguan = {
  /** Nama vendor pelaksana kontrak. */
  pelaksana: string;
  /** Minggu ke berapa sejak SPMK — sifat KONTRAK, sama untuk semua lokasinya. */
  mingguKe: number;
  lokasi: BarisLokasiMingguan[];
};

/**
 * Arah deviasi dalam bahasa yang dipakai di lapangan.
 *
 * Nolnya diperlakukan sebagai "Sesuai rencana", bukan "Mendahului": mendahului
 * sebesar 0% adalah kalimat yang tidak berarti apa-apa.
 */
export function labelDeviasi(deviasiPct: number): string {
  if (deviasiPct > 0) return "Mendahului";
  if (deviasiPct < 0) return "Terlambat";
  return "Sesuai rencana";
}

/**
 * Susun pesan untuk SATU paket. `null` bila tidak ada lokasi yang bisa
 * dilaporkan — grup tidak dikirimi kepala surat tanpa isi.
 *
 * Seluruh lokasi paket ditumpuk dalam SATU pesan (pilihan user): satu kontrak =
 * satu SPMK = satu nomor minggu, jadi memecahnya jadi lima pesan hanya
 * mengulang kepala yang sama lima kali di grup yang sama.
 */
export function susunPesanMingguan(isi: IsiPesanMingguan): string | null {
  if (isi.lokasi.length === 0) return null;

  const blok = isi.lokasi.map((l) => {
    /*
     * Lokasi tanpa baseline TIDAK dicetak "Target : 0,000%".
     *
     * Nol adalah pernyataan bahwa rencananya memang nol minggu ini; kalau
     * kurva-S-nya belum ada, yang benar adalah mengaku belum tahu. Deviasinya
     * ikut disembunyikan — selisih terhadap target yang tidak ada bukan angka,
     * dan di grup ini ia akan terbaca sebagai prestasi.
     */
    if (l.targetPct == null) {
      return [
        `Nama Desa/KNMP : ${l.nama}`,
        "Target : belum ada kurva-S",
        `Realisasi : ${formatPct(l.realisasiPct, 3)}`,
        "Deviasi : belum bisa dihitung",
      ].join("\n");
    }
    return [
      `Nama Desa/KNMP : ${l.nama}`,
      `Target : ${formatPct(l.targetPct, 3)}`,
      `Realisasi : ${formatPct(l.realisasiPct, 3)}`,
      `Deviasi : ${formatPct(l.deviasiPct, 3)} (${labelDeviasi(l.deviasiPct)})`,
    ].join("\n");
  });

  return [
    "Laporan Progres Mingguan",
    `Nama Pelaksana : ${isi.pelaksana}`,
    `Minggu Ke : ${isi.mingguKe}`,
    "",
    blok.join("\n\n"),
  ].join("\n");
}
