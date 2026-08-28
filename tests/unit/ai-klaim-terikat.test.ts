import { describe, expect, it } from "vitest";
import {
  SCHEMA_HINTS,
  hitungKeyakinan,
  kunciFakta,
  validasiKlaimTerikat,
  type BagianJawaban,
  type FaktaResmi,
} from "@/lib/ai-hub/schemas";
import { PETUNJUK_SKEMA } from "@/lib/waha/tanya-niat";

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

  it("HITUNGAN divalidasi juga – tidak ada toleransi untuk 3 vs 4 kendala", () => {
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
    // Sejak DECISIONS 382 alasannya menyebut ANGKA mana yang tak bersumber —
    // perilakunya sama (bagiannya dibuang), keterangannya yang lebih tepat.
    expect(r.dibuang[0]).toContain("angka tanpa sumber");
  });

  it("bagian TANPA angka tetap harus membawa sumber kualitatif", () => {
    const r = jalankan([bagian("Berikut ringkasannya.", [])]);
    expect(r.hidup).toHaveLength(0);

    const bersumber = jalankan([
      { text: "Pelaporan lokasi ini perlu diperiksa.", claims: [], sourceRefIds: ["a:progress"] },
    ]);
    expect(bersumber.hidup).toHaveLength(1);
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

  it("NOL bila bagian kualitatif tidak membawa sumber", () => {
    const r = jalankan([
      bagian("Berikut ringkasannya.", []),
      bagian("Silakan periksa detailnya.", []),
    ]);
    expect(r.hidup).toHaveLength(0);
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

describe("kutipan catatan lapangan: verbatim, dan angkanya boleh (DECISIONS 382)", () => {
  const CHUNK = "narasi:laporan:abc";
  const ASLI =
    "Pengecoran lantai 12 m3 tertunda karena hujan mulai jam 14, tenaga 8 orang dipulangkan.";
  const potongan = new Map([[CHUNK, ASLI]]);

  const jalankanDenganKutipan = (parts: BagianJawaban[]) =>
    validasiKlaimTerikat(parts, FAKTA, REFS, potongan);

  it("kutipan PERSIS lolos, dan angkanya ikut sah", () => {
    /*
     * Penegasan user 2026-08-19: yang dilarang tanpa toleransi adalah MENGARANG
     * angka. Angka yang memang tertulis di catatan lapangan adalah angka
     * MARLIN — boleh disampaikan, asal disalin apa adanya.
     */
    const r = jalankanDenganKutipan([
      {
        text: 'Pelapor menulis: "tertunda karena hujan mulai jam 14".',
        claims: [],
        kutipan: [{ chunkId: CHUNK, teks: "tertunda karena hujan mulai jam 14" }],
      },
    ]);
    expect(r.hidup).toHaveLength(1);
    expect(r.klaimValid).toBe(1);
  });

  it("PARAFRASE ditolak – walau isinya benar", () => {
    /*
     * Begitu model menyusun ulang kalimatnya, tidak ada lagi cara otomatis
     * membedakan angka yang benar-benar ditulis pelapor dari angka yang
     * dikarang model. Pagar ini yang membuat "tidak mengarang angka" bisa
     * diperiksa mesin, bukan sekadar diminta di prompt.
     */
    const r = jalankanDenganKutipan([
      {
        text: "Pekerjaan berhenti sekitar pukul 14 karena hujan.",
        claims: [],
        kutipan: [{ chunkId: CHUNK, teks: "berhenti sekitar pukul 14 karena hujan" }],
      },
    ]);
    expect(r.hidup).toHaveLength(0);
    expect(r.dibuang[0]).toContain("salinan persis");
  });

  it("kutipan ke catatan yang TIDAK ditemukan ditolak", () => {
    const r = jalankanDenganKutipan([
      {
        text: 'Katanya: "hujan deras".',
        claims: [],
        kutipan: [{ chunkId: "narasi:laporan:tidak-ada", teks: "hujan deras" }],
      },
    ]);
    expect(r.hidup).toHaveLength(0);
  });

  it("angka DI LUAR kutipan dan di luar klaim = karangan, bagiannya dibuang", () => {
    /*
     * Inti pagarnya. "12 m3" memang ada di catatan, tapi bagian ini menyebut
     * 20 m3 — angka yang tidak pernah ditulis siapa pun.
     */
    const r = jalankanDenganKutipan([
      {
        text: 'Sekitar 20 m3 belum dicor. Pelapor menulis: "hujan mulai jam 14".',
        claims: [],
        kutipan: [{ chunkId: CHUNK, teks: "hujan mulai jam 14" }],
      },
    ]);
    expect(r.hidup).toHaveLength(0);
    expect(r.dibuang[0]).toContain("angka tanpa sumber");
  });

  it("angka HITUNGAN lapangan kini ikut diperiksa – dulu lolos semua", () => {
    /*
     * Penyaring lama hanya menangkap "%"/"pp", jadi setiap angka lapangan tanpa
     * satuan persen ("8 orang") lolos tanpa pernah diperiksa sama sekali.
     */
    const r = jalankanDenganKutipan([
      { text: "Tenaga 99 orang dipulangkan.", claims: [], kutipan: [] },
    ]);
    expect(r.hidup).toHaveLength(0);
  });

  it("bagian tanpa angka dan tanpa bukti ikut dibuang", () => {
    const r = jalankanDenganKutipan([{ text: "Berikut ringkasannya.", claims: [], kutipan: [] }]);
    expect(r.hidup).toHaveLength(0);
  });

  it("angka dari klaim metrik tetap sah walau ditulis gaya Indonesia", () => {
    // Calculation layer menghasilkan 42.5; balasan menulis "42,5".
    const r = jalankanDenganKutipan([
      {
        text: "Realisasinya 42,5%.",
        claims: [
          { locationId: "lok-a", metric: "realisasi", value: 42.5, periodKey: PERIODE, sourceRefId: "a:progress" },
        ],
        kutipan: [],
      },
    ]);
    expect(r.hidup).toHaveLength(1);
  });
});

describe("angka dibandingkan sebagai NILAI, bukan sebagai teks", () => {
  it("uang berformat Indonesia cocok dengan nilai calculation layer", () => {
    /*
     * Ditemukan lewat uji integrasi yang merah: "Rp 5.000.000.000" adalah
     * bentuk tertulis dari 5000000000. Membandingkan teksnya membuat klaim uang
     * yang BENAR ditolak dan keyakinannya jatuh ke 0 — pagar yang menghukum
     * jawaban yang tepat, yang justru dilarang desain ini.
     */
    const FAKTA_UANG = new Map<string, FaktaResmi>([
      [
        kunciFakta("lok-a", "nilai_kontrak"),
        {
          locationId: "lok-a",
          metric: "nilai_kontrak",
          value: 5_000_000_000,
          periodKey: PERIODE,
          sourceRefId: "a:kontrak",
        },
      ],
    ]);
    const r = validasiKlaimTerikat(
      [
        {
          text: "Nilai kontraknya Rp 5.000.000.000.",
          claims: [
            {
              locationId: "lok-a",
              metric: "nilai_kontrak",
              value: 5_000_000_000,
              periodKey: PERIODE,
              sourceRefId: "a:kontrak",
            },
          ],
        },
      ],
      FAKTA_UANG,
      new Set(["a:kontrak"]),
    );
    expect(r.hidup).toHaveLength(1);
  });

  it("satuan yang menempel angka tidak dihitung sebagai angka", () => {
    // Tanpa lookbehind, "m3" menyumbang angka 3 yang tidak pernah ditulis
    // siapa pun — dan bagian yang sah ikut dibuang.
    const CHUNK = "narasi:laporan:x";
    const r = validasiKlaimTerikat(
      [
        {
          text: 'Pelapor menulis: "cor 12 m3 selesai".',
          claims: [],
          kutipan: [{ chunkId: CHUNK, teks: "cor 12 m3 selesai" }],
        },
      ],
      FAKTA,
      REFS,
      new Map([[CHUNK, "Hari ini cor 12 m3 selesai tanpa kendala."]]),
    );
    expect(r.hidup).toHaveLength(1);
  });
});

/* ── Dua kontrak AI di jalur WhatsApp tidak boleh tertukar ───────────────── */

describe("petunjuk skema membedakan pembaca niat dari penjawab bebas", () => {
  /*
   * CI 2026-08-27: "TypeError: parts is not iterable" di validasiKlaimTerikat.
   * Penyebabnya bukan validator, melainkan stub uji yang mengembalikan objek
   * NIAT untuk setiap panggilan `aiStructured` — termasuk untuk penjawab bebas,
   * yang lalu membaca `answerParts` dari objek yang tidak punya field itu.
   *
   * Stub sekarang memilah berdasarkan ada-tidaknya "answerParts" di
   * schemaHint. Kalau pembeda itu hilang, stub diam-diam kembali menyuapi niat
   * ke jalur jawaban dan kegagalannya menyamar lagi sebagai bug produksi.
   */
  it("hanya skema jawaban yang menyebut answerParts", () => {
    expect(SCHEMA_HINTS.ask).toContain("answerParts");
    expect(PETUNJUK_SKEMA).not.toContain("answerParts");
  });

  it("skema niat memang skema niat, bukan jawaban", () => {
    expect(PETUNJUK_SKEMA).toContain("lokasiDisebut");
    expect(SCHEMA_HINTS.ask).not.toContain("lokasiDisebut");
  });

  it("validator menolak dipanggil tanpa daftar bagian – pemanggil wajib memberi []", () => {
    // Kontraknya array; yang salah adalah pemanggil yang meneruskan undefined
    // di balik `as`. Dikunci supaya perbaikan di tanya-bebas.ts tidak dicabut.
    expect(() => validasiKlaimTerikat(undefined as never, FAKTA, new Set())).toThrow();
    expect(validasiKlaimTerikat([], FAKTA, new Set()).hidup).toEqual([]);
  });
});
