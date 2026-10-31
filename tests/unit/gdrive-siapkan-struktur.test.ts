import { describe, expect, it } from "vitest";
import { ISI_TERMIN, cocokSimpul, hitungSimpul, namaFolderTermin, strukturDriveKkp } from "@/lib/gdrive/struktur";
import { siapkanStruktur, type OpsDrive } from "@/lib/gdrive/siapkan";

/**
 * KERANGKA FOLDER DRIVE KKP (DECISIONS 715) – acuannya Drive KKP paket
 * CV. Putera Fahlevi, TERMIN 1 yang sudah lengkap dan cair.
 */

const LOKASI = ["Asemdoyong", "Muarareja", "Purwahamba", "Tegalsari"];
const pohon = () => strukturDriveKkp({ penyedia: "CV. Putera Fahlevi", lokasi: LOKASI });

/** Drive tiruan di memori: id → { nama, induk }. */
function driveTiruan() {
  let n = 0;
  const folder = new Map<string, { name: string; parent: string }>();
  const ops: OpsDrive = {
    daftarSubfolder: async (parentId) =>
      [...folder.entries()].filter(([, f]) => f.parent === parentId).map(([id, f]) => ({ id, name: f.name })),
    buatFolder: async (parentId, name) => {
      const id = `f${++n}`;
      folder.set(id, { name, parent: parentId });
      return id;
    },
  };
  const tambah = (parent: string, name: string) => {
    const id = `ada${++n}`;
    folder.set(id, { name, parent });
    return id;
  };
  const anak = (parent: string) => [...folder.values()].filter((f) => f.parent === parent).map((f) => f.name);
  const idDari = (parent: string, name: string) =>
    [...folder.entries()].find(([, f]) => f.parent === parent && f.name === name)?.[0] ?? null;
  return { ops, folder, tambah, anak, idDari };
}

const TANPA_BATAS = { batasMs: 60_000 };

describe("struktur folder baku", () => {
  it("9 folder akar persis nama KKP, folder 2 memakai nama di Drive KKP", () => {
    const p = pohon();
    expect(p.map((s) => s.nama)).toEqual([
      "1. SPPBJ, SPK, SPMK, RAB, DED",
      "2. Peninjauan Lokasi, PCM, MC-0",
      "3. LAPORAN HARIAN",
      "4. LAPORAN MINGGUAN",
      "5. LAPORAN BULANAN",
      "6. DOKUMENTASI",
      "7. BERKAS TERMIN",
      "8. SHOP DRAWING",
      "9. AS BUILT",
    ]);
    expect(p[1].anak?.map((s) => s.nama)).toEqual(["1. Peninjauan Lokasi", "2. PCM", "3. MC-0"]);
  });

  it("folder per lokasi hanya di folder yang diisi MARLIN per lokasi (3–6)", () => {
    const p = pohon();
    for (const i of [2, 3, 4, 5]) expect(p[i].anak?.map((s) => s.nama)).toEqual(LOKASI);
    for (const i of [7, 8]) expect(p[i].anak ?? []).toEqual([]);
  });

  it("4 folder termin dengan ambang 25/50/80/100 dan nama penyedia", () => {
    const termin = pohon()[6].anak!;
    expect(termin.map((s) => s.nama)).toEqual([
      "TERMIN 1 (25%) CV. Putera Fahlevi",
      "TERMIN 2 (50%) CV. Putera Fahlevi",
      "TERMIN 3 (80%) CV. Putera Fahlevi",
      "TERMIN 4 (100%) CV. Putera Fahlevi",
    ]);
    expect(namaFolderTermin(1, 25, null)).toBe("TERMIN 1 (25%)");
  });

  it("isi termin mengikuti TERMIN 1 contoh: 12 bagian, pemeriksaan a–d, pembayaran a–i, dokumen teknis", () => {
    expect(ISI_TERMIN.map((s) => s.nama.split(".")[0])).toEqual([
      "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "BERKAS DOKUMEN TEKNIS",
    ]);
    const anak = (nama: string) => ISI_TERMIN.find((s) => s.nama.startsWith(nama))!.anak!.map((s) => s.nama);
    expect(anak("9.").map((n) => n.slice(0, 2))).toEqual(["a.", "b.", "c.", "d."]);
    expect(anak("10.").map((n) => n.slice(0, 2))).toEqual(["a.", "b.", "c.", "d.", "e.", "f.", "g.", "h.", "i."]);
    expect(anak("BERKAS DOKUMEN TEKNIS")).toHaveLength(19);
  });
});

