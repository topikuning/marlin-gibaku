// SEMUA WILAYAH PEKERJAAN HARUS BISA DITANYAKAN KE AI (DECISIONS 459).
//
// Permintaan user 2026-08-28: *"pastikan semua hal yang ada di marlin bisa
// ditanyakan secara jelas di ai (kecuali keuangan), artinya kamu harus
// memastikan semua hal terkait kendala, progress, semuanya terkait pekerjaan
// bisa dihandle dan ditanyakan di AI."*
//
// "Sudah dipastikan" tanpa daftar adalah janji, bukan jaminan — dan sejarahnya
// jelas: temuan & verifikasi lahir di DECISIONS 426 tanpa pernah sampai ke AI,
// rencana kerja baru tersambung di DECISIONS 458 setelah user mengeluh dijawab
// "Saya tidak punya angka bersumber". Tiap kali, kegagalannya SUNYI.
//
// Uji ini menegakkan dua arah:
//   1. tiap wilayah yang didaftar benar-benar punya jalur jawab;
//   2. tiap niat & adapter yang ADA di sistem benar-benar terdaftar.
//
// Arah kedua yang menangkap wilayah baru: menambah adapter atau niat tanpa
// mencantumkannya di peta cakupan akan MEMERAHKAN berkas ini, dan penulisnya
// dipaksa memutuskan — dijawab AI, atau ditulis alasannya kenapa tidak.
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CAKUPAN_AI,
  RUTE_BUKAN_WILAYAH,
  adapterBelumTerdaftar,
  niatBelumTerdaftar,
  ruteTercakup,
  rutePunyaRumah,
} from "@/lib/ai-hub/cakupan";
import { KAPABILITAS_ADAPTER, LABEL_WILAYAH } from "@/lib/ai-hub/adapters-pagar";
import { NIAT } from "@/lib/waha/tanya-niat";

describe("peta cakupan menutup seluruh wilayah", () => {
  it("tidak ada wilayah tanpa jalur jawab", () => {
    for (const w of CAKUPAN_AI) {
      expect(w.jalur.length, `"${w.nama}" tidak punya jalur jawab sama sekali`).toBeGreaterThan(0);
    }
  });

  it("REGRESI: tidak ada NIAT yang lahir tanpa masuk peta cakupan", () => {
    /*
     * Kalau ini merah: sebuah niat WhatsApp ditambahkan tanpa dicantumkan di
     * `CAKUPAN_AI`. Daftarkan wilayahnya di sana — atau, kalau memang niat
     * teknis yang bukan wilayah data, masukkan ke `NIAT_BUKAN_DATA`.
     */
    expect(niatBelumTerdaftar()).toEqual([]);
  });

  it("REGRESI: tidak ada ADAPTER yang lahir tanpa masuk peta cakupan", () => {
    // Kalau ini merah: wilayah data baru sudah punya adapter tapi belum diakui
    // di peta cakupan – persis cara temuan & verifikasi dulu luput.
    expect(adapterBelumTerdaftar()).toEqual([]);
  });

  it("tiap wilayah menunjuk niat dan adapter yang BENAR-BENAR ada", () => {
    const niatSah = new Set<string>(NIAT);
    const adapterSah = new Set(Object.keys(LABEL_WILAYAH));
    for (const w of CAKUPAN_AI) {
      for (const j of w.jalur) {
        if (j.jenis === "niat") {
          for (const n of j.niat) expect(niatSah.has(n), `niat "${n}" tidak ada`).toBe(true);
        }
        if (j.jenis === "adapter") {
          expect(adapterSah.has(j.wilayah), `adapter "${j.wilayah}" tidak ada`).toBe(true);
        }
      }
    }
  });
});

