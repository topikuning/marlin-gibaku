import type { IssueStatus } from "@/generated/prisma/enums";

/**
 * ATURAN MENGGABUNGKAN KENDALA KEMBAR — MURNI (DECISIONS 393).
 *
 * Penjaga duplikat (DECISIONS 392) menahan kembar BARU di pintu masuk, tapi
 * tidak bisa merapikan yang terlanjur ada. Tangkapan layar user memuat "Lahan
 * belum bisa clear" tiga kali — tanggal sama, tingkat sama, ketiganya terbuka.
 *
 * ### Menggabungkan BUKAN menghapus
 *
 * Baris kembarnya tetap ada berikut riwayat dan aksi pemulihannya; ia hanya
 * berhenti dihitung dan berhenti muncul. Menghapus akan membuat jejak audit
 * menunjuk ke baris yang tidak ada lagi, dan membatalkan penggabungan yang
 * salah jadi mustahil.
 *
 * Dipisah dari server action supaya aturannya bisa diuji tanpa basis data —
 * dan supaya aturannya hanya ditulis di satu tempat.
 */

export type KendalaGabung = {
  id: string;
  locationId: string;
  status: IssueStatus;
  mergedIntoId: string | null;
};

/**
 * Alasan dua kendala TIDAK boleh digabungkan. `null` = boleh.
 *
 * Mengembalikan kalimat siap-tampil, bukan kode: pesannya masuk ke layar orang
 * lapangan, dan menerjemahkan kode jadi kalimat di komponen berarti kalimatnya
 * ditulis dua kali dan bisa menyimpang.
 */
export function alasanTidakBisaDigabung(
  duplikat: KendalaGabung,
  induk: KendalaGabung,
): string | null {
  if (duplikat.id === induk.id) {
    return "Kendala tidak bisa digabungkan ke dirinya sendiri.";
  }
  if (duplikat.locationId !== induk.locationId) {
    /*
     * Lokasi jadi syarat keras, sama seperti pada penjaga duplikat: "lahan
     * belum bisa clear" di dua desa berbeda adalah dua masalah berbeda,
     * sedekat apa pun kalimatnya. Menggabungkannya akan menghapus satu masalah
     * nyata dari hitungan lokasi yang lain.
     */
    return "Hanya kendala di lokasi yang sama yang bisa digabungkan.";
  }
  if (duplikat.mergedIntoId) {
    return "Kendala ini sudah pernah digabungkan.";
  }
  if (induk.mergedIntoId) {
    /*
     * Kalau induk yang sudah digabung boleh jadi tujuan, terbentuk rantai
     * A → B → C. Setiap pembaca lalu harus menelusuri rantainya untuk tahu
     * mana yang berlaku, dan rantai yang melingkar akan menggantung selamanya.
     * Satu tingkat saja: pilih induk yang masih berdiri sendiri.
     */
    return "Kendala tujuan sendiri sudah digabungkan ke kendala lain – pilih kendala induknya.";
  }
  if (induk.status === "selesai") {
    /*
     * Menggabungkan kendala yang masih terbuka ke kendala yang sudah ditutup
     * akan MENGHILANGKAN masalah yang masih berjalan dari semua hitungan.
     * Yang benar sebaliknya: buka kembali induknya lebih dulu.
     */
    return "Kendala tujuan sudah selesai – buka kembali dulu bila masalahnya kambuh.";
  }
  return null;
}

/**
 * Catatan penutup baku untuk baris kembarnya.
 *
 * Selalu menyebut judul induknya, bukan hanya "digabungkan": orang yang membuka
 * riwayat ini enam bulan lagi tidak punya cara lain mengetahui ke mana masalah
 * ini pindah.
 */
export function catatanGabung(judulInduk: string, catatanTambahan?: string | null): string {
  const dasar = `Digabungkan ke kendala "${judulInduk}" karena kembar.`;
  const t = catatanTambahan?.trim();
  return t ? `${dasar} ${t}` : dasar;
}
