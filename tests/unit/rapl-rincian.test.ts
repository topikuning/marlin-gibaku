import { describe, expect, it } from "vitest";
import { agregasiKebutuhan, type ItemUntukRapl, type RincianItem } from "@/lib/ahsp/rapl-calc";

/**
 * RINCIAN PER ITEM (RAPL-08, DECISIONS 473).
 *
 * Sebelum ini RAPL hanya bisa menurunkan kebutuhan dari analisa AHSP yang
 * satuannya sepadan. Empat gerbang membuang sisanya, dan tidak ada satu pun
 * jalan bagi manusia untuk melewatinya: analisa hanya lahir dari impor berkas
 * master, koreksi padanan cuma menunjuk analisa lain, tidak ada faktor
 * konversi, tidak ada tempat mengetik koefisien sendiri, tidak ada borongan.
 *
 * Akibatnya setiap item ber-satuan `Ls` — mobilisasi, K3, direksi keet — dan
 * setiap pekerjaan tanpa analisa padanan PERMANEN di luar RAPL. Cakupan
 * mentok, margin selamanya berlabel "selisih sementara", dan pertanyaan yang
 * sebenarnya dipakai orang saat menawar tidak bisa dijawab.
 *
 * Yang diuji di sini adalah jalan keluarnya, dan batas-batasnya.
 */

const komponen = (nama: string, koefisien: number, kategori = "bahan", satuan = "kg") => ({
  kategori,
  nama,
  satuan,
  koefisien,
});

const rincian = (over: Partial<RincianItem> = {}): RincianItem => ({
  faktorKonversi: over.faktorKonversi ?? null,
  catatanKonversi: over.catatanKonversi ?? null,
  hargaBorongan: over.hargaBorongan ?? null,
  tambahan: over.tambahan ?? [],
});

const item = (over: Partial<ItemUntukRapl> = {}): ItemUntukRapl => ({
  lineageKey: over.lineageKey ?? "L1",
  code: over.code ?? "1",
  uraian: over.uraian ?? "Pekerjaan uji",
  satuanNorm: over.satuanNorm ?? "m3",
  volume: over.volume === undefined ? 10 : over.volume,
  amount: over.amount ?? 100_000_000n,
  adaUsulan: over.adaUsulan,
  rincian: over.rincian,
  analisa:
    over.analisa === undefined
      ? {
          kode: "A.1",
          uraian: "Analisa uji",
          satuanNorm: "m3",
          komponen: [komponen("Semen", 5)],
        }
      : over.analisa,
});

describe("faktor konversi satuan", () => {
  it("item m2 dengan analisa m3 MASUK hitungan bila faktornya dinyatakan", () => {
    const hasil = agregasiKebutuhan([
      item({
        satuanNorm: "m2",
        volume: 100,
        rincian: rincian({ faktorKonversi: 0.15, catatanKonversi: "tebal dinding 15 cm" }),
      }),
    ]);

    expect(hasil.dilewat).toHaveLength(0);
    expect(hasil.dipakai.baris).toBe(1);
    // 5 (koefisien per m3) × 100 m2 × 0,15 = 75
    expect(hasil.kebutuhan.find((k) => k.nama === "Semen")?.jumlah).toBe(75);
  });

  it("tanpa faktor, item yang satuannya tidak sepadan tetap dibuang", () => {
    const hasil = agregasiKebutuhan([item({ satuanNorm: "m2", volume: 100 })]);
    expect(hasil.dipakai.baris).toBe(0);
    expect(hasil.dilewat[0].alasan).toBe("satuan_tidak_sepadan");
  });

  it("faktor tanpa catatan DIABAIKAN – konversi tanpa alasan adalah tebakan", () => {
    const hasil = agregasiKebutuhan([
      item({
        satuanNorm: "m2",
        volume: 100,
        rincian: rincian({ faktorKonversi: 0.15, catatanKonversi: "   " }),
      }),
    ]);
    expect(hasil.dipakai.baris).toBe(0);
    expect(hasil.dilewat[0].alasan).toBe("satuan_tidak_sepadan");
  });

  it("faktor tidak dikenakan bila satuannya memang sudah sepadan", () => {
    const hasil = agregasiKebutuhan([
      item({ rincian: rincian({ faktorKonversi: 0.15, catatanKonversi: "keliru diisi" }) }),
    ]);
    // 5 × 10 = 50, bukan 7,5: faktor hanya alat penyepadan satuan.
    expect(hasil.kebutuhan.find((k) => k.nama === "Semen")?.jumlah).toBe(50);
  });
});

