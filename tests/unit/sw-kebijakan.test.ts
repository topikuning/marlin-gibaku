import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * KEBIJAKAN SERVICE WORKER — apa yang boleh dijawab dari simpanan (DECISIONS 392).
 *
 * Service worker satu-satunya bagian MARLIN yang bisa menjawab permintaan tanpa
 * bertanya ke server. Kekeliruan di sini tidak muncul sebagai galat: ia muncul
 * sebagai angka kemarin yang terlihat seperti angka hari ini, atau halaman
 * milik orang sebelumnya di HP yang dipakai bergantian. Karena itu daftar
 * putihnya diuji, bukan dipercaya.
 *
 * Berkasnya skrip klasik (importScripts, demi WebView Android lama) sehingga
 * tidak bisa di-`import`. Uji ini membacanya lalu menjalankannya di `self`
 * palsu – kode yang diuji persis kode yang dikirim ke peramban.
 */

type Rencana = "lewati" | "aset-statis" | "navigasi-luring" | "navigasi-biasa";

interface Kebijakan {
  NAMA: { kerangka: string; aset: string; halaman: string };
  HALAMAN_OFFLINE: string;
  RUTE_LURING: string[];
  rencana(p: {
    metode: string;
    url: string;
    asal: string;
    mode?: string;
    rsc?: boolean;
  }): Rencana;
  kunciHalaman(url: string): string;
  cacheUsang(nama: string): boolean;
}

const ASAL = "https://marlin.example";

function muatKebijakan(): Kebijakan {
  const sumber = readFileSync(join(process.cwd(), "public", "sw-kebijakan.js"), "utf8");
  const lingkup: { KEBIJAKAN_SW?: Kebijakan } = {};
  new Function("self", sumber)(lingkup);
  if (!lingkup.KEBIJAKAN_SW) throw new Error("sw-kebijakan.js tidak menempelkan KEBIJAKAN_SW");
  return lingkup.KEBIJAKAN_SW;
}

const K = muatKebijakan();

/** Permintaan navigasi dokumen (mengetik alamat, muat ulang, tautan penuh). */
function navigasi(jalur: string) {
  return { metode: "GET", url: `${ASAL}${jalur}`, asal: ASAL, mode: "navigate" };
}

describe("kebijakan service worker – yang TIDAK boleh disentuh", () => {
  it("mutasi (non-GET) dilewatkan apa adanya", () => {
    // Server action, unggah foto, login. Antrean foto (DECISIONS 257) memutuskan
    // "coba lagi selamanya" vs "berhenti" dari jawaban server; menyisipkan diri
    // di antaranya berarti mengarang jawaban itu.
    for (const metode of ["POST", "PUT", "DELETE", "PATCH"]) {
      expect(K.rencana({ ...navigasi("/foto-cepat"), metode })).toBe("lewati");
    }
  });

  it("permintaan lintas asal dilewatkan (R2, tile peta)", () => {
    expect(
      K.rencana({ metode: "GET", url: "https://r2.example/foto/1.jpg", asal: ASAL, mode: "no-cors" }),
    ).toBe("lewati");
  });

  it("/api/** tidak pernah disimpan", () => {
    for (const jalur of [
      "/api/versi",
      "/api/health",
      "/api/foto/abc",
      "/api/foto-asli/1",
      "/api/laporan/harian/kranji/2026-08-01/pdf",
    ]) {
      expect(K.rencana({ ...navigasi(jalur), mode: "cors" })).toBe("lewati");
    }
  });

  it("muatan RSC (navigasi sisi-klien & prefetch) dilewatkan", () => {
    // HTML tersimpan bukan muatan RSC. Menjawabnya dengan HTML membuat router
    // Next menelan sampah, bukan menampilkan halaman lama.
    expect(K.rencana({ ...navigasi("/foto-cepat"), rsc: true })).toBe("lewati");
  });

  it("fetch biasa ke rute halaman tidak dianggap navigasi", () => {
    expect(K.rencana({ ...navigasi("/foto-cepat"), mode: "cors" })).toBe("lewati");
  });

  it("URL tak terbaca dilewatkan, bukan melempar", () => {
    expect(K.rencana({ metode: "GET", url: "bukan url", asal: ASAL, mode: "navigate" })).toBe(
      "lewati",
    );
  });
});

describe("kebijakan service worker – yang boleh disimpan", () => {
  it("aset build ber-hash & ikon: simpanan dulu", () => {
    expect(K.rencana({ ...navigasi("/_next/static/chunks/a1b2.js"), mode: "no-cors" })).toBe(
      "aset-statis",
    );
    expect(K.rencana({ ...navigasi("/brand/marlin-favicon-192.png"), mode: "no-cors" })).toBe(
      "aset-statis",
    );
  });

  it("hanya /foto-cepat yang HTML-nya disimpan", () => {
    expect(K.rencana(navigasi("/foto-cepat"))).toBe("navigasi-luring");
    for (const jalur of ["/", "/progress", "/hari-ini", "/keuangan", "/laporan"]) {
      expect(K.rencana(navigasi(jalur))).toBe("navigasi-biasa");
    }
  });

  it("halaman auth tidak pernah disimpan", () => {
    for (const jalur of ["/masuk", "/ganti-password"]) {
      expect(K.rencana(navigasi(jalur))).toBe("navigasi-biasa");
      expect(K.RUTE_LURING).not.toContain(jalur);
    }
  });

  it("navigasi ber-query tidak disimpan", () => {
    // Query = halaman yang berbeda isinya (saringan, tanggal, tab). Satu kunci
    // untuk semuanya berarti menyajikan halaman yang salah dengan yakin.
    expect(K.rencana(navigasi("/foto-cepat?lokasi=kranji"))).toBe("navigasi-biasa");
  });

  it("daftar putih luring tetap satu rute", () => {
    // Bukan uji kosmetik: menambah rute ke daftar ini berarti menambah HTML
    // ber-sesi yang menetap di HP lapangan. Ubah daftarnya = ubah uji ini =
    // keputusan sadar, dan alasannya ditulis di DECISIONS.
    expect(K.RUTE_LURING).toEqual(["/foto-cepat"]);
  });
});

describe("kebijakan service worker – kunci & pembersihan", () => {
  it("kunci simpanan halaman = jalur, tanpa asal & tanda pagar", () => {
    expect(K.kunciHalaman(`${ASAL}/foto-cepat#antrean`)).toBe("/foto-cepat");
  });

  it("cache versi lama dibuang, cache pihak lain tidak disentuh", () => {
    expect(K.cacheUsang("marlin-halaman-0")).toBe(true);
    expect(K.cacheUsang(K.NAMA.halaman)).toBe(false);
    expect(K.cacheUsang(K.NAMA.aset)).toBe(false);
    expect(K.cacheUsang(K.NAMA.kerangka)).toBe(false);
    expect(K.cacheUsang("workbox-precache")).toBe(false);
  });
});
