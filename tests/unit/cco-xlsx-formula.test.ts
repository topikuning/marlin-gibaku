// DOKUMEN CCO — FORMULA-nya yang diuji, bukan angkanya.
//
// Permintaan user 2026-08-03: *"kenapa kamu menggunakan hardcode nilai pada
// file cco ini? sedangkan aku sudah bilang, gunakan rumus, agar ketika file itu
// diubah di lokal, semua hal menyesuaikan."*
//
// Menguji "ada tulisan formula di sel" tidak membuktikan apa-apa — formula yang
// salah tetap berupa formula. Jadi lembarnya DIHITUNG ULANG di sini oleh
// penafsir kecil di bawah, lalu hasilnya dibandingkan dengan
// `susunBarisCco()`. Sesudah itu satu volume DIUBAH (persis yang dilakukan user
// di Excel) dan lembarnya dihitung ulang lagi — kalau ada yang masih nilai
// mati, angka itu tidak akan ikut bergerak dan ujinya jatuh.
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { susunBarisCco, type CcoNode } from "@/lib/rab/cco-rows";

const { buildCcoXlsx, KOLOM_CCO: KOL } = await import("@/lib/export/cco-xlsx");

// ── Penafsir formula seadanya ────────────────────────────────────────────────
// Cakupannya persis tata bahasa yang ditulis cco-xlsx: rujukan sel (dengan/tanpa
// $), SUM(rentang), IF, OR, pembandingan, aritmetika, dan literal "".
// Sengaja tidak memakai pustaka: yang perlu dipastikan justru bahwa formulanya
// benar menurut aturan Excel yang sederhana ini, dan penafsir sekecil ini bisa
// dibaca ulang untuk memeriksa bahwa UJINYA sendiri tidak keliru.
type Sel = { v?: number | string | null; f?: string };
type Lembar = Map<string, Sel>;

const KOSONG = "" as const;

function bacaLembar(ws: ExcelJS.Worksheet): Lembar {
  const m: Lembar = new Map();
  ws.eachRow({ includeEmpty: false }, (row, r) => {
    row.eachCell({ includeEmpty: false }, (cell, c) => {
      const alamat = `${String.fromCharCode(64 + c)}${r}`;
      const v = cell.value;
      if (v && typeof v === "object" && "formula" in v) m.set(alamat, { f: (v as { formula: string }).formula });
      else m.set(alamat, { v: v as number | string | null });
    });
  });
  return m;
}

