/*
 * PENANDA SIBUK — PENJAGA SEURUH APLIKASI (DECISIONS 401).
 *
 * Permintaan user 2026-08-21, sesudah keluhan yang sama untuk KETIGA kalinya:
 * *"ya semua yang diklik berpotensi butuh waktu (tidak instant) gunakan penanda
 * sibuk! common sense kan!"*
 *
 * Benar, dan karena itu penjaganya harus di sini — bukan di ingatan orang yang
 * menulis layar berikutnya. Dua kali sebelumnya (DECISIONS 360, 400) cacatnya
 * ditambal PER LAYAR, dan dua kali pula ia muncul lagi di layar yang lain.
 *
 * Yang dijaga tiga hal yang masing-masing pernah benar-benar terjadi:
 *
 *  1. **Dispatch `useActionState` dipanggil dari klik.** `isPending`-nya bukan
 *     "aksi sedang berjalan" melainkan "ada Transition tertunda", dan React
 *     hanya memasang Transition itu untuk `<form action={…}>`/`formAction`.
 *     Dipanggil dari `onClick`, aksinya jalan tapi `pending` TETAP `false`
 *     selamanya — persis keluhan "Upload ke Drive tidak ada penandanya".
 *     Obatnya `useAksiKlik`.
 *
 *  2. **Tautan yang MEMBANGKITKAN berkas tanpa penanda.** Jangkar biasa
 *     menyerahkan segalanya ke peramban; halaman tempat orang menekan tidak
 *     tahu apa-apa selama server bekerja (diukur 4,1 detik untuk PDF mingguan).
 *
 *  3. **`<Button type="submit">` tanpa `loading`/`disabled`.** Formulir yang
 *     memanggil server tanpa penanda mengundang kiriman ganda.
 *
 * Penjaga ini memakai pemindaian teks, bukan AST. Itu memang kasar — tapi
 * kekasarannya condong ke arah yang benar: ia bisa MELEWATKAN bentuk penulisan
 * yang aneh, tidak menuduh yang benar. Bentuk yang lolos ditulis di daftar
 * pengecualian dengan alasannya, supaya "tidak terjaga" tidak menyamar sebagai
 * "aman".
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const LEWATI = new Set(["node_modules", "generated", ".next"]);

function berkasTsx(dir: string, keluar: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (LEWATI.has(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) berkasTsx(p, keluar);
    else if (p.endsWith(".tsx")) keluar.push(p);
  }
  return keluar;
}

const BERKAS = berkasTsx("src");
const rel = (f: string) => f.replace(`${process.cwd()}/`, "");

/**
 * Kosongkan komentar supaya contoh di dalam penjelasan tidak dituduh melanggar.
 *
 * Barisnya DIPERTAHANKAN (hanya isinya yang dikosongkan): versi pertama penjaga
 * ini membuang baris komentar sekalian, jadi nomor baris yang dilaporkannya
 * meleset belasan baris dan menunjuk kode yang tidak bersalah. Laporan yang
 * salah alamat lebih buruk daripada tidak ada laporan — ia membuang waktu orang
 * lalu membuat penjaganya tidak dipercaya.
 */
function tanpaKomentar(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (_m, p1: string) => p1);
}

describe("1. dispatch server action dari klik wajib lewat useAksiKlik", () => {
  it("tidak ada `useActionState` yang dispatch-nya dipanggil dari onClick/onSelect", () => {
    const pelanggar: string[] = [];
    for (const f of BERKAS) {
      const s = tanpaKomentar(readFileSync(f, "utf8"));
      if (!s.includes("useActionState")) continue;
      const nama = [
        ...s.matchAll(
          /const\s*\[\s*[^,\]]+,\s*([A-Za-z0-9_]+)\s*(?:,\s*[A-Za-z0-9_]+\s*)?\]\s*=\s*useActionState/g,
        ),
      ].map((m) => m[1]);
      for (const n of nama) {
        // `onClick={() => kirim(fd)}` dan `onSelect: () => kirim(fd)`.
        const re = new RegExp(`(onClick|onSelect)\\s*[=:]\\s*\\{?\\s*\\(\\s*\\)\\s*=>[^\\n]*\\b${n}\\s*\\(`, "g");
        for (const m of s.matchAll(re)) {
          pelanggar.push(`${rel(f)}:${s.slice(0, m.index).split("\n").length} → ${n}()`);
        }
      }
    }
    expect(pelanggar).toEqual([]);
  });
});

