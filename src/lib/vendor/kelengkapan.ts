/**
 * KELENGKAPAN PROFIL PERUSAHAAN — murni, tanpa DB (DECISIONS 359).
 *
 * Rancangan master data user 2026-08-18 menampilkan angka "45%" per perusahaan
 * dan "7 lengkap dari 19". Angka itu hanya berguna kalau APA yang dihitung bisa
 * disebut: persentase tanpa daftar isian yang kurang membuat orang menebak-nebak
 * mana yang harus dilengkapi.
 *
 * Karena itu fungsi ini mengembalikan `kurang` — nama-nama isian yang belum
 * terisi — dan persentasenya diturunkan DARI daftar itu, bukan sebaliknya.
 */

export type ProfilVendor = {
  npwp: string | null;
  contact: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  kopUrl: string | null;
  stempelUrl: string | null;
};

/**
 * Isian yang dihitung, beserta namanya untuk ditampilkan.
 *
 * Nama perusahaan TIDAK ikut: ia wajib ada untuk membuat barisnya, jadi
 * memasukkannya hanya menaikkan setiap persentase dengan angka yang sama tanpa
 * membedakan apa pun.
 */
const ISIAN: { kunci: keyof ProfilVendor; nama: string }[] = [
  { kunci: "npwp", nama: "NPWP" },
  { kunci: "contact", nama: "PIC" },
  { kunci: "phone", nama: "telepon" },
  { kunci: "email", nama: "email" },
  { kunci: "address", nama: "alamat" },
  { kunci: "logoUrl", nama: "logo" },
  { kunci: "stempelUrl", nama: "stempel" },
  { kunci: "kopUrl", nama: "kop surat" },
];

export type HasilKelengkapan = {
  /** 0–100, dibulatkan. 100 berarti seluruh isian terisi. */
  persen: number;
  /** Nama isian yang masih kosong, urut seperti di formulir. */
  kurang: string[];
  lengkap: boolean;
};

export function kelengkapanVendor(v: ProfilVendor): HasilKelengkapan {
  const kurang = ISIAN.filter(({ kunci }) => !terisi(v[kunci])).map(({ nama }) => nama);
  const terisiJumlah = ISIAN.length - kurang.length;
  return {
    persen: Math.round((terisiJumlah / ISIAN.length) * 100),
    kurang,
    lengkap: kurang.length === 0,
  };
}

/** Spasi saja BUKAN isi — kolom teks yang berisi " " tetap kosong. */
function terisi(v: string | null | undefined): boolean {
  return typeof v === "string" && v.trim() !== "";
}

/**
 * Kalimat singkat untuk di bawah nama perusahaan.
 *
 * Menyebut paling banyak tiga isian lalu "+N lagi": daftar penuh delapan isian
 * membuat barisnya setinggi tiga baris dan justru berhenti dibaca.
 */
export function ringkasKurang(kurang: string[], batas = 3): string | null {
  if (kurang.length === 0) return null;
  if (kurang.length <= batas) return `Belum ada: ${kurang.join(", ")}`;
  return `Belum ada: ${kurang.slice(0, batas).join(", ")} +${kurang.length - batas} lagi`;
}