describe("pencocokan dengan folder yang sudah ada", () => {
  it("longgar terhadap huruf besar, tanda baca, spasi", () => {
    const s = { nama: "1. SPPBJ, SPK, SPMK, RAB, DED" };
    expect(cocokSimpul(s, "1. sppbj spk spmk rab ded")).toBe(true);
    expect(cocokSimpul(s, "1.SPPBJ,SPK,SPMK,RAB,DED ")).toBe(true);
    expect(cocokSimpul(s, "2. PCM")).toBe(false);
  });

  it("folder 2 lama bernama \"2. PCM\" dikenali – tidak dibuatkan kembaran", () => {
    expect(cocokSimpul(pohon()[1], "2. PCM")).toBe(true);
  });

  it("folder termin dikenali dari nomornya, walau nama penyedia berbeda ejaan", () => {
    const t1 = pohon()[6].anak![0];
    expect(cocokSimpul(t1, "TERMIN 1 (25%) CV Putera Fahlevi")).toBe(true);
    expect(cocokSimpul(t1, "Termin 1")).toBe(true);
    expect(cocokSimpul(t1, "TERMIN 10 (100%)")).toBe(false);
    expect(cocokSimpul(t1, "TERMIN 2 (50%) CV. Putera Fahlevi")).toBe(false);
  });
});

describe("siapkanStruktur", () => {
  it("Drive kosong → seluruh pohon dibuat; ditekan lagi → tidak ada yang dibuat", async () => {
    const d = driveTiruan();
    const p = pohon();
    const pertama = await siapkanStruktur("akar", p, d.ops, TANPA_BATAS);
    expect(pertama.selesai).toBe(true);
    expect(pertama.dibuat).toHaveLength(hitungSimpul(p));
    expect(pertama.dibuat).toContain(
      "7. BERKAS TERMIN/TERMIN 1 (25%) CV. Putera Fahlevi/10. Pembayaran/a. Surat Permohonan Pembayaran",
    );

    const kedua = await siapkanStruktur("akar", p, d.ops, TANPA_BATAS);
    expect(kedua.dibuat).toEqual([]);
    expect(kedua.sudahAda).toBe(hitungSimpul(p));
    expect(d.folder.size).toBe(hitungSimpul(p));
  });

  it("Drive KKP yang sudah terisi: hanya yang kurang ditambah, yang ada tidak disentuh", async () => {
    const d = driveTiruan();
    const f2 = d.tambah("akar", "2. PCM");
    const f7 = d.tambah("akar", "7. BERKAS TERMIN");
    const t1 = d.tambah(f7, "TERMIN 1 (25%) CV Putera Fahlevi");
    const bayar = d.tambah(t1, "10. Pembayaran");
    d.tambah(bayar, "f. BA Pembayaran ");
    d.tambah("akar", "3. laporan harian");

    const h = await siapkanStruktur("akar", pohon(), d.ops, TANPA_BATAS);
    expect(h.selesai).toBe(true);
    // Tidak ada kembaran di akar maupun di dalam termin.
    expect(d.anak("akar").filter((n) => /^2\./.test(n))).toEqual(["2. PCM"]);
    expect(d.anak("akar").filter((n) => /^3\./i.test(n))).toEqual(["3. laporan harian"]);
    expect(d.anak(f7).filter((n) => /^TERMIN 1/.test(n))).toEqual(["TERMIN 1 (25%) CV Putera Fahlevi"]);
    expect(d.anak(bayar).filter((n) => n.startsWith("f."))).toEqual(["f. BA Pembayaran "]);
    // Sub-folder baru dibuat DI DALAM folder lama, bukan di sebelahnya.
    expect(d.anak(f2)).toEqual(["1. Peninjauan Lokasi", "2. PCM", "3. MC-0"]);
    expect(d.idDari(bayar, "g. BA Pembayaran (setelah terbit SHR)")).not.toBeNull();
  });

  it("tenggat habis → berhenti dengan selesai=false; ditekan lagi melanjutkan tanpa kembaran", async () => {
    const d = driveTiruan();
    const p = pohon();
    // Waktu berjalan per panggilan Drive – itulah yang mahal, bukan menelusuri pohon.
    let t = 0;
    const ops: OpsDrive = {
      daftarSubfolder: async (id) => {
        t++;
        return d.ops.daftarSubfolder(id);
      },
      buatFolder: async (id, nama) => {
        t++;
        return d.ops.buatFolder(id, nama);
      },
    };
    const lambat = { batasMs: 60, sekarang: () => t };
    const satu = await siapkanStruktur("akar", p, ops, lambat);
    expect(satu.selesai).toBe(false);
    expect(satu.dibuat.length).toBeGreaterThan(0);
    expect(satu.dibuat.length).toBeLessThan(hitungSimpul(p));

    let total = satu.dibuat.length;
    for (let i = 0; i < 200; i++) {
      t = 0;
      const lagi = await siapkanStruktur("akar", p, ops, lambat);
      total += lagi.dibuat.length;
      if (lagi.selesai) break;
    }
    expect(total).toBe(hitungSimpul(p));
    expect(d.folder.size).toBe(hitungSimpul(p));
  });
});
