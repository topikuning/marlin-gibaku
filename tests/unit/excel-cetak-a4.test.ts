import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { HURUF_MIN_PT, HURUF_NYAMAN_PT, KERTAS_A4, nilaiCetak, ruangCetakMm, siapCetakA4 } from "@/lib/export/cetak-a4";
import { ringkasCetak } from "./cetak-a4-bantu";

/**
 * SEMUA Excel buatan MARLIN dicetak di A4, orientasinya dinilai dari isi
 * sheet (DECISIONS 762). Uji di sini: aturannya sendiri, lalu pagar repo-lebar
 * supaya penulis Excel baru tidak lupa memanggilnya.
 */

const lembar = (lebar: number[], o?: { huruf?: number; margin?: number; baris?: number }) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Uji");
  if (o?.margin != null) {
    ws.pageSetup.margins = { left: o.margin, right: o.margin, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 };
  }
  lebar.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  for (let r = 1; r <= (o?.baris ?? 5); r++) {
    lebar.forEach((_, i) => {
      const c = ws.getCell(r, i + 1);
      c.value = `isi ${r}.${i}`;
      if (o?.huruf) c.font = { size: o.huruf };
    });
  }
  return { wb, ws };
};

/** Lebar kolom (karakter) yang tepat menghasilkan skala potret `s` pada margin bawaan. */
const lebarUntukSkala = (s: number) => {
  const { ws } = lembar([1]);
  return ((ruangCetakMm(ws, "portrait").lebar / s / 25.4) * 96) / 7;
};

/** Jumlah baris (tinggi bawaan 15 pt) yang setinggi `mm` pada skala 100%. */
const barisSetinggi = (mm: number) => Math.round(mm / ((15 * 25.4) / 72));

describe("aturan orientasi", () => {
  it("tabel sempit (Resume RAB: 3 kolom) → potret, kertas A4", () => {
    const { wb } = lembar([6, 56, 18]);
    siapCetakA4(wb);
    expect(ringkasCetak(wb)).toEqual({ Uji: "A4 portrait 1×n" });
    expect(wb.worksheets[0]!.pageSetup.paperSize).toBe(KERTAS_A4);
  });

  it("tabel lebar (laporan periodik: 19 kolom) → lanskap", () => {
    const { wb } = lembar([5, 48, 12, 8, 14, 17, 9, 11, 9, 9, 11, 9, 9, 11, 9, 9, 11, 9, 11]);
    siapCetakA4(wb);
    expect(ringkasCetak(wb)).toEqual({ Uji: "A4 landscape 1×n" });
  });

  it("halaman sama: potret selama hurufnya masih nyaman, tepat di batasnya pindah ke lanskap", () => {
    const pas = HURUF_NYAMAN_PT / 11; // skala yang membuat huruf 11 tepat HURUF_NYAMAN_PT
    expect(nilaiCetak(lembar([lebarUntukSkala(pas + 0.01)]).ws).orientasi).toBe("portrait");
    expect(nilaiCetak(lembar([lebarUntukSkala(pas - 0.01)]).ws).orientasi).toBe("landscape");
  });

  it("yang dinilai huruf hasil cetak: lebar sama, huruf 11 tetap potret, huruf 9 pindah lanskap", () => {
    // Skala potret 0,8: huruf 11 → 8,8 pt; huruf 9 → 7,2 pt (terbaca, tapi kurang nyaman).
    const w = lebarUntukSkala(0.8);
    expect(nilaiCetak(lembar([w]).ws)).toMatchObject({ orientasi: "portrait", hurufPt: 11 });
    expect(nilaiCetak(lembar([w], { huruf: 9 }).ws)).toMatchObject({ orientasi: "landscape", hurufPt: 9 });
  });

  it("rekap pendek: satu halaman potret menang atas dua halaman lanskap walau hurufnya lebih kecil", () => {
    // Kasus REKAP laporan mingguan: di lanskap nama penanda tangan terlempar ke halaman kedua.
    // Tinggi 300 mm: tanpa diperkecil butuh 2 halaman potret, diperkecil ke 0,68 jadi 1.
    const { ws } = lembar([lebarUntukSkala(0.68)], { baris: barisSetinggi(300) });
    const n = nilaiCetak(ws);
    expect(n.potret).toMatchObject({ halaman: 1 });
    expect(n.lanskap).toMatchObject({ halaman: 2 });
    expect(n.potret.hurufPt).toBeLessThan(HURUF_NYAMAN_PT);
    expect(n.orientasi).toBe("portrait");
  });

  it("tabel panjang yang sempit (Detail RAB): potret karena halamannya jauh lebih sedikit", () => {
    const { ws } = lembar([10, 52, 12, 8, 15, 17], { baris: 300 });
    const n = nilaiCetak(ws);
    expect(n.potret.halaman).toBeLessThan(n.lanskap.halaman);
    expect(n.orientasi).toBe("portrait");
  });

  it("huruf di bawah 7 pt tidak dipakai, walau halamannya lebih sedikit", () => {
    expect(HURUF_MIN_PT).toBe(7);
    // Skala 0,62: huruf 11 → 6,8 pt. Potret 1 halaman, lanskap 2 – tetap lanskap.
    const { ws } = lembar([lebarUntukSkala(0.62)], { baris: barisSetinggi(250) });
    const n = nilaiCetak(ws);
    expect(n.potret.halaman).toBeLessThan(n.lanskap.halaman);
    expect(n.orientasi).toBe("landscape");
    // Skala 0,66: 7,3 pt – terbaca, halaman lebih sedikit kembali menang.
    expect(nilaiCetak(lembar([lebarUntukSkala(0.66)], { baris: barisSetinggi(250) }).ws).orientasi).toBe("portrait");
  });

  it("baris dan kolom tersembunyi tidak ikut dihitung", () => {
    const { wb, ws } = lembar([6, 56, 18, 40, 40, 40], { baris: 60 });
    for (const c of [4, 5, 6]) ws.getColumn(c).hidden = true;
    expect(nilaiCetak(ws).tinggiMm).toBeCloseTo(60 * ((15 * 25.4) / 72), 3);
    for (let r = 11; r <= 60; r++) ws.getRow(r).hidden = true;
    expect(nilaiCetak(ws).tinggiMm).toBeCloseTo(10 * ((15 * 25.4) / 72), 3);
    siapCetakA4(wb);
    expect(ringkasCetak(wb)).toEqual({ Uji: "A4 portrait 1×n" });
  });

  it("margin yang ditetapkan sheet dipakai dalam penilaian dan TIDAK ditimpa", () => {
    // Margin bawaan 0,7": huruf potret ±7,7 pt → lanskap. Margin sempit 0,3": ±8,6 pt → potret.
    const w = lebarUntukSkala(0.7);
    expect(nilaiCetak(lembar([w]).ws).orientasi).toBe("landscape");
    const { wb, ws } = lembar([w], { margin: 0.3 });
    siapCetakA4(wb);
    expect(ws.pageSetup.orientation).toBe("portrait");
    expect(ws.pageSetup.margins?.left).toBe(0.3);
  });

  it("sampul diminta satu halaman utuh; sheet lain tetap mengalir ke bawah", () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("COV-BQ").getCell(1, 1).value = "sampul";
    wb.addWorksheet("Laporan").getCell(1, 1).value = "isi";
    siapCetakA4(wb, { satuHalaman: ["COV-BQ"] });
    expect(ringkasCetak(wb)).toEqual({ "COV-BQ": "A4 portrait 1×1", Laporan: "A4 portrait 1×n" });
  });

  it("pengaturan bertahan setelah berkas ditulis dan dibuka lagi", async () => {
    const { wb } = lembar([5, 48, 12, 8, 14, 17, 9, 11, 9, 9, 11, 9, 9, 11, 9, 9, 11, 9, 11]);
    siapCetakA4(wb);
    const buka = new ExcelJS.Workbook();
    await buka.xlsx.load((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    expect(ringkasCetak(buka)).toEqual({ Uji: "A4 landscape 1×n" });
  });
});

/* ── Pagar repo-lebar ─────────────────────────────────────────────────── */

const AKAR = join(__dirname, "..", "..");
const PINTU = "src/lib/export/cetak-a4.ts";

function berkasKode(dir: string): string[] {
  const out: string[] = [];
  for (const nama of readdirSync(dir)) {
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) {
      if (nama === "generated" || nama === "node_modules") continue;
      out.push(...berkasKode(p));
    } else if (/\.(ts|tsx|mts)$/.test(nama)) out.push(p);
  }
  return out;
}

