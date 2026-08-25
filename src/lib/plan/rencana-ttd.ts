import type { PeriodHeader } from "@/lib/periodic-report";

/**
 * BLOK TANDA TANGAN FORMULIR RENCANA MINGGUAN — satu sumber untuk tiga penyaji
 * (PDF, Excel, layar/cetak). DECISIONS 267.
 *
 * Dulu ketiganya menyusun bloknya sendiri-sendiri dari medan yang sama, dan
 * ketiganya salah dengan cara yang sama: nama penanda tangan diambil dari
 * `disusunOleh` — pengguna APLIKASI yang menyimpan rencana — sementara baris
 * jabatan di bawahnya tetap dari kontrak. Hasilnya satu blok yang menggabungkan
 * dua orang berbeda: "Administrator" di atas "Direktur".
 *
 * Aturannya: yang menandatangani atas nama penyedia jasa adalah penanda tangan
 * yang DITUNJUK KONTRAK. Siapa yang mengetikkan rencananya ke sistem adalah
 * provenansi — tempatnya jejak dokumen, bukan garis tanda tangan.
 *
 * Modul ini MURNI (tanpa I/O) supaya bisa diuji langsung; penyaji hanya
 * menuangkan. Selama ketiganya memanggil fungsi ini, tidak mungkin lagi ada
 * satu keluaran yang menandatangani berbeda dari yang lain.
 */

export type PihakTtd = {
  /**
   * Pihak mana blok ini — dipakai penyaji cetak untuk mengambil gambar tanda
   * tangan & stempel yang benar (DECISIONS 328). Ditaruh DI SINI, bukan
   * disimpulkan dari urutan larik di penyaji: urutan blok bisa berubah kalau
   * formatnya diubah, dan menempelkan stempel PPK di kolom penyedia adalah
   * cacat yang tidak akan terlihat sampai dokumennya sudah beredar.
   */
  pihak: "penyedia" | "pengawas" | "ppk";
  /** Baris kecil di atas: "Disusun Oleh,". */
  title: string;
  /** Peran/instansi — tebal. */
  role: string;
  /** Nama penanda tangan; null = belum diisi di kontrak (ditulis garis titik). */
  name: string | null;
  /** Baris kecil di bawah nama (jabatan / NIP / nama firma). */
  sub: string | null;
};

/** Sumber data yang dibutuhkan blok TTD — sengaja sesempit mungkin. */
export type SumberTtdRencana = {
  header: Pick<
    PeriodHeader,
    | "vendorName"
    | "contractorSignerName"
    | "contractorSignerTitle"
    | "supervisorName"
    | "supervisorFirm"
    | "ppkName"
    | "ppkNip"
  >;
};

export function pihakTandaTanganRencana(r: SumberTtdRencana): [PihakTtd, PihakTtd, PihakTtd] {
  const h = r.header;
  return [
    {
      pihak: "penyedia",
      title: "Disusun Oleh,",
      role: `Penyedia Jasa – ${h.vendorName}`,
      // BUKAN `disusunOleh`. Lihat catatan modul.
      name: h.contractorSignerName?.trim() || null,
      sub: h.contractorSignerTitle?.trim() || null,
    },
    {
      pihak: "pengawas",
      title: "Diperiksa,",
      role: "Konsultan Pengawas",
      name: h.supervisorName?.trim() || null,
      sub: h.supervisorFirm?.trim() || null,
    },
    {
      pihak: "ppk",
      title: "Disetujui,",
      role: "Pejabat Pembuat Komitmen",
      name: h.ppkName?.trim() || null,
      sub: h.ppkNip?.trim() ? `NIP. ${h.ppkNip.trim()}` : null,
    },
  ];
}

/**
 * Jejak penyusunan untuk kaki dokumen — provenansi yang DIPINDAH dari blok
 * tanda tangan, bukan dibuang. Tanpa ini sistem kehilangan siapa yang menyusun.
 */
export function jejakPenyusun(
  r: { disusunOleh: string | null; disusunPada: Date | null },
  tanggal: (d: Date) => string,
): string | null {
  const bagian: string[] = [];
  if (r.disusunPada) bagian.push(`disusun ${tanggal(r.disusunPada)}`);
  if (r.disusunOleh) bagian.push(bagian.length > 0 ? `oleh ${r.disusunOleh}` : `disusun oleh ${r.disusunOleh}`);
  return bagian.length > 0 ? bagian.join(" ") : null;
}