function buatPenilai(lembar: Lembar) {
  const cache = new Map<string, number | string>();

  const nilaiSel = (alamat: string): number | string => {
    const bersih = alamat.replace(/\$/g, "");
    if (cache.has(bersih)) return cache.get(bersih)!;
    const sel = lembar.get(bersih);
    let hasil: number | string;
    if (!sel) hasil = 0;
    else if (sel.f != null) hasil = evaluasi(sel.f);
    else if (typeof sel.v === "number") hasil = sel.v;
    else if (sel.v == null) hasil = 0;
    else hasil = sel.v;
    cache.set(bersih, hasil);
    return hasil;
  };

  /** Ubah formula Excel jadi ekspresi JS, lalu jalankan. */
  function evaluasi(f: string): number | string {
    // SUM(A10:A20) → deret nilai dijumlah (teks & "" diabaikan, seperti Excel).
    let s = f.replace(/SUM\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)/g, (_m, k1, r1, _k2, r2) => {
      let total = 0;
      for (let r = Number(r1); r <= Number(r2); r++) {
        const v = nilaiSel(`${k1}${r}`);
        if (typeof v === "number") total += v;
      }
      return `(${total})`;
    });

    // IF(a,b,c) / OR(a,b) → fungsi JS bernama.
    s = s.replace(/\bIF\(/g, "__if(").replace(/\bOR\(/g, "__or(");

    // Rujukan sel → pemanggilan __sel("A10").
    s = s.replace(/\$?([A-Z]+)\$?(\d+)/g, (m) => `__sel(${JSON.stringify(m.replace(/\$/g, ""))})`);

    // "=" pembanding Excel → "===" JS (Excel tidak punya "==").
    s = s.replace(/([^<>!=])=([^=])/g, "$1===$2");
    s = s.replace(/<>/g, "!==");

    const __if = (k: unknown, a: unknown, b: unknown) => (k ? a : b);
    const __or = (...xs: unknown[]) => xs.some(Boolean);
    const __sel = nilaiSel;
    const fn = new Function("__if", "__or", "__sel", `return (${s});`);
    return fn(__if, __or, __sel) as number | string;
  }

  return { nilaiSel, bersihkanCache: () => cache.clear() };
}

// ── Data uji ─────────────────────────────────────────────────────────────────
let urut = 0;
const kat = (id: string, name: string): CcoNode => ({
  id,
  parentId: null,
  kind: "kategori",
  code: id,
  name,
  unit: null,
  volume: null,
  unitPrice: null,
  amount: 0n,
  lineageKey: `K#${id}`,
});
const item = (code: string, parentId: string, name: string, volume: number, harga: number, lineage: string): CcoNode => ({
  id: `${code}-${(urut += 1)}`,
  parentId,
  kind: "item",
  code,
  name,
  unit: "m2",
  volume,
  unitPrice: harga,
  amount: BigInt(Math.round(volume * harga)),
  lineageKey: lineage,
});

// Harga satuan sengaja berdesimal (seperti RAB nyata: 1.573.171,14) supaya
// pembulatan benar-benar teruji, bukan angka bulat yang menyembunyikannya.
const LAMA: CcoNode[] = [
  kat("A", "PEKERJAAN PERSIAPAN"),
  item("1", "A", "Bedeng pekerja", 50, 1_573_171.14, "I#A1"),
  item("2", "A", "Papan nama", 1, 1_810_352.03, "I#A2"),
  kat("B", "PEKERJAAN BETON"),
  item("1", "B", "Sloof", 10, 2_000_000, "I#B1"),
  item("2", "B", "Kolom", 4, 1_250_000.5, "I#B2"),
];
const BARU: CcoNode[] = [
  kat("A", "PEKERJAAN PERSIAPAN"),
  item("1", "A", "Bedeng pekerja", 80, 1_573_171.14, "I#A1"), // naik
  item("2", "A", "Papan nama", 1, 1_810_352.03, "I#A2"), // tetap
  kat("B", "PEKERJAAN BETON"),
  item("1", "B", "Sloof", 3, 2_000_000, "I#B1"), // turun
  // "Kolom" dicabut → HAPUS
  item("3", "B", "Balok latei", 6, 900_000, "I#B3"), // BARU
];

const MASUKAN = {
  locationName: "Batah Timur",
  packageName: "Paket uji",
  workTitle: null,
  address: null,
  contractNumber: null,
  vendorName: null,
  ppnPercent: 11,
  ccoNo: 1,
  // Nilai tercatat = Σ amount tiap item (sama seperti DB) → selisih rekonsiliasi
  // nol untuk data uji ini; kasus selisih bukan-nol diuji tersendiri di bawah.
  nilaiTercatatLama: LAMA.reduce((a, n) => a + n.amount, 0n),
  nilaiTercatatBaru: BARU.reduce((a, n) => a + n.amount, 0n),
  // Realisasi lapangan: "Sloof" sudah dikerjakan 2 dari 10 (DECISIONS 242).
  realisasiByLineage: new Map([["I#B1", 2]]),
  lama: LAMA,
  baru: BARU,
};

/** XML mentah sheet pertama — untuk hal yang tidak dibaca balik ExcelJS. */
async function xmlSheet(d = MASUKAN): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await buildCcoXlsx(d));
  return zip.file("xl/worksheets/sheet1.xml")!.async("string");
}

async function lembarCco() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await buildCcoXlsx(MASUKAN)) as unknown as ArrayBuffer);
  const ws = wb.worksheets[0]!;
  const lembar = bacaLembar(ws);
  return { ws, lembar, ...buatPenilai(lembar) };
}

/** Cari baris berdasarkan uraian di kolom B. */
function cariBaris(lembar: Lembar, uraian: string): number {
  for (const [alamat, sel] of lembar) {
    if (alamat.startsWith("B") && sel.v === uraian) return Number(alamat.slice(1));
  }
  throw new Error(`baris "${uraian}" tidak ketemu`);
}
function cariKaki(lembar: Lembar, label: string): number {
  for (const [alamat, sel] of lembar) {
    if (alamat.startsWith("A") && sel.v === label) return Number(alamat.slice(1));
  }
  throw new Error(`baris "${label}" tidak ketemu`);
}

