/**
 * PENCARIAN DAFTAR GRUP WHATSAPP – modul murni (DECISIONS 747).
 *
 * Keluhan user 2026-11-06: *"muat data group ini juga menyusahkan pencarian,
 * jika jumlah group sudah banyak."* Daftar "Cara 1" di form grup hanya bisa
 * digulung, padahal nomor MARLIN ikut di banyak grup lintas provinsi.
 *
 * Nama grup ditulis bebas oleh orang ("KNMP JAWA - CV. WAPIKE BALI - DESA
 * SUMBEREJO, KAB. JEMBER, PROV. JAWA TIMUR"), jadi pencocokannya per KATA,
 * urutan bebas, tanpa peduli huruf besar, tanda baca, dan aksen. Semua kata
 * yang diketik wajib ada – "knmp bitung" mempersempit, bukan melebarkan.
 */

function normal(teks: string): string {
  return teks
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Grup yang cocok dengan kata kunci, diurutkan menurut nama. Daftar aslinya tidak diubah. */
export function saringGrupWa<T extends { id: string; name: string }>(grup: readonly T[], kataKunci: string): T[] {
  const kata = normal(kataKunci).split(" ").filter(Boolean);
  const cocok = kata.length
    ? grup.filter((g) => {
        const isi = `${normal(g.name)} ${normal(g.id)}`;
        return kata.every((k) => isi.includes(k));
      })
    : [...grup];
  return cocok.sort((a, b) => a.name.localeCompare(b.name, "id", { sensitivity: "base" }));
}

/**
 * Isian awal kotak cari di form grup KABUPATEN: nama kabupatennya tanpa awalan
 * "Kabupaten"/"Kab."/"Kota". Nama grup jarang menulis awalannya sama persis
 * ("KAB. JEMBER", "Kab Jember", "Jember"), jadi awalan itu justru membuat
 * pencarian gagal.
 */
export function kataKunciKabupaten(regency: string): string {
  return regency
    .trim()
    .replace(/^(kabupaten|kab\.?|kota administrasi|kota)\s+/i, "")
    .trim();
}
