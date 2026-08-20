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
  /** "Bangkalan, Jawa Timur" — kabupaten & provinsi, permintaan user 2026-08-12. */
  wilayah: string;
  /** Rencana kurva-S pada minggu ini (%). `null` = lokasi belum punya baseline. */
  targetPct: number | null;
  realisasiPct: number;
  /** realisasi − target. Positif = mendahului. */
  deviasiPct: number;
};

/**
 * Angka SELURUH paket — rata-rata TERTIMBANG nilai kontrak, bukan rata-rata
 * biasa. Sudah dihitung di hulu oleh `progress-calc` (formula kanonik); di sini
 * hanya dicetak.
 */
export type RekapPaket = {
  targetPct: number;
  realisasiPct: number;
  deviasiPct: number;
  /** Berapa lokasi yang IKUT dihitung. */
  lokasiDihitung: number;
  /**
   * Lokasi yang DIKELUARKAN karena belum punya kurva-S. Disebut jumlahnya, tidak
   * disembunyikan: "2 dari 3 lokasi" adalah keterangan yang berbeda jauh dari
   * "2 lokasi", dan pembacanya berhak tahu angka ini belum mencakup semuanya.
   */
  lokasiTanpaKurva: number;
};

export type IsiPesanMingguan = {
  /** Nama vendor pelaksana kontrak. */
  pelaksana: string;
  /** Minggu ke berapa sejak SPMK — sifat KONTRAK, sama untuk semua lokasinya. */
  mingguKe: number;
  /**
   * Rentang tanggal minggu itu, mis. "12–18 Agu 2026" (DECISIONS 357).
   *
   * Wajib ada sejak minggu yang dilaporkan bisa BUKAN minggu berjalan: nomor
   * minggu saja tidak cukup bagi PPK & konsultan yang menerima pesannya untuk
   * tahu periode mana yang dimaksud, dan pesan WhatsApp tidak bisa ditarik
   * kembali untuk diperjelas.
   */
  periode?: string | null;
  /** false = minggu sudah TUNTAS; true = masih berjalan (data belum genap). */
  berjalan?: boolean;
  lokasi: BarisLokasiMingguan[];
  /**
   * Rekap seluruh paket. `null` bila tidak ada yang bisa dihitung — dan SENGAJA
   * dilewati saat paketnya cuma punya satu lokasi: rekapnya akan mengulang
   * angka yang sama persis dengan blok di atasnya.
   */
  rekap?: RekapPaket | null;
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
        `Kabupaten/Provinsi : ${l.wilayah}`,
        "Target : belum ada kurva-S",
        `Realisasi : ${formatPct(l.realisasiPct, 3)}`,
        "Deviasi : belum bisa dihitung",
      ].join("\n");
    }
    return [
      `Nama Desa/KNMP : ${l.nama}`,
      `Kabupaten/Provinsi : ${l.wilayah}`,
      `Target : ${formatPct(l.targetPct, 3)}`,
      `Realisasi : ${formatPct(l.realisasiPct, 3)}`,
      `Deviasi : ${formatPct(l.deviasiPct, 3)} (${labelDeviasi(l.deviasiPct)})`,
    ].join("\n");
  });

  const bagian = [
    "Laporan Progres Mingguan",
    `Nama Pelaksana : ${isi.pelaksana}`,
    `Minggu Ke : ${isi.mingguKe}${isi.periode ? ` (${isi.periode})` : ""}`,
    /*
     * Minggu BERJALAN dikatakan apa adanya. Angkanya belum genap seminggu, dan
     * penerima yang mengira ini laporan minggu penuh akan membandingkannya
     * dengan minggu-minggu sebelumnya yang genap — perbandingan yang selalu
     * membuat minggu berjalan terlihat tertinggal.
     */
    ...(isi.berjalan ? ["_(minggu berjalan – belum genap seminggu)_"] : []),
    "",
    blok.join("\n\n"),
  ];

  /*
   * REKAP paket ditaruh di BAWAH, sesudah rinciannya.
   *
   * Ia rangkuman, dan rangkuman yang mendahului hal yang dirangkumnya membuat
   * pembaca menakar angka gabungan sebelum tahu isinya. Untuk paket satu lokasi
   * bagian ini tidak muncul sama sekali — angkanya akan sama persis dengan blok
   * di atasnya, dan mengulanginya hanya membuat pesan lebih panjang tanpa
   * menambah satu pun keterangan baru.
   */
  const r = isi.rekap;
  if (r && isi.lokasi.length > 1) {
    const cakupan =
      r.lokasiTanpaKurva > 0
        ? `${r.lokasiDihitung} dari ${r.lokasiDihitung + r.lokasiTanpaKurva} lokasi – ${r.lokasiTanpaKurva} lokasi belum ada kurva-S`
        : `${r.lokasiDihitung} lokasi`;
    bagian.push(
      "",
      `TOTAL PAKET (${cakupan})`,
      `Target : ${formatPct(r.targetPct, 3)}`,
      `Realisasi : ${formatPct(r.realisasiPct, 3)}`,
      `Deviasi : ${formatPct(r.deviasiPct, 3)} (${labelDeviasi(r.deviasiPct)})`,
    );
  }

  return bagian.join("\n");
}