describe("HANYA volume & harga satuan yang berupa data", () => {
  it("kolom turunan semuanya formula, bukan angka mati", async () => {
    const { lembar } = await lembarCco();
    const r = cariBaris(lembar, "Bedeng pekerja");
    // C=vol MC-0, D=satuan, E=harga satuan, N=vol CCO-01 → data
    // Kolom DATA (satu-satunya yang diketik), diturunkan dari peta kolom.
    for (const kol of [KOL.volumeLama, KOL.satuan, KOL.harga, KOL.volumeBaru, KOL.realisasi]) {
      expect(lembar.get(`${kol}${r}`)?.f, `${kol}${r} seharusnya data`).toBeUndefined();
    }
    // F,G,H,I,J,K,L,M,O,P,Q → turunan
    for (const kol of [
      KOL.jumlahLama, KOL.bobotLama,
      KOL.volumeTambah, KOL.jumlahTambah, KOL.bobotTambah,
      KOL.volumeKurang, KOL.jumlahKurang, KOL.bobotKurang,
      KOL.jumlahBaru, KOL.bobotBaru, KOL.ket,
    ]) {
      expect(lembar.get(`${kol}${r}`)?.f, `${kol}${r} seharusnya formula`).toBeTypeOf("string");
    }
  });

  it("baris JUMLAH, PPN, dan TOTAL NILAI juga formula", async () => {
    const { lembar } = await lembarCco();
    const j = cariKaki(lembar, "JUMLAH");
    const t = cariKaki(lembar, "TOTAL NILAI");
    for (const kol of [KOL.jumlahLama, KOL.bobotLama, KOL.jumlahTambah, KOL.jumlahKurang, KOL.jumlahBaru, KOL.bobotBaru]) {
      expect(lembar.get(`${kol}${j}`)?.f, `${kol}${j}`).toContain("SUM(");
    }
    for (const kol of [KOL.jumlahLama, KOL.jumlahTambah, KOL.jumlahKurang, KOL.jumlahBaru])
      expect(lembar.get(`${kol}${t}`)?.f).toBeTypeOf("string");
  });
});

describe("hasil hitung formula = hasil susunBarisCco", () => {
  it("jumlah harga tiap blok cocok sampai rupiah", async () => {
    // Excel menyimpan NILAI PENUH (105.468.911,03) sementara DB menyimpan
    // rupiah bulat — itu memang aturannya, bukan selisih yang perlu ditutup:
    // total = round(Σ nilai eksak), "PERSIS seperti Excel yang menjumlah nilai
    // penuh lalu membulatkan sekali" (DECISIONS 075, lib/rab/flatten.ts).
    // Membulatkan tiap baris justru yang akan membuat totalnya meleset.
    const { lembar, nilaiSel } = await lembarCco();
    const ringkas = susunBarisCco(LAMA, BARU);
    const cocok = (kol: string, nilai: bigint) =>
      expect(Math.round(nilaiSel(`${kol}${cariKaki(lembar, "JUMLAH")}`) as number)).toBe(Number(nilai));
    cocok(KOL.jumlahLama!, ringkas.totalLama);
    cocok(KOL.jumlahTambah!, ringkas.totalTambah);
    cocok(KOL.jumlahKurang!, ringkas.totalKurang);
    cocok(KOL.jumlahBaru!, ringkas.totalBaru);
  });

  it("INVARIAN MC-0 + tambah − kurang = CCO-01 menutup di dalam berkasnya", async () => {
    const { lembar, nilaiSel } = await lembarCco();
    const j = cariKaki(lembar, "JUMLAH");
    const [mc0, tambah, kurang, cco] = [KOL.jumlahLama, KOL.jumlahTambah, KOL.jumlahKurang, KOL.jumlahBaru].map(
      (k) => nilaiSel(`${k}${j}`) as number,
    );
    expect(mc0 + tambah - kurang).toBeCloseTo(cco, 6);
  });

  it("bobot MC-0 dan CCO-01 masing-masing berjumlah 100%", async () => {
    const { lembar, nilaiSel } = await lembarCco();
    const j = cariKaki(lembar, "JUMLAH");
    expect(nilaiSel(`${KOL.bobotLama}${j}`)).toBeCloseTo(100, 6);
    expect(nilaiSel(`${KOL.bobotBaru}${j}`)).toBeCloseTo(100, 6);
  });

  it("bobot tambah/kurang memakai penyebut MC-0, bukan CCO-01", async () => {
    // Konsekuensinya: Σbobot tambah = kenaikan terhadap nilai kontrak berjalan
    // — angka yang dipakai uji batas 10% Perpres (DECISIONS 233).
    const { lembar, nilaiSel } = await lembarCco();
    const j = cariKaki(lembar, "JUMLAH");
    const mc0 = nilaiSel(`${KOL.jumlahLama}${j}`) as number;
    const tambah = nilaiSel(`${KOL.jumlahTambah}${j}`) as number;
    expect(nilaiSel(`${KOL.bobotTambah}${j}`)).toBeCloseTo((tambah / mc0) * 100, 6);
  });
});