describe("komponen tambahan", () => {
  it("item TANPA analisa bisa dirinci tangan dan masuk hitungan", () => {
    const hasil = agregasiKebutuhan([
      item({
        code: "MOB",
        uraian: "Mobilisasi dan demobilisasi",
        satuanNorm: "ls",
        volume: 1,
        analisa: null,
        rincian: rincian({
          tambahan: [
            komponen("Sewa truk", 2, "alat", "unit"),
            komponen("Operator", 4, "upah", "OH"),
          ],
        }),
      }),
    ]);

    expect(hasil.dilewat).toHaveLength(0);
    expect(hasil.dipakai.baris).toBe(1);
    expect(hasil.kebutuhan.find((k) => k.nama === "Sewa truk")?.jumlah).toBe(2);
    expect(hasil.kebutuhan.find((k) => k.nama === "Operator")?.jumlah).toBe(4);
  });

  it("tambahan melengkapi analisa, tidak menggantikannya", () => {
    const hasil = agregasiKebutuhan([
      item({ rincian: rincian({ tambahan: [komponen("Additive", 0.5)] }) }),
    ]);
    expect(hasil.kebutuhan.find((k) => k.nama === "Semen")?.jumlah).toBe(50);
    expect(hasil.kebutuhan.find((k) => k.nama === "Additive")?.jumlah).toBe(5);
  });

  it("koefisien tambahan PER SATUAN ITEM – faktor konversi tidak dikenakan padanya", () => {
    const hasil = agregasiKebutuhan([
      item({
        satuanNorm: "m2",
        volume: 100,
        rincian: rincian({
          faktorKonversi: 0.15,
          catatanKonversi: "tebal 15 cm",
          tambahan: [komponen("Angkut", 1, "alat", "rit")],
        }),
      }),
    ]);
    // Analisa ikut faktor: 5 × 100 × 0,15 = 75. Tambahan tidak: 1 × 100 = 100.
    expect(hasil.kebutuhan.find((k) => k.nama === "Semen")?.jumlah).toBe(75);
    expect(hasil.kebutuhan.find((k) => k.nama === "Angkut")?.jumlah).toBe(100);
  });

  it("item tanpa volume tetap tidak bisa dirinci – tidak ada yang bisa dikalikan", () => {
    const hasil = agregasiKebutuhan([
      item({ volume: null, analisa: null, rincian: rincian({ tambahan: [komponen("X", 1)] }) }),
    ]);
    expect(hasil.dipakai.baris).toBe(0);
    expect(hasil.dilewat[0].alasan).toBe("volume_kosong");
  });
});

describe("borongan", () => {
  it("item borongan masuk hitungan TANPA menurunkan kebutuhan sumber daya", () => {
    const hasil = agregasiKebutuhan([
      item({
        code: "K3",
        uraian: "Penerapan SMKK",
        satuanNorm: "ls",
        volume: 1,
        analisa: null,
        rincian: rincian({ hargaBorongan: 45_000_000n, catatanBorongan: "penawaran subkon" } as Partial<RincianItem>),
      }),
    ]);
    expect(hasil.dilewat).toHaveLength(0);
    expect(hasil.dipakai.baris).toBe(1);
    // Borongan tidak melahirkan kebutuhan bahan/upah/alat: memang tidak diketahui.
    expect(hasil.kebutuhan).toHaveLength(0);
  });

  it("borongan mengalahkan analisa – satu item satu cara hitung", () => {
    const hasil = agregasiKebutuhan([
      item({ rincian: rincian({ hargaBorongan: 10_000_000n }) }),
    ]);
    expect(hasil.kebutuhan).toHaveLength(0);
    expect(hasil.dipakai.baris).toBe(1);
  });
});

describe("cakupan yang dilaporkan", () => {
  it("nilai item yang dirinci tangan ikut dihitung sebagai masuk hitungan", () => {
    const hasil = agregasiKebutuhan([
      item({ lineageKey: "A", amount: 100_000_000n }),
      item({
        lineageKey: "B",
        code: "MOB",
        satuanNorm: "ls",
        volume: 1,
        amount: 50_000_000n,
        analisa: null,
        rincian: rincian({ tambahan: [komponen("Sewa truk", 1, "alat", "unit")] }),
      }),
    ]);
    expect(hasil.dipakai.nilai).toBe(150_000_000n);
    expect(hasil.dipakai.baris).toBe(2);
  });
});

