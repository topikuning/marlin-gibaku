// Pembersih keluaran AI kronologi.
//
// Permintaan user 2026-08-31: kronologi "jangan apa adanya semua dikirim, tapi
// kamu minta AI rapikan" dan "perlu kesimpulan dari satu lokasi, dalam 2-3
// kalimat".
//
// Dua janji yang harus DITEGAKKAN KODE, bukan dipercaya dari model:
//
// 1. Kesimpulan tidak boleh lebih dari 3 kalimat. DECISIONS 453/454 sudah
//    mencatat model tetap mengirim lebih walau diminta; yang membaca di
//    WhatsApp lalu menerima paragraf pada tempat yang dijanjikan ringkas.
// 2. Babak yang menunjuk sumber tak dikenal dibuang. Babak adalah kalimat yang
//    dirapikan DARI peristiwa; yang tidak bisa ditelusuri ke peristiwanya bukan
//    rapi, ia karangan.
import { describe, expect, it } from "vitest";
import { rapikanKeluaranKronologi } from "@/lib/ai-hub/kronologi-format";
import type { KronologiOutput } from "@/lib/ai-hub/schemas";

const babak = (sourceRefIds: string[], judul = "Babak") => ({
  locationId: "loc-1",
  judul,
  periode: "1-24 Agu 2026",
  reason: "Uraian babak.",
  sourceRefIds,
});

const keluaran = (over: Partial<KronologiOutput> = {}): KronologiOutput => ({
  kesimpulan: "Satu. Dua. Tiga.",
  kesimpulanSourceRefIds: ["kronologi:kendala:a:dibuka"],
  confidence: 50,
  babak: [],
  limitations: [],
  ...over,
});

const SAH = new Set(["kronologi:kendala:a:dibuka", "kronologi:kegiatan:g"]);

describe("rapikanKeluaranKronologi", () => {
  it("memangkas kesimpulan yang lebih dari tiga kalimat, dan mengatakannya", () => {
    const h = rapikanKeluaranKronologi(
      keluaran({ kesimpulan: "Satu. Dua. Tiga. Empat. Lima." }),
      SAH,
    );
    expect(h.output.kesimpulan).toBe("Satu. Dua. Tiga.");
    expect(h.dibuang.join(" ")).toContain("kesimpulan");
  });

  it("membiarkan kesimpulan yang memang sudah ringkas", () => {
    const h = rapikanKeluaranKronologi(keluaran(), SAH);
    expect(h.output.kesimpulan).toBe("Satu. Dua. Tiga.");
    expect(h.dibuang).toHaveLength(0);
  });

  it("membuang babak yang menunjuk sumber tak dikenal", () => {
    const h = rapikanKeluaranKronologi(
      keluaran({
        babak: [babak(["kronologi:kegiatan:g"], "Sah"), babak(["kronologi:entah"], "Karangan")],
      }),
      SAH,
    );
    expect(h.output.babak.map((b) => b.judul)).toEqual(["Sah"]);
    expect(h.dibuang.join(" ")).toContain("babak");
  });

  it("membuang sumber kesimpulan yang tak dikenal tanpa membuang kesimpulannya", () => {
    const h = rapikanKeluaranKronologi(
      keluaran({ kesimpulanSourceRefIds: ["kronologi:entah"] }),
      SAH,
    );
    expect(h.output.kesimpulanSourceRefIds).toEqual([]);
    expect(h.output.kesimpulan).toBe("Satu. Dua. Tiga.");
    expect(h.dibuang.join(" ")).toContain("kesimpulan tidak menyebut sumber");
  });

  it("menghitung keyakinan dari bagian yang selamat, bukan dari pengakuan model", () => {
    const h = rapikanKeluaranKronologi(
      keluaran({
        confidence: 99,
        babak: [babak(["kronologi:kegiatan:g"]), babak(["kronologi:entah"])],
      }),
      SAH,
    );
    // 1 babak + 1 kesimpulan bersumber, dari 2 babak + 1 kesimpulan = 2/3.
    expect(h.output.confidence).toBe(67);
  });
});
