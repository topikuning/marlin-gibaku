/*
 * SIKLUS SURAT + UTANG JAWAB (DECISIONS 432).
 *
 * Inti register surat bukan arsip yang rapi, melainkan surat yang MENDIAMKAN
 * DIRI harus kelihatan. `terlambatDijawab` dipakai layar DAN aturan EWS —
 * kalau keduanya memakai rumus sendiri-sendiri, papan peringatan dan register
 * bisa berbeda pendapat tentang surat yang sama.
 */
import { describe, expect, it } from "vitest";
import { sisaHariJawab, terlambatDijawab, transisiSurat } from "@/lib/surat/lifecycle";
import { evaluasiEwsSurat } from "@/lib/ews/rules";

const tgl = (s: string) => new Date(`${s}T00:00:00.000Z`);
const HARI_INI = tgl("2026-08-25");

describe("transisi status surat", () => {
  it("surat baru boleh menjadi perlu jawaban, selesai, atau arsip", () => {
    expect(transisiSurat("baru", "perlu_jawaban").ok).toBe(true);
    expect(transisiSurat("baru", "selesai").ok).toBe(true);
  });

  it("tidak bisa meloncat dari baru langsung ke dijawab", () => {
    const r = transisiSurat("baru", "dijawab");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("tidak bisa langsung");
  });

  it("status yang sama = sah (idempoten, klik dua kali tidak menghukum)", () => {
    expect(transisiSurat("selesai", "selesai").ok).toBe(true);
  });

  it("surat selesai masih boleh dibuka kembali jadi perlu jawaban", () => {
    expect(transisiSurat("selesai", "perlu_jawaban").ok).toBe(true);
  });
});

describe("terlambat dijawab", () => {
  it("lewat tenggat & belum dijawab → terlambat", () => {
    expect(
      terlambatDijawab(
        { status: "perlu_jawaban", needsReply: true, replyDueDate: tgl("2026-08-20") },
        HARI_INI,
      ),
    ).toBe(true);
  });

  it("sudah dijawab tidak pernah terlambat, walau tenggatnya lewat", () => {
    expect(
      terlambatDijawab({ status: "dijawab", needsReply: true, replyDueDate: tgl("2026-08-01") }, HARI_INI),
    ).toBe(false);
  });

  it("tanpa tuntutan jawaban atau tanpa tenggat → tidak menagih apa pun", () => {
    expect(
      terlambatDijawab({ status: "baru", needsReply: false, replyDueDate: tgl("2026-08-01") }, HARI_INI),
    ).toBe(false);
    expect(terlambatDijawab({ status: "baru", needsReply: true, replyDueDate: null }, HARI_INI)).toBe(false);
  });

  it("tenggat hari ini belum terlambat", () => {
    expect(
      terlambatDijawab({ status: "perlu_jawaban", needsReply: true, replyDueDate: HARI_INI }, HARI_INI),
    ).toBe(false);
  });
});

describe("sisa hari menuju tenggat", () => {
  it("positif sebelum tenggat, negatif sesudahnya", () => {
    expect(sisaHariJawab(tgl("2026-08-28"), HARI_INI)).toBe(3);
    expect(sisaHariJawab(tgl("2026-08-22"), HARI_INI)).toBe(-3);
    expect(sisaHariJawab(null, HARI_INI)).toBeNull();
  });
});

describe("aturan EWS surat", () => {
  const dasar = { letterId: "x", agenda: "12/2026", subject: "Teguran mutu", pihak: "Wakil PPK" };

  it("belum lewat tenggat → tidak memunculkan peringatan", () => {
    expect(evaluasiEwsSurat({ ...dasar, telatHari: 0 })).toHaveLength(0);
    expect(evaluasiEwsSurat({ ...dasar, telatHari: -2 })).toHaveLength(0);
  });

  it("telat sedikit = tinggi; telat seminggu atau lebih = kritis", () => {
    expect(evaluasiEwsSurat({ ...dasar, telatHari: 3 })[0].severity).toBe("tinggi");
    expect(evaluasiEwsSurat({ ...dasar, telatHari: 7 })[0].severity).toBe("kritis");
  });

  it("peringatannya menyebut angka & pihaknya, bukan kalimat umum", () => {
    const w = evaluasiEwsSurat({ ...dasar, telatHari: 5 })[0];
    expect(w.alasan).toContain("5 hari");
    expect(w.alasan).toContain("Wakil PPK");
    expect(w.href).toContain("/surat");
  });
});
