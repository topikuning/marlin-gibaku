// EXCEL "RAPL SIAP ISI HARGA" (DECISIONS 803).
//
// Keputusan user 2026-11-28: sekali klik jadi Excel yang tinggal diisi harga;
// kolom harga kosong kecuali harga yang sudah disetujui. Di sebelahnya usulan
// harga estimasi UNTUK LOKASI ITU (DECISIONS 805) – bukan harga prototipe
// referensi. Yang dijaga BENTUK berkasnya: harga diisi sekali di Isi Harga dan
// dirujuk rumus, harga kontrak per item tertulis apa adanya, harga/usulan yang
// berbeda antar-lokasi tidak dipilihkan, dan tidak ada angka referensi.
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildRaplSiapIsiXlsx, daftarSumberDaya } from "@/lib/export/rapl-siap-isi-xlsx";
import type { BiayaItem, KomponenItem } from "@/lib/ahsp/rapl-calc";
import type { LokasiRaplSiapIsi } from "@/lib/rapl-siap-isi/data";

const komp = (o: Partial<KomponenItem> & Pick<KomponenItem, "kategori" | "nama" | "satuan" | "jumlah">): KomponenItem => ({
  dariAhsp: true,
  harga: null,
  hargaDariKontrak: false,
  biaya: null,
  ...o,
});

const item = (o: Partial<BiayaItem> & Pick<BiayaItem, "code" | "uraian" | "komponen">): BiayaItem => ({
  lineageKey: o.code,
  satuan: "m3",
  volume: 10,
  nilaiRab: 15_000_000n,
  cara: "ahsp",
  sumberAnalisa: "ai",
  dariLokasi: "Bolmut",
  biaya: 0n,
  komponenBelumBerharga: 0,
  lengkap: false,
  margin: null,
  marginPersen: null,
  alasanLewat: null,
  rinciLewat: null,
  faktorKonversi: null,
  catatanKonversi: null,
  hargaBorongan: null,
  ...o,
});

const SEMEN = JSON.stringify(["bahan", "Semen Portland komposit 50 kg", "zak"]);
const BATU = JSON.stringify(["bahan", "Batu belah", "m3"]);

const lokasi = (nama: string, hargaSemen: bigint | null, hargaPekerja: bigint, usulan: [string, bigint][] = []): LokasiRaplSiapIsi => ({
  id: nama,
  nama,
  desa: nama,
  kabupaten: "Bitung",
  provinsi: "Sulawesi Utara",
  paket: "KNMP Uji",
  nomorKontrak: "K/1",
  pelaksana: "PT Uji",
  bulanKontrak: 3.5,
  nilaiRab: 30_000_000n,
  volumeBetonM3: 10,
  usulan: new Map(usulan),
  kategori: [
    {
      kode: "I",
      nama: "PEKERJAAN STRUKTUR",
      item: [
        item({
          code: "1",
          uraian: "Beton fc' 20 MPa",
          komponen: [
            komp({ kategori: "bahan", nama: "Semen Portland komposit 50 kg", satuan: "zak", jumlah: 76.8, harga: hargaSemen }),
            komp({ kategori: "upah", nama: "Pekerja", satuan: "OH", jumlah: 16.5, harga: hargaPekerja }),
          ],
        }),
        item({
          code: "2",
          uraian: "Pasangan batu belah",
          sumberAnalisa: "kontrak",
          dariLokasi: null,
          komponen: [komp({ kategori: "bahan", nama: "Batu belah", satuan: "m3", jumlah: 12, harga: 330_000n, hargaDariKontrak: true })],
        }),
        item({ code: "3", uraian: "Pekerjaan khusus", cara: "belum", sumberAnalisa: null, dariLokasi: null, komponen: [], rinciLewat: "satuan tidak sepadan" }),
      ],
    },
  ],
});

async function baca(lok: LokasiRaplSiapIsi[]) {
  const buf = await buildRaplSiapIsiXlsx({ judul: "Uji", lokasi: lok });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as ArrayBuffer);
  return wb;
}

const cariBaris = (ws: ExcelJS.Worksheet, kol: number, nilai: string): number => {
  for (let r = 1; r <= ws.rowCount; r++) if (ws.getCell(r, kol).value === nilai) return r;
  throw new Error(`"${nilai}" tidak ada di ${ws.name}`);
};
const rumus = (c: ExcelJS.Cell) => (c.value as { formula?: string } | null)?.formula ?? null;

