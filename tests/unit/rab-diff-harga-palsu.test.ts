// PERINGATAN HARGA PALSU DI PRATINJAU ADENDUM.
//
// Laporan user 2026-09-01 (tangkapan layar): panel merah "Harga satuan 9 item
// KONTRAK LAMA berubah" menyala, sementara panel yang sama mencetak buktinya
// sendiri bahwa tidak ada yang berubah – sisi kontrak "Rp 0", sisi file kosong,
// dampak "(+Rp 0)". Item Pekerjaan Pondasi Tapak 30x60x60 memang berharga 0
// sejak awal.
//
// Yang diuji di sini bukan "peringatannya hilang", melainkan bahwa peringatan
// itu berbunyi TEPAT saat nilai kontrak benar-benar bergerak. Peringatan yang
// berbunyi untuk Rp 0 melatih mata mengabaikannya, dan pada saat yang sama
// mengubur satu baris yang sungguhan di antara delapan yang palsu.
import { describe, expect, it } from "vitest";
import { bandingkanTerhadapAktif, type NodeAktif } from "@/lib/rab/diff-parsed";
import type { FlatNode } from "@/lib/rab/flatten";

const kat: NodeAktif = {
  lineageKey: "I", kind: "kategori", code: "I", name: "PEKERJAAN STRUKTUR",
  volume: null, unitPrice: null, amount: 0n,
};

const aktifItem = (o: Partial<NodeAktif> & Pick<NodeAktif, "lineageKey" | "code" | "name">): NodeAktif => ({
  kind: "item", volume: null, unitPrice: null, amount: 0n, ...o,
});

const fileKategori = (amount: bigint): FlatNode => ({
  kind: "kategori", code: "I", name: "PEKERJAAN STRUKTUR", volume: null, unit: null,
  unitPrice: null, amount, lineageKey: "I", parentLineageKey: null, sortOrder: 0,
});

const fileItem = (o: Partial<FlatNode> & Pick<FlatNode, "lineageKey" | "code" | "name">): FlatNode => ({
  kind: "item", volume: null, unit: null, unitPrice: null, amount: 0n,
  parentLineageKey: "I", sortOrder: 1, ...o,
});

describe("nol dan kosong adalah keadaan yang sama, bukan perubahan harga", () => {
  it("harga kontrak 0 lawan sel harga kosong di file: BUKAN perubahan", () => {
    const aktif = [kat, aktifItem({ lineageKey: "I#10.c", code: "10.c", name: "Pekerjaan Pondasi Tapak 30x60x60 cm", volume: 4, unitPrice: 0 })];
    const baru = [fileKategori(0n), fileItem({ lineageKey: "I#10.c", code: "10.c", name: "Pekerjaan Pondasi Tapak 30x60x60 cm", volume: 4, unitPrice: null })];
    const h = bandingkanTerhadapAktif(aktif, baru, new Map());
    expect(h.hargaBerubah).toEqual([]);
    expect(h.jumlahTetap).toBe(1);
  });

  it("harga kontrak kosong lawan 0 di file: BUKAN perubahan (arah sebaliknya)", () => {
    const aktif = [kat, aktifItem({ lineageKey: "I#10.d", code: "10.d", name: "Pekerjaan Kolom Pedestal 25/25", volume: 2, unitPrice: null })];
    const baru = [fileKategori(0n), fileItem({ lineageKey: "I#10.d", code: "10.d", name: "Pekerjaan Kolom Pedestal 25/25", volume: 2, unitPrice: 0 })];
    expect(bandingkanTerhadapAktif(aktif, baru, new Map()).hargaBerubah).toEqual([]);
  });

  it("volume kontrak kosong lawan 0 di file: BUKAN perubahan volume", () => {
    const aktif = [kat, aktifItem({ lineageKey: "I#1", code: "1", name: "Mobilisasi", volume: null, unitPrice: 500 })];
    const baru = [fileKategori(0n), fileItem({ lineageKey: "I#1", code: "1", name: "Mobilisasi", volume: 0, unitPrice: 500 })];
    expect(bandingkanTerhadapAktif(aktif, baru, new Map()).volumeBerubah).toEqual([]);
  });
});

