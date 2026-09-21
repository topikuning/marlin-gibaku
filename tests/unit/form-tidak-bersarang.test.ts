/*
 * `<form>` DI DALAM `<form>` – HTML MELARANGNYA, DAN REACT MEMATIKAN HALAMANNYA.
 *
 * **Laporan user 2026-09-21**: *"menu lampiran, klik minta usul ai tidak muncul
 * apapun, diklik simpan sebagai dokumen juga tidak muncul apa pun."*
 *
 * Direproduksi di browser, dan React sendiri yang menyebutkan sebabnya:
 *
 *     <form> cannot contain a nested <form>.
 *     This will cause a hydration error.
 *
 * Halaman Lampiran membungkus SELURUH daftar dengan borang "pembersih massal",
 * sementara tiap baris membawa borang aksinya sendiri (usul AI, tetapkan,
 * catat surat). Hidrasi gagal di subtree itu, jadi `action` borang-borang
 * dalamnya tidak pernah terpasang: tombolnya tetap tampil, tetap bisa ditekan,
 * dan tidak terjadi apa pun. Tidak ada galat di layar, tidak ada jejak – jenis
 * kerusakan yang paling lama hidup.
 *
 * Yang dijaga di sini BUKAN satu layar itu, melainkan polanya: elemen `<form>`
 * tidak boleh punya leluhur `<form>` di berkas mana pun. Pemeriksaannya statis
 * dan kasar – ia hanya melihat berkas yang merender `<form>` DAN menerima
 * `children`/merender komponen lain di antara borangnya – jadi ia menangkap
 * bentuk yang benar-benar berbahaya tanpa mengarang aturan baru.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const AKAR = join(import.meta.dirname, "..", "..");

function berkasTsx(): string[] {
  return execFileSync("git", ["ls-files", "src/**/*.tsx"], { cwd: AKAR, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

/**
 * Buang komentar dan string sebelum menghitung.
 *
 * Tanpa ini penjaganya berbohong: percobaan pertama menuduh ENAM berkas yang
 * ternyata hanya MENYEBUT `<form>` di komentar dokumentasinya. Penjaga yang
 * menuduh berkas bersih adalah penjaga yang akan dimatikan orang.
 */
