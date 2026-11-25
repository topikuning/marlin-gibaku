import { describe, expect, it } from "vitest";
import { ISI_TERMIN, hitungSimpul, strukturDriveKkp } from "@/lib/gdrive/struktur";
import { kabarSiapkan, siapkanStruktur, type HasilSiapkan, type OpsDrive } from "@/lib/gdrive/siapkan";
import { folderMilikMarlin, TOLERANSI_DIBUAT_MS } from "@/lib/gdrive/milik";
import { KATALOG_BERKAS_TERMIN, butirBerkas } from "@/lib/penagihan/katalog";

/**
 * BERKAS DOKUMEN TEKNIS TIDAK MENGULANG FOLDER UTAMA TERMIN (DECISIONS 776).
 *
 * Keluhan user 2026-11-25: *"di berkas termin, misal termin 1 (25%), itu ada
 * folder 'berkas dokumen teknis'. kenapa itu redudansi dengan folder termin
 * langsung itu sendiri. lalu kalau memang itu harus ada, kenapa konten yang
 * sama tidak kamu link kan saja"*.
 *
 * Sembilan butirnya (T1–T4, T6, T8, T9, T12, T13) isinya sama dengan folder
 * utama termin (DECISIONS 725). Kini ia PINTASAN Drive ke folder utama itu,
 * bukan folder kosong.
 */

const TEKNIS = "BERKAS DOKUMEN TEKNIS";
const anakTeknis = () => ISI_TERMIN.find((s) => s.nama === TEKNIS)!.anak!;

describe("struktur: sembilan butir ganda = pintasan ke folder utama", () => {
  it("BERKAS DOKUMEN TEKNIS tetap 19 butir: 10 folder sendiri, 9 pintasan", () => {
    const a = anakTeknis();
    expect(a).toHaveLength(19);
    expect(a.filter((s) => s.pintasanKe)).toHaveLength(9);
    expect(a.filter((s) => !s.pintasanKe).map((s) => s.nama.split(".")[0])).toEqual([
      "5", "7", "10", "11", "14", "15", "16", "17", "19", "20",
    ]);
  });

  it("tujuan pintasan = folder butir utama di katalog penagihan (cukupDi), tidak boleh berselisih", () => {
    const utama = new Set(ISI_TERMIN.map((s) => s.nama));
    for (const s of anakTeknis().filter((x) => x.pintasanKe)) {
      expect(utama.has(s.pintasanKe!)).toBe(true);
      const b = KATALOG_BERKAS_TERMIN.find((k) => k.jalur[0] === TEKNIS && k.jalur[1] === s.nama)!;
      expect(b.cukupDi, s.nama).toBeTruthy();
      expect(butirBerkas(b.cukupDi!)!.jalur).toEqual([s.pintasanKe]);
    }
    // Sebaliknya: setiap butir ganda di katalog memang pintasan di Drive.
    for (const b of KATALOG_BERKAS_TERMIN.filter((k) => k.cukupDi)) {
      expect(anakTeknis().find((s) => s.nama === b.jalur[1])?.pintasanKe, b.kode).toBeTruthy();
    }
  });
});

/** Drive tiruan: folder dan pintasan. */
function driveTiruan() {
  let n = 0;
  const isi = new Map<string, { name: string; parent: string; target?: string; trashed?: boolean }>();
  const dibuang: string[] = [];
  const bolehDiganti = new Set<string>();
  const hidup = () => [...isi.entries()].filter(([, f]) => !f.trashed);
  const ops: OpsDrive = {
    daftarSubfolder: async (p) => hidup().filter(([, f]) => f.parent === p && !f.target).map(([id, f]) => ({ id, name: f.name })),
    buatFolder: async (p, name) => {
      const id = `f${++n}`;
      isi.set(id, { name, parent: p });
      return id;
    },
    daftarPintasan: async (p) =>
      hidup().filter(([, f]) => f.parent === p && f.target).map(([id, f]) => ({ id, name: f.name, targetId: f.target! })),
    buatPintasan: async ({ folderId, name, targetId }) => {
      const id = `p${++n}`;
      isi.set(id, { name, parent: folderId, target: targetId });
      return id;
    },
    folderBolehDiganti: async (id) => bolehDiganti.has(id),
    buangKeSampah: async (id) => {
      dibuang.push(id);
      isi.get(id)!.trashed = true;
    },
  };
  const tambah = (parent: string, name: string) => {
    const id = `ada${++n}`;
    isi.set(id, { name, parent });
    return id;
  };
  const idDari = (parent: string, name: string) =>
    hidup().find(([, f]) => f.parent === parent && f.name === name)?.[0] ?? null;
  const anak = (parent: string) => hidup().filter(([, f]) => f.parent === parent);
  return { ops, isi, tambah, idDari, anak, dibuang, bolehDiganti };
}

