/*
 * PAGAR KIRIMAN KE NOMOR PRIBADI (DECISIONS 433).
 *
 * Ketetapan user 2026-08-25: kiriman WhatsApp ke nomor pribadi dimatikan
 * secara bawaan, karena WhatsApp memblokir nomor yang terlalu sering
 * mengirim chat pribadi — dan blokir itu ikut mematikan kiriman ke GRUP,
 * yang justru inti pemakaian MARLIN.
 *
 * `tujuanGrup` adalah satu-satunya pembeda grup vs orang, dipakai penjaga
 * gateway DAN layar Sistem. Kalau ia salah, pagar itu bisa menutup kiriman
 * grup yang sah (fitur mati) atau meloloskan chat pribadi (nomor diblokir).
 */
import { describe, expect, it } from "vitest";
import { tujuanGrup } from "@/lib/waha/grup-id";

describe("membedakan grup dari orang", () => {
  it("domain @g.us = grup", () => {
    expect(tujuanGrup("120363000000000000@g.us")).toBe(true);
  });

  it("@c.us dan @lid = orang, bukan grup", () => {
    expect(tujuanGrup("6281234567890@c.us")).toBe(false);
    // @lid = identitas privasi WhatsApp; tetap perorangan (DECISIONS 138/347).
    expect(tujuanGrup("123456789@lid")).toBe(false);
  });

  it("huruf besar & spasi tidak boleh menipu pagar", () => {
    expect(tujuanGrup("  120363000000000000@G.US  ")).toBe(true);
    expect(tujuanGrup(" 6281234567890@C.US ")).toBe(false);
  });

  it("teks tanpa domain bukan grup – aman ke sisi menutup", () => {
    expect(tujuanGrup("6281234567890")).toBe(false);
    expect(tujuanGrup("")).toBe(false);
  });

  it("nama grup yang KEBETULAN memuat teks @g.us di tengah tidak lolos", () => {
    // Yang menentukan adalah AKHIRAN domainnya, bukan ada-tidaknya teks itu.
    expect(tujuanGrup("12036@g.us.evil@c.us")).toBe(false);
  });
});
