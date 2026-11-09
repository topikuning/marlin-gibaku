/*
 * BERKAS KKP PER LOKASI DI GRUP WHATSAPP (DECISIONS 752) – aturan murni.
 *
 * Permintaan user 2026-11-09: *"saat aku minta laporan hari ini ke marlin, di
 * group itu, marlin kirim pdf versi kkp ke group. tiap lokasi per file. atau
 * kalau laporan hari ini nama_lokasi, maka lokasi yang sesuai yang dikirim.
 * kalau laporan mingguan juga format laporan mingguan begitu. tapi untuk rekap
 * harian seminggu kirim format kkp yang rekap laporan harian dalam periode
 * seminggu"*.
 *
 * Yang dijaga di sini:
 * 1. permintaan mana yang menjadi berkas, dan berkas yang mana – terutama
 *    "kirim laporan mingguan" (kata kerja produksi) tetap laporan mingguan,
 *    dan "laporan eksekutif" tetap BUKAN blanko harian;
 * 2. nomor minggu KKP dihitung dari SPMK dan mode minggu kontrak, bukan dari
 *    pekan Senin–Minggu – "minggu lalu" = minggu kontrak sebelumnya;
 * 3. teks pembuka menyebut yang dikirim DAN yang tidak, dengan sebabnya.
 */
import { describe, expect, it } from "vitest";
import {
  BATAS_BERKAS_KKP,
  bagiBatasBerkas,
  jenisBerkasKkp,
  kepalaBerkasKkp,
  mingguKkpDiminta,
  type RencanaBerkas,
} from "@/lib/waha/berkas-kkp";
import { bacaPeriode } from "@/lib/waha/tanya-tanggal";
import type { PeriodeDiminta } from "@/lib/waha/tanya-tanggal";

describe("jenisBerkasKkp – permintaan mana yang menjadi berkas", () => {
  it("di grup: laporan → blanko harian, laporan mingguan → laporan mingguan", () => {
    expect(jenisBerkasKkp("laporan", "laporan hari ini", true)).toBe("harian");
    expect(jenisBerkasKkp("laporan", "laporan hari ini kedung mutih", true)).toBe("harian");
    expect(jenisBerkasKkp("laporan_mingguan", "laporan mingguan", true)).toBe("mingguan");
    expect(jenisBerkasKkp("laporan_mingguan", "rekap mingguan", true)).toBe("mingguan");
  });

  it("rekap harian seminggu → berkas mingguan berisi laporan harian, di kanal mana pun", () => {
    expect(jenisBerkasKkp("rekap_harian", "rekap harian seminggu", true)).toBe("rekap_harian");
    expect(jenisBerkasKkp("rekap_harian", "rekap harian seminggu kedung mutih", false)).toBe("rekap_harian");
  });

  it("chat pribadi: laporan & laporan mingguan tetap dijawab teks seperti sebelumnya", () => {
    expect(jenisBerkasKkp("laporan", "laporan hari ini", false)).toBeNull();
    expect(jenisBerkasKkp("laporan_mingguan", "laporan mingguan", false)).toBeNull();
  });

  it("kata kerja 'kirim' tidak mengubah berkasnya", () => {
    // Parser membaca kalimat ini sebagai `produksi` (kata kerja menang atas
    // kata benda). Di grup ia tetap permintaan berkas yang MARLIN bisa kirim.
    expect(jenisBerkasKkp("produksi", "kirim laporan hari ini", true)).toBe("harian");
    expect(jenisBerkasKkp("produksi", "kirimkan laporan harian kemarin", true)).toBe("harian");
    expect(jenisBerkasKkp("produksi", "kirim laporan mingguan", true)).toBe("mingguan");
    expect(jenisBerkasKkp("produksi", "kirim rekap harian seminggu", true)).toBe("rekap_harian");
  });

  it("artefak lain TIDAK menjadi blanko harian", () => {
    // Keluhan lama (audit 2026-08-28): "buatkan laporan eksekutif" dijawab isi
    // laporan harian. Jangan diulang dalam bentuk berkas.
    expect(jenisBerkasKkp("produksi", "buatkan laporan eksekutif untuk direksi", true)).toBeNull();
    expect(jenisBerkasKkp("produksi", "export excel progress", true)).toBeNull();
    expect(jenisBerkasKkp("produksi", "kirim laporan bulanan", true)).toBeNull();
    expect(jenisBerkasKkp("produksi", "kirim kurva s", true)).toBeNull();
  });

  it("bentuk ringkas yang DIMINTA tetap ringkas, bukan blanko KKP", () => {
    expect(jenisBerkasKkp("laporan", "laporan hari ini versi ringkas", true)).toBeNull();
    expect(jenisBerkasKkp("produksi", "kirim ringkasan laporan harian kedung mutih", true)).toBeNull();
    // "kkp" mengalahkan "ringkasan", sama dengan `bacaBentukDokumen`.
    expect(jenisBerkasKkp("laporan", "ringkasan laporan harian versi kkp", true)).toBe("harian");
  });

  it("niat lain tidak pernah menjadi berkas KKP", () => {
    for (const niat of ["progress", "deviasi", "kendala", "kelengkapan", "laporan_bulanan", "rencana", "bantuan"] as const) {
      expect(jenisBerkasKkp(niat, "laporan", true), niat).toBeNull();
    }
  });
});

