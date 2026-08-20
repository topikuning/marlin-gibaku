/**
 * Isi kolom "Nomor" di daftar paket: nomor paket, dan bila KOSONG dipakai
 * nomor KONTRAK.
 *
 * Permintaan user 2026-08-04. Alasannya nyata di lapangan: paket yang sudah
 * berkontrak kerap tidak pernah diberi nomor paket sendiri, sedangkan nomor
 * kontraknya justru nomor yang dipakai orang menyebut paket itu. Tanpa
 * cadangan ini kolomnya berisi "—" berderet padahal nomornya ADA, cuma
 * tersimpan di kontrak.
 *
 * `??` saja TIDAK cukup — ia hanya menangkap null/undefined, sementara kolom
 * teks yang "kosong" bisa juga berupa string kosong atau spasi, dan itu tetap
 * tampil kosong di layar sambil menutup jalan ke nomor kontraknya. Karena itu
 * di-trim dulu, dan yang dikembalikan pun sudah rapi.
 */
export function nomorPaket(
  packageNumber: string | null | undefined,
  contractNumber?: string | null,
): string {
  return packageNumber?.trim() || contractNumber?.trim() || "–";
}
