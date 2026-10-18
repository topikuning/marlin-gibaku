import { describe, expect, it } from "vitest";
import { ambilLokasiKawal, JALUR_LOKASI, KawalGalat, normalisasiAlamat } from "@/lib/kawal/klien";

/**
 * ALUR MASUK KAWAL LEWAT SERVER TIRUAN (DECISIONS 689).
 *
 * Meniru aplikasi PHP bersesi cookie: halaman depan mengalihkan ke /login,
 * formulir ber-token CSRF, POST yang berhasil mengalihkan ke dasbor dengan
 * cookie sesi baru, dan API yang hanya menjawab JSON bila cookie sesinya benar.
 */

const DASAR = "https://kawal.contoh.test";
const FORM = `<html><head><meta name="csrf-token" content="csrf-abc"></head><body>
<form method="post" action="/login"><input type="hidden" name="_token" value="csrf-abc">
<input type="text" name="username"><input type="password" name="password"></form></body></html>`;

type Catatan = { method: string; path: string; cookie: string | null; body: string | null; csrf: string | null };

function serverTiruan(opsi: { sandiBenar?: string; apiHtml?: boolean } = {}) {
  const catatan: Catatan[] = [];
  const sandiBenar = opsi.sandiBenar ?? "rahasia";
  const fetchTiruan = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const h = new Headers(init?.headers);
    const cookie = h.get("cookie");
    const body = typeof init?.body === "string" ? init.body : null;
    catatan.push({ method: init?.method ?? "GET", path: url.pathname, cookie, body, csrf: h.get("x-csrf-token") });
    const html = (s: string, extra: Record<string, string> = {}) =>
      new Response(s, { status: 200, headers: { "content-type": "text/html; charset=utf-8", ...extra } });

    if (url.pathname === "/") return new Response(null, { status: 302, headers: { location: "/login" } });
    if (url.pathname === "/login" && (init?.method ?? "GET") === "GET") {
      return html(FORM, { "set-cookie": "PHPSESSID=tamu; Path=/; HttpOnly" });
    }
    if (url.pathname === "/login") {
      const p = new URLSearchParams(body ?? "");
      if (p.get("_token") !== "csrf-abc" || p.get("password") !== sandiBenar || !cookie?.includes("PHPSESSID=tamu")) {
        return html(FORM);
      }
      return new Response(null, {
        status: 302,
        headers: { location: "/dashboard", "set-cookie": "PHPSESSID=masuk; Path=/; HttpOnly" },
      });
    }
    if (url.pathname === "/dashboard") return html("<html>Dasbor</html>");
    if (url.pathname === JALUR_LOKASI) {
      if (opsi.apiHtml || !cookie?.includes("PHPSESSID=masuk")) return html(FORM);
      return new Response(JSON.stringify({ status: true, count: 1, data: [{ id: 1 }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("tidak ada", { status: 404 });
  }) as typeof fetch;
  return { fetchTiruan, catatan };
}

const AKUN = { alamat: DASAR, akun: "kontraktor", sandi: "rahasia" };

describe("klien Kawal", () => {
  it("masuk lewat formulir yang dibaca dari halamannya, lalu menerima JSON lokasi", async () => {
    const { fetchTiruan, catatan } = serverTiruan();
    const hasil = await ambilLokasiKawal(AKUN, fetchTiruan);
    expect(hasil.body).toEqual({ status: true, count: 1, data: [{ id: 1 }] });
    expect(hasil.formulir).toMatchObject({ jalurKirim: "/login", namaKolomAkun: "username", adaCsrfMeta: true });

    const post = catatan.find((c) => c.method === "POST")!;
    expect(new URLSearchParams(post.body!).get("username")).toBe("kontraktor");
    expect(post.csrf).toBe("csrf-abc");
    // Cookie sesi yang baru menggantikan cookie tamu.
    expect(catatan.at(-1)).toMatchObject({ path: JALUR_LOKASI, cookie: "PHPSESSID=masuk" });
  });

  it("jejak langkah hanya memuat jalur, metode, status – tanpa isian formulir", async () => {
    const { fetchTiruan } = serverTiruan();
    const { langkah } = await ambilLokasiKawal(AKUN, fetchTiruan);
    expect(langkah.map((l) => `${l.metode} ${l.jalur} ${l.status}`)).toEqual([
      "GET / 302",
      "GET /login 200",
      "POST /login 302",
      "GET /dashboard 200",
      `GET ${JALUR_LOKASI} 200`,
    ]);
    expect(JSON.stringify(langkah)).not.toContain("rahasia");
  });

  it("sandi salah: berhenti dengan pesan yang jelas, bukan data kosong", async () => {
    const { fetchTiruan } = serverTiruan({ sandiBenar: "lain" });
    await expect(ambilLokasiKawal(AKUN, fetchTiruan)).rejects.toThrow(/menolak masuk/);
  });

  it("API mengembalikan halaman masuk alih-alih JSON = sesi tidak diterima", async () => {
    const { fetchTiruan } = serverTiruan({ apiHtml: true });
    const galat = await ambilLokasiKawal(AKUN, fetchTiruan).catch((e) => e);
    expect(galat).toBeInstanceOf(KawalGalat);
    expect(galat.message).toMatch(/sesi tidak diterima/);
    expect(galat.langkah.length).toBeGreaterThan(0);
  });

  it("alamat harus http(s), garis miring di akhir dibuang", () => {
    expect(normalisasiAlamat("https://kawal.contoh.test/app/")).toBe("https://kawal.contoh.test/app");
    expect(() => normalisasiAlamat("ftp://kawal.contoh.test")).toThrow(/https/);
    expect(() => normalisasiAlamat("bukan alamat")).toThrow(/tidak sah/);
  });
});
