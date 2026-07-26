import { describe, expect, it } from "vitest";
import {
  categorizeMessage,
  classifyMessage,
  summarizeClasses,
  type MessageClass,
} from "@/lib/waha/message-classify";

/**
 * Klasifikasi relevansi pesan chat grup — pesan pendek berkonteks rendah tidak
 * boleh setara pesan kendala. DECISIONS 139.
 */

const base = { hasMedia: false, noise: false, fromMe: false };

describe("categorizeMessage", () => {
  it("mengenali kategori operasional", () => {
    expect(categorizeMessage("Material besi belum datang di lokasi")).toBe("kendala");
    expect(categorizeMessage("Mohon segera kirim gambar kerja")).toBe("tindak_lanjut");
    expect(categorizeMessage("Pengecoran lantai 1 sudah 60 persen")).toBe("progres");
    expect(categorizeMessage("Invoice termin 1 menunggu tanda tangan")).toBe("administrasi");
    expect(categorizeMessage("Rapat dengan kades besok pagi")).toBe("tindak_lanjut"); // "besok" menang
    expect(categorizeMessage("Kunjungan konsultan pengawas ke site")).toBe("koordinasi");
    expect(categorizeMessage("oke")).toBe("lainnya");
  });

  it("kendala menang atas kategori lain bila bercampur", () => {
    expect(categorizeMessage("Pengecoran terhambat karena hujan deras")).toBe("kendala");
  });
});

describe("classifyMessage", () => {
  it("kendala & tindak lanjut = sangat relevan dan selalu dipakai", () => {
    const a = classifyMessage({ ...base, body: "Alat berat rusak, pekerjaan galian berhenti" });
    expect(a.relevance).toBe("sangat_relevan");
    expect(a.category).toBe("kendala");
    expect(a.useForSummary).toBe(true);

    const b = classifyMessage({ ...base, body: "Tolong kirim laporan volume besok pagi" });
    expect(b.relevance).toBe("sangat_relevan");
    expect(b.useForSummary).toBe(true);
  });

  it("progres/administrasi/koordinasi = relevan", () => {
    expect(classifyMessage({ ...base, body: "Timbunan zona A sudah terpasang penuh" }).relevance).toBe("relevan");
    expect(classifyMessage({ ...base, body: "Kunjungan direksi dan konsultan pengawas" }).relevance).toBe("relevan");
  });

  it("pesan pendek tanpa kata kunci = konteks rendah dan TIDAK dipakai", () => {
    const r = classifyMessage({ ...base, body: "siap pak 👍" });
    expect(r.relevance).toBe("konteks_rendah");
    expect(r.useForSummary).toBe(false);
  });

  it("pesan panjang tanpa kata kunci = perlu interpretasi, tetap dipakai", () => {
    const r = classifyMessage({
      ...base,
      body: "Kemarin sore ada tamu dari kabupaten sebelah menanyakan hal teknis di sekitar dermaga",
    });
    expect(r.relevance).toBe("perlu_interpretasi");
    expect(r.useForSummary).toBe(true);
  });

  it("lampiran tanpa teks = perlu interpretasi (buktinya ada, maknanya belum)", () => {
    const r = classifyMessage({ ...base, body: "   ", hasMedia: true });
    expect(r.relevance).toBe("perlu_interpretasi");
    expect(r.useForSummary).toBe(true);
  });

  it("uji sistem/basa-basi (noise) dibuang dari bahan ringkasan", () => {
    const r = classifyMessage({ ...base, body: "test webhook", noise: true });
    expect(r.relevance).toBe("konteks_rendah");
    expect(r.useForSummary).toBe(false);
  });

  it("kiriman MARLIN selalu ikut & ditandai administrasi", () => {
    const r = classifyMessage({ ...base, body: "ok", fromMe: true, noise: true });
    expect(r.relevance).toBe("relevan");
    expect(r.category).toBe("administrasi");
    expect(r.useForSummary).toBe(true);
  });

  it("setiap hasil punya alasan yang bisa ditampilkan", () => {
    const r = classifyMessage({ ...base, body: "Material terlambat" });
    expect(r.reason.length).toBeGreaterThan(5);
  });
});

describe("summarizeClasses", () => {
  it("menghitung total/dipakai/dibuang per relevansi & kategori", () => {
    const classes: MessageClass[] = [
      classifyMessage({ ...base, body: "Besi belum datang" }),
      classifyMessage({ ...base, body: "ok" }),
      classifyMessage({ ...base, body: "Pengecoran sudah selesai" }),
    ];
    const s = summarizeClasses(classes);
    expect(s.total).toBe(3);
    expect(s.used).toBe(2);
    expect(s.excluded).toBe(1);
    expect(s.byRelevance.sangat_relevan).toBe(1);
    expect(s.byRelevance.konteks_rendah).toBe(1);
    expect(s.byCategory.kendala).toBe(1);
  });

  it("daftar kosong aman", () => {
    const s = summarizeClasses([]);
    expect(s.total).toBe(0);
    expect(s.used).toBe(0);
  });
});
