import { describe, expect, it } from "vitest";
import {
  buildBatchRewritePrompt,
  buildRewritePrompt,
  parseBatchRewrite,
  stripEchoedHeader,
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

describe("verifyRewrite – MENANDAI, bukan memblokir (DECISIONS 181)", () => {
  const asli = "hari ini pengecoran kolom 12 titik, mutu K-250, cuaca hujan sore jadi berhenti jam 15";

  it("perapian yang jujur → tanpa catatan", () => {
    const usul =
      "Pada hari ini dilaksanakan pengecoran kolom sebanyak 12 titik dengan mutu beton K-250. " +
      "Pekerjaan dihentikan pukul 15 karena hujan pada sore hari.";
    expect(verifyRewrite(asli, usul)).toEqual({ ok: true, problems: [], warnings: [] });
  });

  it("angka baru → tetap DITAMPILKAN, dengan catatan (user yang memutuskan)", () => {
    const usul = "Dilaksanakan pengecoran kolom 12 titik mutu K-250 volume 8 m3, dihentikan pukul 15.";
    const v = verifyRewrite(asli, usul);
    expect(v.ok).toBe(true);
    expect(v.warnings.join(" ")).toMatch(/tidak ada di teks asli/i);
  });

  it("angka asli hilang → ditampilkan dengan catatan", () => {
    const v = verifyRewrite(asli, "Dilaksanakan pengecoran kolom mutu K-250, dihentikan karena hujan.");
    expect(v.ok).toBe(true);
    expect(v.warnings.join(" ")).toMatch(/tidak muncul lagi/i);
  });

  it("teks pendek yang wajar memanjang saat dibakukan → TANPA catatan panjang", () => {
    // Inilah kasus yang dulu memblokir seluruh usulan di lapangan.
    const v = verifyRewrite(
      "cor kolom 12 titik",
      "Dilaksanakan pekerjaan pengecoran kolom sebanyak 12 titik.",
    );
    expect(v.ok).toBe(true);
    expect(v.warnings).toEqual([]);
  });

  it("memanjang berkali-kali → ditampilkan, diberi catatan", () => {
    const v = verifyRewrite("kolom 12 titik selesai", "Pengecoran kolom 12 titik selesai. " + "x".repeat(420));
    expect(v.ok).toBe(true);
    expect(v.warnings.join(" ")).toMatch(/jauh lebih panjang/i);
  });

  it("balasan berupa pengantar model → ditampilkan, diberi catatan", () => {
    const v = verifyRewrite("kolom 12 titik selesai", "Berikut versi rapinya: kolom 12 titik selesai");
    expect(v.ok).toBe(true);
    expect(v.warnings.join(" ")).toMatch(/pengantar model/i);
  });

  it("hasil kosong → satu-satunya alasan tidak ditampilkan", () => {
    expect(verifyRewrite("kolom 12 titik selesai", "   ").ok).toBe(false);
  });

  it("desimal & pemisah ribuan dianggap sama walau formatnya berubah", () => {
    expect(verifyRewrite("pasang 1.500 batako", "Dipasang 1500 buah batako.").warnings).toEqual([]);
  });
});

describe("cleanRewrite – balasan model dibersihkan sebelum dipakai", () => {
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

describe("rewriteInputProblem – kapan tombol tidak perlu memanggil model", () => {
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

describe("mode gabungan (dipakai saat finalisasi) – satu panggilan, banyak bagian", () => {
  it("prompt hanya memuat bagian yang dikirim + gaya yang dipilih", () => {
    const p = buildBatchRewritePrompt({
      fields: [
        { field: "notes", text: "cor kolom 12 titik" },
        { field: "solusi", text: "besok mulai lebih pagi" },
      ],
      style: "teknis",
      kindLabel: "Pengawasan Harian",
    });
    expect(p).toContain("[CATATAN]");
    expect(p).toContain("[TINDAK_LANJUT]");
    expect(p).not.toContain("[KENDALA]"); // kendala tidak dikirim
    expect(p).toMatch(/register teknis/i);
    expect(p).toContain("Pengawasan Harian");
  });

  it("balasan bertanda diurai per bagian", () => {
    const hasil = parseBatchRewrite(
      "[CATATAN]\nDilaksanakan pengecoran kolom.\n\n[KENDALA]\nAlat berat terlambat.\n\n[TINDAK_LANJUT]\nPekerjaan dimulai lebih pagi.",
    );
    expect(hasil.notes).toBe("Dilaksanakan pengecoran kolom.");
    expect(hasil.kendala).toBe("Alat berat terlambat.");
    expect(hasil.solusi).toBe("Pekerjaan dimulai lebih pagi.");
  });

  it("bagian yang tidak dibalas model → absen (bukan string kosong yang menimpa teks asli)", () => {
    const hasil = parseBatchRewrite("[CATATAN]\nDilaksanakan pengecoran kolom.");
    expect(hasil.notes).toBeTruthy();
    expect(hasil.kendala).toBeUndefined();
    expect(hasil.solusi).toBeUndefined();
  });

  it("urutan penanda acak tetap terurai benar", () => {
    const hasil = parseBatchRewrite("[TINDAK_LANJUT]\nMulai lebih pagi.\n[CATATAN]\nPengecoran kolom.");
    expect(hasil.solusi).toBe("Mulai lebih pagi.");
    expect(hasil.notes).toBe("Pengecoran kolom.");
  });
});

/**
 * GEMA JUDUL — keluhan user 2026-09-03: usulan datang berbunyi
 * "Catatan kegiatan – Catatan pelaksanaan kegiatan: Tim PLN melakukan survei…".
 *
 * Kalimatnya bukan tulisan pelapor dan bukan karangan model: itu label +
 * petunjuk dari prompt kami sendiri, ditiru balik lalu ikut tersimpan ke teks
 * yang dicetak di laporan resmi. Diuji dari BALASAN model, bukan dari prompt:
 * prompt yang rapi tidak menjamin model patuh.
 */
describe("gema judul prompt tidak boleh ikut masuk usulan", () => {
  it("membuang 'Catatan kegiatan – Catatan pelaksanaan kegiatan:' di depan isi", () => {
    const hasil = parseBatchRewrite(
      "[CATATAN]\nCatatan kegiatan – Catatan pelaksanaan kegiatan: Tim PLN melakukan survei lokasi untuk kebutuhan kelistrikan serta memeriksa progres pekerjaan.",
    );
    expect(hasil.notes).toBe(
      "Tim PLN melakukan survei lokasi untuk kebutuhan kelistrikan serta memeriksa progres pekerjaan.",
    );
  });

  it("membuang gema pada kendala & tindak lanjut juga", () => {
    const hasil = parseBatchRewrite(
      "[KENDALA]\nKendala: Alat berat terlambat tiba.\n[TINDAK_LANJUT]\nTindak lanjut – Tindak lanjut: Pekerjaan dimulai lebih pagi.",
    );
    expect(hasil.kendala).toBe("Alat berat terlambat tiba.");
    expect(hasil.solusi).toBe("Pekerjaan dimulai lebih pagi.");
  });

  it("isi yang KEBETULAN diawali kata serupa tidak ikut terpotong isinya", () => {
    const hasil = parseBatchRewrite("[KENDALA]\nKendala utama adalah cuaca.");
    expect(hasil.kendala).toBe("utama adalah cuaca.");
  });

  it("balasan yang hanya berisi gema judul tidak berubah jadi kosong", () => {
    expect(stripEchoedHeader("notes", "Catatan kegiatan")).toBe("Catatan kegiatan");
  });

  it("prompt tidak lagi menempelkan label pada baris penanda", () => {
    const p = buildBatchRewritePrompt({
      fields: [{ field: "notes", text: "tim pln survey lokasi buat listrik" }],
      style: "rapi",
    });
    expect(p).not.toMatch(/^\[CATATAN\][ \t]+\S/m);
    expect(p).toMatch(/Jangan menulis ulang label/i);
  });
});
