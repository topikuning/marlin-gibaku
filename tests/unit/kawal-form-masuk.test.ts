import { describe, expect, it } from "vitest";
import { bacaFormulirMasuk, isiFormulirMasuk } from "@/lib/kawal/form-masuk";

/**
 * FORMULIR MASUK KAWAL DIBACA, TIDAK DITEBAK (DECISIONS 689).
 * HTML di sini buatan – meniru pola Laravel/Ace Admin pada umumnya.
 */

const HALAMAN = `<!doctype html><html><head>
<meta charset="utf-8"><META NAME='csrf-token' CONTENT='tok&amp;123'>
</head><body>
<form action="/cari" method="get"><input name="q" type="text"></form>
<form class="login" method="POST" action="https://kawal.contoh.test/login">
  <input type="hidden" name="_token" value="tok&amp;123">
  <input type='email' name='email' placeholder="Email">
  <input type="password" name="password">
  <input type="checkbox" name="remember" value="1">
  <input type="checkbox" name="setuju" value="ya" checked>
  <button type="submit">Masuk</button>
  <input type="submit" name="kirim" value="Masuk">
</form></body></html>`;

describe("membaca formulir masuk Kawal", () => {
  it("memilih formulir yang punya kolom sandi, bukan formulir pertama", () => {
    const f = bacaFormulirMasuk(HALAMAN)!;
    expect(f.action).toBe("https://kawal.contoh.test/login");
    expect(f.metode).toBe("POST");
  });

  it("mengenali kolom akun dan sandi dari tipenya", () => {
    const f = bacaFormulirMasuk(HALAMAN)!;
    expect(f.namaKolomAkun).toBe("email");
    expect(f.namaKolomSandi).toBe("password");
  });

  it("token CSRF tersembunyi ikut, kotak centang yang tidak dicentang dan tombol kirim tidak", () => {
    const f = bacaFormulirMasuk(HALAMAN)!;
    expect(f.kolom.map((k) => k.nama)).toEqual(["_token", "email", "password", "setuju"]);
    expect(f.kolom[0].nilai).toBe("tok&123");
    expect(f.csrfMeta).toBe("tok&123");
  });

  it("isian dikirim dengan akun & sandi kita, kolom lain apa adanya", () => {
    const p = isiFormulirMasuk(bacaFormulirMasuk(HALAMAN)!, "kontraktor@contoh.test", "rahasia");
    expect(p.get("_token")).toBe("tok&123");
    expect(p.get("email")).toBe("kontraktor@contoh.test");
    expect(p.get("password")).toBe("rahasia");
    expect(p.get("setuju")).toBe("ya");
  });

  it("halaman tanpa kolom sandi = bukan halaman masuk", () => {
    expect(bacaFormulirMasuk(`<form><input name="q"></form>`)).toBeNull();
    expect(bacaFormulirMasuk(`{"status":"ok"}`)).toBeNull();
  });

  it("kolom akun tanpa atribut type tetap dikenali (bawaannya text)", () => {
    const f = bacaFormulirMasuk(`<form method=post><input name=username><input type=password name=pass></form>`)!;
    expect(f.namaKolomAkun).toBe("username");
    expect(f.namaKolomSandi).toBe("pass");
    expect(f.action).toBe("");
  });
});
