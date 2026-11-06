/*
 * "LOKASI INI KIRIM KE GRUP WA MANA" HANYA DIJAWAB SATU PINTU (DECISIONS 747).
 *
 * Laporan user 2026-11-06, dengan tangkapan layar Status Laporan Harian: delapan
 * lokasi Sulawesi Utara bertanda "Tanpa grup", padahal grup kabupatennya sudah
 * dipasang –
 *
 *   *"ada beberapa lokasi ini menggunakan group kabupaten, kenapa ini
 *   dinyatakan tanpa group. aku sudah pernah memintamu audit semua jalur group
 *   whatsapp terutama soal group kabupaten ini"*
 *
 * Ini kebocoran KEEMPAT dari kelas yang sama. DECISIONS 596 meramalkannya
 * ("tiap salinan jadi satu tempat yang bisa ketinggalan"), 609 menambal layar
 * lokasi, 626 menambal laporan mingguan. Pagar 609 hanya menjaga
 * `app/(app)/lokasi/`, jadi papan status di `lib/daily-report/` – yang membaca
 * `package.waGroupId` mentah – lolos tanpa suara.
 *
 * Pagar ini berlaku untuk SELURUH `src/`. Berkas yang menyebut `waGroupId`
 * wajib ada di daftar izin di bawah beserta alasannya. Berkas baru yang perlu
 * tahu tujuan grup memakai `tujuanGrupLokasi` / `grupUntukLokasi` (lib/waha),
 * bukan kolomnya. Komentar tidak dihitung.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = new URL("../../src/", import.meta.url).pathname;

/** Berkas yang BOLEH menyentuh kolom grup, dan kenapa. */
const IZIN: Record<string, string> = {
  // Satu pintu itu sendiri.
  "lib/waha/grup-tujuan.ts": "resolver murni: grup kabupaten dulu, lalu grup paket",
  "lib/waha/grup.ts": "resolver DB: lokasi→grup dan grup→lokasi",
  // Tempat kolomnya DISUNTING.
  "lib/waha/actions.ts": "aksi simpan grup paket + uji penerimaan pesan",
  "lib/waha/kabupaten-actions.ts": "aksi simpan grup kabupaten",
  "app/(app)/paket/[id]/wa-group-form.tsx": "nama isian form grup paket",
  "app/(app)/paket/[id]/wa-kabupaten-form.tsx": "nama isian form grup kabupaten",
  "app/(app)/paket/[id]/page.tsx": "kartu Komunikasi paket – tempat kedua grup diatur",
  "lib/package/queries.ts": "data form grup paket + daftar paket",
  // Jalur MASUK: chatId → paket/lokasi. Kabupaten dicari lebih dulu.
  "lib/waha/ingest.ts": "arsip pesan masuk: chatId → paket",
  "lib/waha/tanya.ts": "Tanya MARLIN: chatId → lingkup lokasi",
  // Penjadwal yang sudah mendahulukan grup kabupaten dan diuji tersendiri.
  "lib/mingguan/kirim.ts": "laporan mingguan per grup – uji mingguan-grup-kabupaten",
  "lib/harian/belum-lapor.ts": "pengingat belum lapor per grup – uji wa-pengingat-per-grup",
};

function berkasKode(dir: string): string[] {
  const out: string[] = [];
  for (const nama of readdirSync(dir)) {
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) {
      if (nama === "generated") continue;
      out.push(...berkasKode(p));
    } else if (/\.tsx?$/.test(nama)) out.push(p);
  }
  return out;
}

/** Buang komentar: yang dijaga kode, bukan penjelasannya. */
function tanpaKomentar(teks: string): string {
  return teks.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

const menyentuh = (p: string) => /waGroupId/.test(tanpaKomentar(readFileSync(p, "utf8")));

describe("tujuan grup WA hanya dijawab satu pintu", () => {
  const semua = berkasKode(SRC);

  it("tidak ada berkas di luar daftar izin yang membaca waGroupId sendiri", () => {
    const liar = semua
      .filter(menyentuh)
      .map((p) => relative(SRC, p))
      .filter((r) => !(r in IZIN));
    expect(
      liar,
      "berkas ini menjawab sendiri 'lokasi ini punya grup WA?' – pakai tujuanGrupLokasi() " +
        "atau grupUntukLokasi(). Kalau tidak, lokasi ber-grup KABUPATEN terbaca 'tanpa grup'.",
    ).toEqual([]);
  });

  it("daftar izin tidak basi – tiap berkasnya masih ada dan memang menyentuh kolomnya", () => {
    // Izin yang tidak lagi dipakai harus dicabut, supaya berkas itu kembali
    // dijaga kalau suatu hari ada yang menulis ulang isinya.
    const basi = Object.keys(IZIN).filter((r) => {
      const p = join(SRC, r);
      try {
        return !menyentuh(p);
      } catch {
        return true;
      }
    });
    expect(basi).toEqual([]);
  });

  it("dan pagarnya memang memeriksa sesuatu", () => {
    expect(semua.length).toBeGreaterThan(500);
  });
});