describe("gerbangnya adalah rupiah yang berpindah, bukan selisih desimal", () => {
  it("beda pembulatan tulis satu sen yang tidak memindahkan rupiah: BUKAN perubahan", () => {
    // Kasus APAR dari tangkapan layar: 706.908,69 lawan 706.908,70. Nilai
    // aslinya 706.908,695; satu dokumen membulatkan turun, satu naik.
    const aktif = [kat, aktifItem({ lineageKey: "I#6.9.a", code: "6.9.a", name: "Alat Pemadam Api Ringan (APAR)", volume: 12.5, unitPrice: 706_908.69, amount: 8_836_359n })];
    const baru = [fileKategori(8_836_359n), fileItem({ lineageKey: "I#6.9.a", code: "6.9.a", name: "Alat Pemadam Api Ringan (APAR)", volume: 12.5, unitPrice: 706_908.7, amount: 8_836_359n })];
    expect(bandingkanTerhadapAktif(aktif, baru, new Map()).hargaBerubah).toEqual([]);
  });

  it("pembulatan simpan Decimal(15,3) pada volume: BUKAN perubahan", () => {
    // File menulis 12,3456; kolom volume Decimal(15,3) menyimpan 12,346.
    // Selisih 0,0004 – 400x lebih besar dari EPS 1e-6, jadi berkas yang SAMA
    // dipratinjau ulang melaporkan "volume berubah" selamanya.
    const aktif = [kat, aktifItem({ lineageKey: "I#1", code: "1", name: "Urugan Pasir", volume: 12.346, unitPrice: 100_000 })];
    const baru = [fileKategori(1_234_600n), fileItem({ lineageKey: "I#1", code: "1", name: "Urugan Pasir", volume: 12.3456, unitPrice: 100_000, amount: 1_234_600n })];
    expect(bandingkanTerhadapAktif(aktif, baru, new Map()).volumeBerubah).toEqual([]);
  });

  it("kenaikan harga yang sungguhan TETAP berbunyi, dengan dampak rupiahnya", () => {
    const aktif = [kat, aktifItem({ lineageKey: "I#1", code: "1", name: "Beton K-250", volume: 10, unitPrice: 1_000_000, amount: 10_000_000n })];
    const baru = [fileKategori(11_000_000n), fileItem({ lineageKey: "I#1", code: "1", name: "Beton K-250", volume: 10, unitPrice: 1_100_000, amount: 11_000_000n })];
    const h = bandingkanTerhadapAktif(aktif, baru, new Map());
    expect(h.hargaBerubah).toHaveLength(1);
    expect(h.hargaBerubah[0].dampakRupiah).toBe(1_000_000n);
  });

  it("harga item lump-sum (volume kosong) berubah: berbunyi, dan dampaknya BUKAN Rp 0", () => {
    // Volume null membuat (baru - lama) x volume = 0, sehingga perubahan harga
    // termahal justru dilaporkan berdampak Rp 0 lalu terurut paling bawah dan
    // terpotong dari layar.
    const aktif = [kat, aktifItem({ lineageKey: "I#9", code: "9", name: "Pekerjaan Ls", volume: null, unitPrice: 100_000_000, amount: 100_000_000n })];
    const baru = [fileKategori(200_000_000n), fileItem({ lineageKey: "I#9", code: "9", name: "Pekerjaan Ls", volume: null, unitPrice: 200_000_000, amount: 200_000_000n })];
    const h = bandingkanTerhadapAktif(aktif, baru, new Map());
    expect(h.hargaBerubah).toHaveLength(1);
    expect(h.hargaBerubah[0].dampakRupiah).toBe(100_000_000n);
  });
});

describe("kolom JUMLAH yang bergeser sendiri tidak boleh terhitung tetap", () => {
  it("volume dan harga sama persis, JUMLAH berbeda: dilaporkan, tidak dihitung tetap", () => {
    // `flatten` memakai total_price dari berkas APA ADANYA bila ada, jadi
    // kolom JUMLAH yang diketik ulang menggeser nilai kontrak tanpa satu pun
    // volume atau harga bergerak. Cek-silang parser hanya bunyi di atas 1%.
    const aktif = [kat, aktifItem({ lineageKey: "I#1", code: "1", name: "Pasangan Batu", volume: 195, unitPrice: 400_000, amount: 78_000_000n })];
    const baru = [fileKategori(78_700_000n), fileItem({ lineageKey: "I#1", code: "1", name: "Pasangan Batu", volume: 195, unitPrice: 400_000, amount: 78_700_000n })];
    const h = bandingkanTerhadapAktif(aktif, baru, new Map());
    expect(h.jumlahTetap).toBe(0);
    expect(h.nilaiBergeser).toHaveLength(1);
    expect(h.nilaiBergeser[0].selisih).toBe(700_000n);
  });

  it("selisih 1 rupiah dari apportionment saudara BUKAN pergeseran nilai", () => {
    const aktif = [kat, aktifItem({ lineageKey: "I#1", code: "1", name: "Pasangan Batu", volume: 195, unitPrice: 400_000, amount: 78_000_000n })];
    const baru = [fileKategori(78_000_001n), fileItem({ lineageKey: "I#1", code: "1", name: "Pasangan Batu", volume: 195, unitPrice: 400_000, amount: 78_000_001n })];
    expect(bandingkanTerhadapAktif(aktif, baru, new Map()).nilaiBergeser).toEqual([]);
  });
});