const pohon = () => strukturDriveKkp({ penyedia: "CV. Putera Fahlevi", lokasi: ["Asemdoyong"] });
const T1 = "TERMIN 1 (25%) CV. Putera Fahlevi";
const TANPA_BATAS = { batasMs: 60_000 };

function jalanKeTermin1(d: ReturnType<typeof driveTiruan>) {
  const f7 = d.idDari("akar", "7. BERKAS TERMIN")!;
  const t1 = d.idDari(f7, T1)!;
  return { t1, teknis: d.idDari(t1, TEKNIS)! };
}

describe("siapkanStruktur: pintasan", () => {
  it("Drive kosong → 9 pintasan per termin menunjuk folder utama termin yang SAMA; ditekan lagi tidak menambah apa pun", async () => {
    const d = driveTiruan();
    const p = pohon();
    const h = await siapkanStruktur("akar", p, d.ops, TANPA_BATAS);
    expect(h.selesai).toBe(true);
    expect(h.pintasan).toHaveLength(9 * 4);
    expect(h.dibuat.length + h.pintasan.length).toBe(hitungSimpul(p));

    const { t1, teknis } = jalanKeTermin1(d);
    const kurva = d.anak(teknis).find(([, f]) => f.name === "9. Kurva S")![1];
    expect(kurva.target).toBe(d.idDari(t1, "5. Kurva S"));
    const ssuk = d.anak(teknis).filter(([, f]) => f.target === d.idDari(t1, "2. SSUK & SKK"));
    expect(ssuk.map(([, f]) => f.name).sort()).toEqual(["12. SSUK", "13. SSKK"]);
    // Folder sendiri BERKAS DOKUMEN TEKNIS tetap folder.
    expect(d.anak(teknis).find(([, f]) => f.name === "5. Laporan Harian")![1].target).toBeUndefined();

    const lagi = await siapkanStruktur("akar", p, d.ops, TANPA_BATAS);
    expect(lagi.dibuat).toEqual([]);
    expect(lagi.pintasan).toEqual([]);
    expect(lagi.sudahAda).toBe(hitungSimpul(p));
  });

  it("folder ganda lama buatan MARLIN yang kosong → dibuang ke Sampah dan diganti pintasan", async () => {
    const d = driveTiruan();
    const f7 = d.tambah("akar", "7. BERKAS TERMIN");
    const t1 = d.tambah(f7, T1);
    const kurvaUtama = d.tambah(t1, "5. Kurva S");
    const teknis = d.tambah(t1, TEKNIS);
    const lama = d.tambah(teknis, "9. Kurva S");
    d.bolehDiganti.add(lama);

    const h = await siapkanStruktur("akar", pohon(), d.ops, TANPA_BATAS);
    expect(d.dibuang).toEqual([lama]);
    expect(h.diganti).toEqual([`7. BERKAS TERMIN/${T1}/${TEKNIS}/9. Kurva S`]);
    const baru = d.anak(teknis).filter(([, f]) => f.name === "9. Kurva S");
    expect(baru).toHaveLength(1);
    expect(baru[0][1].target).toBe(kurvaUtama);
  });

  it("folder ganda buatan orang atau berisi → tidak disentuh, tidak diberi pintasan kembar", async () => {
    const d = driveTiruan();
    const f7 = d.tambah("akar", "7. BERKAS TERMIN");
    const t1 = d.tambah(f7, T1);
    const teknis = d.tambah(t1, TEKNIS);
    d.tambah(teknis, "9. Kurva S");
    d.tambah(teknis, "6. LAPORAN MINGGUAN");

    const h = await siapkanStruktur("akar", pohon(), d.ops, TANPA_BATAS);
    expect(d.dibuang).toEqual([]);
    expect(h.dibiarkan.sort()).toEqual([
      `7. BERKAS TERMIN/${T1}/${TEKNIS}/6. Laporan Mingguan`,
      `7. BERKAS TERMIN/${T1}/${TEKNIS}/9. Kurva S`,
    ]);
    expect(d.anak(teknis).filter(([, f]) => /^9\. Kurva S$/.test(f.name))).toHaveLength(1);
    expect(d.anak(teknis).filter(([, f]) => /^6\. laporan mingguan$/i.test(f.name))).toHaveLength(1);
  });

  it("pintasan yang sudah ada (apa pun tujuannya) tidak disentuh", async () => {
    const d = driveTiruan();
    await siapkanStruktur("akar", pohon(), d.ops, TANPA_BATAS);
    const sebelum = d.isi.size;
    const h = await siapkanStruktur("akar", pohon(), d.ops, TANPA_BATAS);
    expect(d.isi.size).toBe(sebelum);
    expect(h.diganti).toEqual([]);
    expect(h.dibiarkan).toEqual([]);
  });
});