describe("aturan kolom sesuai templat user", () => {
  it("volume tambah = vol CCO − vol MC-0; kurang = vol MC-0 − vol CCO", async () => {
    const { lembar, nilaiSel } = await lembarCco();
    const naik = cariBaris(lembar, "Bedeng pekerja");
    expect(nilaiSel(`${KOL.volumeTambah}${naik}`)).toBeCloseTo(80 - 50, 6);
    expect(nilaiSel(`${KOL.volumeKurang}${naik}`)).toBe(KOSONG);

    const turun = cariBaris(lembar, "Sloof");
    expect(nilaiSel(`${KOL.volumeKurang}${turun}`)).toBeCloseTo(10 - 3, 6);
    expect(nilaiSel(`${KOL.volumeTambah}${turun}`)).toBe(KOSONG);
  });

  it("jumlah harga = harga satuan × volume", async () => {
    const { lembar, nilaiSel } = await lembarCco();
    const r = cariBaris(lembar, "Bedeng pekerja");
    expect(nilaiSel(`${KOL.jumlahLama}${r}`)).toBeCloseTo(1_573_171.14 * 50, 2);
    expect(nilaiSel(`${KOL.jumlahTambah}${r}`)).toBeCloseTo(1_573_171.14 * 30, 2);
    expect(nilaiSel(`${KOL.jumlahBaru}${r}`)).toBeCloseTo(1_573_171.14 * 80, 2);
  });

  it("baris tak berubah mengosongkan blok tambah & kurang", async () => {
    const { lembar, nilaiSel } = await lembarCco();
    const r = cariBaris(lembar, "Papan nama");
    for (const kol of [
      KOL.volumeTambah, KOL.jumlahTambah, KOL.bobotTambah,
      KOL.volumeKurang, KOL.jumlahKurang, KOL.bobotKurang,
    ])
      expect(nilaiSel(`${kol}${r}`)).toBe(KOSONG);
    expect(nilaiSel(`${KOL.ket}${r}`)).toBe("TETAP");
  });

  it("KET dihitung formula: TAMBAH / KURANG / BARU / HAPUS", async () => {
    const { lembar, nilaiSel } = await lembarCco();
    expect(nilaiSel(`${KOL.ket}${cariBaris(lembar, "Bedeng pekerja")}`)).toBe("TAMBAH");
    expect(nilaiSel(`${KOL.ket}${cariBaris(lembar, "Sloof")}`)).toBe("KURANG");
    expect(nilaiSel(`${KOL.ket}${cariBaris(lembar, "Balok latei")}`)).toBe("BARU");
    expect(nilaiSel(`${KOL.ket}${cariBaris(lembar, "Kolom")}`)).toBe("HAPUS");
  });

  it("PPN memakai sel persen tersendiri, tidak menanam angkanya di formula", async () => {
    const { lembar, nilaiSel } = await lembarCco();
    const p = cariKaki(lembar, "PPN");
    const j = cariKaki(lembar, "JUMLAH");
    expect(lembar.get(`${KOL.harga}${p}`)?.v).toBeCloseTo(0.11, 10); // selnya, bisa diubah
    expect(lembar.get(`${KOL.jumlahLama}${p}`)?.f).toContain(`$${KOL.harga}$${p}`); // formulanya menunjuk ke sana
    expect(nilaiSel(`${KOL.jumlahLama}${p}`)).toBeCloseTo((nilaiSel(`${KOL.jumlahLama}${j}`) as number) * 0.11, 4);
    const t = cariKaki(lembar, "TOTAL NILAI");
    expect(nilaiSel(`${KOL.jumlahLama}${t}`)).toBeCloseTo((nilaiSel(`${KOL.jumlahLama}${j}`) as number) * 1.11, 4);
  });
});