describe("biaya dan margin per item", () => {
  const harga = [
    { kategori: "bahan", nama: "Semen", satuan: "kg", harga: 2_000n },
    { kategori: "alat", nama: "Sewa truk", satuan: "unit", harga: 1_500_000n },
    { kategori: "upah", nama: "Operator", satuan: "OH", harga: 150_000n },
  ];

  it("menjawab pertanyaan yang sebenarnya dipakai: item mana yang rugi", async () => {
    const { hitungItemRapl } = await import("@/lib/ahsp/rapl-calc");
    const hasil = hitungItemRapl(
      [
        // 5 kg/m3 × 10 m3 = 50 kg × Rp2.000 = Rp100.000 → untung
        item({ lineageKey: "UNTUNG", amount: 100_000_000n }),
        // sama, tapi nilai RAB-nya cuma Rp60.000 → RUGI
        item({ lineageKey: "RUGI", amount: 60_000n }),
      ],
      harga,
    );

    const untung = hasil.find((h) => h.lineageKey === "UNTUNG")!;
    expect(untung.biaya).toBe(100_000n);
    expect(untung.lengkap).toBe(true);
    expect(untung.margin).toBe(99_900_000n);

    const rugi = hasil.find((h) => h.lineageKey === "RUGI")!;
    expect(rugi.margin).toBe(-40_000n);
    expect(rugi.margin! < 0n).toBe(true);
  });

  it("margin null selama ada komponen yang belum berharga – separuh biaya bukan margin", async () => {
    const { hitungItemRapl } = await import("@/lib/ahsp/rapl-calc");
    const [it] = hitungItemRapl(
      [item({ rincian: rincian({ tambahan: [komponen("Bahan tanpa harga", 1)] }) })],
      harga,
    );
    expect(it.komponenBelumBerharga).toBe(1);
    expect(it.lengkap).toBe(false);
    expect(it.margin).toBeNull();
    // Biaya yang SUDAH diketahui tetap dilaporkan apa adanya.
    expect(it.biaya).toBe(100_000n);
  });

  it("item borongan selalu lengkap – tidak ada komponen yang bisa kosong", async () => {
    const { hitungItemRapl } = await import("@/lib/ahsp/rapl-calc");
    const [it] = hitungItemRapl(
      [
        item({
          code: "MOB",
          satuanNorm: "ls",
          volume: 1,
          amount: 50_000_000n,
          analisa: null,
          rincian: rincian({ hargaBorongan: 45_000_000n }),
        }),
      ],
      harga,
    );
    expect(it.cara).toBe("borongan");
    expect(it.lengkap).toBe(true);
    expect(it.biaya).toBe(45_000_000n);
    expect(it.margin).toBe(5_000_000n);
  });

  it("menyebut asal tiap komponen: dari AHSP atau ditambahkan orang", async () => {
    const { hitungItemRapl } = await import("@/lib/ahsp/rapl-calc");
    const [it] = hitungItemRapl(
      [item({ rincian: rincian({ tambahan: [komponen("Sewa truk", 1, "alat", "unit")] }) })],
      harga,
    );
    expect(it.cara).toBe("campuran");
    expect(it.komponen.find((k) => k.nama === "Semen")?.dariAhsp).toBe(true);
    expect(it.komponen.find((k) => k.nama === "Sewa truk")?.dariAhsp).toBe(false);
  });

  it("item yang tidak bisa dihitung membawa sebabnya, bukan biaya nol yang menipu", async () => {
    const { hitungItemRapl } = await import("@/lib/ahsp/rapl-calc");
    const [it] = hitungItemRapl([item({ analisa: null, amount: 80_000_000n })], harga);
    expect(it.cara).toBe("belum");
    expect(it.alasanLewat).toBe("belum_disetujui");
    expect(it.margin).toBeNull();
    expect(it.lengkap).toBe(false);
  });

  it("agregat sumber daya konsisten dengan penjumlahan per item", async () => {
    const { hitungItemRapl } = await import("@/lib/ahsp/rapl-calc");
    const daftar = [
      item({ lineageKey: "A" }),
      item({ lineageKey: "B", volume: 4 }),
    ];
    const perItem = hitungItemRapl(daftar, harga);
    const agregat = agregasiKebutuhan(daftar);

    const semenPerItem = perItem
      .flatMap((i) => i.komponen)
      .filter((k) => k.nama === "Semen")
      .reduce((a, k) => a + k.jumlah, 0);
    expect(semenPerItem).toBe(agregat.kebutuhan.find((k) => k.nama === "Semen")!.jumlah);
  });
});