describe("folderMilikMarlin: folder ganda lama boleh dibuang hanya bila terbukti buatan MARLIN", () => {
  const jam = (m: number) => new Date(Date.UTC(2026, 10, 1, 10, m));
  const f = (o: Partial<Parameters<typeof folderMilikMarlin>[0]> = {}) => ({
    id: "x",
    createdTime: jam(0),
    terbitanMarlin: false,
    diubahOrangLain: false,
    kosong: true,
    ...o,
  });

  it("dibuat saat MARLIN menulis ke Drive paket itu (jejak dicatat SESUDAH folder dibuat), kosong, tak diubah orang → boleh", () => {
    expect(folderMilikMarlin(f(), [jam(1)])).toBe(true);
    expect(folderMilikMarlin(f(), [new Date(jam(0).getTime() + TOLERANSI_DIBUAT_MS)])).toBe(true);
  });

  it("bertanda terbitan MARLIN, kosong, tak diubah orang → boleh tanpa jejak waktu", () => {
    expect(folderMilikMarlin(f({ terbitanMarlin: true }), [])).toBe(true);
  });

  it("berisi, diubah orang, atau dibuat di luar waktu MARLIN menulis → tidak disentuh", () => {
    expect(folderMilikMarlin(f({ kosong: false }), [jam(1)])).toBe(false);
    expect(folderMilikMarlin(f({ terbitanMarlin: true, kosong: false }), [])).toBe(false);
    expect(folderMilikMarlin(f({ diubahOrangLain: true }), [jam(1)])).toBe(false);
    expect(folderMilikMarlin(f({ terbitanMarlin: true, diubahOrangLain: true }), [])).toBe(false);
    expect(folderMilikMarlin(f(), [])).toBe(false);
    expect(folderMilikMarlin(f(), [jam(30)])).toBe(false);
    // Dibuat jauh SESUDAH jejak MARLIN = bukan hasil tulisan itu.
    expect(folderMilikMarlin(f({ createdTime: jam(10) }), [jam(0)])).toBe(false);
  });
});

describe("kabarSiapkan", () => {
  const h = (o: Partial<HasilSiapkan>): HasilSiapkan => ({
    dibuat: [],
    pintasan: [],
    diganti: [],
    dibiarkan: [],
    sudahAda: 0,
    selesai: true,
    ...o,
  });

  it("menyebut folder baru, pintasan, folder ganda yang diganti dan yang dibiarkan", () => {
    expect(kabarSiapkan(h({ dibuat: ["a", "b"], pintasan: ["p"], sudahAda: 3 }), 10)).toBe(
      "2 folder baru dan 1 pintasan dibuat, 3 sudah ada dan tidak diubah.",
    );
    expect(kabarSiapkan(h({ diganti: ["x", "y"], sudahAda: 5 }), 10)).toBe(
      "5 sudah ada dan tidak diubah. 2 folder ganda di BERKAS DOKUMEN TEKNIS diganti pintasan ke folder utama termin. Folder lamanya kosong dan bisa dipulihkan dari Sampah Drive.",
    );
    expect(kabarSiapkan(h({ dibiarkan: ["x"], sudahAda: 10 }), 10)).toBe(
      "Semua 10 folder baku sudah ada. Tidak ada yang perlu dibuat. 1 folder ganda di BERKAS DOKUMEN TEKNIS dibiarkan karena berisi berkas atau dibuat orang lain.",
    );
    expect(kabarSiapkan(h({ dibuat: ["a"], selesai: false }), 10)).toBe(
      "1 folder baru dibuat. Belum semua sempat dibuat. Tekan Siapkan folder Drive sekali lagi untuk melanjutkan.",
    );
  });
});
