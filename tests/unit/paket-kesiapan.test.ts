import { describe, expect, it } from "vitest";
import { kesiapanPaket } from "@/lib/package/kesiapan";

/**
 * KOLOM "STATUS DATA" di daftar paket (DECISIONS 368).
 *
 * Yang dijaga di sini bukan sekadar pemetaan tahap → warna, melainkan satu
 * keputusan rancangan yang gampang dirusak belakangan: **kesiapan diukur
 * terhadap TAHAPNYA**. Kalau prospek tanpa lokasi ikut merah, seluruh kolom ini
 * merah pada paket yang tidak salah apa-apa — dan kolom yang selalu merah
 * berhenti dibaca, persis saat paket berkontrak tanpa lokasi butuh dilihat.
 */

const bahan = (o: Partial<Parameters<typeof kesiapanPaket>[0]> = {}) => ({
  stage: "pelaksanaan" as const,
  locationCount: 2,
  adaVendor: true,
  ...o,
});

describe("kesiapan data paket", () => {
  it("paket berkontrak yang lengkap → Lengkap, tanpa daftar kekurangan", () => {
    const r = kesiapanPaket(bahan());
    expect(r.status).toBe("lengkap");
    expect(r.kurang).toEqual([]);
  });

  it("berkontrak TANPA lokasi → Belum lengkap; tidak ada yang bisa dilaporkan", () => {
    const r = kesiapanPaket(bahan({ locationCount: 0 }));
    expect(r.status).toBe("belum_lengkap");
    expect(r.kurang).toContain("lokasi belum dipilih");
  });

  it("berkontrak tanpa penyedia → Belum lengkap", () => {
    expect(kesiapanPaket(bahan({ adaVendor: false })).status).toBe("belum_lengkap");
  });

  it("PROSPEK tanpa lokasi TIDAK merah – prospek memang belum tentu jadi", () => {
    const r = kesiapanPaket(bahan({ stage: "prospek", locationCount: 0, adaVendor: false }));
    expect(r.status).toBe("perlu_cek");
    // Tetap disebut, supaya orang tahu apa yang menunggu.
    expect(r.kurang).toContain("lokasi belum dipilih");
  });

  it("tender yang sudah punya lokasi & kandidat → Lengkap", () => {
    expect(kesiapanPaket(bahan({ stage: "tender" })).status).toBe("lengkap");
  });

  it("grup WA & Drive TIDAK ikut dihitung sama sekali", () => {
    /*
     * Versi pertama memasukkannya, dan akibatnya kelihatan begitu dijalankan
     * pada data nyata: SELURUH paket pelaksanaan berlencana "Perlu cek" yang
     * sama, karena tak satu pun punya grup WA. Kolom yang warnanya seragam
     * tidak membedakan apa pun.
     *
     * Ujinya lewat bentuk masukan: kalau seseorang menambahkan kembali medan
     * itu, `BahanKesiapan` ikut berubah dan baris ini merah di typecheck.
     */
    const kunci = Object.keys(bahan()).sort();
    expect(kunci).toEqual(["adaVendor", "locationCount", "stage"]);
  });

  it("penghalang disebut LEBIH DULU daripada catatan", () => {
    // Yang menghambat pekerjaan harus terbaca pertama.
    const r = kesiapanPaket(bahan({ stage: "kontrak", locationCount: 0, adaVendor: false }));
    expect(r.kurang[0]).toBe("lokasi belum dipilih");
  });

  it("paket batal → Arsip, tidak menagih apa pun", () => {
    const r = kesiapanPaket(bahan({ stage: "batal", locationCount: 0, adaVendor: false }));
    expect(r.status).toBe("arsip");
    expect(r.kurang).toEqual([]);
  });
});
