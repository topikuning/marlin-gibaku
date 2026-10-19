import { describe, expect, it } from "vitest";
import { cocokkanLokasi, kunciKontrak, kunciWilayah, type BarisCocok, type LokasiCocok } from "@/lib/kawal/cocok";

/**
 * PENCOCOKAN LOKASI KAWAL ↔ MARLIN (DECISIONS 690). Otomatis hanya bila
 * buktinya tunggal; nama kembar tanpa kontrak/kabupaten yang cocok masuk
 * antrean; tanpa petunjuk dibuang.
 */

function baris(o: Partial<BarisCocok> & { kawalId: number }): BarisCocok {
  return {
    namaKnmp: `KNMP Lain ${o.kawalId}`,
    desa: null,
    kabupaten: "Kabupaten Lain",
    noKontrak: null,
    latitude: null,
    longitude: null,
    ...o,
  };
}

function lokasi(o: Partial<LokasiCocok> & { id: string }): LokasiCocok {
  return {
    name: o.id,
    village: o.id,
    regency: "Contoh",
    packageId: "P1",
    contractNumber: "KTR/01/2026",
    gpsLat: null,
    gpsLng: null,
    ...o,
  };
}

describe("kunci pembanding", () => {
  it("awalan desa/kabupaten dan frasa KNMP dibuang, Kota dipertahankan", () => {
    expect(kunciWilayah("KNMP Desa Pasir-Putih")).toBe("pasir putih");
    expect(kunciWilayah("Kampung Nelayan Merah Putih Bajo")).toBe("bajo");
    expect(kunciWilayah("Kab. Bima")).toBe("bima");
    expect(kunciWilayah("Kota Bima")).toBe("kota bima");
    expect(kunciWilayah("Tanah Merah")).toBe("tanah merah");
    expect(kunciKontrak(" ktr / 01 / 2026 ")).toBe("KTR/01/2026");
  });
});