describe("RAPL siap isi – dua lokasi satu paket", () => {
  it("sheet: Rekapitulasi, Isi Harga, lalu Rincian per lokasi", async () => {
    const wb = await baca([lokasi("Iyok", 92_000n, 160_000n), lokasi("Jiko", 95_000n, 160_000n)]);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Rekapitulasi", "Isi Harga", "Rincian Iyok", "Rincian Jiko"]);
  });

  it("Isi Harga: harga lokasi yang SAMA terisi; yang BERBEDA dikosongkan dengan catatan", async () => {
    const wb = await baca([lokasi("Iyok", 92_000n, 160_000n), lokasi("Jiko", 95_000n, 160_000n)]);
    const h = wb.getWorksheet("Isi Harga")!;
    const pekerja = cariBaris(h, 3, "Pekerja");
    expect(h.getCell(pekerja, 7).value).toBe(160_000);
    expect(h.getCell(pekerja, 6).value).toBeNull();
    const semen = cariBaris(h, 3, "Semen Portland komposit 50 kg");
    expect(h.getCell(semen, 7).value).toBeNull();
    expect(String(h.getCell(semen, 9).value)).toContain("Harga lokasi berbeda: Iyok Rp92.000; Jiko Rp95.000");
    // Volume & jumlah = SUMIFS kode ke setiap sheet Rincian.
    expect(rumus(h.getCell(semen, 5))).toBe(
      `SUMIFS('Rincian Iyok'!$D:$D,'Rincian Iyok'!$A:$A,$A${semen})+SUMIFS('Rincian Jiko'!$D:$D,'Rincian Jiko'!$A:$A,$A${semen})`,
    );
  });

  it("usulan harga per lokasi: hanya untuk yang belum berharga, sama → di Isi Harga, beda → disebut; tiap Rincian memuat usulan lokasinya", async () => {
    const wb = await baca([
      lokasi("Iyok", null, 160_000n, [[SEMEN, 90_000n], [BATU, 1n]]),
      lokasi("Jiko", null, 160_000n, [[SEMEN, 97_000n]]),
    ]);
    const h = wb.getWorksheet("Isi Harga")!;
    expect(String(h.getCell(6, 6).value)).toBe("Usulan harga (belum disetujui)");
    const semen = cariBaris(h, 3, "Semen Portland komposit 50 kg");
    expect(h.getCell(semen, 6).value).toBeNull();
    expect(h.getCell(semen, 7).value).toBeNull();
    expect(String(h.getCell(semen, 9).value)).toContain("Usulan berbeda per lokasi: Iyok Rp90.000; Jiko Rp97.000");
    // Batu belah sudah berharga dari analisa kontrak: usulan tidak ditampilkan.
    expect(h.getCell(cariBaris(h, 3, "Batu belah"), 6).value).toBeNull();
    const ri = wb.getWorksheet("Rincian Iyok")!;
    const rj = wb.getWorksheet("Rincian Jiko")!;
    expect(ri.getCell(cariBaris(ri, 2, "Semen Portland komposit 50 kg"), 9).value).toBe(90_000);
    expect(rj.getCell(cariBaris(rj, 2, "Semen Portland komposit 50 kg"), 9).value).toBe(97_000);
    expect(ri.getCell(cariBaris(ri, 2, "Batu belah"), 9).value).toBeNull();

    const satu = await baca([lokasi("Iyok", null, 160_000n, [[SEMEN, 90_000n]])]);
    const h1 = satu.getWorksheet("Isi Harga")!;
    expect(h1.getCell(cariBaris(h1, 3, "Semen Portland komposit 50 kg"), 6).value).toBe(90_000);
  });

  it("Rincian: harga komponen merujuk Isi Harga; harga analisa kontrak tertulis angkanya", async () => {
    const wb = await baca([lokasi("Iyok", 92_000n, 160_000n), lokasi("Jiko", 95_000n, 160_000n)]);
    const h = wb.getWorksheet("Isi Harga")!;
    const r = wb.getWorksheet("Rincian Iyok")!;
    const semenH = cariBaris(h, 3, "Semen Portland komposit 50 kg");
    const semenR = cariBaris(r, 2, "Semen Portland komposit 50 kg");
    expect(rumus(r.getCell(semenR, 5))).toBe(`'Isi Harga'!$G$${semenH}`);
    expect(rumus(r.getCell(semenR, 6))).toBe(`ROUND(D${semenR}*E${semenR},0)`);
    const batu = cariBaris(r, 2, "Batu belah");
    expect(r.getCell(batu, 5).value).toBe(330_000);
    expect(r.getCell(batu, 8).value).toBe("harga analisa kontrak");
    // Baris item: jumlah = Σ komponennya; asal rincian disebut.
    const beton = cariBaris(r, 2, "Beton fc' 20 MPa");
    expect(rumus(r.getCell(beton, 6))).toBe(`SUM(F${beton + 1}:F${beton + 2})`);
    // Analisa AI yang dipakai ulang dari uraian sama di lokasi lain menyebut asalnya (DECISIONS 807).
    expect(r.getCell(beton, 8).value).toBe("Usulan AI – diterima (dari Bolmut)");
  });

  it("item yang belum terurai: satu baris harga per satuan berwarna kuning untuk diisi", async () => {
    const wb = await baca([lokasi("Iyok", 92_000n, 160_000n)]);
    const r = wb.getWorksheet("Rincian")!;
    const khusus = cariBaris(r, 2, "Pekerjaan khusus");
    expect(r.getCell(khusus, 8).value).toBe("Belum terurai");
    expect(String(r.getCell(khusus + 1, 2).value)).toContain("Harga per satuan – isi (belum terurai: satuan tidak sepadan)");
    expect((r.getCell(khusus + 1, 5).fill as ExcelJS.FillPattern).fgColor?.argb).toBe("FFFFF2CC");
  });

  it("biaya di luar item RAB & tak terduga: volume dari data lokasi, harga dan persen KOSONG untuk diisi", async () => {
    const wb = await baca([lokasi("Iyok", 92_000n, 160_000n)]);
    const r = wb.getWorksheet("Rincian")!;
    const gaji = cariBaris(r, 2, "Gaji manajer lapangan (site manager)");
    expect(r.getCell(gaji, 4).value).toBe(3.5);
    expect(r.getCell(gaji, 5).value).toBeNull();
    expect(r.getCell(gaji, 9).value).toBeNull();
    const tak = cariBaris(r, 2, "Cadangan biaya tak terduga");
    expect(r.getCell(tak, 4).value).toBeNull();
    expect(r.getCell(tak, 7).value).toBe("Tak terduga");
    // Harga bahan = harga sampai di lokasi: tidak ada baris angkutan material terpisah.
    expect(() => cariBaris(r, 2, "Angkutan dan bongkar muat material ke lokasi (paket)")).toThrow();
    const uji = cariBaris(r, 2, "Uji kuat tekan beton (benda uji silinder)");
    expect(r.getCell(uji, 4).value).toBe(6); // 3 × maks(2, ⌈10/15⌉)
  });

  it("Rekapitulasi menjumlah per kategori dari sheet Rincian masing-masing lokasi", async () => {
    const wb = await baca([lokasi("Iyok", 92_000n, 160_000n), lokasi("Jiko", 95_000n, 160_000n)]);
    const k = wb.getWorksheet("Rekapitulasi")!;
    const jiko = cariBaris(k, 2, "Jiko");
    expect(rumus(k.getCell(jiko, 3))).toBe(`SUMIFS('Rincian Jiko'!$F:$F,'Rincian Jiko'!$G:$G,"Bahan")`);
    expect(k.getCell(jiko, 10).value).toBe(30_000_000);
    expect(cariBaris(k, 2, "JUMLAH")).toBeGreaterThan(jiko);
  });

  it("semua sheet A4 (siapCetakA4)", async () => {
    const wb = await baca([lokasi("Iyok", 92_000n, 160_000n)]);
    for (const ws of wb.worksheets) expect(ws.pageSetup.paperSize).toBe(9);
  });
});

describe("daftar sumber daya", () => {
  it("berkode urut kategori (bahan, upah) lalu nama; satu baris per sumber daya lintas lokasi", () => {
    const sd = daftarSumberDaya([lokasi("Iyok", 92_000n, 160_000n), lokasi("Jiko", 92_000n, 160_000n)]);
    expect([...sd.values()].map((b) => [b.kode, b.kategori, b.nama, b.hargaDipakai])).toEqual([
      ["H0001", "bahan", "Batu belah", null],
      ["H0002", "bahan", "Semen Portland komposit 50 kg", 92_000n],
      ["H0003", "upah", "Pekerja", 160_000n],
    ]);
  });
});
