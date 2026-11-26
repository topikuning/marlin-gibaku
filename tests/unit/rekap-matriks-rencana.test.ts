import { describe, expect, it } from "vitest";
import { susunRencana, type MasukanRencana } from "@/lib/daily-report/rekap-matriks/rencana";
import type { SelMarlin } from "@/lib/daily-report/rekap-matriks/jenis";

/**
 * RENCANA IMPOR REKAP HARIAN (DECISIONS 782). Permintaan user 2026-11-25:
 * *"ada dua mode, apend dan overwrite, jika di tanggal yang sama itu tinggal
 * penyesuaian, tapi jika ada tanggal yang tidak sama antara di excel dan di
 * marlin, lalu bentrok jumlahnya, ini juga perlu dimitigasi, yang utama foto
 * eksisting tidak boleh hilang dan harus aman."*
 */
const sel = (tanggal: string, volume: number, o: Partial<SelMarlin> = {}): [string, SelMarlin] => [
  tanggal,
  { rowId: `r-${tanggal}`, reportId: `L-${tanggal}`, status: "dikirim", basis: "aktif", volume, padanan: false, foto: 2, fotoWaktu: [tanggal, tanggal], ...o },
];
const masukan = (o: Partial<MasukanRencana> & { excel: [string, number][]; ada?: [string, SelMarlin][]; kontrak?: number }): MasukanRencana => {
  const ada = Object.fromEntries(o.ada ?? []);
  return {
    mode: o.mode ?? "tambah",
    hariIni: "2026-11-25",
    awalPeriode: "2026-09-18",
    akhirPeriode: o.akhirPeriode === undefined ? "2026-11-20" : o.akhirPeriode,
    baris: o.baris ?? [{ excelRow: 27, nama: "Bedeng", lineageKey: "I#1", sel: o.excel.map(([tanggal, volume]) => ({ tanggal, volume })) }],
    rab: { "I#1": { name: "Buat Bedeng", unit: "m2", volume: o.kontrak ?? 100, jalur: "I · 1" } },
    marlin: { "I#1": ada },
    laporan: {
      ...Object.fromEntries(Object.entries(ada).map(([t, s]) => [t, { reportId: s.reportId, status: s.status, noActivity: false }])),
      ...(o.laporan ?? {}),
    },
    tertutup: o.tertutup ?? {},
    izin: o.izin ?? { ubahTerkirim: true, ubahFinal: false },
    pilihan: o.pilihan ?? {},
  };
};
const ubah = (r: ReturnType<typeof susunRencana>) =>
  r.item[0]!.perubahan.map((p) => [p.tanggal, p.aksi, p.dari, p.ke, p.ditahan ? "ditahan" : "tulis"]);

describe("mode tambah", () => {
  it("tanggal yang sama disesuaikan, tanggal yang hanya di Excel ditambah", () => {
    const r = susunRencana(masukan({ excel: [["2026-10-30", 25], ["2026-11-06", 25]], ada: [sel("2026-10-30", 20)] }));
    expect(ubah(r)).toEqual([
      ["2026-10-30", "ubah", 20, 25, "tulis"],
      ["2026-11-06", "tambah", null, 25, "tulis"],
    ]);
    expect(r.ringkas).toMatchObject({ tambah: 1, ubah: 1, nolkan: 0, laporanBaru: ["2026-11-06"] });
  });

  it("beda tanggal (Excel 30 Okt, MARLIN 28 Okt) = BENTROK: bawaannya dilewati; ikuti Excel menolkan 28 Okt tanpa menghapus baris", () => {
    const m = masukan({ excel: [["2026-10-30", 25]], ada: [sel("2026-10-28", 25)] });
    const lewat = susunRencana(m);
    expect(lewat.item[0]).toMatchObject({ bentrok: ["beda_tanggal"], pilihan: "lewati", perubahan: [], hanyaExcel: ["2026-10-30"], hanyaMarlin: ["2026-10-28"] });
    expect(lewat.item[0]!.pilihanTersedia).toEqual(["lewati", "excel", "jumlahkan"]);
    const excel = susunRencana({ ...m, pilihan: { "I#1": "excel" } });
    expect(ubah(excel)).toEqual([
      ["2026-10-28", "nolkan", 25, 0, "tulis"],
      ["2026-10-30", "tambah", null, 25, "tulis"],
    ]);
    expect(excel.item[0]!.perubahan[0]).toMatchObject({ rowId: "r-2026-10-28", foto: 2 });
    expect(excel.sidik).not.toBe(lewat.sidik);
    const jumlah = susunRencana({ ...m, pilihan: { "I#1": "jumlahkan" } });
    expect(jumlah.item[0]!.totalSesudah).toBe(50);
  });

  it("melebihi volume kontrak: jumlahkan tidak ditawarkan; potong rata sampai kontrak", () => {
    const m = masukan({ excel: [["2026-10-30", 30], ["2026-11-06", 10]], ada: [sel("2026-10-28", 20)], kontrak: 50 });
    const r = susunRencana(m);
    expect(r.item[0]!.bentrok).toEqual(["beda_tanggal", "melebihi_kontrak"]);
    expect(r.item[0]!.pilihanTersedia).toEqual(["lewati", "excel"]);
    const k = susunRencana({ ...masukan({ excel: [["2026-10-30", 40], ["2026-11-06", 20]], kontrak: 50 }), pilihan: { "I#1": "potong" } });
    expect(k.item[0]!.pilihanTersedia).toEqual(["lewati", "potong"]);
    expect(ubah(k)).toEqual([
      ["2026-10-30", "tambah", null, 33.333, "tulis"],
      ["2026-11-06", "tambah", null, 16.667, "tulis"],
    ]);
    expect(k.item[0]!.totalSesudah).toBe(50);
  });
});