const d = (k: string) => new Date(`${k}T00:00:00.000Z`);

describe("mingguKkpDiminta – nomor minggu dari SPMK, bukan pekan kalender", () => {
  const HARI_INI = "2026-11-09"; // Senin
  const baca = (p: PeriodeDiminta) => bacaPeriode(p, HARI_INI);

  it("7 hari sejak SPMK: minggu berjalan dan minggu lalu", () => {
    // SPMK Senin 19 Okt: M1 19–25 Okt, M2 26 Okt–1 Nov, M3 2–8 Nov, M4 9–15 Nov.
    const k = { startDate: d("2026-10-19"), endDate: d("2026-12-13"), weekMode: "tujuh_hari" as const };
    const ini = mingguKkpDiminta(k, { jenis: "hari_ini" }, baca({ jenis: "hari_ini" }), HARI_INI);
    expect(ini).toEqual({ n: 4, mulai: "2026-11-09", akhir: "2026-11-15", berjalan: true });
    const lalu = { jenis: "rentang", satuan: "minggu", mundur: 1 } as const;
    expect(mingguKkpDiminta(k, lalu, baca(lalu), HARI_INI)).toEqual({
      n: 3,
      mulai: "2026-11-02",
      akhir: "2026-11-08",
      berjalan: false,
    });
  });

  it("REGRESI rancangan: 'minggu lalu' pada minggu Jumat–Kamis = minggu kontrak SEBELUMNYA", () => {
    /*
     * Minggu kontrak Jumat–Kamis, hari ini Senin 9 Nov (minggu Jumat 6 – Kamis
     * 12 Nov). "Minggu lalu" versi kalender (2–8 Nov) berakhir Minggu 8 Nov –
     * yang jatuh di minggu kontrak YANG SEDANG BERJALAN. Memetakan lewat
     * tanggal akhir pekan kalender akan mengirim minggu ini lagi.
     */
    const k = { startDate: d("2026-10-23"), endDate: d("2026-12-31"), weekMode: "jumat_kamis" as const };
    const lalu = { jenis: "rentang", satuan: "minggu", mundur: 1 } as const;
    expect(mingguKkpDiminta(k, lalu, baca(lalu), HARI_INI)).toEqual({
      n: 2,
      mulai: "2026-10-30",
      akhir: "2026-11-05",
      berjalan: false,
    });
    const ini = mingguKkpDiminta(k, { jenis: "hari_ini" }, baca({ jenis: "hari_ini" }), HARI_INI);
    expect(ini).toMatchObject({ n: 3, mulai: "2026-11-06", akhir: "2026-11-12", berjalan: true });
  });

  it("tanggal yang disebut → minggu kontrak yang memuat tanggal itu", () => {
    const k = { startDate: d("2026-10-23"), endDate: d("2026-12-31"), weekMode: "jumat_kamis" as const };
    const p = { jenis: "tanggal", hari: 28, bulan: 10, tahun: 2026 } as const;
    expect(mingguKkpDiminta(k, p, baca(p), HARI_INI)).toMatchObject({ n: 1, mulai: "2026-10-23", akhir: "2026-10-29" });
  });

  it("tanpa SPMK, sebelum SPMK, dan sesudah masa kontrak → sebab, bukan nomor karangan", () => {
    const hariIni = { jenis: "hari_ini" } as const;
    expect(
      mingguKkpDiminta({ startDate: null, endDate: null, weekMode: "tujuh_hari" }, hariIni, baca(hariIni), HARI_INI),
    ).toEqual({ sebab: "kontraknya belum punya tanggal SPMK" });

    const belum = mingguKkpDiminta(
      { startDate: d("2026-12-01"), endDate: d("2027-02-01"), weekMode: "tujuh_hari" },
      hariIni,
      baca(hariIni),
      HARI_INI,
    );
    expect("sebab" in belum && belum.sebab).toMatch(/belum mulai.*SPMK 1 Desember 2026/);

    const lewat = mingguKkpDiminta(
      { startDate: d("2026-10-19"), endDate: d("2026-11-01"), weekMode: "tujuh_hari" },
      hariIni,
      baca(hariIni),
      HARI_INI,
    );
    expect("sebab" in lewat && lewat.sebab).toMatch(/masa kontrak hanya 2 minggu/);
  });
});

