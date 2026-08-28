import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));

const { alokasiBelumTertagih, cashRequirement, totalPortofolio, unbilledWork } = await import(
  "../../src/lib/finance/calc"
);

/**
 * FIXTURE EMAS CALCULATION LAYER KEUANGAN (audit 2026-08-28, C-3).
 *
 * `finance/calc.ts` adalah salah satu modul kalkulasi kanonik, tetapi sampai
 * audit ini TIDAK ADA satu pun berkas uji yang mengimpornya — sementara
 * `progress.ts` punya 10. Uang adalah satu-satunya angka di sistem ini yang
 * salahnya tidak bisa dinegosiasikan, jadi justru itu yang paling butuh pagar.
 *
 * Yang diuji di sini fungsi MURNI-nya. `getLocationsFinance` dan
 * `getContractsBilling` menyentuh DB dan tetap jadi urusan uji integrasi.
 */

const rupiah = (n: number) => BigInt(n);

describe("unbilledWork – terpasang vs tertagih disetarakan pada basis inklusif PPN", () => {
  it("PPN 11%: terpasang pre-PPN dinaikkan dulu sebelum dikurangi tagihan", () => {
    // Rp100.000.000 pre-PPN → Rp111.000.000 inklusif PPN; belum ditagih apa pun.
    expect(unbilledWork(rupiah(100_000_000), 0n, 11)).toBe(rupiah(111_000_000));
  });

  it("PPN 0%: tidak ada penyetaraan, angkanya apa adanya", () => {
    expect(unbilledWork(rupiah(100_000_000), 0n, 0)).toBe(rupiah(100_000_000));
  });

  it("tertagih PERSIS sebesar terpasang inklusif PPN → nol, bukan sisa receh", () => {
    expect(unbilledWork(rupiah(100_000_000), rupiah(111_000_000), 11)).toBe(0n);
  });

  it("tertagih MELEBIHI terpasang → 0, tidak pernah negatif", () => {
    // Kalau ini negatif, dashboard akan menampilkan "belum tertagih −Rp39 jt"
    // yang terbaca seperti utang pemberi kerja kepada pelaksana.
    expect(unbilledWork(rupiah(100_000_000), rupiah(150_000_000), 11)).toBe(0n);
  });

  it("terpasang nol → nol", () => {
    expect(unbilledWork(0n, 0n, 11)).toBe(0n);
  });

  it("PPN dibulatkan SETENGAH-NAIK, bukan dipotong ke bawah", () => {
    // 50 × 11% = 5,5 → 6 (bukan 5). Pemotongan ke bawah membuat unbilled
    // understated di setiap baris, dan selisihnya menumpuk lintas lokasi.
    expect(unbilledWork(rupiah(50), 0n, 11)).toBe(rupiah(56));
  });

  it("terpasang negatif (koreksi/retur) tidak berbalik jadi tagihan", () => {
    expect(unbilledWork(rupiah(-50), 0n, 11)).toBe(0n);
  });

  it("PPN pecahan (12%) tetap dihitung pada basis 1/100", () => {
    expect(unbilledWork(rupiah(100_000_000), 0n, 12)).toBe(rupiah(112_000_000));
  });
});

describe("cashRequirement", () => {
  it("kebutuhan = komitmen jatuh tempo + forecast − kas − pencairan terjadwal", () => {
    expect(
      cashRequirement({
        commitmentsDue: rupiah(100),
        forecastCost: rupiah(50),
        cashAvailable: rupiah(30),
        scheduledDisbursement: rupiah(20),
      }),
    ).toBe(rupiah(100));
  });

  it("kas lebih dari cukup → 0, bukan angka negatif", () => {
    expect(
      cashRequirement({
        commitmentsDue: rupiah(10),
        forecastCost: rupiah(10),
        cashAvailable: rupiah(100),
        scheduledDisbursement: rupiah(0),
      }),
    ).toBe(0n);
  });
});

