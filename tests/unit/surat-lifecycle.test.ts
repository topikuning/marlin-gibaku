/*
 * SIKLUS SURAT + UTANG JAWAB (DECISIONS 432).
 *
 * Inti register surat bukan arsip yang rapi, melainkan surat yang MENDIAMKAN
 * DIRI harus kelihatan. `terlambatDijawab` dipakai layar DAN aturan EWS —
 * kalau keduanya memakai rumus sendiri-sendiri, papan peringatan dan register
 * bisa berbeda pendapat tentang surat yang sama.
 */
import { describe, expect, it } from "vitest";
import {
  STATUS_SURAT_LABEL,
  STATUS_SURAT_TONE,
  sisaHariJawab,
  statusPulih,
  suratDibatalkan,
  terlambatDijawab,
  transisiSurat,
} from "@/lib/surat/lifecycle";
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

/* ── Pembatalan surat (DECISIONS 437) ───────────────────────────────────── */

describe("pembatalan surat", () => {
  it("bisa dibatalkan dari status mana pun – salah catat bisa ketahuan kapan saja", () => {
    for (const dari of ["baru", "perlu_jawaban", "dijawab", "selesai", "arsip"] as const) {
      expect(transisiSurat(dari, "dibatalkan").ok, dari).toBe(true);
    }
  });

  it("pulih hanya ke keadaan AWAL, tidak melompat ke 'selesai'", () => {
    expect(transisiSurat("dibatalkan", "baru").ok).toBe(true);
    expect(transisiSurat("dibatalkan", "perlu_jawaban").ok).toBe(true);
    expect(transisiSurat("dibatalkan", "selesai").ok).toBe(false);
    expect(transisiSurat("dibatalkan", "dijawab").ok).toBe(false);
    expect(transisiSurat("dibatalkan", "arsip").ok).toBe(false);
  });

  it("statusPulih mengembalikan utang jawab hanya bila memang menuntut jawaban", () => {
    expect(statusPulih(true)).toBe("perlu_jawaban");
    expect(statusPulih(false)).toBe("baru");
  });

  it("surat batal TIDAK menagih siapa pun walau tenggatnya lewat", () => {
    const lewat = {
      needsReply: true,
      replyDueDate: new Date("2026-08-01T00:00:00.000Z"),
      status: "dibatalkan" as const,
    };
    expect(terlambatDijawab(lewat, new Date("2026-08-26T00:00:00.000Z"))).toBe(false);
    // Pembandingnya: surat yang sama tapi belum dibatalkan MEMANG menagih.
    expect(
      terlambatDijawab({ ...lewat, status: "perlu_jawaban" }, new Date("2026-08-26T00:00:00.000Z")),
    ).toBe(true);
  });

  it("punya label & nada sendiri, tidak menumpang status lain", () => {
    expect(STATUS_SURAT_LABEL.dibatalkan).toBe("Dibatalkan");
    expect(STATUS_SURAT_TONE.dibatalkan).toBe("danger");
    expect(suratDibatalkan("dibatalkan")).toBe(true);
    expect(suratDibatalkan("arsip")).toBe(false);
  });
});