describe("bagiBatasBerkas – paling banyak BATAS_BERKAS_KKP berkas sekali minta", () => {
  it("lebih dari batas → sisanya disebut, tidak diam-diam dibuang", () => {
    const r: RencanaBerkas[] = Array.from({ length: BATAS_BERKAS_KKP + 2 }, (_, i) => ({
      lokasiId: `l${i}`,
      nama: `Lokasi ${String(i).padStart(2, "0")}`,
      kirim: true,
      keterangan: "",
    }));
    const b = bagiBatasBerkas(r);
    expect(b.dikirim).toHaveLength(BATAS_BERKAS_KKP);
    expect(b.kelebihan.map((x) => x.nama)).toEqual([`Lokasi ${BATAS_BERKAS_KKP}`, `Lokasi ${BATAS_BERKAS_KKP + 1}`]);
  });
});

describe("kepalaBerkasKkp – teks pembuka sebelum berkas", () => {
  const harian = (rencana: RencanaBerkas[], lebih: RencanaBerkas[] = []) => {
    const { dikirim, dilewati } = bagiBatasBerkas(rencana);
    const kelebihan = bagiBatasBerkas(lebih).dikirim;
    return kepalaBerkasKkp({ jenis: "harian", tanggalKey: "2026-11-09", dikirim, dilewati, kelebihan, catatan: null });
  };

  it("harian: yang dikirim, yang masih draft, dan yang belum lapor – semuanya disebut", () => {
    const t = harian([
      { lokasiId: "a", nama: "Kedung Mutih", kirim: true, keterangan: "Final" },
      { lokasiId: "b", nama: "Kedungmalang", kirim: false, sebab: "draft", kelompok: "belum_dikirim" },
      { lokasiId: "c", nama: "Tengket", kirim: false, sebab: "belum ada laporan", kelompok: "belum_ada" },
    ]);
    expect(t).toContain("Laporan harian KKP");
    expect(t).toContain("9 November 2026");
    expect(t).toMatch(/Berkasnya menyusul: Kedung Mutih\./);
    expect(t).toMatch(/belum dikirim pelapor[^\n]*Kedungmalang \(draft\)/i);
    expect(t).toMatch(/Belum ada laporan: Tengket/);
  });

  it("tanpa satu pun berkas: mengatakannya, bukan diam", () => {
    const t = harian([{ lokasiId: "c", nama: "Tengket", kirim: false, sebab: "belum ada laporan", kelompok: "belum_ada" }]);
    expect(t).toMatch(/Belum ada laporan harian yang dikirim pelapor untuk 9 November 2026/);
    expect(t).not.toMatch(/berkas menyusul/);
  });

  it("kelebihan batas disebut namanya dan cara memintanya", () => {
    const t = harian(
      [{ lokasiId: "a", nama: "Kedung Mutih", kirim: true, keterangan: "Final" }],
      [{ lokasiId: "z", nama: "Zona Akhir", kirim: true, keterangan: "Final" }],
    );
    expect(t).toContain("Zona Akhir");
    expect(t).toMatch(new RegExp(`paling banyak ${BATAS_BERKAS_KKP} berkas`));
    expect(t).toMatch(/sebut nama lokasinya/i);
  });

  it("mingguan: satu minggu yang sama → disebut sekali di judul; minggu berjalan dikatakan", () => {
    const t = kepalaBerkasKkp({
      jenis: "mingguan",
      tanggalKey: "2026-11-09",
      dikirim: [
        { lokasiId: "a", nama: "Kedung Mutih", kirim: true, keterangan: "", minggu: { n: 4, mulai: "2026-11-09", akhir: "2026-11-15", berjalan: true } },
        { lokasiId: "b", nama: "Kedungmalang", kirim: true, keterangan: "", minggu: { n: 4, mulai: "2026-11-09", akhir: "2026-11-15", berjalan: true } },
      ],
      dilewati: [{ lokasiId: "c", nama: "Tengket", kirim: false, sebab: "belum punya RAB aktif", kelompok: "lain" }],
      kelebihan: [],
      catatan: null,
    });
    expect(t.split("\n")[0]).toMatch(/Laporan mingguan KKP – minggu ke-4 \(9 – 15 November 2026\)/);
    expect(t).toMatch(/2 berkas menyusul/);
    expect(t).toMatch(/masih berjalan/);
    expect(t).toMatch(/Tidak ada berkas untuk Tengket: belum punya RAB aktif\./);
  });

  it("mingguan: minggu berbeda per lokasi (kabupaten lintas paket) → disebut per lokasi", () => {
    const t = kepalaBerkasKkp({
      jenis: "mingguan",
      tanggalKey: "2026-11-09",
      dikirim: [
        { lokasiId: "a", nama: "A", kirim: true, keterangan: "", minggu: { n: 4, mulai: "2026-11-09", akhir: "2026-11-15", berjalan: true } },
        { lokasiId: "b", nama: "B", kirim: true, keterangan: "", minggu: { n: 7, mulai: "2026-11-06", akhir: "2026-11-12", berjalan: true } },
      ],
      dilewati: [],
      kelebihan: [],
      catatan: null,
    });
    expect(t.split("\n")[0]).toBe("*Laporan mingguan KKP*");
    expect(t).toMatch(/A – minggu ke-4/);
    expect(t).toMatch(/B – minggu ke-7/);
  });

  it("rekap harian: menyebut bahwa hanya laporan terkirim yang dimuat", () => {
    const t = kepalaBerkasKkp({
      jenis: "rekap_harian",
      tanggalKey: "2026-11-09",
      dikirim: [
        { lokasiId: "a", nama: "Kedung Mutih", kirim: true, keterangan: "", minggu: { n: 3, mulai: "2026-11-02", akhir: "2026-11-08", berjalan: false } },
      ],
      dilewati: [],
      kelebihan: [],
      catatan: null,
    });
    expect(t.split("\n")[0]).toMatch(/Rekap laporan harian KKP – minggu ke-3/);
    expect(t).toMatch(/hanya laporan yang sudah dikirim pelapor/i);
  });
});
