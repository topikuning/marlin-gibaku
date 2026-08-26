/*
 * KLASIFIKASI LAMPIRAN GRUP WA (DECISIONS 432).
 *
 * Yang dijaga di sini bukan sekadar "fungsinya jalan", tapi satu keputusan
 * desain yang menentukan fitur ini dipakai atau ditinggalkan: **foto lapangan
 * biasa TIDAK boleh masuk antrean persetujuan.** Kalau 83 grup mengirim
 * puluhan foto sehari, antrean berisi ribuan baris dan berhenti dibaca — dan
 * antrean yang tidak dibaca sama saja dengan tidak ada.
 */
import { describe, expect, it } from "vitest";
import { klasifikasiLampiran, terlaluBesar, BATAS_SIMPAN_BYTE } from "@/lib/waha/lampiran-klasifikasi";

const bahan = (o: Partial<Parameters<typeof klasifikasiLampiran>[0]>) =>
  klasifikasiLampiran({ fileName: null, mimeType: null, caption: "", sizeBytes: null, ...o });

describe("foto lapangan tidak menuntut persetujuan", () => {
  it("foto kamera WhatsApp → foto_lapangan, tidak masuk antrean", () => {
    const k = bahan({ fileName: "IMG-20260825-WA0032.jpg", mimeType: "image/jpeg" });
    expect(k.kind).toBe("foto_lapangan");
    expect(k.perluDitetapkan).toBe(false);
    expect(k.layakDibacaAi).toBe(false);
  });

  it("gambar tanpa nama pun dianggap foto lapangan", () => {
    const k = bahan({ fileName: null, mimeType: "image/jpeg" });
    expect(k.kind).toBe("foto_lapangan");
    expect(k.perluDitetapkan).toBe(false);
  });

  it("TAPI gambar yang menyebut surat tetap ditanyakan – surat sering difoto", () => {
    const k = bahan({ fileName: "IMG-001.jpg", mimeType: "image/jpeg", caption: "Surat teguran dari PPK" });
    expect(k.kind).toBe("surat_kandidat");
    expect(k.perluDitetapkan).toBe(true);
  });
});

describe("berkas dokumen selalu ditanyakan", () => {
  it("PDF bernama surat → surat_kandidat dengan alasan yang menyebut kata pemicunya", () => {
    const k = bahan({ fileName: "Surat Teguran No 12.pdf", mimeType: "application/pdf" });
    expect(k.kind).toBe("surat_kandidat");
    expect(k.alasan).toContain("surat");
    expect(k.layakDibacaAi).toBe(true);
  });

  it("Excel jadwal → dokumen kerja, bukan surat", () => {
    const k = bahan({
      fileName: "Time Schedule Kedungmutih.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    expect(k.kind).toBe("dokumen");
    expect(k.perluDitetapkan).toBe(true);
  });

  it("PDF tanpa kata kunci tetap dokumen – jangan diam-diam dibuang", () => {
    const k = bahan({ fileName: "scan001.pdf", mimeType: "application/pdf" });
    expect(k.kind).toBe("dokumen");
    expect(k.perluDitetapkan).toBe(true);
  });
});

describe("yang bukan bahan kerja tidak menumpuk ongkos", () => {
  it("stiker → abaikan, tidak diunduh, tidak ditanyakan", () => {
    const k = bahan({ mimeType: "image/webp", fileName: "sticker.webp" });
    expect(k.kind).toBe("abaikan");
    expect(k.perluDitetapkan).toBe(false);
  });

  it("audio & video juga diabaikan", () => {
    expect(bahan({ mimeType: "audio/ogg" }).kind).toBe("abaikan");
    expect(bahan({ mimeType: "video/mp4" }).kind).toBe("abaikan");
  });
});

describe("kata pemicu dibaca dari caption, bukan hanya nama berkas", () => {
  it("nama berkas acak + caption menyebut berita acara → surat_kandidat", () => {
    const k = bahan({
      fileName: "doc-99.pdf",
      mimeType: "application/pdf",
      caption: "Pak, ini berita acara pemeriksaan kemarin",
    });
    expect(k.kind).toBe("surat_kandidat");
  });
});

describe("batas simpan", () => {
  it("di bawah batas boleh disimpan; di atas batas tidak", () => {
    expect(terlaluBesar(BATAS_SIMPAN_BYTE - 1)).toBe(false);
    expect(terlaluBesar(BATAS_SIMPAN_BYTE + 1)).toBe(true);
    expect(terlaluBesar(null)).toBe(false);
  });
});

describe("jenis tak dikenali tetap terlihat", () => {
  it("MIME asing → media_lain dan tetap ditanyakan, bukan dibuang diam-diam", () => {
    const k = bahan({ fileName: "data.dwg", mimeType: "application/acad" });
    expect(k.kind).toBe("media_lain");
    expect(k.perluDitetapkan).toBe(true);
  });
});
