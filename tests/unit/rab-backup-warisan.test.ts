/*
 * SUMBER BACKUP VOLUME & ANALISA LINTAS REVISI (DECISIONS baru 2026-10-07).
 *
 * Permintaan user: *"rab non aktif (rab awal) yang sudah di cco … ke depannya
 * tetap harus ada sumber informasi backup volumenya, kemudian yang sudah di cco
 * juga ketahuan backup volumenya"*. Yang dijaga:
 *   1. backup revisi lama BOLEH dipakai hanya bila volumenya sama persis –
 *      backup lama menghitung volume yang lain;
 *   2. item yang volumenya berubah / baru disebut "belum", dengan sebabnya;
 *   3. isian MARLIN mengalahkan semuanya, berkas tertaut mengalahkan warisan;
 *   4. warisan menunjuk ke ASAL-nya, bukan ke revisi perantara;
 *   5. analisa diwarisi bila HARGA SATUAN sama, bukan volume;
 *   6. hasil baris backup isian = jumlah × P × L × T (yang kosong dilewati),
 *      pengurang bertanda minus, selisih terhadap RAB disebut.
 */
import { describe, expect, it } from "vitest";
import { hasilBarisBackup, totalBackupIsian } from "@/lib/ahsp/rapl-calc";
import { selesaikanAnalisa, selesaikanBackup, type RevisiBackup } from "@/lib/rab/rincian/warisan";

const it_ = (volume: string | null, berkas: string | null = null, isian = false) => ({ volume, berkas, isian });

function rev(id: string, no: number, items: Record<string, ReturnType<typeof it_>>, punyaRincian = true): RevisiBackup {
  return { id, revisionNo: no, punyaRincian, items: new Map(Object.entries(items)) };
}

describe("selesaikanBackup", () => {
  const r1 = rev("r1", 1, {
    A: it_("10.000", "tertaut"),
    B: it_("5.000", "tertaut"),
    C: it_("7.000", "angka_langsung"),
    D: it_("2.000", "tertaut"),
  });
  // CCO lewat editor: tanpa berkas, tanpa rincian.
  const r2 = rev(
    "r2",
    2,
    { A: it_("10"), B: it_("6.500"), C: it_("7"), D: it_("2"), E: it_("3") },
    false,
  );
  // CCO berikutnya: D diisi tangan di r3, A tetap.
  const r3 = rev("r3", 3, { A: it_("10"), D: it_("2", null, true), E: it_("3") }, false);
  const hasil = selesaikanBackup([r3, r1, r2]);

  it("volume sama → diwarisi dari berkas revisi asal", () => {
    expect(hasil.get("r2")!.get("A")).toEqual({ jenis: "warisan", dari: "berkas", revisionId: "r1", revisionNo: 1 });
    // r3 menunjuk ke ASAL (r1), bukan ke r2 perantara.
    expect(hasil.get("r3")!.get("A")).toEqual({ jenis: "warisan", dari: "berkas", revisionId: "r1", revisionNo: 1 });
  });

  it("volume berubah → belum, dan backup lama hanya disebut sebagai rujukan", () => {
    const b = hasil.get("r2")!.get("B")!;
    expect(b.jenis).toBe("belum");
    if (b.jenis !== "belum") return;
    expect(b.sebab).toBe("volume_berubah");
    expect(b.sebelumnya).toMatchObject({ revisionNo: 1, volume: "5.000" });
    expect(b.sebelumnya?.sumber).toMatchObject({ jenis: "warisan", dari: "berkas", revisionId: "r1" });
  });

  it("item baru → belum (baru); item yang sejak awal tanpa backup tetap belum", () => {
    expect(hasil.get("r2")!.get("E")).toMatchObject({ jenis: "belum", sebab: "baru" });
    expect(hasil.get("r1")!.get("C")).toMatchObject({ jenis: "belum", sebab: "tanpa_backup", berkas: "angka_langsung" });
    // Revisi tanpa berkas membawa SEBAB ASAL-nya, bukan "belum dilengkapi".
    expect(hasil.get("r2")!.get("C")).toMatchObject({ jenis: "belum", sebab: "tanpa_backup", berkas: "angka_langsung" });
    const awalEditor = rev("e1", 1, { X: it_("1") }, false);
    awalEditor.punyaBerkas = false;
    const awalBerkas = rev("b1", 1, { X: it_("1") }, false);
    expect(selesaikanBackup([awalEditor]).get("e1")!.get("X")).toMatchObject({ sebab: "tanpa_berkas" });
    expect(selesaikanBackup([awalBerkas]).get("b1")!.get("X")).toMatchObject({ sebab: "belum_dilengkapi" });
  });

  it("isian MARLIN menang, dan bisa diwarisi revisi berikutnya", () => {
    expect(hasil.get("r3")!.get("D")).toEqual({ jenis: "isian", revisionId: "r3", revisionNo: 3 });
    const r4 = rev("r4", 4, { D: it_("2.000") }, false);
    expect(selesaikanBackup([r1, r2, r3, r4]).get("r4")!.get("D")).toEqual({
      jenis: "warisan",
      dari: "isian",
      revisionId: "r3",
      revisionNo: 3,
    });
  });

  it("berkas tertaut milik revisi sendiri tidak diganti warisan", () => {
    const r5 = rev("r5", 5, { A: it_("10", "tertaut") });
    expect(selesaikanBackup([r1, r5]).get("r5")!.get("A")).toEqual({ jenis: "berkas", revisionId: "r5", revisionNo: 5 });
  });
});

