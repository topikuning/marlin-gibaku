import { describe, expect, it } from "vitest";
import { agregasiKebutuhan, type ItemUntukRapl } from "@/lib/ahsp/rapl-calc";

/**
 * Penurunan kebutuhan sumber daya dari RAB + AHSP (DECISIONS 320).
 *
 * Rumusnya sepele (koefisien × volume). Yang diuji di sini adalah SYARAT-nya —
 * karena di situlah simulasi ini bisa berbohong sambil terlihat rapi.
 */

function item(over: Partial<ItemUntukRapl> = {}): ItemUntukRapl {
  return {
    lineageKey: over.lineageKey ?? "I#1",
    code: over.code ?? "1",
    uraian: over.uraian ?? "Pekerjaan Beton",
    satuanNorm: over.satuanNorm ?? "m3",
    volume: over.volume === undefined ? 10 : over.volume,
    amount: over.amount ?? 1_000_000n,
    adaUsulan: over.adaUsulan ?? false,
    analisa:
      over.analisa === undefined
        ? {
            kode: "A.1",
            uraian: "1 m3 Beton mutu rendah",
            satuanNorm: "m3",
            komponen: [
              { kategori: "bahan", nama: "Semen PC", satuan: "kg", koefisien: 247 },
              { kategori: "upah", nama: "Pekerja", satuan: "OH", koefisien: 1.65 },
            ],
          }
        : over.analisa,
  };
}