describe("selisih pembulatan", () => {
  it("rekap dua desimal sedikit di atas kontrak (0,18 untuk 0,179 – berkas BUYAT 1): bukan bentrok, disamakan ke kontrak dan disebut", () => {
    const r = susunRencana(masukan({ excel: [["2026-11-20", 0.18]], kontrak: 0.179 }));
    expect(r.item[0]!.bentrok).toEqual([]);
    expect(ubah(r)).toEqual([["2026-11-20", "tambah", null, 0.179, "tulis"]]);
    expect(r.item[0]!.catatan.join(" ")).toMatch(/selisih pembulatan 0,001\) – disamakan ke volume kontrak/);
  });

  it("lebih dari batas pembulatan tetap bentrok", () => {
    const r = susunRencana(masukan({ excel: [["2026-11-20", 0.19]], kontrak: 0.179 }));
    expect(r.item[0]!.bentrok).toEqual(["melebihi_kontrak"]);
  });
});

describe("mode timpa", () => {
  it("tanggal yang hanya di MARLIN dalam periode Excel dinolkan; sesudah periode Excel tidak disentuh", () => {
    const r = susunRencana(
      masukan({ mode: "timpa", excel: [["2026-10-30", 25]], ada: [sel("2026-10-28", 10), sel("2026-11-24", 5)] }),
    );
    expect(r.item[0]!.bentrok).toEqual([]);
    expect(ubah(r)).toEqual([
      ["2026-10-28", "nolkan", 10, 0, "tulis"],
      ["2026-10-30", "tambah", null, 25, "tulis"],
    ]);
    expect(r.item[0]!.totalSesudah).toBe(30);
  });
});

