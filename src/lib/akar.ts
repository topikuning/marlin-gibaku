/**
 * SUPER ADMIN UTAMA ("akar") — ditetapkan dari LUAR database, lewat variabel
 * lingkungan `SUPER_ADMIN_UTAMA`. MURNI (tanpa db/network), jadi aturannya bisa
 * diuji langsung.
 *
 * ### Kenapa harus dari luar database
 *
 * Sebelum ini, akun super admin adalah PINTU SATU ARAH: super admin boleh
 * MEMBUAT super admin lain (`ROLE_CREATE_MATRIX`), tapi `outranks` melarang
 * siapa pun menonaktifkan, menurunkan, atau mereset akun setingkat — termasuk
 * yang membuatnya. Aman terhadap akun bocor, tapi jadi jebakan pada kejadian
 * paling biasa: orang keluar dari perusahaan dan akunnya tidak bisa dimatikan
 * siapa pun. Pemulihannya cuma SQL langsung ke database produksi.
 *
 * Menaruh akarnya di dalam database akan mengembalikan masalah yang sama:
 * apa pun yang bisa diubah dari dalam aplikasi bisa diubah oleh akun yang
 * bocor. Yang di env tidak — mengubahnya menuntut akses deploy, yaitu kendali
 * yang berbeda dan lebih sedikit orangnya.
 *
 * ### Kenapa USERNAME, bukan email atau ID
 *
 * `username` adalah satu-satunya identitas akun yang TIDAK BISA diubah dari
 * dalam aplikasi — ia hanya diisi saat akun dibuat. Email bisa diganti lewat
 * "Edit nama", jadi memakainya berarti pagar ini bisa dipindahkan oleh orang
 * yang seharusnya dijaga olehnya. ID bisa saja dipakai, tapi UUID tidak layak
 * diketik manusia ke dashboard Railway dan salah ketiknya tak terbaca.
 */

/**
 * Baca daftar username akar dari nilai mentah env (dipisah koma).
 *
 * Boleh lebih dari satu, dan itu disengaja: satu akar tunggal menghadirkan
 * kembali jebakan yang sama satu tingkat di atas — kalau orangnya pergi, tidak
 * ada yang bisa menurunkan siapa pun sampai ada yang mengubah env.
 *
 * Dinormalisasi ke huruf kecil karena username memang huruf kecil
 * (`createUser`: /^[a-z0-9._-]+$/); tanpa ini "Admin" di Railway diam-diam
 * tidak cocok dengan "admin" di database.
 */
export function parseAkar(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

/** Identitas seadanya yang cukup untuk menilai status akar. */
export type CalonAkar = { username: string | null; role: string };

/**
 * Apakah akun ini SUPER ADMIN UTAMA.
 *
 * Perannya WAJIB `super_admin`. Mencantumkan username seorang mandor di env
 * tidak memberinya apa-apa — env menunjuk SIAPA di antara para super admin yang
 * jadi akar, bukan mengangkat siapa pun jadi super admin. Tanpa syarat ini,
 * satu salah ketik di dashboard Railway bisa jadi eskalasi wewenang diam-diam.
 */
export function adalahAkar(user: CalonAkar, daftar: string[]): boolean {
  if (user.role !== "super_admin") return false;
  const u = user.username?.trim().toLowerCase();
  if (!u) return false;
  return daftar.includes(u);
}