function tanpaKomentar(isi: string): string {
  return isi
    .replace(/\/\*[\s\S]*?\*\//g, " ") // blok /* … */ (termasuk {/* … */} JSX)
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ") // baris // …, tanpa menyentuh "https://"
    .replace(/`[^`]*`/g, "``")
    .replace(/"[^"\n]*"/g, '""')
    .replace(/'[^'\n]*'/g, "''");
}

/**
 * Kedalaman `<form>` tertinggi dalam satu berkas, dihitung dari tag pembuka dan
 * penutup. `<form … />` (menutup sendiri) mustahil untuk form nyata, jadi tidak
 * diperhitungkan.
 */
function kedalamanFormMaks(sumber: string): number {
  const isi = tanpaKomentar(sumber);
  const tag = /<\/?form(\s|>)/g;
  let dalam = 0;
  let maks = 0;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(isi)) !== null) {
    if (isi.slice(m.index, m.index + 2) === "</") dalam -= 1;
    else {
      dalam += 1;
      maks = Math.max(maks, dalam);
    }
  }
  return maks;
}

/**
 * Berkas yang merender `<form>` DAN menempatkan `{children}` di dalamnya.
 *
 * Ini SAH dengan sendirinya – `tombol-kirim.tsx` memang begitu, dan benar.
 * Yang berbahaya hanya kalau PEMANGGILNYA menaruh komponen yang merender borang
 * di dalamnya, dan itu tidak bisa dilihat dari berkas si pembungkus. Karena itu
 * pemeriksaannya dilanjutkan ke tempat pemakaiannya, bukan berhenti di sini –
 * penjaga yang menuduh berkas yang benar akan dimatikan orang.
 */
function membungkusChildrenDalamForm(sumber: string): boolean {
  const isi = tanpaKomentar(sumber);
  const mulai = isi.indexOf("<form");
  if (mulai === -1) return false;
  const tutup = isi.lastIndexOf("</form>");
  if (tutup === -1 || tutup < mulai) return false;
  return /\{\s*children\s*\}/.test(isi.slice(mulai, tutup));
}

/**
 * Potong berkas jadi { namaKomponen → badannya }.
 *
 * Per KOMPONEN, bukan per berkas. Percobaan sebelumnya menilai per berkas dan
 * menuduh `TombolSaring` punya borang hanya karena ia bertetangga dengan
 * `FormSaring` di satu berkas – padahal ia cuma sebuah tombol. Sekali lagi:
 * penjaga yang menuduh yang benar akan dimatikan orang.
 */
function komponenDanBadannya(sumber: string): Map<string, string> {
  const isi = tanpaKomentar(sumber);
  const tanda = [...isi.matchAll(/export\s+function\s+([A-Z]\w*)/g)];
  const hasil = new Map<string, string>();
  for (const [i, m] of tanda.entries()) {
    const akhir = i + 1 < tanda.length ? tanda[i + 1].index! : isi.length;
    hasil.set(m[1], isi.slice(m.index!, akhir));
  }
  return hasil;
}

/** Isi JSX di antara `<Nama …>` dan `</Nama>`, atau null bila tidak dipakai begitu. */
function isiElemen(isi: string, nama: string): string | null {
  const buka = isi.indexOf(`<${nama}`);
  if (buka === -1) return null;
  const tutup = isi.indexOf(`</${nama}>`, buka);
  if (tutup === -1) return null;
  const awalIsi = isi.indexOf(">", buka);
  return awalIsi === -1 || awalIsi > tutup ? null : isi.slice(awalIsi + 1, tutup);
}

describe("tidak ada <form> di dalam <form>", () => {
  const berkas = berkasTsx();

  it("tidak ada satu berkas pun yang menyarangkan borangnya sendiri", () => {
    const pelanggar = berkas.filter((f) => kedalamanFormMaks(readFileSync(join(AKAR, f), "utf8")) > 1);
    expect(pelanggar).toEqual([]);
  });

  it("tidak ada pemanggil yang menaruh komponen ber-borang di dalam pembungkus ber-borang", () => {
    // Kotak centang yang perlu ikut terkirim TIDAK harus berada di dalam
    // borangnya: atribut `form="id"` mengikatkannya dari mana pun di halaman.
    // Itu cara HTML menyatakan hubungan ini tanpa menyarangkan apa pun.
    const sumber = new Map(berkas.map((f) => [f, readFileSync(join(AKAR, f), "utf8")]));

    /** Komponen pembungkus: merender `<form>` yang memuat `{children}`. */
    const pembungkus = new Set<string>();
    /** Komponen yang merender borang – kandidat isi yang berbahaya. */
    const berborang = new Set<string>();

    for (const [, isiMentah] of sumber) {
      for (const [nama, badan] of komponenDanBadannya(isiMentah)) {
        if (/<form(\s|>)/.test(badan)) berborang.add(nama);
        if (membungkusChildrenDalamForm(badan)) pembungkus.add(nama);
      }
    }

    const pelanggar: string[] = [];
    for (const [f, isiMentah] of sumber) {
      const isi = tanpaKomentar(isiMentah);
      for (const w of pembungkus) {
        const dalam = isiElemen(isi, w);
        if (!dalam) continue;
        for (const anak of [...dalam.matchAll(/<([A-Z]\w*)/g)].map((m) => m[1])) {
          if (berborang.has(anak)) pelanggar.push(`${f}: <${w}> memuat <${anak}> yang punya <form>`);
        }
      }
    }
    expect([...new Set(pelanggar)]).toEqual([]);
  });
});
