import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * PENJAGA: SETIAP PEMBACA `Issue` MENYARING KENDALA YANG SUDAH DIGABUNGKAN
 * (DECISIONS 393).
 *
 * Menggabungkan kendala kembar hanya berguna kalau kembarnya benar-benar
 * berhenti muncul. Saat penggabungan dirancang, tujuh tempat membaca `Issue` —
 * dan EMPAT di antaranya tidak menyaring status sama sekali, termasuk laporan
 * periodik KKP. Menutup baris kembarnya saja tidak cukup untuk yang empat itu.
 *
 * Bahayanya bukan hari ini, melainkan pembaca KEDELAPAN yang ditambahkan enam
 * bulan lagi oleh orang yang tidak tahu kolom `mergedIntoId` ada. Ia tidak akan
 * memerahkan uji apa pun; ia hanya akan diam-diam menampilkan "Lahan belum bisa
 * clear" tiga kali lagi.
 *
 * Karena itu penjaganya STATIS: tiap tempat membaca daftar kendala wajib
 * menyebut `mergedIntoId`, ATAU menuliskan alasannya di sebelahnya dengan
 * penanda `KEMBAR-OK:`. Penandanya sengaja harus ditulis di kode, bukan di
 * daftar pengecualian di berkas ini — daftar terpisah akan basi begitu baris
 * bergeser, dan pengecualian tanpa alasan tertulis adalah pengecualian yang
 * tidak pernah ditinjau ulang.
 */

const PENANDA = "KEMBAR-OK:";

/** Jendela penelusuran sesudah titik baca — cukup untuk satu blok `where`. */
const JENDELA = 900;

/**
 * Bentuk pembacaan yang bisa mengembalikan LEBIH DARI SATU kendala.
 *
 * `findUnique`/`findUniqueOrThrow` sengaja TIDAK ikut: keduanya mengambil satu
 * baris lewat kunci yang sudah diketahui pemanggil, jadi kendala kembar tidak
 * bisa "muncul" di sana tanpa ada yang sengaja memintanya.
 */
const POLA = [
  /db\.issue\.findMany\(/g,
  /db\.issue\.findFirst\(/g,
  /db\.issue\.count\(/g,
  /db\.issue\.aggregate\(/g,
  /db\.issue\.groupBy\(/g,
  /\bissues:\s*\{/g,
];

/**
 * Sebagian kueri memakai objek `where` yang dirakit di atasnya
 * (`where: saring,` atau `where,`). Jendela ke depan tidak melihat isinya, jadi
 * penanda diikuti sampai ke deklarasinya.
 *
 * Tanpa ini, penjaga memaksa `KEMBAR-OK:` pada kode yang justru SUDAH benar –
 * dan penjaga yang menuntut pengecualian palsu akan mengajari orang menempel
 * penanda tanpa membacanya.
 */
function whereIkutVariabel(src: string, jendela: string): boolean {
  // Tiga bentuk: `where: saring,` · `where,` · `{ where }` (singkatan objek).
  const m = jendela.match(/where\s*(?::\s*(\w+))?\s*[,}]/);
  if (!m) return false;
  const nama = m[1] ?? "where";
  const deklarasi = new RegExp(`\\b(?:const|let)\\s+${nama}\\b`).exec(src);
  if (!deklarasi) return false;
  return src.slice(deklarasi.index, deklarasi.index + JENDELA).includes("mergedIntoId");
}

function berkasSumber(): string[] {
  const keluaran = execFileSync(
    "git",
    ["ls-files", "src/**/*.ts", "src/**/*.tsx"],
    { encoding: "utf8" },
  );
  return keluaran.split("\n").filter(Boolean);
}

describe("pembaca kendala menyaring yang sudah digabungkan", () => {
  it("tiap pembacaan daftar kendala menyebut mergedIntoId, atau beralasan tertulis", () => {
    const lolos: string[] = [];

    for (const berkas of berkasSumber()) {
      const src = readFileSync(berkas, "utf8");
      if (!src.includes("db.issue.") && !src.includes("issues:")) continue;

      /*
       * Semua titik baca dikumpulkan dulu supaya jendela tiap titik bisa
       * DIPOTONG di titik baca berikutnya.
       *
       * Tanpa pemotongan itu, kueri yang sama sekali tidak menyaring bisa lolos
       * hanya karena kueri LAIN 700 karakter di bawahnya kebetulan menyaring —
       * dan itu benar-benar terjadi: `naikkan.ts` lolos padahal penandanya
       * sudah dilepas, ketahuan waktu uji gigi.
       */
      const titik: { pos: number; teks: string }[] = [];
      for (const pola of POLA) {
        pola.lastIndex = 0;
        for (const m of src.matchAll(pola)) titik.push({ pos: m.index ?? 0, teks: m[0] });
      }
      titik.sort((a, b) => a.pos - b.pos);

      for (let i = 0; i < titik.length; i++) {
        const { pos, teks } = titik[i];
        const batas = Math.min(pos + JENDELA, titik[i + 1]?.pos ?? Infinity);
        const jendela = src.slice(pos, batas);
        if (jendela.includes("mergedIntoId")) continue;
        if (whereIkutVariabel(src, jendela)) continue;
        if (jendela.includes(PENANDA)) continue;
        // Cek juga SEBELUM titik baca: alasan sering ditulis di komentar tepat
        // di atas kueri, bukan di dalamnya.
        if (src.slice(Math.max(0, pos - 400), pos).includes(PENANDA)) continue;

        lolos.push(`${berkas}:${src.slice(0, pos).split("\n").length} – ${teks}`);
      }
    }

    expect(
      lolos,
      `Pembacaan kendala berikut tidak menyaring yang sudah digabungkan.\n` +
        `Tambahkan \`mergedIntoId: null\` ke where-nya, atau tulis komentar\n` +
        `\`// ${PENANDA} <alasan>\` di sebelahnya bila memang harus ikut:\n` +
        lolos.map((p) => `  ${p}`).join("\n"),
    ).toEqual([]);
  });
});