describe("yang ditahan", () => {
  it("laporan final tanpa hak super admin ditahan; pindahan sebagian → seluruh item ditahan", () => {
    const r = susunRencana(
      masukan({ mode: "timpa", excel: [["2026-10-30", 25]], ada: [sel("2026-10-28", 25, { status: "final" })] }),
    );
    expect(r.item[0]!.ditahanSemua).toMatch(/tidak terhitung dua kali/);
    expect(r.item[0]!.perubahan.every((p) => p.ditahan)).toBe(true);
    expect(r.ringkas).toMatchObject({ tambah: 0, nolkan: 0 });
    const boleh = susunRencana({
      ...masukan({ mode: "timpa", excel: [["2026-10-30", 25]], ada: [sel("2026-10-28", 25, { status: "final" })] }),
      izin: { ubahTerkirim: true, ubahFinal: true },
    });
    expect(boleh.ringkas).toMatchObject({ tambah: 1, nolkan: 1, ditahan: 0 });
  });

  it("hanya menambah: sel yang ditahan tidak menahan sel lain", () => {
    const r = susunRencana(
      masukan({
        excel: [["2026-10-30", 5], ["2026-11-06", 5]],
        ada: [sel("2026-10-30", 1, { status: "final" })],
      }),
    );
    expect(ubah(r)).toEqual([
      ["2026-10-30", "ubah", 1, 5, "ditahan"],
      ["2026-11-06", "tambah", null, 5, "tulis"],
    ]);
  });

  it("ikut Excel: hari nihil, baris draft adendum, baris hasil pemasangan DITULIS dengan akibatnya disebut; lokasi dicabut tetap ditahan", () => {
    const r = susunRencana(
      masukan({
        excel: [["2026-10-01", 1], ["2026-10-02", 1], ["2026-10-03", 1], ["2026-10-04", 1], ["2026-11-30", 1]],
        // Semua kenaikan (0,5 → 1), supaya aturan "pindahan sebagian ditahan seluruhnya" tidak ikut bermain.
        ada: [sel("2026-10-01", 0.5, { basis: "draft_adendum" }), sel("2026-10-02", 0.5, { padanan: true })],
        laporan: { "2026-10-03": { reportId: "N", status: "dikirim", noActivity: true, sebabNihil: "hujan" } },
        tertutup: { "2026-10-04": "Lokasi dicabut dari kontrak sejak 1 Oktober 2026." },
      }),
    );
    const per = Object.fromEntries(r.item[0]!.perubahan.map((p) => [p.tanggal, p]));
    expect([per["2026-10-01"]!.ditahan, per["2026-10-01"]!.catatan]).toEqual([null, "baris draft adendum dijadikan baris kontrak"]);
    expect([per["2026-10-02"]!.ditahan, per["2026-10-02"]!.catatan]).toEqual([null, "baris hasil pemasangan – pasangannya tidak bisa dilepas lagi"]);
    expect([per["2026-10-03"]!.ditahan, per["2026-10-03"]!.catatan]).toEqual([null, 'pernyataan "tidak ada kegiatan" (hujan) dibatalkan']);
    expect(per["2026-10-04"]!.ditahan).toMatch(/dicabut/);
    expect(r.item[0]!.catatan.join(" ")).toMatch(/30 Nov 2026 belum terjadi/);
  });

  it("laporan terkirim tanpa hak Site Manager ditahan", () => {
    const r = susunRencana({ ...masukan({ excel: [["2026-10-30", 5]], ada: [sel("2026-10-30", 1)] }), izin: { ubahTerkirim: false, ubahFinal: false } });
    expect(r.item[0]!.perubahan[0]!.ditahan).toMatch(/sudah dikirim/);
  });
});

describe("baris Excel", () => {
  it("dua baris menunjuk item yang sama dijumlahkan per tanggal dan disebut; baris tanpa tujuan dilewati", () => {
    const r = susunRencana(
      masukan({
        excel: [],
        baris: [
          { excelRow: 27, nama: "A", lineageKey: "I#1", sel: [{ tanggal: "2026-10-30", volume: 2 }] },
          { excelRow: 40, nama: "A lagi", lineageKey: "I#1", sel: [{ tanggal: "2026-10-30", volume: 3 }] },
          { excelRow: 41, nama: "Tak dikenal", lineageKey: null, sel: [{ tanggal: "2026-10-30", volume: 3 }] },
        ],
      }),
    );
    expect(ubah(r)).toEqual([["2026-10-30", "tambah", null, 5, "tulis"]]);
    expect(r.item[0]!.catatan.join(" ")).toMatch(/Baris Excel 27, 40/);
    expect(r.ringkas.itemDilewati).toBe(1);
  });

  it("sidik tetap sama untuk masukan yang sama", () => {
    const m = masukan({ excel: [["2026-10-30", 25]], ada: [sel("2026-10-30", 20)] });
    expect(susunRencana(m).sidik).toBe(susunRencana(m).sidik);
  });
});

/*
 * PINDAHKAN FOTO KE TANGGAL EXCEL (DECISIONS 783). Jawaban user 2026-11-25:
 * *"ya, pindahkan foto ke tanggal excel jika ditentukan"*.
 */