describe("agregasiKebutuhan", () => {
  it("mengalikan koefisien dengan volume dan menjumlahkan lintas baris", () => {
    const h = agregasiKebutuhan([
      item({ lineageKey: "I#1", volume: 10 }),
      item({ lineageKey: "I#2", code: "2", volume: 5 }),
    ]);
    const semen = h.kebutuhan.find((k) => k.nama === "Semen PC")!;
    expect(semen.jumlah).toBe(247 * 15);
    expect(semen.satuan).toBe("kg");
    // "Dari berapa baris" ikut dilaporkan supaya asal angkanya bisa ditelusuri.
    expect(semen.dariBaris).toBe(2);
    expect(h.dipakai.baris).toBe(2);
    expect(h.dipakai.nilai).toBe(2_000_000n);
  });

  it("SATUAN yang tidak sepadan dikeluarkan, bukan dikalikan diam-diam", () => {
    /*
     * Analisa berbunyi "1 m3 Beton…" — koefisiennya per SATU METER KUBIK.
     * Mengalikannya dengan volume item bersatuan m² menghasilkan angka yang
     * rapi dan sepenuhnya tidak berarti. Ini bug paling berbahaya di seluruh
     * jalur RAPL karena hasilnya tidak terlihat salah.
     */
    const h = agregasiKebutuhan([item({ satuanNorm: "m2" })]);
    expect(h.kebutuhan).toEqual([]);
    expect(h.dilewat[0].alasan).toBe("satuan_tidak_sepadan");
    expect(h.dilewat[0].rinci).toContain("m2");
    expect(h.dilewat[0].rinci).toContain("m3");
    expect(h.nilaiDilewat.satuan_tidak_sepadan).toBe(1_000_000n);
  });

  it("satuan yang TIDAK DIKETAHUI tidak dianggap sepadan", () => {
    // Berkas master menulis "—" untuk satuan yang tidak terbaca. Dua-duanya
    // kosong BUKAN berarti cocok — itu berarti tidak ada yang tahu.
    const h = agregasiKebutuhan([
      item({
        satuanNorm: "",
        analisa: { kode: "A.9", uraian: "Analisa", satuanNorm: "", komponen: [
          { kategori: "bahan", nama: "Pasir", satuan: "m3", koefisien: 1 },
        ] },
      }),
    ]);
    expect(h.kebutuhan).toEqual([]);
    expect(h.dilewat[0].alasan).toBe("satuan_tidak_sepadan");
  });

  it("analisa tanpa koefisien terstruktur dilewat dengan alasannya sendiri", () => {
    const h = agregasiKebutuhan([
      item({ analisa: { kode: "A.5", uraian: "Analisa kutipan", satuanNorm: "m3", komponen: [] } }),
    ]);
    expect(h.dilewat[0].alasan).toBe("tanpa_koefisien");
    expect(h.dilewat[0].rinci).toContain("A.5");
  });

  it("item tanpa volume dilewat — bukan dianggap nol", () => {
    // Nol berarti "tidak butuh apa-apa"; kosong berarti "tidak ada yang tahu".
    // Menyamakan keduanya membuat kebutuhan proyek terlihat lebih kecil.
    const h = agregasiKebutuhan([item({ volume: null })]);
    expect(h.kebutuhan).toEqual([]);
    expect(h.dilewat[0].alasan).toBe("volume_kosong");
  });

  it("padanan yang belum disetujui diperlakukan seperti tidak ada", () => {
    const h = agregasiKebutuhan([item({ analisa: null })]);
    expect(h.kebutuhan).toEqual([]);
    expect(h.dilewat[0].alasan).toBe("belum_disetujui");
    expect(h.dipakai.baris).toBe(0);
  });

  it('"tinggal disetujui" dibedakan dari "belum ada padanan sama sekali"', () => {
    // Pekerjaannya memang beda: yang satu diperiksa lalu diklik, yang satu
    // harus dicarikan analisanya. Diukur pada RAB Kedung Mutih, 534 baris
    // masuk kelompok ini — menyuruh semuanya dikerjakan dengan cara yang sama
    // membuat berkas unduhannya tidak bisa dipakai membagi tugas.
    const h = agregasiKebutuhan([
      item({ lineageKey: "a", analisa: null, adaUsulan: true }),
      item({ lineageKey: "b", analisa: null, adaUsulan: false }),
    ]);
    expect(h.dilewat[0].rinci).toMatch(/tinggal diperiksa lalu disetujui/i);
    expect(h.dilewat[1].rinci).toMatch(/perlu dicarikan analisanya/i);
  });

  it("nilai yang dilewat dilaporkan per alasan — supaya lubangnya terukur", () => {
    const h = agregasiKebutuhan([
      item({ lineageKey: "a", satuanNorm: "m2", amount: 5_000_000n }),
      item({ lineageKey: "b", volume: null, amount: 3_000_000n }),
      item({ lineageKey: "c", analisa: null, amount: 2_000_000n }),
      item({ lineageKey: "d", amount: 9_000_000n }),
    ]);
    expect(h.dipakai.nilai).toBe(9_000_000n);
    expect(h.nilaiDilewat.satuan_tidak_sepadan).toBe(5_000_000n);
    expect(h.nilaiDilewat.volume_kosong).toBe(3_000_000n);
    expect(h.nilaiDilewat.belum_disetujui).toBe(2_000_000n);
    // Tidak ada nilai yang menguap: dipakai + dilewat = seluruhnya.
    const totalLewat = Object.values(h.nilaiDilewat).reduce((a, b) => a + b, 0n);
    expect(h.dipakai.nilai + totalLewat).toBe(19_000_000n);
  });

  it("besar-kecil huruf satuan BUKAN pembeda — Kg dan kg satu bahan", () => {
    // Kalau ikut jadi kunci, satu bahan pecah jadi dua baris berjumlah separuh
    // dan pembacanya menyimpulkan kebutuhannya lebih kecil dari yang sebenarnya.
    const h = agregasiKebutuhan([
      item({
        analisa: {
          kode: "A.1",
          uraian: "x",
          satuanNorm: "m3",
          komponen: [
            { kategori: "bahan", nama: "Semen PC", satuan: "Kg", koefisien: 100 },
            { kategori: "bahan", nama: "Semen PC", satuan: "kg", koefisien: 50 },
          ],
        },
      }),
    ]);
    expect(h.kebutuhan).toHaveLength(1);
    expect(h.kebutuhan[0].jumlah).toBe(150 * 10);
  });

  it("komponen UPAH bersatuan bahan ditandai janggal, bukan dipindahkan", () => {
    /*
     * Cacat nyata di berkas SE DJBK 47/2026: analisa [2.3.(21a)] "Saluran U
     * Pracetak" mendaftarkan "Semen (Kg)" sebagai UPAH — 334 komponen serupa
     * tersebar di 62 analisa. Menebak maksudnya lalu memindahkannya sendiri ke
     * "bahan" akan menghasilkan angka yang tidak bisa dipertanggungjawabkan;
     * yang benar adalah menandainya supaya ada yang memeriksa halaman PDF-nya.
     */
    const h = agregasiKebutuhan([
      item({
        analisa: {
          kode: "2.3.(21a)",
          uraian: "Saluran U Pracetak",
          satuanNorm: "m3",
          komponen: [
            { kategori: "upah", nama: "Semen", satuan: "Kg", koefisien: 1 },
            { kategori: "upah", nama: "Pekerja", satuan: "OH", koefisien: 1 },
          ],
        },
      }),
    ]);
    const semen = h.kebutuhan.find((k) => k.nama === "Semen")!;
    const pekerja = h.kebutuhan.find((k) => k.nama === "Pekerja")!;
    // Tetap di kategori aslinya — ditandai, bukan dipindahkan.
    expect(semen.kategori).toBe("upah");
    expect(semen.janggal).toBe(true);
    expect(pekerja.janggal).toBe(false);
  });

  it("nama yang berbeda TIDAK disatukan, satuan yang berbeda juga tidak", () => {
    // "Semen PC" dan "Semen Portland" mungkin barang yang sama — tapi memutuskan
    // itu bukan tugas pengurut daftar. Menggabungkannya diam-diam menghasilkan
    // satu angka yang tak seorang pun bisa pertanggungjawabkan.
    const h = agregasiKebutuhan([
      item({
        analisa: {
          kode: "A.1",
          uraian: "x",
          satuanNorm: "m3",
          komponen: [
            { kategori: "bahan", nama: "Semen PC", satuan: "kg", koefisien: 1 },
            { kategori: "bahan", nama: "Semen Portland", satuan: "kg", koefisien: 1 },
            { kategori: "bahan", nama: "Semen PC", satuan: "zak", koefisien: 1 },
          ],
        },
      }),
    ]);
    expect(h.kebutuhan).toHaveLength(3);
  });

  it("mengurutkan upah → bahan → alat, lalu dari yang terbesar", () => {
    const h = agregasiKebutuhan([
      item({
        analisa: {
          kode: "A.1",
          uraian: "x",
          satuanNorm: "m3",
          komponen: [
            { kategori: "alat", nama: "Molen", satuan: "jam", koefisien: 0.5 },
            { kategori: "bahan", nama: "Pasir", satuan: "m3", koefisien: 0.5 },
            { kategori: "bahan", nama: "Semen", satuan: "kg", koefisien: 200 },
            { kategori: "upah", nama: "Mandor", satuan: "OH", koefisien: 0.1 },
          ],
        },
      }),
    ]);
    expect(h.kebutuhan.map((k) => k.nama)).toEqual(["Mandor", "Semen", "Pasir", "Molen"]);
  });

  it("koefisien 8 desimal tidak hilang jadi nol", () => {
    // Koefisien alat berat lazim 0,0000xxx. Pembulatan yang terlalu kasar akan
    // menghapusnya dan membuat kebutuhan alat tampak tidak ada.
    const h = agregasiKebutuhan([
      item({
        volume: 1000,
        analisa: {
          kode: "A.1",
          uraian: "x",
          satuanNorm: "m3",
          komponen: [{ kategori: "alat", nama: "Excavator", satuan: "jam", koefisien: 0.00012345 }],
        },
      }),
    ]);
    expect(h.kebutuhan[0].jumlah).toBeCloseTo(0.12345, 5);
  });
});
