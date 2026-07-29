import { describe, expect, it } from "vitest";
import {
  PROMPT_GROUP_LABEL,
  PROMPT_SLOTS,
  promptDefault,
  promptSlot,
  validatePromptOverride,
} from "@/lib/ai/prompt-registry";

/**
 * Halaman Sistem → Prompt AI membuat teks perintah bisa disetel tanpa deploy.
 * Yang diuji di sini: registrinya utuh, dan PENJAGA frasa pengaman benar-benar
 * menolak override yang membuang larangan mengarang (DECISIONS 180).
 */

describe("registri prompt", () => {
  it("kunci unik & tidak ada bawaan kosong (kecuali yang memang dibiarkan kosong)", () => {
    const keys = PROMPT_SLOTS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const slot of PROMPT_SLOTS) {
      expect(slot.label.length, slot.key).toBeGreaterThan(0);
      expect(slot.description.length, slot.key).toBeGreaterThan(0);
      expect(slot.default.trim().length, slot.key).toBeGreaterThan(0);
      expect(slot.maxChars, slot.key).toBeGreaterThan(200);
    }
  });

  it("setiap bawaan lolos validasinya sendiri (mustContain konsisten dengan teksnya)", () => {
    for (const slot of PROMPT_SLOTS) {
      expect(validatePromptOverride(slot.key, slot.default), slot.key).toBeNull();
    }
  });

  it("bawaan tidak melebihi batas karakternya sendiri", () => {
    for (const slot of PROMPT_SLOTS) {
      expect(slot.default.length, slot.key).toBeLessThanOrEqual(slot.maxChars);
    }
  });

  it("semua grup punya label tampilan", () => {
    for (const slot of PROMPT_SLOTS) {
      expect(PROMPT_GROUP_LABEL[slot.group], slot.key).toBeTruthy();
    }
  });

  it("menutup SEMUA aksi AI yang ada di sistem", () => {
    const keys = PROMPT_SLOTS.map((s) => s.key);
    // AI Hub: aturan dasar + 5 jenis run
    expect(keys).toContain("hub.system");
    for (const kind of ["pulse", "deviasi", "risiko", "kualitas_data", "tanya"]) {
      expect(keys).toContain(`hub.kind.${kind}`);
    }
    // Laporan eksekutif WA: aturan dasar + 3 template
    expect(keys).toContain("exec.system");
    for (const k of ["rangkuman_kegiatan", "rekap_kendala", "kepatuhan_lapor"]) {
      expect(keys).toContain(`exec.${k}`);
    }
    // Chat grup + perapian kegiatan
    expect(keys).toEqual(expect.arrayContaining(["chat.summary", "chat.overview"]));
    expect(keys).toEqual(
      expect.arrayContaining([
        "kegiatan.rewrite.system",
        "kegiatan.rewrite.rapi",
        "kegiatan.rewrite.teknis",
      ]),
    );
  });
});

describe("validatePromptOverride — pagar anti-mengarang tidak boleh dihapus", () => {
  it("membuang frasa pengaman AI Hub → DITOLAK", () => {
    const problem = validatePromptOverride(
      "hub.system",
      "Anda asisten analisis MARLIN. Jawab sebebas mungkin dan buat kesimpulan sendiri.",
    );
    expect(problem).toMatch(/BUKAN sumber angka/i);
  });

  it("mengubah gaya TAPI mempertahankan frasa pengaman → diterima", () => {
    const problem = validatePromptOverride(
      "hub.system",
      "Anda analis MARLIN. Tulis sangat ringkas, maksimal 5 poin. Anda BUKAN sumber angka — kutip persis angka yang diberikan.",
    );
    expect(problem).toBeNull();
  });

  it("membuang larangan mengarang di laporan eksekutif → DITOLAK", () => {
    expect(validatePromptOverride("exec.system", "Tulis laporan yang meyakinkan untuk direksi.")).toMatch(
      /JANGAN mengarang/i,
    );
  });

  it("membuang larangan menebak istilah di gaya teknis → DITOLAK", () => {
    expect(
      validatePromptOverride("kegiatan.rewrite.teknis", "Pakai istilah teknis sipil sebanyak mungkin."),
    ).toMatch(/JANGAN menebak/i);
  });

  it("melebihi batas karakter → DITOLAK dengan angkanya", () => {
    expect(validatePromptOverride("kegiatan.rewrite.rapi", "a".repeat(5000))).toMatch(/1500/);
  });

  it("dikosongkan → DITOLAK, diarahkan ke tombol kembalikan ke bawaan", () => {
    expect(validatePromptOverride("hub.system", "   ")).toMatch(/Kembalikan ke bawaan/i);
  });

  it("kunci tidak dikenal → DITOLAK", () => {
    expect(validatePromptOverride("tidak.ada", "apa saja")).toMatch(/tidak dikenal/i);
  });
});

describe("promptSlot / promptDefault", () => {
  it("mengembalikan slot & teks bawaan yang benar", () => {
    expect(promptSlot("hub.system")?.group).toBe("hub");
    expect(promptDefault("hub.system")).toMatch(/BUKAN sumber angka/);
    expect(promptSlot("tidak.ada")).toBeNull();
    expect(promptDefault("tidak.ada")).toBe("");
  });
});