describe("pindahkan foto ke tanggal Excel – hanya bila diminta", () => {
  it("tujuanFoto: tanggal terdekat; sama dekat → tidak dipindah", async () => {
    const { tujuanFoto } = await import("@/lib/daily-report/rekap-matriks/rencana");
    expect(tujuanFoto("2026-10-26", ["2026-10-25", "2026-11-01"])).toBe("2026-10-25");
    expect(tujuanFoto("2026-10-29", ["2026-10-25", "2026-11-01"])).toBe("2026-11-01");
    expect(tujuanFoto("2026-10-28", ["2026-10-26", "2026-10-30"])).toBeNull();
  });

  it("tanpa centang foto tidak dipindah; dengan centang foto baris yang dinolkan ikut ke tanggal Excel", () => {
    const m = masukan({ mode: "timpa", excel: [["2026-10-30", 25]], ada: [sel("2026-10-28", 25)] });
    expect(susunRencana(m).item[0]!.pindahFoto).toEqual([]);
    const r = susunRencana({ ...m, pindahFoto: true });
    expect(r.item[0]!.pindahFoto).toEqual([{ dari: "2026-10-28", ke: "2026-10-30", jumlah: 2 }]);
    expect(r.ringkas.fotoDipindah).toBe(2);
    expect(r.sidik).not.toBe(susunRencana(m).sidik);
  });

  it("dibagi menurut waktu jepret; yang sama dekat dan foto bukti catatan di luar RAB tetap, disebut sebabnya", () => {
    const r = susunRencana({
      ...masukan({
        mode: "timpa",
        // 28 Okt tepat di tengah 25 dan 31 Okt (3 hari ke masing-masing).
        excel: [["2026-10-25", 10], ["2026-10-31", 10]],
        ada: [sel("2026-10-28", 20, { foto: 4, fotoWaktu: ["2026-10-26", "2026-10-30", "2026-10-28"] })],
      }),
      pindahFoto: true,
    });
    expect(r.item[0]!.pindahFoto).toEqual([
      { dari: "2026-10-28", ke: "2026-10-25", jumlah: 1 },
      { dari: "2026-10-28", ke: "2026-10-31", jumlah: 1 },
    ]);
    expect(r.item[0]!.fotoTetap.map((f) => [f.jumlah, f.sebab])).toEqual([
      [1, "foto bukti catatan di luar RAB, tetap bersama catatannya"],
      [1, "jaraknya sama ke dua tanggal Excel"],
    ]);
  });

  it("item yang ditahan seluruhnya tidak memindah foto", () => {
    const r = susunRencana({
      ...masukan({ mode: "timpa", excel: [["2026-10-30", 25]], ada: [sel("2026-10-28", 25, { status: "final" })] }),
      pindahFoto: true,
    });
    expect([r.item[0]!.ditahanSemua != null, r.item[0]!.pindahFoto]).toEqual([true, []]);
  });
});

