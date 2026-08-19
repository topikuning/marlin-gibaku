import { describe, expect, it } from "vitest";
import {
  hitungKeyakinan,
  kunciFakta,
  validasiKlaimTerikat,
  type BagianJawaban,
  type FaktaResmi,
} from "@/lib/ai-hub/schemas";

/**
 * VALIDASI KLAIM TERIKAT + keyakinan deterministik (DECISIONS 378).
 *
 * Yang dijaga bukan "ada validasi", melainkan bahwa KELIMA pengikatnya benar-
 * benar mengikat. Mengendurkan satu saja membuat sisanya nyaris tak berarti.
 */

const PERIODE = "2026-08-19";

const FAKTA = new Map<string, FaktaResmi>([
  [
    kunciFakta("lok-a", "realisasi"),
    { locationId: "lok-a", metric: "realisasi", value: 42, periodKey: PERIODE, sourceRefId: "a:progress" },
  ],
  [
    kunciFakta("lok-a", "rencana"),
    { locationId: "lok-a", metric: "rencana", value: 55, periodKey: PERIODE, sourceRefId: "a:progress" },
  ],
  [
    kunciFakta("lok-a", "kendala_terbuka"),
    { locationId: "lok-a", metric: "kendala_terbuka", value: 3, periodKey: PERIODE, sourceRefId: "a:kendala" },
  ],
  [
    kunciFakta("lok-b", "realisasi"),
    { locationId: "lok-b", metric: "realisasi", value: 88, periodKey: PERIODE, sourceRefId: "b:progress" },
  ],
]);

const REFS = new Set(["a:progress", "a:kendala", "b:progress"]);

const bagian = (text: string, claims: BagianJawaban["claims"]): BagianJawaban => ({ text, claims });

const jalankan = (parts: BagianJawaban[]) => validasiKlaimTerikat(parts, FAKTA, REFS);

describe("klaim yang benar lolos", () => {
  it("lokasi + metrik + nilai + periode + sumber semuanya cocok", () => {
    const r = jalankan([
      bagian("Realisasi Kedung Mutih 42%.", [
        { locationId: "lok-a", metric: "realisasi", value: 42, periodKey: PERIODE, sourceRefId: "a:progress" },
      ]),
    ]);
    expect(r.hidup).toHaveLength(1);
    expect(r.klaimValid).toBe(1);
  });

  it("selisih kecil pada persen ditoleransi (pembulatan tampilan)", () => {
    const r = jalankan([
      bagian("Realisasi sekitar 42,5%.", [
        { locationId: "lok-a", metric: "realisasi", value: 42.5, periodKey: PERIODE, sourceRefId: "a:progress" },
      ]),
    ]);
    expect(r.hidup).toHaveLength(1);
  });

  it("HITUNGAN divalidasi juga — tidak ada toleransi untuk 3 vs 4 kendala", () => {
    /*
     * Jalur lama tidak bisa memeriksa ini sama sekali: ia mengambil angka lewat
     * regex "%"/"pp", jadi setiap klaim hitungan lolos tanpa diperiksa.
     */
    const benar = jalankan([
      bagian("Ada 3 kendala terbuka.", [
        { locationId: "lok-a", metric: "kendala_terbuka", value: 3, periodKey: PERIODE, sourceRefId: "a:kendala" },
      ]),
    ]);
    expect(benar.hidup).toHaveLength(1);

    const salah = jalankan([
      bagian("Ada 4 kendala terbuka.", [
        { locationId: "lok-a", metric: "kendala_terbuka", value: 4, periodKey: PERIODE, sourceRefId: "a:kendala" },
      ]),
    ]);
    expect(salah.hidup).toHaveLength(0);
  });
});