describe("UJI POKOK: ubah satu volume, seluruh berkas menyesuaikan", () => {
  // Inilah yang diminta user. Kalau ada satu saja angka mati tersisa di jalur
  // hitungnya, salah satu asersi di bawah pasti jatuh.
  it("volume CCO-01 diubah → jumlah, bobot, KET, JUMLAH, PPN, TOTAL ikut", async () => {
    const { lembar, nilaiSel, bersihkanCache } = await lembarCco();
    const r = cariBaris(lembar, "Papan nama"); // semula TETAP
    const j = cariKaki(lembar, "JUMLAH");
    const t = cariKaki(lembar, "TOTAL NILAI");

    const sebelum = {
      ket: nilaiSel(`${KOL.ket}${r}`),
      jumlahBaru: nilaiSel(`${KOL.jumlahBaru}${r}`) as number,
      totalBaru: nilaiSel(`${KOL.jumlahBaru}${j}`) as number,
      totalNilai: nilaiSel(`${KOL.jumlahBaru}${t}`) as number,
      bobot: nilaiSel(`${KOL.bobotBaru}${r}`) as number,
    };
    expect(sebelum.ket).toBe("TETAP");

    // Persis yang dilakukan user di Excel: ketik volume baru di kolom N.
    lembar.set(`${KOL.volumeBaru}${r}`, { v: 4 });
    bersihkanCache();

    expect(nilaiSel(`${KOL.ket}${r}`), "KET harus ikut berubah").toBe("TAMBAH");
    expect(nilaiSel(`${KOL.volumeTambah}${r}`), "volume tambah = 4 − 1").toBeCloseTo(3, 6);
    expect(nilaiSel(`${KOL.jumlahTambah}${r}`), "jumlah tambah = harga × 3").toBeCloseTo(1_810_352.03 * 3, 2);
    expect(nilaiSel(`${KOL.jumlahBaru}${r}`), "jumlah CCO-01 naik").toBeCloseTo(sebelum.jumlahBaru * 4, 2);
    expect(nilaiSel(`${KOL.jumlahBaru}${j}`), "JUMLAH CCO-01 ikut naik").toBeCloseTo(
      sebelum.totalBaru + 1_810_352.03 * 3,
      2,
    );
    expect(nilaiSel(`${KOL.jumlahBaru}${t}`), "TOTAL NILAI ikut naik").toBeGreaterThan(sebelum.totalNilai);
    expect(nilaiSel(`${KOL.bobotBaru}${r}`), "bobot ikut naik").toBeGreaterThan(sebelum.bobot);
    // Dan invariannya tetap menutup sesudah diubah.
    const [mc0, tambah, kurang, cco] = [KOL.jumlahLama, KOL.jumlahTambah, KOL.jumlahKurang, KOL.jumlahBaru].map(
      (k) => nilaiSel(`${k}${j}`) as number,
    );
    expect(mc0 + tambah - kurang).toBeCloseTo(cco, 6);
    expect(nilaiSel(`${KOL.bobotBaru}${j}`), "bobot CCO-01 tetap 100%").toBeCloseTo(100, 6);
  });

  it("harga satuan diubah → jumlah & bobot ikut, volume tidak", async () => {
    const { lembar, nilaiSel, bersihkanCache } = await lembarCco();
    const r = cariBaris(lembar, "Sloof");
    lembar.set(`${KOL.harga}${r}`, { v: 4_000_000 }); // semula 2.000.000
    bersihkanCache();
    expect(nilaiSel(`${KOL.jumlahLama}${r}`)).toBeCloseTo(4_000_000 * 10, 2);
    expect(nilaiSel(`${KOL.jumlahKurang}${r}`), "jumlah kurang = harga baru × 7").toBeCloseTo(4_000_000 * 7, 2);
    expect(nilaiSel(`${KOL.volumeKurang}${r}`), "volume kurang tidak terpengaruh harga").toBeCloseTo(7, 6);
  });
});