describe("DECISIONS 786 – keputusan yang jelas, baris 0 tanpa isi dibuang", () => {
  it("melebihi kontrak saja: bawaannya dipotong rata sampai pas kontrak; Lewati tetap bisa; hasil tiap pilihan disebut", () => {
    const m = masukan({ excel: [["2026-10-30", 40], ["2026-11-06", 20]], kontrak: 50 });
    const r = susunRencana(m);
    expect(r.item[0]).toMatchObject({ bentrok: ["melebihi_kontrak"], pilihan: "potong", totalSesudah: 50 });
    expect(r.item[0]!.hasilPilihan).toEqual({ lewati: 0, potong: 50 });
    expect(r.item[0]!.excelPerTanggal).toEqual([
      { tanggal: "2026-10-30", volume: 40 },
      { tanggal: "2026-11-06", volume: 20 },
    ]);
    const lewat = susunRencana({ ...m, pilihan: { "I#1": "lewati" } });
    expect(lewat.item[0]).toMatchObject({ pilihan: "lewati", perubahan: [], totalSesudah: 0 });
  });

  it("tanggal berbeda (meski juga melebihi kontrak) tetap tidak ditebak: bawaannya dilewati", () => {
    const r = susunRencana(masukan({ excel: [["2026-10-30", 30], ["2026-11-06", 10]], ada: [sel("2026-10-28", 20)], kontrak: 50 }));
    expect(r.item[0]).toMatchObject({ bentrok: ["beda_tanggal", "melebihi_kontrak"], pilihan: "lewati", perubahan: [] });
  });

  it("timpa: baris dinolkan tanpa foto/catatan DIBUANG; yang masih membawa foto, catatan orang, catatan luar RAB tetap dan disebut", () => {
    const r = susunRencana(
      masukan({
        mode: "timpa",
        excel: [["2026-10-30", 25]],
        ada: [
          sel("2026-10-24", 3, { foto: 0, fotoWaktu: [], catatanBaris: "Dari impor rekap harian" }),
          sel("2026-10-25", 4, { foto: 0, fotoWaktu: [] }),
          sel("2026-10-26", 5, { foto: 0, fotoWaktu: [], catatanBaris: "Pagar sisi barat" }),
          sel("2026-10-27", 6, { foto: 1, fotoWaktu: ["2026-10-27"] }),
          sel("2026-10-28", 7, { foto: 0, fotoWaktu: [], luarRab: true }),
        ],
      }),
    );
    expect(ubah(r)).toEqual([
      ["2026-10-24", "hapus", 3, 0, "tulis"],
      ["2026-10-25", "hapus", 4, 0, "tulis"],
      ["2026-10-26", "nolkan", 5, 0, "tulis"],
      ["2026-10-27", "nolkan", 6, 0, "tulis"],
      ["2026-10-28", "nolkan", 7, 0, "tulis"],
      ["2026-10-30", "tambah", null, 25, "tulis"],
    ]);
    expect(r.item[0]!.perubahan.map((p) => p.tetapKarena)).toEqual([
      null,
      null,
      "catatan",
      "1 foto",
      "catatan di luar RAB yang dipadankan",
      null,
    ]);
    expect(r.ringkas).toMatchObject({ hapus: 2, nolkan: 3, tambah: 1 });
    expect(r.item[0]!.totalSesudah).toBe(25);
  });

  it("baris 0 tanpa isi yang DINOLKAN IMPOR SEBELUMNYA: dibuang di mode timpa, dibiarkan di mode tambah", () => {
    const ada: [string, SelMarlin][] = [sel("2026-10-28", 0, { foto: 0, fotoWaktu: [], nolImpor: true }), sel("2026-10-29", 0, { nolImpor: true })];
    const timpa = susunRencana(masukan({ mode: "timpa", excel: [["2026-10-30", 25]], ada }));
    expect(ubah(timpa)).toEqual([
      ["2026-10-28", "hapus", 0, 0, "tulis"],
      ["2026-10-30", "tambah", null, 25, "tulis"],
    ]);
    const tambah = susunRencana(masukan({ excel: [["2026-10-30", 25]], ada }));
    expect(ubah(tambah)).toEqual([["2026-10-30", "tambah", null, 25, "tulis"]]);
  });

  it("DECISIONS 787: baris 0 yang tidak terbukti dinolkan impor (mis. hasil aktivasi adendum) TIDAK dibuang", () => {
    const ada: [string, SelMarlin][] = [sel("2026-10-28", 0, { foto: 0, fotoWaktu: [] })];
    const r = susunRencana(masukan({ mode: "timpa", excel: [["2026-10-30", 25]], ada }));
    expect(ubah(r)).toEqual([["2026-10-30", "tambah", null, 25, "tulis"]]);
  });

  it("DECISIONS 787: item bervolume kontrak 0 – barisnya bahan Pasangkan realisasi, dinolkan tapi tidak pernah dibuang", () => {
    const ada: [string, SelMarlin][] = [
      sel("2026-10-27", 0, { foto: 0, fotoWaktu: [], nolImpor: true }),
      sel("2026-10-28", 4, { foto: 0, fotoWaktu: [] }),
    ];
    const r = susunRencana(masukan({ mode: "timpa", excel: [["2026-10-30", 0]], ada, kontrak: 0 }));
    const p28 = r.item[0]!.perubahan.find((p) => p.tanggal === "2026-10-28")!;
    expect(p28).toMatchObject({ aksi: "nolkan", tetapKarena: expect.stringMatching(/Pasangkan realisasi/) });
    expect(r.item[0]!.perubahan.some((p) => p.aksi === "hapus")).toBe(false);
  });

  it("pindahkan foto: baris yang semua fotonya pindah ikut dibuang; sidik membedakan dibuang dan dinolkan", () => {
    const m = masukan({ mode: "timpa", excel: [["2026-10-30", 25]], ada: [sel("2026-10-28", 10, { foto: 2, fotoWaktu: ["2026-10-29", "2026-10-29"] })] });
    const tetap = susunRencana(m);
    expect(ubah(tetap)[0]).toEqual(["2026-10-28", "nolkan", 10, 0, "tulis"]);
    const pindah = susunRencana({ ...m, pindahFoto: true });
    expect(pindah.item[0]!.pindahFoto).toEqual([{ dari: "2026-10-28", ke: "2026-10-30", jumlah: 2 }]);
    expect(ubah(pindah)[0]).toEqual(["2026-10-28", "hapus", 10, 0, "tulis"]);
    expect(pindah.sidik).not.toBe(tetap.sidik);
  });
});
