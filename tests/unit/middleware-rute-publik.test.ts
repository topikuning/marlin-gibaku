/**
 * RUTE PUBLIK MIDDLEWARE — khususnya `/offline` (DECISIONS 398).
 *
 * Halaman luring HARUS bisa dijemput tanpa cookie sesi. Kalau tidak, service
 * worker yang memasang dirinya menjemput `/offline`, ikut dialihkan ke `/masuk`
 * (redirect diikuti, hasil akhir 200), lalu `cache.add` menyimpan HALAMAN MASUK
 * di bawah kunci `/offline`. Yang kehilangan sinyal kemudian disodori formulir
 * masuk yang mustahil dilewati tanpa jaringan — kebalikan persis dari gunanya.
 *
 * Penjaga `bolehSimpanHalaman` di sw-kebijakan.js TIDAK menutup lubang ini:
 * prapasang memakai `cache.add`, yang tidak melewati kebijakan itu. Jadi satu-
 * satunya tempat yang bisa menegakkannya adalah middleware.
 *
 * Sekaligus menjaga sisi sebaliknya: daftar publik tidak boleh diam-diam
 * melebar. Rute aplikasi tanpa cookie tetap harus dialihkan.
 */
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

function minta(pathname: string, opts: { sesi?: boolean } = {}) {
  const req = new NextRequest(new URL(`https://marlin.test${pathname}`));
  if (opts.sesi) req.cookies.set("marlin_session", "kunci-uji");
  return middleware(req);
}

describe("middleware: rute publik", () => {
  it("/offline lewat TANPA cookie sesi", () => {
    const res = minta("/offline");
    // 200 = NextResponse.next(); 307 = redirect ke /masuk.
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("/masuk lewat tanpa cookie sesi", () => {
    expect(minta("/masuk").status).toBe(200);
  });

  it.each(["/", "/foto-cepat", "/kendala", "/laporan/harian"])(
    "%s tanpa sesi tetap dialihkan ke /masuk",
    (jalur) => {
      const res = minta(jalur);
      expect(res.status).toBe(307);
      expect(new URL(res.headers.get("location")!).pathname).toBe("/masuk");
    },
  );

  it("rute aplikasi dengan cookie sesi diteruskan", () => {
    expect(minta("/foto-cepat", { sesi: true }).status).toBe(200);
  });

  it("bukan awalan longgar: /offline-lama tetap butuh sesi", () => {
    /*
     * `startsWith` di middleware memakai `${p}/`, bukan `p` telanjang. Uji ini
     * menahan penyederhanaan yang tampak tidak berbahaya: `pathname.startsWith(p)`
     * akan membuka SEMUA jalur berawalan sama, termasuk yang belum ada hari ini.
     */
    const res = minta("/offline-lama");
    expect(res.status).toBe(307);
  });
});
