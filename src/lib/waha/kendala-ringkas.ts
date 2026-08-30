import type { BarisKendala } from "./tanya-format";

/**
 * Kendala → SATU BARIS PER LOKASI, tanpa kembar (DECISIONS 450).
 *
 * ### Kejadiannya
 *
 * Keberatan user 2026-08-27 atas register kendala yang benar-benar terkirim:
 * *"duplikasi terjadi berkali-kali, kamu seharusnya membuang duplikat. lalu
 * memfilter jika masalah mirip dimunculkan satu, jika ada beberapa masalah
 * dalam satu lokasi pun, seharusnya kamu bukan menjadi 2 baris, tapi dalam 2
 * baris itu kendalanya ada beberapa"*.
 *
 * Yang ia lihat memang begitu: Betahwalang muncul dua kali dengan kalimat yang
 * PERSIS sama; Junganyar tiga baris untuk dua persoalan; "Pekerjaan tertahan
 * menunggu lahan / izin" berdiri sendiri di sebelah kalimat yang memuatnya
 * utuh. Daftar begitu tidak bisa dipakai menagih siapa pun – yang terbaca
 * cuma bahwa datanya berantakan.
 *
 * ### Yang digabung, dan HANYA itu
 *
 * Dua aturan, keduanya bisa diperiksa ulang oleh manusia:
 *
 *  1. **Kalimat yang sama** (setelah huruf besar/kecil, tanda baca, dan spasi
 *     diseragamkan) → satu.
 *  2. **Kalimat yang seluruhnya termuat di kalimat lain yang lebih panjang** →
 *     yang lebih panjang dipakai, karena ia yang lebih lengkap.
 *
 * Kalimat yang sekadar MIRIP – bersinggungan sebagian, atau kebetulan memakai
 * kata yang sama – TIDAK digabung. Menggabungkan atas dasar kemiripan berarti
 * menghilangkan persoalan yang berbeda dari daftar tagihan, dan itu kesalahan
 * yang jauh lebih mahal daripada satu baris kembar yang terlihat.
 *
 * ### Yang tidak boleh hilang
 *
 * Jumlah yang digabung DIKEMBALIKAN, supaya pemakainya bisa mengatakannya di
 * dokumen. Penggabungan diam-diam membuat daftar terlihat lebih pendek dari
 * kenyataannya, dan pembacanya tidak punya cara tahu.
 *
 * Murni: tanpa DB, tanpa `server-only`.
 */

/** Urutan tingkat, dari paling ringan. Sama dengan enum `IssueSeverity`. */
const PERINGKAT_TINGKAT = ["rendah", "sedang", "tinggi", "kritis"];

/** Status yang paling menuntut perhatian didahulukan. */
const PERINGKAT_STATUS = ["ditangani", "sedang_ditangani", "terbuka"];

function peringkat(daftar: string[], nilai: string): number {
  const i = daftar.indexOf(nilai);
  // Nilai yang tidak dikenal dianggap PALING RINGAN, bukan paling berat:
  // menaikkan sesuatu yang tidak dimengerti ke "kritis" akan menyalakan alarm
  // palsu di seluruh daftar.
  return i === -1 ? -1 : i;
}