describe("REKONSILIASI terhadap nilai yang tercatat", () => {
  // Pada RAB nyata, Σ(harga × volume) bisa TIDAK sama dengan nilai kontrak —
  // bukan karena pembulatan. Batah Timur memuat tiga item ber-volume dan
  // ber-harga satuan yang JUMLAH-nya nol di RAB (Roolag Bata, Plesteran,
  // Acian: Rp 781.920). MARLIN menyimpannya apa adanya (DECISIONS 203), jadi
  // dokumen ini WAJIB memperlihatkan selisihnya, bukan menutupnya.
  const kaki = (lembar: Lembar, label: string) => cariKaki(lembar, label);

  it("selisih nol saat Σ(harga × volume) = nilai tercatat", async () => {
    const { lembar, nilaiSel } = await lembarCco();
    const r = kaki(lembar, "Selisih Σ(harga × volume) − nilai tercatat");
    expect(Math.round(nilaiSel(`${KOL.jumlahLama}${r}`) as number)).toBe(0);
    expect(Math.round(nilaiSel(`${KOL.jumlahBaru}${r}`) as number)).toBe(0);
  });

  it("selisih TERLIHAT saat RAB memuat item ber-harga tapi jumlahnya nol", async () => {
    // Tiru kasus nyata: item punya volume & harga satuan, tapi amount-nya 0.
    const lamaJanggal = LAMA.map((n) =>
      n.name === "Papan nama" ? { ...n, amount: 0n } : n,
    );
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(
      (await buildCcoXlsx({
        ...MASUKAN,
        lama: lamaJanggal,
        nilaiTercatatLama: lamaJanggal.reduce((a, n) => a + n.amount, 0n),
      })) as unknown as ArrayBuffer,
    );
    const lembar = bacaLembar(wb.worksheets[0]!);
    const { nilaiSel } = buatPenilai(lembar);
    const r = kaki(lembar, "Selisih Σ(harga × volume) − nilai tercatat");
    // Selisihnya persis nilai item yang jumlahnya ditulis nol di RAB.
    expect(nilaiSel(`${KOL.jumlahLama}${r}`)).toBeCloseTo(1_810_352.03, 2);
  });
});

describe("PENGAMAN DI LEVEL BERKAS: item yang sudah terprogres", () => {
  // Server menolak volume di bawah realisasi, tapi baru SESUDAH diunggah.
  // Berkas CCO ber-formula ini memang diedit lokal, jadi tanpa rambu di
  // selnya orang bisa menyusun dokumen pengajuan yang mengusulkan membatalkan
  // pekerjaan yang sudah dikerjakan. DECISIONS 242.
  it("kolom REALISASI ada dan berisi angka lapangan", async () => {
    const { lembar } = await lembarCco();
    const r = cariBaris(lembar, "Sloof"); // realisasi 2 (lihat MASUKAN)
    expect(lembar.get(`${KOL.realisasi}${r}`)?.v).toBe(2);
  });

  it("sel volume CCO-01 menolak entri di bawah realisasi", async () => {
    const { ws, lembar } = await lembarCco();
    const r = cariBaris(lembar, "Sloof");
    const dv = ws.getCell(`${KOL.volumeBaru}${r}`).dataValidation;
    expect(dv, "validasi harus terpasang").toBeDefined();
    expect(dv?.operator).toBe("greaterThanOrEqual");
    // Pesannya menyebut angkanya — "tidak valid" saja tidak memberi tahu apa pun.
    expect(String((dv as { error?: string }).error)).toContain("2");

    /*
     * Rujukan selnya diperiksa dari XML MENTAH, bukan dari hasil baca-ulang:
     * pembaca ExcelJS memaksa formula validasi bertipe "decimal" jadi angka,
     * sehingga `$D$14` terbaca NaN — padahal berkasnya benar. Memeriksa lewat
     * pembaca yang cacat itu akan mengunci uji ke bug pustaka, bukan ke isi
     * berkas yang dibuka Excel.
     */
    const xml = await xmlSheet();
    expect(xml).toContain(`sqref="${KOL.volumeBaru}${r}"`);
    expect(xml).toMatch(
      new RegExp(`sqref="${KOL.volumeBaru}${r}"[^>]*><formula1>\\$${KOL.realisasi}\\$${r}</formula1>`),
    );
  });

  it("item tanpa realisasi TIDAK dipasangi validasi", async () => {
    // Pagar hanya di tempat yang memang berpagar; validasi di mana-mana
    // membuat orang terbiasa menembusnya.
    const { ws, lembar } = await lembarCco();
    const r = cariBaris(lembar, "Bedeng pekerja");
    expect(ws.getCell(`${KOL.volumeBaru}${r}`).dataValidation).toBeUndefined();
  });

  it("pelanggaran yang lolos validasi tetap menyala merah", async () => {
    // Diperiksa dari XML, sama seperti validasi: tipe ExcelJS tidak mengekspos
    // `conditionalFormattings`, dan XML adalah yang benar-benar dibuka Excel.
    const { lembar } = await lembarCco();
    const r = cariBaris(lembar, "Sloof");
    const xml = await xmlSheet();
    expect(xml).toContain(`<conditionalFormatting sqref="${KOL.volumeBaru}${r}">`);
    // "<" ter-escape jadi &lt; di dalam XML.
    expect(xml).toContain(`$${KOL.volumeBaru}$${r}&lt;$${KOL.realisasi}$${r}`);
  });
});