describe("pencocokan lokasi Kawal", () => {
  const L = [
    lokasi({ id: "bajo-a", village: "Bajo", regency: "Kabupaten Contoh", packageId: "P1", contractNumber: "KTR/01" }),
    lokasi({ id: "ketapang", village: "Ketapang", regency: "Contoh", packageId: "P1", contractNumber: "KTR/01" }),
    lokasi({ id: "bajo-b", village: "Bajo", regency: "Lainan", packageId: "P2", contractNumber: "KTR/02" }),
    lokasi({ id: "tunggal", village: "Sumber", regency: "Contoh", packageId: "P3", contractNumber: "KTR/03" }),
  ];

  it("kontrak + desa + kabupaten tunggal → otomatis", () => {
    const [k] = cocokkanLokasi(
      [baris({ kawalId: 1, desa: "Desa Bajo", kabupaten: "Kab. Contoh", noKontrak: "ktr/01" })],
      L,
      [],
    );
    expect(k).toEqual({ kawalId: 1, jenis: "berpasangan", locationId: "bajo-a", baru: { basis: "kontrak_desa" } });
  });

  it("nama kembar TANPA kontrak: kabupaten yang menentukan; tanpa kabupaten cocok → antrean", () => {
    const [denganKab, tanpaKab] = cocokkanLokasi(
      [
        baris({ kawalId: 2, desa: "Bajo", kabupaten: "Lainan" }),
        baris({ kawalId: 3, desa: "Bajo", kabupaten: "Kabupaten Entah" }),
      ],
      L,
      [],
    );
    expect(denganKab).toMatchObject({ jenis: "berpasangan", locationId: "bajo-b", baru: { basis: "desa_kabupaten" } });
    // bajo-b sudah direbut baris Lainan; yang tersisa untuk ditawarkan hanya bajo-a.
    expect(tanpaKab.jenis).toBe("antre");
    if (tanpaKab.jenis === "antre") expect(tanpaKab.kandidat.map((k) => k.locationId)).toEqual(["bajo-a"]);
  });

  it("paket satu lokasi: kontrak + kabupaten cukup, walau nama desanya ditulis lain", () => {
    const [k] = cocokkanLokasi(
      [
        baris({
          kawalId: 4,
          namaKnmp: "KNMP Sumber Makmur",
          desa: "Sumbermakmur",
          kabupaten: "Contoh",
          noKontrak: "KTR/03",
        }),
      ],
      L,
      [],
    );
    expect(k).toMatchObject({ jenis: "berpasangan", locationId: "tunggal", baru: { basis: "kontrak_satu_lokasi" } });
  });

  it("paket berisi beberapa lokasi dan desanya tidak cocok → antrean dengan semua lokasi paket", () => {
    const [k] = cocokkanLokasi([baris({ kawalId: 5, desa: "Entah", kabupaten: "Contoh", noKontrak: "KTR/01" })], L, []);
    expect(k.jenis).toBe("antre");
    if (k.jenis === "antre") expect(k.kandidat.map((c) => c.locationId).sort()).toEqual(["bajo-a", "ketapang"]);
  });

  it("tanpa petunjuk apa pun → dibuang", () => {
    const [k] = cocokkanLokasi([baris({ kawalId: 6, desa: "Jauh", noKontrak: "KTR/99" })], L, []);
    expect(k).toEqual({ kawalId: 6, jenis: "buang" });
  });

  it("dua baris Kawal berebut satu lokasi → keduanya antre, tidak bergantung urutan", () => {
    const rebutan = [
      baris({ kawalId: 7, desa: "Ketapang", kabupaten: "Contoh" }),
      baris({ kawalId: 8, namaKnmp: "KNMP Ketapang", kabupaten: "Contoh" }),
    ];
    const maju = cocokkanLokasi(rebutan, L, []);
    const mundur = cocokkanLokasi([...rebutan].reverse(), L, []);
    expect(maju.map((k) => k.jenis)).toEqual(["antre", "antre"]);
    expect(mundur.map((k) => k.jenis)).toEqual(["antre", "antre"]);
  });

  it("pasangan yang sudah ada dihormati; lokasi yang sudah dipegang tidak ditawarkan lagi", () => {
    const hasil = cocokkanLokasi(
      [
        baris({ kawalId: 9, desa: "Ketapang", kabupaten: "Contoh" }),
        baris({ kawalId: 10, desa: "Ketapang", kabupaten: "Contoh" }),
        baris({ kawalId: 11, desa: "Bajo", kabupaten: "Contoh" }),
      ],
      L,
      [
        { kawalId: 9, locationId: "ketapang", status: "dikonfirmasi" },
        { kawalId: 11, locationId: null, status: "bukan_marlin" },
      ],
    );
    expect(hasil[0]).toEqual({ kawalId: 9, jenis: "berpasangan", locationId: "ketapang", baru: null });
    // Ketapang sudah dipegang id 9 → id 10 tidak punya kandidat lagi.
    expect(hasil[1]).toEqual({ kawalId: 10, jenis: "buang" });
    expect(hasil[2]).toEqual({ kawalId: 11, jenis: "bukan_marlin" });
  });

  it("tarikan kedua atas data yang sama memberi hasil yang sama (pasangan otomatis ikut dihitung)", () => {
    // bajo-a direbut baris berkontrak; Bajo-Seberang harus SEJAK tarikan
    // pertama hanya ditawari bajo-b, bukan ditawari bajo-a dulu lalu besoknya
    // daftarnya berubah sendiri.
    const B = [
      baris({ kawalId: 20, desa: "Bajo", kabupaten: "Contoh", noKontrak: "KTR/01" }),
      baris({ kawalId: 21, desa: "Bajo", kabupaten: "Seberang", noKontrak: "KTR/77" }),
      baris({ kawalId: 22, desa: "Ketapang", kabupaten: "Entah" }),
    ];
    const pertama = cocokkanLokasi(B, L, []);
    const petaBaru = pertama.flatMap((k) =>
      k.jenis === "berpasangan" ? [{ kawalId: k.kawalId, locationId: k.locationId, status: "otomatis" }] : [],
    );
    const kedua = cocokkanLokasi(B, L, petaBaru);
    const ringkas = (ks: typeof pertama) =>
      ks.map((k) => `${k.kawalId}:${k.jenis}:${k.jenis === "antre" ? k.kandidat.map((c) => c.locationId) : ""}`);
    expect(ringkas(pertama)).toEqual(ringkas(kedua));
    expect(pertama.map((k) => k.jenis)).toEqual(["berpasangan", "antre", "antre"]);
    const seberang = pertama[1];
    if (seberang.jenis === "antre") expect(seberang.kandidat.map((c) => c.locationId)).toEqual(["bajo-b"]);
  });

  it("kandidat antrean membawa jarak bila kedua titik ada", () => {
    const [k] = cocokkanLokasi(
      [baris({ kawalId: 12, desa: "Bajo", kabupaten: "Entah", latitude: -6.9, longitude: 110.4 })],
      [
        lokasi({ id: "dekat", village: "Bajo", gpsLat: -6.901, gpsLng: 110.401 }),
        lokasi({ id: "jauh", village: "Bajo", packageId: "P2", gpsLat: -7.9, gpsLng: 112.4 }),
      ],
      [],
    );
    expect(k.jenis).toBe("antre");
    if (k.jenis !== "antre") return;
    expect(k.kandidat[0].locationId).toBe("dekat");
    expect(k.kandidat[0].jarakKm).toBeLessThan(0.2);
    expect(k.kandidat[1].jarakKm).toBeGreaterThan(200);
  });
});
