import { describe, expect, it } from "vitest";
import { isiKendalaDariKegiatan, layakJadiKendala } from "@/lib/kendala/dari-kegiatan";

/**
 * DECISIONS 392 — kendala kegiatan lapangan dinaikkan jadi Issue.
 *
 * Yang dijaga di sini bukan "fiturnya jalan", melainkan dua bahaya yang saling
 * berlawanan:
 *
 * 1. Kendala nyata DIAM-DIAM HILANG (keadaan sebelum perubahan ini).
 * 2. Papan kendala BANJIR baris "-" dan "tidak ada kendala" sehingga orang
 *    berhenti membacanya – yang akibatnya sama saja dengan nomor 1.
 */

describe("layakJadiKendala", () => {
  it("kendala sungguhan lolos", () => {
    expect(layakJadiKendala("Lahan belum bisa clear, pemilik masih menuntut")).toBe(true);
    expect(layakJadiKendala("Material besi belum datang")).toBe(true);
  });

  it("isian 'tidak ada kendala' dalam berbagai bentuk TIDAK jadi kendala", () => {
    for (const t of [
      "-",
      "–",
      "0",
      "nihil",
      "Nihil.",
      "NIHIL",
      "tidak ada",
      "Tidak ada kendala",
      "tdk ada kendala",
      "Belum ada kendala",
      "Tidak ada kendala yang berarti",
      "tidak ada kendala berarti",
      "tidak ada kendala apa apa",
      "Aman",
      "aman, lancar",
      "N/A",
      "kosong",
    ]) {
      expect(layakJadiKendala(t), `"${t}" seharusnya diabaikan`).toBe(false);
    }
  });

  it("null / kosong / coretan pendek diabaikan", () => {
    expect(layakJadiKendala(null)).toBe(false);
    expect(layakJadiKendala(undefined)).toBe(false);
    expect(layakJadiKendala("   ")).toBe(false);
    expect(layakJadiKendala("ok")).toBe(false);
    expect(layakJadiKendala("x")).toBe(false);
  });

  it("REGRESI: 'tidak ada' di TENGAH kalimat tetap kendala", () => {
    /*
     * Kalau daftar pengabai dicocokkan sebagai POTONGAN, kalimat-kalimat ini
     * ikut terbuang – dan justru inilah bentuk kendala yang paling sering
     * ditulis orang lapangan.
     */
    expect(layakJadiKendala("Tidak ada material besi di lokasi")).toBe(true);
    expect(layakJadiKendala("Air bersih tidak ada sejak Senin")).toBe(true);
    expect(layakJadiKendala("Akses jalan belum ada, alat berat tidak bisa masuk")).toBe(true);
  });
});

describe("isiKendalaDariKegiatan", () => {
  it("kalimat pendek jadi judul utuh, tanpa keterangan berulang", () => {
    const r = isiKendalaDariKegiatan("Material besi belum datang");
    expect(r.title).toBe("Material besi belum datang");
    // Menyalin teks yang sama ke keterangan hanya membuat layar penuh dua kali.
    expect(r.description).toBeNull();
  });

  it("paragraf panjang: judul = kalimat pertama, teks utuh masuk keterangan", () => {
    const r = isiKendalaDariKegiatan(
      "Lahan belum bisa clear. Pemilik masih menuntut ganti rugi tambahan dan menolak alat masuk sampai ada kesepakatan tertulis.",
    );
    expect(r.title).toBe("Lahan belum bisa clear.");
    expect(r.description).toContain("menuntut ganti rugi");
  });

  it("baris kedua dan seterusnya tidak ikut ke judul", () => {
    const r = isiKendalaDariKegiatan("Akses jalan longsor\nAlat berat tertahan di desa");
    expect(r.title).toBe("Akses jalan longsor");
    expect(r.description).toContain("Alat berat tertahan");
  });

  it("judul kepanjangan dipotong di batas KATA, bukan di tengah kata", () => {
    const panjang = `${"Pekerjaan tertahan karena persoalan lahan yang belum selesai ".repeat(6)}akhir`;
    const r = isiKendalaDariKegiatan(panjang);
    expect(r.title.length).toBeLessThanOrEqual(200);
    expect(r.title.endsWith("…")).toBe(true);
    // Tidak berakhir di tengah kata: karakter sebelum elipsis bukan potongan
    // kata yang terpenggal – dicek dengan memastikan kata terakhir utuh.
    const kataTerakhir = r.title.slice(0, -1).trimEnd().split(" ").pop()!;
    expect(panjang.split(/\s+/)).toContain(kataTerakhir);
    // Teks utuh tidak hilang.
    expect(r.description).toBe(panjang.trim());
  });

  it("solusi yang sudah ditulis ikut terbawa sebagai rencana penanganan", () => {
    const r = isiKendalaDariKegiatan("Air bersih tidak ada", "Sewa tangki dari kecamatan");
    expect(r.description).toContain("Rencana penanganan");
    expect(r.description).toContain("Sewa tangki dari kecamatan");
  });

  it("solusi berisi '-' tidak melahirkan baris 'Rencana penanganan: -'", () => {
    const r = isiKendalaDariKegiatan("Air bersih tidak ada", "-");
    expect(r.description).toBeNull();
  });
});
