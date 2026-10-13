/**
 * KOP halaman "LAPORAN PROGRES MINGGUAN" (format Lampiran Termin KKP,
 * DECISIONS 670) – teksnya SATU sumber untuk web, PDF, dan Excel.
 *
 * Koreksi user 2026-10-12: *"kamu harus singkronkan semua format kop dsb, baik
 * excel, pdf, web. pastikan sesuai format dari kkp yang sudah aku berikan"*.
 * Ketiga penyaji dulu menyusun kopnya sendiri-sendiri dan hasilnya berbeda
 * (web satu kolom, PDF kisi empat kolom, Excel tanpa logo konsultan). Kini
 * mereka hanya menata, isinya dari sini.
 *
 * Susunan contoh: judul di tengah; identitas paket di kiri; di kanan
 * "MINGGU KE-n (…)", periode, lalu tiga kotak logo PENYEDIA JASA · KONSULTAN
 * PENGAWAS · PEMBERI TUGAS.
 */
import { formatTanggal } from "@/lib/format";
import { terbilang } from "@/lib/daily-report/kkp-lampiran-susun";
import type { PeriodHeader } from "@/lib/periodic-report";

const SATUAN = ["", "Satu", "Dua", "Tiga", "Empat", "Lima", "Enam", "Tujuh", "Delapan", "Sembilan", "Sepuluh", "Sebelas"];

/** Terbilang 0..9999 untuk masa pelaksanaan ("120 (Seratus Dua Puluh) Hari"). */
export function terbilangHari(n: number): string | null {
  if (!Number.isInteger(n) || n < 1 || n > 9999) return null;
  const kata = (x: number): string => {
    if (x < 12) return SATUAN[x];
    if (x < 20) return `${SATUAN[x - 10]} Belas`;
    if (x < 100) return `${SATUAN[Math.floor(x / 10)]} Puluh${x % 10 ? ` ${SATUAN[x % 10]}` : ""}`;
    if (x < 200) return `Seratus${x % 100 ? ` ${kata(x % 100)}` : ""}`;
    if (x < 1000) return `${SATUAN[Math.floor(x / 100)]} Ratus${x % 100 ? ` ${kata(x % 100)}` : ""}`;
    if (x < 2000) return `Seribu${x % 1000 ? ` ${kata(x % 1000)}` : ""}`;
    return `${SATUAN[Math.floor(x / 1000)]} Ribu${x % 1000 ? ` ${kata(x % 1000)}` : ""}`;
  };
  return kata(n);
}

export type KopProgresMingguan = {
  judul: string;
  minggu: string;
  periode: string;
  identitas: [string, string][];
  /** Urutan kotak logo di kanan kop – sama dengan contoh KKP. */
  pihak: readonly ["PENYEDIA JASA", "KONSULTAN PENGAWAS", "PEMBERI TUGAS"];
};

const rupiah = (n: bigint) => `Rp ${new Intl.NumberFormat("id-ID").format(Number(n))}`;

export function kopProgresMingguan(h: PeriodHeader, n: number): KopProgresMingguan {
  const kata = terbilang(n);
  const hari = terbilangHari(h.masaPelaksanaanHari);
  const lokasi = `${h.village}${h.district ? `, Kec. ${h.district}` : ""}, ${h.regency}, ${h.province}`;
  const kontrak = h.contractSignedDate
    ? `${h.contractNumber || "–"}. Tgl. ${formatTanggal(h.contractSignedDate, "d MMMM yyyy")}`
    : h.contractNumber || "–";
  return {
    judul: "LAPORAN PROGRES MINGGUAN",
    minggu: `MINGGU KE-${n}${kata ? ` (${kata})` : ""}`,
    periode: `Periode ${formatTanggal(h.periodeStart, "d MMMM")} s/d ${formatTanggal(h.periodeEnd, "d MMMM yyyy")}`,
    identitas: [
      ["Paket Pekerjaan", h.packageName],
      ["Lokasi", lokasi],
      ["Nilai Kontrak Fisik", rupiah(h.contractValue)],
      ["No. dan Tanggal Kontrak", kontrak],
      ["Kontraktor Pelaksana", h.vendorName],
      ["Konsultan Pengawas", h.supervisorFirm?.trim() || h.supervisorName?.trim() || "–"],
      ["Masa Pelaksanaan", `${h.masaPelaksanaanHari}${hari ? ` (${hari})` : ""} Hari Kalender`],
    ],
    pihak: ["PENYEDIA JASA", "KONSULTAN PENGAWAS", "PEMBERI TUGAS"],
  };
}
