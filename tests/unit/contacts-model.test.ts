import { describe, expect, it } from "vitest";
import {
  formatSenderKey,
  matchesQuery,
  normalizeWaTarget,
  senderKeyKind,
  byName,
} from "@/lib/contacts/model";

/** Manajemen Kontak — util murni. DECISIONS 150. */

describe("normalizeWaTarget", () => {
  it("nomor apa pun bentuknya jadi 62…@c.us", () => {
    expect(normalizeWaTarget("6281234567890")).toBe("6281234567890@c.us");
    expect(normalizeWaTarget("+62 812-3456-7890")).toBe("6281234567890@c.us");
  });

  it("REGRESI: awalan 0 dan 8 diubah ke 62 — kalau tidak, kiriman gagal senyap", () => {
    // Gejala: kontak tersimpan "081234567890@c.us"; WhatsApp tidak mengenalnya
    // dan barusan ketahuan hanya ketika laporan gagal terkirim.
    expect(normalizeWaTarget("  0812 3456 7890 ")).toBe("6281234567890@c.us");
    expect(normalizeWaTarget("81234567890")).toBe("6281234567890@c.us");
  });

  it("kode negara ganda hasil salin-tempel dirapikan", () => {
    expect(normalizeWaTarget("62626281234567890")).toBe("6281234567890@c.us");
  });

  it("ID lengkap dibiarkan apa adanya", () => {
    expect(normalizeWaTarget("120363042@g.us")).toBe("120363042@g.us");
    expect(normalizeWaTarget("6281@c.us")).toBe("6281@c.us");
    expect(normalizeWaTarget("628123@s.whatsapp.net")).toBe("628123@s.whatsapp.net");
  });

  it("menolak yang jelas bukan tujuan WA", () => {
    expect(() => normalizeWaTarget("")).toThrow(/kosong/i);
    expect(() => normalizeWaTarget("   ")).toThrow(/kosong/i);
    expect(() => normalizeWaTarget("direksi")).toThrow(/tidak dikenal/i);
    expect(() => normalizeWaTarget("12345")).toThrow(/tidak dikenal/i);
  });
});

describe("senderKeyKind & formatSenderKey", () => {
  it("mengenali bentuk kunci pengirim", () => {
    expect(senderKeyKind("164253889654321@lid")).toBe("lid");
    expect(senderKeyKind("6281234567890@c.us")).toBe("kontak");
    expect(senderKeyKind("120363042@g.us")).toBe("grup");
    expect(senderKeyKind("6281234567890")).toBe("nomor");
  });

  it("LID panjang dipendekkan tapi tetap bisa dibedakan", () => {
    const a = formatSenderKey("164253889654321@lid");
    const b = formatSenderKey("164253889654999@lid");
    expect(a).toContain("…");
    expect(a).not.toBe(b); // ujung dipertahankan → dua LID mirip tidak tertukar
  });

  it("LID pendek tidak dipendekkan", () => {
    expect(formatSenderKey("12345@lid")).toBe("12345@lid");
  });

  it("nomor diberi +, ID grup TIDAK (itu bukan nomor telepon)", () => {
    expect(formatSenderKey("6281234567890")).toBe("+6281234567890");
    expect(formatSenderKey("6281234567890@c.us")).toBe("+6281234567890@c.us");
    expect(formatSenderKey("120363042@g.us")).toBe("120363042@g.us");
  });

  it("nomor yang sudah berawalan + tidak jadi ++", () => {
    expect(formatSenderKey("+6281234567890")).toBe("+6281234567890");
  });
});

describe("matchesQuery", () => {
  const row = { name: "Prio Yulianto", detail: "6281234567890@c.us", note: "Mandor Pasar Banggi", owner: "Hery" };

  it("query kosong meloloskan semua", () => {
    expect(matchesQuery(row, "")).toBe(true);
    expect(matchesQuery(row, "   ")).toBe(true);
  });

  it("cocok lintas kolom & tidak peduli huruf besar/kecil", () => {
    expect(matchesQuery(row, "prio")).toBe(true);
    expect(matchesQuery(row, "812345")).toBe(true);
    expect(matchesQuery(row, "MANDOR")).toBe(true);
    expect(matchesQuery(row, "hery")).toBe(true);
  });

  it("beberapa kata MENYEMPIT (AND), bukan melebar", () => {
    expect(matchesQuery(row, "prio mandor")).toBe(true);
    expect(matchesQuery(row, "prio tukang")).toBe(false);
  });

  it("kolom yang tidak ada tidak bikin error", () => {
    expect(matchesQuery({ name: "A", detail: "B" }, "a")).toBe(true);
    expect(matchesQuery({ name: "A", detail: "B" }, "hery")).toBe(false);
  });
});

describe("byName", () => {
  it("urut Indonesia, abai huruf besar/kecil", () => {
    const rows = [{ name: "budi" }, { name: "Ani" }, { name: "Candra" }];
    expect([...rows].sort(byName).map((r) => r.name)).toEqual(["Ani", "budi", "Candra"]);
  });
});