describe("alokasiBelumTertagih – kontrak ditagih per KONTRAK, ditampilkan per LOKASI", () => {
  const billing = (rows: Record<string, { billed: number; disbursed: number }>) =>
    new Map(
      Object.entries(rows).map(([id, v]) => [
        id,
        { billed: rupiah(v.billed), disbursed: rupiah(v.disbursed) },
      ]),
    );
  const terpasang = (rows: Record<string, number>) =>
    new Map(Object.entries(rows).map(([id, v]) => [id, rupiah(v)]));

  it("kontrak satu lokasi: seluruh sisa jadi milik lokasi itu", () => {
    const hasil = alokasiBelumTertagih(
      [{ contractId: "K1", ppnPercent: 11, locationIds: ["L1"] }],
      billing({ K1: { billed: 0, disbursed: 0 } }),
      terpasang({ L1: 100_000_000 }),
    );
    expect(hasil.perLokasi.get("L1")).toBe(rupiah(111_000_000));
    expect(hasil.totalBilled).toBe(0n);
  });

  it("kontrak multi-lokasi: dibagi PROPORSIONAL nilai terpasang", () => {
    // Terpasang 60 : 40, sisa tagihan 70 → 42 : 28.
    const hasil = alokasiBelumTertagih(
      [{ contractId: "K1", ppnPercent: 0, locationIds: ["L1", "L2"] }],
      billing({ K1: { billed: 30, disbursed: 10 } }),
      terpasang({ L1: 60, L2: 40 }),
    );
    expect(hasil.perLokasi.get("L1")).toBe(rupiah(42));
    expect(hasil.perLokasi.get("L2")).toBe(rupiah(28));
    expect(hasil.totalBilled).toBe(rupiah(30));
    expect(hasil.totalDisbursed).toBe(rupiah(10));
  });

  it("porsi yang tidak habis dibagi DIPOTONG ke bawah – perilaku yang sengaja dipertahankan", () => {
    // Sisa 2.000 dibagi 1.000 : 2.000 → 666,67 dan 1.333,33 → 666 + 1.333 =
    // 1.999. Satu rupiah menguap. Ini didokumentasikan di `alokasiBelumTertagih`
    // dan diuji supaya tidak berubah diam-diam.
    const hasil = alokasiBelumTertagih(
      [{ contractId: "K1", ppnPercent: 0, locationIds: ["L1", "L2"] }],
      billing({ K1: { billed: 1_000, disbursed: 0 } }),
      terpasang({ L1: 1_000, L2: 2_000 }),
    );
    expect(hasil.perLokasi.get("L1")).toBe(rupiah(666));
    expect(hasil.perLokasi.get("L2")).toBe(rupiah(1_333));
    const jumlah = (hasil.perLokasi.get("L1") ?? 0n) + (hasil.perLokasi.get("L2") ?? 0n);
    expect(jumlah).toBe(rupiah(1_999));
  });

  it("belum ada progres sama sekali → tidak membagi nol dengan nol", () => {
    const hasil = alokasiBelumTertagih(
      [{ contractId: "K1", ppnPercent: 11, locationIds: ["L1", "L2"] }],
      billing({ K1: { billed: 0, disbursed: 0 } }),
      terpasang({}),
    );
    expect(hasil.perLokasi.get("L1")).toBe(0n);
    expect(hasil.perLokasi.get("L2")).toBe(0n);
  });

  it("kontrak tanpa baris penagihan dianggap belum ditagih, bukan dilewati", () => {
    const hasil = alokasiBelumTertagih(
      [{ contractId: "K1", ppnPercent: 0, locationIds: ["L1"] }],
      billing({}),
      terpasang({ L1: 500 }),
    );
    expect(hasil.perLokasi.get("L1")).toBe(rupiah(500));
  });

  it("lokasi yang di luar lingkup pembaca tidak menarik porsi", () => {
    // Pemanggil sudah menyaring; yang tersisa hanya L1. Penyebutnya pun ikut
    // menyusut, jadi L1 menanggung sisa kontraknya sendiri – bukan porsi 60%.
    const hasil = alokasiBelumTertagih(
      [{ contractId: "K1", ppnPercent: 0, locationIds: ["L1"] }],
      billing({ K1: { billed: 0, disbursed: 0 } }),
      terpasang({ L1: 60, L2: 40 }),
    );
    expect(hasil.perLokasi.get("L1")).toBe(rupiah(60));
    expect(hasil.perLokasi.has("L2")).toBe(false);
  });

  it("satu lokasi di DUA kontrak: porsinya dijumlahkan, bukan ditimpa", () => {
    const hasil = alokasiBelumTertagih(
      [
        { contractId: "K1", ppnPercent: 0, locationIds: ["L1"] },
        { contractId: "K2", ppnPercent: 0, locationIds: ["L1"] },
      ],
      billing({ K1: { billed: 0, disbursed: 5 }, K2: { billed: 0, disbursed: 7 } }),
      terpasang({ L1: 100 }),
    );
    expect(hasil.perLokasi.get("L1")).toBe(rupiah(200));
    expect(hasil.totalDisbursed).toBe(rupiah(12));
  });
});

describe("totalPortofolio", () => {
  const baris = (n: number, installed: number) => ({
    locationId: `L${n}`,
    budgetTotal: rupiah(n * 1_000),
    expenseApproved: rupiah(n * 100),
    commitmentOpen: rupiah(n * 10),
    availableBudget: rupiah(n * 890),
    invoiceApproved: rupiah(n * 50),
    paymentOut: rupiah(n * 20),
    outstandingPayable: rupiah(n * 30),
    installedValue: rupiah(installed),
  });

  it("menjumlahkan enam angka portofolio lintas lokasi", () => {
    const total = totalPortofolio([baris(1, 700), baris(2, 300)]);
    expect(total.budget).toBe(rupiah(3_000));
    expect(total.expense).toBe(rupiah(300));
    expect(total.commitment).toBe(rupiah(30));
    expect(total.available).toBe(rupiah(2_670));
    expect(total.outstanding).toBe(rupiah(90));
    expect(total.installed).toBe(rupiah(1_000));
  });

  it("tanpa lokasi → nol semua, bukan NaN atau undefined", () => {
    const total = totalPortofolio([]);
    expect(total.budget).toBe(0n);
    expect(total.installed).toBe(0n);
  });
});