/** Buang komentar supaya kalimat penjelasan tidak terbaca sebagai kode. */
const tanpaKomentar = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const semua = [...berkasKode(join(AKAR, "src")), ...berkasKode(join(AKAR, "scripts"))].map((p) => ({
  rel: relative(AKAR, p),
  kode: tanpaKomentar(readFileSync(p, "utf8")),
}));

describe("pagar: tidak ada Excel yang keluar tanpa pengaturan cetak", () => {
  it("setiap writeBuffer didahului langsung oleh siapCetakA4", () => {
    const pelanggar: string[] = [];
    let jumlah = 0;
    for (const f of semua) {
      const baris = f.kode.split("\n");
      baris.forEach((b, i) => {
        if (!/\.xlsx\.writeBuffer\(/.test(b)) return;
        jumlah++;
        let j = i - 1;
        while (j >= 0 && baris[j]!.trim() === "") j--;
        if (!/siapCetakA4\(/.test(baris[j] ?? "")) pelanggar.push(`${f.rel}:${i + 1}`);
      });
    }
    // Sanity: pagar ini memang menemukan penulis Excel (15 saat ditulis).
    expect(jumlah).toBeGreaterThanOrEqual(15);
    expect(pelanggar).toEqual([]);
  });

  it("kertas, orientasi, dan skala cetak hanya diatur di satu pintu", () => {
    const pola = /\bpaperSize\b|\borientation\s*[:=]\s*["'](portrait|landscape)["']|\bfitTo(Width|Height|Page)\b|\bscale\s*:\s*\d/;
    // Hanya berkas yang menyentuh Excel: `scale` di pembaca PDF bukan urusan ini.
    const excel = semua.filter((f) => /["']exceljs["']|\bpageSetup\b|\baddWorksheet\(/.test(f.kode));
    expect(excel.length).toBeGreaterThanOrEqual(15);
    const pelanggar = excel.filter((f) => f.rel !== PINTU && pola.test(f.kode)).map((f) => f.rel);
    expect(pelanggar).toEqual([]);
  });
});