describe("selesaikanAnalisa", () => {
  it("diwarisi bila harga satuan sama; harga berubah → tanpa analisa", () => {
    const h = selesaikanAnalisa([
      {
        id: "r1",
        revisionNo: 1,
        items: new Map([
          ["A", { harga: "1250000.00", analisaId: "an1", cara: "rumus" }],
          ["B", { harga: "500.00", analisaId: "an2", cara: "cocok_harga" }],
        ]),
      },
      {
        id: "r2",
        revisionNo: 2,
        items: new Map([
          ["A", { harga: "1250000", analisaId: null, cara: null }],
          ["B", { harga: "650", analisaId: null, cara: null }],
        ]),
      },
    ]);
    expect(h.get("r2")!.get("A")).toEqual({ analisaId: "an1", cara: "rumus", revisionId: "r1", revisionNo: 1, warisan: true });
    expect(h.get("r2")!.has("B")).toBe(false);
  });
});

describe("backup isian", () => {
  it("hasil = perkalian faktor yang terisi; pengurang minus; baris tanpa angka tanpa hasil", () => {
    expect(hasilBarisBackup({ jumlah: 4, panjang: 12.5, lebar: 0.3, tinggi: 0.4, kurang: false })).toBeCloseTo(6, 9);
    expect(hasilBarisBackup({ jumlah: null, panjang: 3, lebar: 2, tinggi: null, kurang: true })).toBe(-6);
    expect(hasilBarisBackup({ jumlah: null, panjang: null, lebar: null, tinggi: null, kurang: false })).toBeNull();
  });

  it("total dibanding volume RAB – selisih disebut, tidak dibetulkan", () => {
    const baris = [
      { jumlah: 4, panjang: 12.5, lebar: 0.3, tinggi: 0.4, kurang: false },
      { jumlah: 1, panjang: 2, lebar: 0.3, tinggi: 0.4, kurang: true },
    ];
    expect(totalBackupIsian(baris, 5.76)).toEqual({ total: 5.76, selisih: 0, cocok: true });
    expect(totalBackupIsian(baris, 6)).toEqual({ total: 5.76, selisih: -0.24, cocok: false });
    expect(totalBackupIsian(baris, null)).toEqual({ total: 5.76, selisih: null, cocok: false });
  });
});
