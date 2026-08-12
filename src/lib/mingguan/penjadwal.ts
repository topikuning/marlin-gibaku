import "server-only";
import { db } from "@/lib/db";
import { akhirMingguKontrak, kirimLaporanMingguan } from "./kirim";
import { getMingguanAktif } from "./setelan";

/**
 * Penjadwal LAPORAN PROGRES MINGGUAN — menumpang putaran cron harian yang sudah
 * ada (`/api/cron/harian`), bukan cron kedua.
 *
 * ### Kenapa dipanggil tiap hari padahal laporannya mingguan
 *
 * User memilih pengiriman pada AKHIR MINGGU KONTRAK tiap paket, bukan hari
 * tetap dalam seminggu. Karena tanggal SPMK tiap paket berbeda, hari jatuh
 * temponya juga berbeda-beda — jadi yang mungkin adalah memeriksa setiap hari
 * lalu mengirim untuk paket yang minggu kontraknya memang berakhir hari itu.
 *
 * Aman dipicu berkali-kali sehari: pengamannya UNIQUE `(paket, minggu)` di
 * `weekly_wa_logs`, bukan ketepatan penjadwal luar.
 */

export type HasilMingguan = {
  aktif: boolean;
  diperiksa: number;
  terkirim: number;
  gagal: number;
  dilewati: number;
  rincian: { paket: string; hasil: string }[];
};

export async function kirimLaporanMingguanTerjadwal(now = new Date()): Promise<HasilMingguan> {
  const hasil: HasilMingguan = {
    aktif: true,
    diperiksa: 0,
    terkirim: 0,
    gagal: 0,
    dilewati: 0,
    rincian: [],
  };

  if (!(await getMingguanAktif())) {
    // Sakelar mati = penjadwal diam. Tombol manual SENGAJA tidak ikut terkunci:
    // sakelar ini mematikan jadwal, bukan kemampuan melapor.
    hasil.aktif = false;
    return hasil;
  }

  /*
   * Hanya paket yang BENAR-BENAR sedang berjalan dan punya grup.
   *
   * Paket tanpa `waGroupId` bukan kegagalan yang perlu dicatat setiap hari —
   * ia memang belum disiapkan, dan mencatatnya sebagai "gagal" tiap 24 jam
   * hanya membuat log ini tidak terbaca lagi saat yang gagal betulan muncul.
   */
  const kandidat = await db.package.findMany({
    where: {
      stage: "pelaksanaan",
      waGroupId: { not: null },
      contract: { startDate: { not: null } },
    },
    select: { id: true, name: true, contract: { select: { startDate: true } } },
  });

  for (const p of kandidat) {
    const mulai = p.contract?.startDate;
    if (!mulai) continue;
    if (!akhirMingguKontrak(mulai, now)) continue;

    hasil.diperiksa += 1;
    const r = await kirimLaporanMingguan(p.id, { manual: false, now });
    if (r.ok) {
      hasil.terkirim += 1;
      hasil.rincian.push({ paket: p.name, hasil: `terkirim (minggu ke-${r.mingguKe})` });
    } else if (r.alasan.startsWith("Minggu ke-")) {
      hasil.dilewati += 1;
      hasil.rincian.push({ paket: p.name, hasil: r.alasan });
    } else {
      hasil.gagal += 1;
      hasil.rincian.push({ paket: p.name, hasil: r.alasan });
    }
  }

  return hasil;
}
