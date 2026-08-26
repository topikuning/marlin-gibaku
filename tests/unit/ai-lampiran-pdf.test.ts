import { describe, expect, it } from "vitest";
import { dukunganLampiran, kontenOpenAi, type AiRequest } from "@/lib/ai/lampiran";
import { AI_PROVIDERS, aiProvider } from "@/lib/ai/providers";

/**
 * Jalur PDF per provider (DECISIONS 435).
 *
 * Bentuk medan di sini BUKAN hasil ingatan — diambil dari tipe SDK resmi:
 *  - OpenAI  `openai@7.5.0`            → `ChatCompletionContentPart.File`
 *    = `{ type:"file", file:{ filename, file_data } }`
 *  - Mistral `@mistralai/mistralai@2.6.4` → `DocumentURLChunk` di `ContentChunk`
 *    = `{ type:"document_url", document_url, document_name? }`
 *
 * Uji ini menjaga supaya perubahan berikutnya tidak diam-diam menyeragamkan
 * keduanya menjadi `image_url` lagi — kesalahan yang pernah terjadi.
 */

const PDF: AiRequest = {
  prompt: "Petakan surat ini.",
  attachments: [{ mediaType: "application/pdf", dataBase64: "QkFTRTY0", nama: "surat masuk.pdf" }],
};

function bagian(hasil: unknown): Record<string, unknown>[] {
  expect(Array.isArray(hasil)).toBe(true);
  return hasil as Record<string, unknown>[];
}

describe("kontenOpenAi – PDF per provider", () => {
  it("OpenAI memakai bagian `file` dengan filename + file_data data-URI", () => {
    const b = bagian(kontenOpenAi(PDF, "openai_file"));
    expect(b[0]).toEqual({ type: "text", text: "Petakan surat ini." });
    expect(b[1]).toEqual({
      type: "file",
      file: { filename: "surat masuk.pdf", file_data: "data:application/pdf;base64,QkFTRTY0" },
    });
  });

  it("OpenAI tetap mengirim filename walau nama berkas kosong", () => {
    const b = bagian(kontenOpenAi({ ...PDF, attachments: [{ mediaType: "application/pdf", dataBase64: "QQ==" }] }, "openai_file"));
    expect((b[1].file as { filename: string }).filename).toBe("surat.pdf");
  });

  it("Mistral memakai bagian `document_url` berisi data-URI", () => {
    const b = bagian(kontenOpenAi(PDF, "mistral_document_url"));
    expect(b[1]).toEqual({
      type: "document_url",
      document_url: "data:application/pdf;base64,QkFTRTY0",
      document_name: "surat masuk.pdf",
    });
  });

  it("Grok: PDF disaring – jalur Files API dua langkah belum dibangun", () => {
    // Tidak ada bagian berkas, jadi isinya turun menjadi teks biasa.
    expect(kontenOpenAi(PDF, "unggah_dulu")).toBe("Petakan surat ini.");
  });

  it("gambar seragam `image_url` di semua jalur", () => {
    const req: AiRequest = {
      prompt: "Baca foto.",
      attachments: [{ mediaType: "image/jpeg", dataBase64: "SU1H" }],
    };
    for (const j of ["openai_file", "mistral_document_url", "unggah_dulu"] as const) {
      const b = bagian(kontenOpenAi(req, j));
      expect(b[1]).toEqual({ type: "image_url", image_url: { url: "data:image/jpeg;base64,SU1H" } });
    }
  });

  it("tanpa lampiran, isinya tetap string polos", () => {
    expect(kontenOpenAi({ prompt: "halo" }, "openai_file")).toBe("halo");
  });
});

describe("dukunganLampiran", () => {
  it("Claude, ChatGPT, dan Mistral menerima PDF", () => {
    for (const id of ["claude", "openai", "mistral"] as const) {
      const j = aiProvider(id)!.jalurPdf;
      expect(dukunganLampiran(j).pdf, id).toBe(true);
    }
  });

  it("Grok belum: alasannya menyebut BATAS MARLIN, bukan ketidakmampuan provider", () => {
    const d = dukunganLampiran(aiProvider("grok")!.jalurPdf);
    expect(d.pdf).toBe(false);
    expect(d.gambar).toBe(true);
    expect(d.alasan).toContain("MARLIN belum bisa");
    // Klaim "provider X tidak bisa" tidak boleh muncul lagi – itu yang salah dulu.
    expect(d.alasan.toLowerCase()).not.toMatch(/provider ini tidak bisa|tidak mendukung pdf/);
  });

  it("semua provider punya jalur PDF yang ditetapkan", () => {
    for (const p of AI_PROVIDERS) {
      expect(dukunganLampiran(p.jalurPdf).gambar, p.id).toBe(true);
      expect(dukunganLampiran(p.jalurPdf).alasan.length, p.id).toBeGreaterThan(10);
    }
  });
});