describe("kelima pengikat benar-benar mengikat", () => {
  it("LOKASI: angka lokasi lain tidak memvalidasi klaim lokasi ini", () => {
    /*
     * Kelemahan paling berbahaya di jalur lama: angka dicocokkan ke kolam
     * SELURUH lokasi. "Realisasi lok-a 88%" lolos hanya karena lok-b memang
     * 88% — jawaban yang benar untuk lokasi yang salah, dan tidak ada yang
     * bisa membedakannya.
     */
    const r = jalankan([
      bagian("Realisasi 88%.", [
        { locationId: "lok-a", metric: "realisasi", value: 88, periodKey: PERIODE, sourceRefId: "a:progress" },
      ]),
    ]);
    expect(r.hidup).toHaveLength(0);
  });

  it("METRIK: rencana tidak memvalidasi klaim realisasi", () => {
    const r = jalankan([
      bagian("Realisasi 55%.", [
        { locationId: "lok-a", metric: "realisasi", value: 55, periodKey: PERIODE, sourceRefId: "a:progress" },
      ]),
    ]);
    expect(r.hidup).toHaveLength(0);
  });

  it("PERIODE: angka hari ini tidak memvalidasi klaim tentang tanggal lain", () => {
    const r = jalankan([
      bagian("Realisasi 42% pada 1 Agustus.", [
        { locationId: "lok-a", metric: "realisasi", value: 42, periodKey: "2026-08-01", sourceRefId: "a:progress" },
      ]),
    ]);
    expect(r.hidup).toHaveLength(0);
    expect(r.dibuang[0]).toContain("periode");
  });

  it("SUMBER: sourceRef yang bukan sumber angka itu ditolak", () => {
    // "a:kendala" ada di daftar sumber yang sah, tapi ia bukan sumber angka
    // realisasi. Menerimanya berarti menyodorkan tautan yang tidak memuat
    // angka yang diklaim — pembaca yang memeriksanya justru tersesat.
    const r = jalankan([
      bagian("Realisasi 42%.", [
        { locationId: "lok-a", metric: "realisasi", value: 42, periodKey: PERIODE, sourceRefId: "a:kendala" },
      ]),
    ]);
    expect(r.hidup).toHaveLength(0);
    expect(r.dibuang[0]).toContain("sumber");
  });

  it("SUMBER: sourceRef di luar run ditolak", () => {
    const r = jalankan([
      bagian("Realisasi 42%.", [
        { locationId: "lok-a", metric: "realisasi", value: 42, periodKey: PERIODE, sourceRefId: "x:palsu" },
      ]),
    ]);
    expect(r.hidup).toHaveLength(0);
  });
});

describe("angka tanpa klaim", () => {
  it("bagian yang MENYEBUT ANGKA tanpa claims DIBUANG", () => {
    /*
     * Tanpa aturan ini seluruh validasi jadi hiasan: model cukup berhenti
     * mengisi `claims` dan angka apa pun lolos.
     */
    const r = jalankan([bagian("Realisasi Kedung Mutih 42%.", [])]);
    expect(r.hidup).toHaveLength(0);
    expect(r.dibuang[0]).toContain("tanpa klaim");
  });

  it("bagian TANPA angka boleh lewat tanpa claims", () => {
    // Kalimat penghubung bukan klaim; menuntut sitasi untuknya hanya
    // memaksa model mengarang rujukan.
    const r = jalankan([bagian("Berikut ringkasannya.", [])]);
    expect(r.hidup).toHaveLength(1);
  });
});

describe("keyakinan deterministik", () => {
  it("NOL bila tidak ada satu pun klaim valid", () => {
    // Syarat keras brief butir 26. Jawaban tanpa sitasi sah tidak boleh
    // tampil "80% yakin" — apalagi angka itu berasal dari model yang sama
    // yang sedang kita ragukan.
    const r = jalankan([bagian("Realisasi 88%.", [
      { locationId: "lok-a", metric: "realisasi", value: 88, periodKey: PERIODE, sourceRefId: "a:progress" },
    ])]);
    expect(hitungKeyakinan(r, 1)).toBe(0);
  });

  it("NOL walau semua bagian SELAMAT, bila tak satu pun membawa klaim", () => {
    /*
     * Kasus yang justru dituju butir 26, dan yang paling mudah terlewat:
     * bagian tanpa angka memang boleh lewat tanpa sitasi, jadi ia SELAMAT.
     * Menghitung keyakinan dari porsi bagian yang selamat saja akan
     * menghasilkan 100% untuk jawaban yang tidak memuat satu pun angka
     * terverifikasi — persis rasa percaya diri tanpa dasar yang dilarang.
     *
     * Uji ini ditambahkan setelah uji gigi memperlihatkan pagar `klaimValid
     * === 0` bisa dilepas tanpa satu pun uji memerah.
     */
    const r = jalankan([
      bagian("Berikut ringkasannya.", []),
      bagian("Silakan periksa detailnya.", []),
    ]);
    expect(r.hidup).toHaveLength(2);
    expect(r.klaimValid).toBe(0);
    expect(hitungKeyakinan(r, 2)).toBe(0);
  });

  it("NOL juga untuk jawaban tanpa bagian sama sekali", () => {
    const r = jalankan([]);
    expect(hitungKeyakinan(r, 0)).toBe(0);
  });

  it("porsi bagian yang selamat, bukan angka yang diakui model", () => {
    const r = jalankan([
      bagian("Realisasi 42%.", [
        { locationId: "lok-a", metric: "realisasi", value: 42, periodKey: PERIODE, sourceRefId: "a:progress" },
      ]),
      bagian("Rencana 99%.", [
        { locationId: "lok-a", metric: "rencana", value: 99, periodKey: PERIODE, sourceRefId: "a:progress" },
      ]),
    ]);
    expect(r.hidup).toHaveLength(1);
    expect(hitungKeyakinan(r, 2)).toBe(50);
  });
});