describe("2. tautan yang membangkitkan berkas wajib punya penanda", () => {
  /**
   * Jangkar telanjang ke alamat yang MEMBANGUN berkas di server.
   *
   * Yang TIDAK dihitung melanggar:
   * - `target="_blank"` — halamannya dibuka di tab baru, dan tab itu sendiri
   *   yang jadi penandanya (DECISIONS 400).
   * - berkas TERSIMPAN (`/api/documents/`, `/api/foto`, lampiran) — alihan ke
   *   R2, bukan berkas yang dibangun; penanda unduhan peramban sudah cukup.
   */
  const MEMBANGUN = /(pdf|excel|xlsx|export|rincian|ringkas)/i;

  it("tidak ada `<a href>` telanjang ke alamat pembangkit berkas", () => {
    const pelanggar: string[] = [];
    for (const f of BERKAS) {
      if (f.includes("/app/cetak/")) continue; // halaman cetak: tanpa shell, tanpa JS
      const baris = tanpaKomentar(readFileSync(f, "utf8")).split("\n");
      baris.forEach((l, i) => {
        if (!/<a\b/.test(l) && !/^\s*href=/.test(l)) return;
        if (!/href=(\{`|")(\/api\/|\/lokasi\/)/.test(l)) return;
        if (!MEMBANGUN.test(l)) return;
        // Jendela kecil ke depan: atribut sebuah `<a>` sering dipecah beberapa baris.
        const jendela = baris.slice(Math.max(0, i - 4), i + 6).join(" ");
        if (/target="_blank"/.test(jendela)) return;
        if (/TautanUnduh|ButtonLink/.test(jendela)) return;
        pelanggar.push(`${rel(f)}:${i + 1} → ${l.trim().slice(0, 70)}`);
      });
    }
    expect(pelanggar).toEqual([]);
  });

  it("setiap `ButtonLink unduhan` menyatakan labelSibuk", () => {
    const pelanggar: string[] = [];
    for (const f of BERKAS) {
      const s = tanpaKomentar(readFileSync(f, "utf8"));
      for (const m of s.matchAll(/<ButtonLink\b[\s\S]*?>/g)) {
        if (!/\bunduhan\b/.test(m[0])) continue;
        if (/labelSibuk/.test(m[0])) continue;
        pelanggar.push(`${rel(f)}:${s.slice(0, m.index).split("\n").length}`);
      }
    }
    expect(pelanggar).toEqual([]);
  });
});

describe("3. tombol submit wajib menyatakan keadaan sibuknya", () => {
  /**
   * Dikecualikan DENGAN ALASAN, bukan diam-diam.
   *
   * Formulir yang hanya menyaring/menutup dialog tidak memanggil server, jadi
   * penanda sibuk di situ hanya berkedip tanpa arti. Yang dikecualikan tetap
   * ditulis di sini supaya pembaca berikutnya bisa membantahnya.
   */
  const KECUALI = new Map<string, string>([
    [
      "src/components/ui/confirm-dialog.tsx",
      "tombolnya menutup dialog lalu menyerahkan ke pemanggil; pemanggilnya yang memegang keadaan sibuk",
    ],
  ]);

  it("tidak ada `<Button type=\"submit\">` tanpa loading/disabled", () => {
    const pelanggar: string[] = [];
    for (const f of BERKAS) {
      if (KECUALI.has(rel(f))) continue;
      const s = tanpaKomentar(readFileSync(f, "utf8"));
      for (const m of s.matchAll(/<Button\b[^>]*?type="submit"[^>]*?>/gs)) {
        if (/loading=|disabled=/.test(m[0])) continue;
        pelanggar.push(`${rel(f)}:${s.slice(0, m.index).split("\n").length}`);
      }
    }
    expect(pelanggar).toEqual([]);
  });
});

describe("penjaganya sendiri benar-benar memindai sesuatu", () => {
  it("menemukan berkas .tsx yang cukup banyak", () => {
    // Tanpa ini, satu salah ketik pada jalur akar membuat SELURUH penjaga di
    // atas hijau tanpa memeriksa apa pun.
    expect(BERKAS.length).toBeGreaterThan(100);
  });
});
