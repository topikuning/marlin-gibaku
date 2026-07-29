import { describe, expect, it } from "vitest";
import {
  buildRewritePrompt,
  cleanRewrite,
  REWRITE_SYSTEM_PROMPT,
  rewriteInputProblem,
  verifyRewrite,
} from "@/lib/field-activity/rewrite";

/**
 * Inti fitur ini bukan promptnya, melainkan PENJAGANYA: teks kegiatan ikut
 * tercetak ke laporan resmi, jadi usulan model tidak boleh dipercaya begitu
 * saja. Yang diuji di sini adalah penolakan deterministik terhadap usulan yang
 * menyelundupkan/menghilangkan fakta (DECISIONS 178).
 */

describe("verifyRewrite — usulan tidak boleh menambah atau membuang fakta", () => {
  const asli = "hari ini pengecoran kolom 12 titik, mutu K-250, cuaca hujan sore jadi berhenti jam 15";

  it("perapian bahasa yang jujur → diterima", () => {
    const usul =
      "Pada hari ini dilaksanakan pengecoran kolom sebanyak 12 titik dengan mutu beton K-250. " +
      "Pekerjaan dihentikan pukul 15 karena hujan pada sore hari.";
    expect(verifyRewrite(asli, usul)).toEqual({ ok: true, problems: [] });
  });

  it("angka yang tidak ada di teks asli → DITOLAK", () => {
    const usul =
      "Dilaksanakan pengecoran kolom sebanyak 12 titik mutu K-250 dengan volume 8 m3. " +
      "Pekerjaan dihentikan pukul 15 karena hujan.";
    const v = verifyRewrite(asli, usul);
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toMatch(/tidak ada di teks asli/i);
  });

  it("angka asli yang hilang → DITOLAK (perapian tidak boleh membuang data)", () => {
    const usul = "Dilaksanakan pengecoran kolom dengan mutu K-250. Pekerjaan dihentikan karena hujan.";
    const v = verifyRewrite(asli, usul);
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toMatch(/hilang/i);
  });

  it("hasil melar jauh (mengarang paragraf) → DITOLAK", () => {
    const pendek = "kolom 12 titik selesai";
    const usul =
      "Pada hari ini telah dilaksanakan pekerjaan pengecoran kolom sebanyak 12 titik yang seluruhnya " +
      "telah diselesaikan dengan baik sesuai dengan rencana kerja yang telah disepakati bersama antara " +
      "pihak penyedia dan pengawas lapangan, serta telah dilakukan pemeriksaan mutu dan hasilnya " +
      "dinyatakan memenuhi persyaratan teknis yang berlaku pada pekerjaan ini.";
    expect(verifyRewrite(pendek, usul).ok).toBe(false);
  });

  it("model membalas dengan pengantar, bukan teks laporan → DITOLAK", () => {
    expect(verifyRewrite("kolom 12 titik selesai", "Berikut versi rapinya: kolom 12 titik selesai").ok).toBe(
      false,
    );
  });

  it("hasil kosong → DITOLAK", () => {
    expect(verifyRewrite("kolom 12 titik selesai", "   ").ok).toBe(false);
  });

  it("desimal & pemisah ribuan dianggap sama walau formatnya berubah", () => {
    // "1.500" (ribuan) vs "1500" — bukan fakta baru, hanya format.
    expect(verifyRewrite("pasang 1.500 batako", "Dipasang 1500 buah batako.").ok).toBe(true);
  });
});

describe("cleanRewrite — balasan model dibersihkan sebelum dipakai", () => {
  it("buang pembungkus kutip dan blok kode", () => {
    expect(cleanRewrite('"Pekerjaan selesai."')).toBe("Pekerjaan selesai.");
    expect(cleanRewrite("```\nPekerjaan selesai.\n```")).toBe("Pekerjaan selesai.");
  });

  it("buang penanda markdown (blanko KKP dicetak polos)", () => {
    expect(cleanRewrite("- Pengecoran kolom\n- Pemasangan bekisting")).toBe(
      "Pengecoran kolom\nPemasangan bekisting",
    );
    expect(cleanRewrite("**Penting**: pekerjaan berhenti")).toBe("Penting: pekerjaan berhenti");
  });

  it("penomoran daftar dipertahankan (itu isi, bukan penanda)", () => {
    expect(cleanRewrite("1. Pengecoran\n2. Bekisting")).toBe("1. Pengecoran\n2. Bekisting");
  });
});

describe("rewriteInputProblem — kapan tombol tidak perlu memanggil model", () => {
  it("teks terlalu pendek → tidak dipanggil", () => {
    expect(rewriteInputProblem("selesai")).toMatch(/pendek/i);
  });

  it("teks melebihi batas kolom → ditolak sebelum memanggil", () => {
    expect(rewriteInputProblem("a".repeat(2001))).toMatch(/2000/);
  });

  it("teks wajar → boleh diproses", () => {
    expect(rewriteInputProblem("pengecoran kolom 12 titik hari ini")).toBeNull();
  });
});

describe("prompt", () => {
  it("aturan anti-karang tertulis eksplisit di system prompt", () => {
    expect(REWRITE_SYSTEM_PROMPT).toMatch(/JANGAN menambah informasi/i);
    expect(REWRITE_SYSTEM_PROMPT).toMatch(/disalin PERSIS/i);
    expect(REWRITE_SYSTEM_PROMPT).toMatch(/Kendala tetap ditulis sebagai kendala/i);
  });

  it("prompt memuat teks asli + konteks bagian, tanpa data lain", () => {
    const p = buildRewritePrompt({
      field: "kendala",
      text: "alat berat telat datang",
      kindLabel: "Rapat Koordinasi",
      title: "PCM minggu 3",
    });
    expect(p).toContain("Kendala");
    expect(p).toContain("Rapat Koordinasi");
    expect(p).toContain("PCM minggu 3");
    expect(p).toContain("alat berat telat datang");
  });
});
