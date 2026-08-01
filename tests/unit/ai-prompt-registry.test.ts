import { describe, expect, it } from "vitest";
import {
  ANTI_KARANG_FRASA,
  PROMPT_GROUP_LABEL,
  PROMPT_SLOTS,
  promptDefault,
  promptSlot,
  validatePromptOverride,
} from "@/lib/ai/prompt-registry";
import { AI_REPORT_TEMPLATES } from "@/lib/ai-hub/report-templates";

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
    // Slot exec.* SUDAH DIHAPUS: menu Laporan → WA dilebur ke Report Studio
    // (DECISIONS 194) — laporan WA kini lewat template Report Studio yang
    // pagarnya menempel di report-templates.ts, bukan slot prompt terpisah.
    expect(keys.filter((k) => k.startsWith("exec."))).toEqual([]);
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

/**
 * Permintaan user 30 Juli 2026 (DECISIONS 182): larangan mengarang harus
 * DITEKANKAN di SEMUA prompt, bukan cuma di slot "aturan dasar". Yang diuji di
 * sini: tidak ada satu pun slot yang lolos tanpa aturan sumber, dan pagarnya
 * tidak bisa dibuang lewat halaman Sistem → Prompt AI.
 */
describe("aturan sumber wajib ada di SEMUA prompt", () => {
  it("setiap bawaan menyebut larangan mengarang", () => {
    for (const slot of PROMPT_SLOTS) {
      expect(slot.default.toLowerCase(), slot.key).toContain(ANTI_KARANG_FRASA.toLowerCase());
    }
  });

  it("setiap bawaan menyebut sumbernya secara eksplisit", () => {
    for (const slot of PROMPT_SLOTS) {
      expect(slot.default, slot.key).toMatch(/SUMBER: gunakan HANYA /);
    }
  });

  it("setiap slot mewajibkan frasa itu tetap ada pada override", () => {
    for (const slot of PROMPT_SLOTS) {
      const wajib = slot.mustContain.map((f) => f.toLowerCase());
      expect(wajib, slot.key).toContain(ANTI_KARANG_FRASA.toLowerCase());
    }
  });

  it("override tanpa larangan mengarang → DITOLAK di slot mana pun", () => {
    for (const slot of PROMPT_SLOTS) {
      const problem = validatePromptOverride(slot.key, "Tulis sebebas mungkin, panjang tidak masalah.");
      expect(problem, slot.key).toMatch(new RegExp(ANTI_KARANG_FRASA, "i"));
    }
  });

  it("instruksi per-jenis pun tidak bisa dikosongkan dari pagarnya", () => {
    // Dulu slot-slot ini mustContain-nya kosong sehingga bisa ditimpa apa saja.
    for (const key of ["hub.kind.pulse", "kegiatan.rewrite.rapi"]) {
      expect(validatePromptOverride(key, "Ringkas saja, seingatmu."), key).toMatch(/mengarang/i);
    }
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
      "Anda analis MARLIN. Tulis sangat ringkas, maksimal 5 poin. Anda BUKAN sumber angka — kutip persis " +
        "angka yang diberikan. JANGAN MENGARANG apa pun di luar data yang dilampirkan.",
    );
    expect(problem).toBeNull();
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

describe("template Report Studio ikut memuat pagar sumber", () => {
  it("setiap instruksi template menyebut sumber & larangan mengarang", () => {
    for (const t of AI_REPORT_TEMPLATES) {
      expect(t.instruction, t.key).toContain(ANTI_KARANG_FRASA);
      expect(t.instruction, t.key).toMatch(/SUMBER: gunakan HANYA /);
    }
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
