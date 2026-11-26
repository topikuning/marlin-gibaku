import { describe, expect, it } from "vitest";
import { buildJadwalXlsx } from "@/lib/export/xlsx";
import { parseJadwalWorkbook } from "@/lib/scurve/jadwal-import";

// Round-trip: build Time Schedule Excel (export) → parse balik → matriks mingguan
// per kategori harus terbaca, TERMASUK minggu jeda (0). DECISIONS 103.

function spread(total: number, weeks: number[], n = 10): number[] {
  const a = new Array<number>(n).fill(0);
  const per = total / weeks.length;
  for (const w of weeks) a[w - 1] = per;
  return a;
}

function syntheticReport() {
  const contractStart = new Date("2026-07-01T00:00:00Z");
  const cats = [
    { code: "I", name: "PERSIAPAN", weekly: spread(20, [1, 2, 3, 4]) },
    // Terputus: aktif M1–4, JEDA M5–6, lanjut M7–10.
    { code: "II", name: "STRUKTUR TERPUTUS", weekly: spread(50, [1, 2, 3, 4, 7, 8, 9, 10]) },
    { code: "III", name: "FINISHING", weekly: spread(30, [7, 8, 9, 10]) },
  ];
  return {
    kind: "mingguan",
    n: 1,
    totalWeeks: 10,
    kurvaSchedule: cats,
    header: { packageName: "Paket Uji", village: "Desa X", regency: "Kab Y", contractStart },
    scurve: { actualPct: [5, 12, null, null, null, null, null, null, null, null], currentWeek: 2 },
  } as unknown as Parameters<typeof buildJadwalXlsx>[0];
}

describe("parseJadwalWorkbook (round-trip Time Schedule Excel – DECISIONS 103)", () => {
  it("membaca kembali kategori + matriks mingguan; jeda (0) dipertahankan", async () => {
    const buf = await buildJadwalXlsx(syntheticReport());
    const parsed = await parseJadwalWorkbook(buf);

    expect(parsed.totalWeeks).toBe(10);
    expect(parsed.categories.map((c) => c.name)).toEqual(["PERSIAPAN", "STRUKTUR TERPUTUS", "FINISHING"]);
    expect(parsed.categories.map((c) => c.code)).toEqual(["I", "II", "III"]);

    const struktur = parsed.categories.find((c) => c.code === "II")!;
    expect(struktur.weekly).toHaveLength(10);
    // Jeda M5–6 terbaca 0.
    expect(struktur.weekly[4]).toBe(0);
    expect(struktur.weekly[5]).toBe(0);
    // Minggu aktif > 0.
    expect(struktur.weekly[0]).toBeGreaterThan(0);
    expect(struktur.weekly[6]).toBeGreaterThan(0);
    // Σ ≈ bobot kategori (50), toleransi pembulatan 3 desimal export.
    expect(struktur.weekly.reduce((s, v) => s + v, 0)).toBeCloseTo(50, 1);

    const persiapan = parsed.categories.find((c) => c.code === "I")!;
    // Aktif hanya M1–4.
    expect(persiapan.weekly.slice(4).every((v) => v === 0)).toBe(true);
    expect(persiapan.weekly.reduce((s, v) => s + v, 0)).toBeCloseTo(20, 1);
  });
});

describe("Time Schedule berkas lapangan (DECISIONS 789)", () => {
  /**
   * Berkas BUYAT TENGAH CCO, sheet "Time Schedule": kolom J kosong di antara
   * M6 dan M7 (judul tanpa isi). Pembaca dulu berhenti di sana – 6 dari 16
   * minggu – sehingga hampir semua kategori terbaca 0.
   */
  async function berkas(o: { selaKosong?: boolean; tersembunyi?: boolean } = {}): Promise<Buffer> {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Time Schedule");
    ws.getCell("A17").value = "No";
    ws.getCell("B17").value = "Uraian Pekerjaan";
    const kolom = o.selaKosong ? ["D", "E", "G", "H"] : ["D", "E", "F", "G"];
    kolom.forEach((k, i) => (ws.getCell(`${k}18`).value = `M${i + 1}\n ${i + 1}/9`));
    if (o.tersembunyi) {
      ws.getCell("F18").value = "M3\n lama";
      ws.getColumn("F").hidden = true;
    }
    ws.getCell("A19").value = 1;
    ws.getCell("B19").value = "PEKERJAAN PERSIAPAN";
    kolom.forEach((k, i) => (ws.getCell(`${k}19`).value = [1, 2, 3, 4][i]!));
    ws.getCell("A20").value = 2;
    ws.getCell("B20").value = "PEKERJAAN LEVELLING LAHAN";
    kolom.forEach((k, i) => (ws.getCell(`${k}20`).value = [0, 0, 40, 50][i]!));
    ws.getCell("B21").value = "RENCANA PRESTASI";
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  it("kolom sela kosong di antara minggu dilewati – semua minggu terbaca", async () => {
    const r = await parseJadwalWorkbook(await berkas({ selaKosong: true }));
    expect(r.totalWeeks).toBe(4);
    expect(r.categories.map((c) => c.weekly)).toEqual([
      [1, 2, 3, 4],
      [0, 0, 40, 50],
    ]);
  });

  it("kolom tersembunyi tidak dibaca (DECISIONS 604), walau berjudul minggu", async () => {
    const r = await parseJadwalWorkbook(await berkas({ selaKosong: true, tersembunyi: true }));
    expect(r.totalWeeks).toBe(4);
    expect(r.categories[0]!.weekly).toEqual([1, 2, 3, 4]);
  });
});