/** Bentuk banding kalimat: huruf kecil, tanpa tanda baca, spasi rapat. */
export function normalKendala(teks: string): string {
  return teks
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Benarkah `pendek` termuat UTUH sebagai rangkaian kata di dalam `panjang`?
 *
 * Dua pagar, dan keduanya untuk mencegah penggabungan yang terlalu rakus:
 *
 *  - dicocokkan per KATA (dibungkus spasi), bukan per huruf – tanpa itu
 *    "izin" akan tertelan oleh kata mana pun yang memuat huruf-hurufnya;
 *  - minimal TIGA kata. Kalimat kendala satu-dua kata ("Lainnya",
 *    "Sosialisasi") terlalu umum: ia bisa muncul di tengah kalimat lain yang
 *    membicarakan persoalan yang sama sekali berbeda.
 */
function termuatUtuh(panjang: string, pendek: string): boolean {
  if (pendek.split(" ").length < 3) return false;
  return ` ${panjang} `.includes(` ${pendek} `);
}

export type KendalaLokasi = {
  lokasi: string;
  /** Tingkat TERTINGGI di lokasi ini – itu yang menentukan perhatian. */
  tingkat: string;
  status: string;
  /** Umur TERLAMA – kendala yang paling lama menganggur di lokasi itu. */
  umurHari: number;
  /** Kalimat kendala yang tersisa setelah kembar dibuang, urut seperti asalnya. */
  kendala: string[];
};

export type HasilRingkas = {
  baris: KendalaLokasi[];
  /** Berapa baris kendala yang lenyap karena digabung. 0 = tidak ada kembar. */
  digabung: number;
};

export function ringkasKendalaPerLokasi(baris: BarisKendala[]): HasilRingkas {
  const perLokasi = new Map<string, BarisKendala[]>();
  for (const b of baris) {
    const k = perLokasi.get(b.lokasi) ?? [];
    k.push(b);
    perLokasi.set(b.lokasi, k);
  }

  let digabung = 0;
  const hasil: KendalaLokasi[] = [];

  for (const [lokasi, isi] of perLokasi) {
    /*
     * Dipilih dari yang PALING PANJANG dulu supaya kalimat pendek yang
     * termuat di dalamnya bisa dikenali sebagai bagian – bukan sebaliknya.
     * Urutan tampilnya dikembalikan ke urutan asal sesudahnya, karena urutan
     * asal itu bermakna (paling berat dulu, lalu paling lama menganggur).
     */
    const berurut = isi
      .map((b, i) => ({ b, i, n: normalKendala(b.judul) }))
      .sort((x, y) => y.n.length - x.n.length || x.i - y.i);

    const disimpan: { i: number; judul: string; n: string }[] = [];
    for (const c of berurut) {
      if (!c.n) continue;
      const termuat = disimpan.some((d) => d.n === c.n || termuatUtuh(d.n, c.n));
      if (termuat) {
        digabung++;
        continue;
      }
      disimpan.push({ i: c.i, judul: c.b.judul, n: c.n });
    }

    hasil.push({
      lokasi,
      tingkat: isi.reduce(
        (t, b) =>
          peringkat(PERINGKAT_TINGKAT, b.tingkat) > peringkat(PERINGKAT_TINGKAT, t) ? b.tingkat : t,
        isi[0].tingkat,
      ),
      status: isi.reduce(
        (s, b) =>
          peringkat(PERINGKAT_STATUS, b.status) > peringkat(PERINGKAT_STATUS, s) ? b.status : s,
        isi[0].status,
      ),
      umurHari: isi.reduce((u, b) => Math.max(u, b.umurHari), 0),
      kendala: disimpan.sort((a, b) => a.i - b.i).map((d) => d.judul),
    });
  }

  return { baris: hasil, digabung };
}

/**
 * Kalimat yang mengaku bahwa daftarnya sudah dipadatkan.
 *
 * `null` bila tidak ada yang digabung – catatan yang selalu muncul akan
 * berhenti dibaca justru saat ia berarti sesuatu.
 */
export function catatanGabung(digabung: number): string | null {
  if (digabung <= 0) return null;
  return `${digabung} catatan ${PENANDA_GABUNG} agar tidak dihitung dua kali.`;
}

/**
 * Potongan kata yang menandai kalimat di atas, dan SATU-SATUNYA tempat ia
 * ditulis.
 *
 * `keteranganBerkas` membuang catatan ini dari daftar catatan karena
 * pengantar PDF sudah menyebut penggabungannya dengan kalimat yang lebih
 * lengkap. Versi pertama mencocokkannya dengan salinan teks di berkas lain —
 * dan salinan teks adalah cara paling sunyi sebuah penyaring berhenti bekerja:
 * kalimatnya diperbaiki di sini, penyaringnya tetap hijau di sana, lalu
 * pengantar PDF memuat keterangan yang sama dua kali tanpa ada yang merah.
 */
const PENANDA_GABUNG = "duplikat digabung";

/** Apakah sebuah catatan adalah kalimat penggabungan di atas. */
export function adalahCatatanGabung(catatan: string): boolean {
  return catatan.includes(PENANDA_GABUNG);
}
