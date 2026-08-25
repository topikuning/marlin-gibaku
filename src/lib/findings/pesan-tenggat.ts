/**
 * TEKS PENGINGAT TEMUAN LEWAT TENGGAT — MODUL MURNI (DECISIONS 426).
 *
 * Saudara kandung `kendala/pesan-tenggat.ts`, alasan yang sama: perhitungan
 * "lewat tenggat" ada di papan `/temuan`, tapi papan hanya menolong yang
 * membukanya. Sidik jari & batas baris DIPAKAI ULANG dari modul kendala —
 * logikanya identik dan dua salinan pasti perlahan berbeda.
 */
import { MAKS_BARIS, sidikTenggat, type BarisTenggat } from "@/lib/kendala/pesan-tenggat";

export { MAKS_BARIS, sidikTenggat };

export type BarisTemuanTenggat = BarisTenggat & {
  /** rendah | sedang | tinggi | kritis — ikut dicetak; temuan kritis harus terbaca beda. */
  severity: string;
};

const SEVERITY_LABEL: Record<string, string> = {
  kritis: "KRITIS",
  tinggi: "tinggi",
  sedang: "sedang",
  rendah: "rendah",
};

/** Bangun pesan untuk SATU grup paket. `null` = tidak ada yang lewat tenggat. */
export function pesanTemuanTenggat(
  namaPaket: string,
  baris: BarisTemuanTenggat[],
  /** Jumlah SEBENARNYA (bila `baris` potongan) — alasan sama dgn kendala. */
  total = baris.length,
): string | null {
  if (baris.length === 0) return null;

  const urut = [...baris].sort((a, b) => b.lewatHari - a.lewatHari);
  const tampil = urut.slice(0, MAKS_BARIS);
  const jumlah = Math.max(total, urut.length);
  const sisa = jumlah - tampil.length;

  const daftar = tampil.map((b) => {
    const bagian = [b.judul, b.lokasi, SEVERITY_LABEL[b.severity] ?? b.severity];
    bagian.push(b.pic ? `PIC ${b.pic}` : "belum ada PIC");
    bagian.push(`lewat ${b.lewatHari} hari`);
    return `• ${bagian.join(" – ")}`;
  });

  const kepala =
    jumlah === 1
      ? "1 temuan pemeriksa sudah lewat tenggat tindak lanjut:"
      : `${jumlah} temuan pemeriksa sudah lewat tenggat tindak lanjut:`;

  return [
    `⚠️ *MARLIN – Temuan lewat tenggat*`,
    namaPaket,
    "",
    kepala,
    ...daftar,
    ...(sisa > 0 ? [`• dan ${sisa} temuan lain yang tidak ditampilkan di sini`] : []),
    "",
    "Tindak lanjuti lalu ajukan verifikasi lewat menu *Temuan* di MARLIN – temuan hanya selesai setelah verifikator menutupnya.",
    "",
    "_Pesan otomatis._",
  ].join("\n");
}