describe("berkasnya harus SAH menurut OOXML, bukan hanya menurut ExcelJS", () => {
  it("errorStyle memakai nilai yang dikenal spesifikasi", async () => {
    // `errorStyle="error"` bukan nilai sah OOXML (hanya stop/warning/
    // information). ExcelJS menuliskannya apa adanya, jadi berkas lolos uji
    // berbasis ExcelJS tetapi ditolak pembaca lain dan Excel membuang
    // validasinya. Lihat catatan panjang di uji template adendum.
    const xml = await xmlSheet();
    const gaya = [...xml.matchAll(/errorStyle="([^"]+)"/g)].map((m) => m[1]);
    expect(gaya.length, "harus ada validasi terpasang").toBeGreaterThan(0);
    for (const g of gaya) expect(["stop", "warning", "information"]).toContain(g);
  });
});

describe("TANDA TANGAN: nama pihak diambil dari kontrak", () => {
  // "nama-nama pihak kan sudah ada di sistem. kenapa tidak kamu masukkan!"
  // Ketiganya tercatat di `Contract`; mencetak garis titik-titik berarti
  // menyuruh orang menulis tangan sesuatu yang sudah diketahui. DECISIONS 243.
  const DENGAN_TTD = {
    ...MASUKAN,
    vendorName: "PT Nusantara Bahari Utama",
    ppkName: "Ir. Slamet Riyadi, M.T.",
    ppkNip: "196504121990031002",
    supervisorName: "Andi Wijaya",
    supervisorFirm: "CV Pengawas Jaya",
    contractorSignerName: "Rudi Hartono",
    contractorSignerTitle: "Site Manager",
  };
  const teksLembar = async (d: Parameters<typeof buildCcoXlsx>[0]) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildCcoXlsx(d)) as unknown as ArrayBuffer);
    const out: string[] = [];
    wb.worksheets[0]!.eachRow((row) =>
      row.eachCell((c) => {
        if (typeof c.value === "string") out.push(c.value);
      }),
    );
    return out.join("\n");
  };

  it("ketiga nama tercetak, bukan garis titik-titik", async () => {
    const t = await teksLembar(DENGAN_TTD);
    expect(t).toContain("( Ir. Slamet Riyadi, M.T. )");
    expect(t).toContain("( Andi Wijaya )");
    expect(t).toContain("( Rudi Hartono )");
    expect(t).not.toContain("(.................................................)");
  });

  it("NIP, instansi, dan jabatan ikut", async () => {
    const t = await teksLembar(DENGAN_TTD);
    expect(t).toContain("NIP. 196504121990031002");
    expect(t).toContain("CV Pengawas Jaya");
    expect(t).toContain("PT Nusantara Bahari Utama");
    expect(t).toContain("Site Manager");
  });

  it("field yang BELUM diisi di kontrak jadi garis isian, tidak ditebak", async () => {
    // Garis isian jujur menyatakan "belum ada datanya"; menebak nama pejabat
    // pada dokumen pengajuan jauh lebih buruk daripada kolom kosong.
    const t = await teksLembar({ ...DENGAN_TTD, ppkName: null, supervisorName: null });
    expect(t).toContain("(.................................................)");
    expect(t).not.toContain("( Andi Wijaya )");
    expect(t).toContain("( Rudi Hartono )"); // yang ada tetap terisi
  });
});