describe("halaman baru tidak bisa lolos diam-diam", () => {
  /**
   * Rute NYATA di `src/app/(app)/` — dibaca dari disk, bukan disalin.
   *
   * Inilah jawaban atas keberatan review 2026-08-28: uji versi pertama hanya
   * membandingkan daftar manual dengan niat/adapter, jadi halaman baru yang
   * lahir tanpa jalur AI tetap tidak terdeteksi. Yang membuat peta cakupan
   * berarti bukan isinya, melainkan bahwa ia DIPAKSA menjawab seluruh rute.
   */
  function ruteNyata(): string[] {
    /*
     * SETIAP direktori ber-`page.tsx`, dengan jalur PENUH — bukan hanya
     * direktori tingkat satu (review kedua 2026-08-28).
     *
     * Versi pertama membaca `readdirSync` tingkat atas saja, jadi halaman baru
     * di bawah `lokasi/[slug]/…` atau `paket/[id]/…` otomatis terhitung
     * tercakup oleh entri "lokasi"/"paket". Justru dua tempat itulah yang
     * paling sering ditambahi halaman, dan domain datanya berlainan: `rapl`
     * bukan `progress`, `keuangan` bukan `rab`. Jaminan yang ditulis di
     * komentar peta karenanya belum berlaku persis di tempat ia paling
     * dibutuhkan.
     */
    const akar = join(process.cwd(), "src", "app", "(app)");
    const out: string[] = [];
    const telusur = (dir: string, prefix: string) => {
      for (const e of readdirSync(dir)) {
        const penuh = join(dir, e);
        if (!statSync(penuh).isDirectory()) continue;
        const rute = prefix ? `${prefix}/${e}` : e;
        if (existsSync(join(penuh, "page.tsx"))) out.push(rute);
        telusur(penuh, rute);
      }
    };
    if (existsSync(join(akar, "page.tsx"))) out.push(".");
    telusur(akar, "");
    return out.sort();
  }

  it("REGRESI: tiap HALAMAN (app) punya rumah – di peta cakupan atau di pengecualian", () => {
    const pola = ruteTercakup();
    const yatim = ruteNyata().filter((r) => !rutePunyaRumah(r, pola));
    expect(
      yatim,
      "halaman ini belum diputuskan: masukkan ke CAKUPAN_AI (bila datanya bisa ditanyakan) " +
        "atau ke RUTE_BUKAN_WILAYAH berikut alasannya",
    ).toEqual([]);
  });

  it("bukan cuma tingkat satu – halaman bersarang ikut diperiksa", () => {
    /*
     * Penjaga untuk penjaganya. Kalau `ruteNyata()` suatu saat kembali hanya
     * membaca tingkat atas, uji yatim di atas akan tetap hijau — dan lubang
     * yang baru ditutup ini terbuka lagi tanpa suara.
     */
    const nyata = ruteNyata();
    expect(nyata).toContain("lokasi/[slug]/progress");
    expect(nyata).toContain("paket/[id]/kontrak");
    expect(nyata.some((r) => r.split("/").length >= 3)).toBe(true);
  });

  it("tiap pola yang didaftar memang mengenai halaman yang ada", () => {
    // Arah sebaliknya: rute yang dihapus/di-rename tidak boleh meninggalkan
    // baris yang menyesatkan di peta.
    const nyata = ruteNyata();
    for (const p of ruteTercakup()) {
      expect(
        nyata.some((r) => rutePunyaRumah(r, [p])),
        `pola "${p}" tercantum di peta cakupan tapi tidak mengenai halaman mana pun di (app)`,
      ).toBe(true);
    }
  });

  it("tiap pengecualian membawa ALASAN, bukan sekadar nama", () => {
    for (const [rute, alasan] of Object.entries(RUTE_BUKAN_WILAYAH)) {
      expect(alasan.length, `pengecualian "${rute}" tanpa alasan tertulis`).toBeGreaterThan(20);
    }
  });
});

describe("lapisan pengendalian ikut terjawab", () => {
  /*
   * Empat wilayah DECISIONS 426 yang sebelumnya tidak pernah sampai ke AI.
   * Disebut satu per satu, bukan dihitung: kalau salah satunya dilepas, uji
   * yang menghitung "ada 14 wilayah" akan tetap hijau selama ada penggantinya.
   */
  it.each(["kesiapan", "ews", "verifikasi", "inspeksi", "temuan", "surat"])(
    "wilayah %s punya adapter berpagar",
    (w) => {
      expect(Object.keys(LABEL_WILAYAH)).toContain(w);
      expect(KAPABILITAS_ADAPTER[w as keyof typeof KAPABILITAS_ADAPTER]).toBeTruthy();
    },
  );

  it("pagarnya SAMA dengan halaman masing-masing", () => {
    /*
     * Pintu AI tidak boleh jadi jalan memutar. Angka-angka ini disalin dari
     * `requireCapabilityPage` tiap halaman; kalau halamannya diperketat dan
     * baris ini tidak ikut, AI akan tetap menjawab yang layarnya sudah tutup.
     */
    expect(KAPABILITAS_ADAPTER.kesiapan).toBe("package.view");
    expect(KAPABILITAS_ADAPTER.ews).toBe("portfolio.view");
    expect(KAPABILITAS_ADAPTER.verifikasi).toBe("report.verify_external");
    expect(KAPABILITAS_ADAPTER.inspeksi).toBe("inspection.manage");
    expect(KAPABILITAS_ADAPTER.surat).toBe("letter.view");
    expect(KAPABILITAS_ADAPTER.temuan).toBe("finding.view");
  });
});

describe("keuangan", () => {
  it("dikecualikan dengan ALASAN TERTULIS, bukan dihilangkan diam-diam", () => {
    const uang = CAKUPAN_AI.find((w) => w.nama.toLowerCase().includes("keuangan"));
    expect(uang, "keuangan wajib tetap tercantum – yang dikecualikan harus terlihat").toBeTruthy();
    expect(uang?.lewatSengaja, "pengecualian tanpa alasan tertulis tidak bisa diperiksa").toBeTruthy();
  });

  it("pagarnya tetap finance.view, tidak dilonggarkan demi AI", () => {
    expect(KAPABILITAS_ADAPTER.keuangan).toBe("finance.view");
  });
});
