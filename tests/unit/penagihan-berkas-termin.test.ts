import { describe, expect, it } from "vitest";
import {
  awalanPeriodeTermin,
  namaLaporanTermin,
  periodePekerjaanTermin,
  refKeyPekerjaanTermin,
  rencanaBerkasTermin,
  rentangMingguTermin,
  uraiPeriodeTermin,
  type PekerjaanTermin,
} from "@/lib/penagihan/berkas-termin-aturan";
import { KATALOG_BERKAS_TERMIN, type StatusButir } from "@/lib/penagihan/katalog";

/**
 * "Siapkan berkas Termin n" (DECISIONS 721): periode laporan termin dan
 * daftar pekerjaan unggahnya.
 */

describe("rentangMingguTermin", () => {
  it("termin 1: minggu 1 s.d. minggu prestasinya", () => {
    expect(rentangMingguTermin(1, [{ terminKe: 1, mingguKe: 7 }])).toEqual({ ok: true, rentang: { awal: 1, akhir: 7 } });
  });

  it("termin berikutnya: sesudah minggu prestasi termin sebelumnya, tidak terikat nomor minggu tetap", () => {
    const prestasi = [
      { terminKe: 1, mingguKe: 7 },
      { terminKe: 2, mingguKe: 11 },
      { terminKe: 3, mingguKe: 19 },
    ];
    expect(rentangMingguTermin(2, prestasi)).toEqual({ ok: true, rentang: { awal: 8, akhir: 11 } });
    expect(rentangMingguTermin(3, prestasi)).toEqual({ ok: true, rentang: { awal: 12, akhir: 19 } });
  });

  it("progres yang belum diisi menunjuk termin yang harus diisi", () => {
    expect(rentangMingguTermin(1, [])).toMatchObject({ ok: false, terminKe: 1 });
    expect(rentangMingguTermin(2, [{ terminKe: 2, mingguKe: 10 }])).toMatchObject({ ok: false, terminKe: 1 });
    expect(rentangMingguTermin(2, [{ terminKe: 1, mingguKe: 7 }])).toMatchObject({ ok: false, terminKe: 2 });
  });

  it("minggu prestasi yang tidak maju ditolak, bukan dibalik diam-diam", () => {
    const r = rentangMingguTermin(2, [
      { terminKe: 1, mingguKe: 9 },
      { terminKe: 2, mingguKe: 9 },
    ]);
    expect(r).toMatchObject({ ok: false, terminKe: 2 });
    if (!r.ok) expect(r.alasan).toMatch(/tidak sesudah termin 1/);
  });
});

/** Semua butir dengan status bawaan halaman kosong; `ada` diisi per uji. */
function baris(ada: Record<string, { dokumenId: string } | { suratId: string }> = {}) {
  return KATALOG_BERKAS_TERMIN.map((b) => ({
    kode: b.kode,
    status: (ada[b.kode] ? "ada" : b.sumber === "marlin" && !b.surat ? "disiapkan_marlin" : "menunggu") as StatusButir,
    sumber: ada[b.kode] ?? null,
  }));
}

describe("rencanaBerkasTermin", () => {
  const dasar = { terminKe: 1, lokasi: ["L1", "L2"], rentang: { awal: 1, akhir: 3 }, bulan: [1] };

  it("laporan MARLIN: Kurva S sekali per paket; mingguan & harian per lokasi per minggu; bulanan per bulan; dokumentasi per lokasi", () => {
    const r = rencanaBerkasTermin({ ...dasar, baris: baris() });
    const hitung = (j: string) => r.filter((p) => p.jenis === j).length;
    expect(hitung("kurva_s")).toBe(1);
    expect(hitung("mingguan")).toBe(2 * 3);
    expect(hitung("harian")).toBe(2 * 3);
    expect(hitung("bulanan")).toBe(2 * 1);
    expect(hitung("dokumentasi")).toBe(2);
    expect(hitung("berkas")).toBe(0);
    // Satu PDF untuk dua folder: "7. Laporan Mingguan" dan BERKAS DOKUMEN TEKNIS 6.
    expect(r.find((p) => p.jenis === "mingguan")!.kode).toEqual(["7", "T6"]);
    expect(r.find((p) => p.jenis === "kurva_s")).toMatchObject({ kode: ["5", "T9"], locationId: null });
    expect(r.filter((p) => p.jenis === "harian").map((p) => p.nomor)).toEqual([1, 2, 3, 1, 2, 3]);
  });

  it("berkas yang sudah ada disalin; folder laporan yang diisi unggahan orang tidak ditimpa laporan MARLIN", () => {
    const r = rencanaBerkasTermin({
      ...dasar,
      baris: baris({ "3": { dokumenId: "spmk" }, "9a": { suratId: "s1" }, "5": { dokumenId: "kurva-sendiri" } }),
    });
    const salin = r.filter((p) => p.jenis === "berkas");
    expect(salin.map((p) => [p.kode[0], p.sumber])).toEqual([
      ["3", "dspmk"],
      ["5", "dkurva-sendiri"],
      ["9a", "ss1"],
    ]);
    expect(r.find((p) => p.jenis === "kurva_s")!.kode).toEqual(["T9"]);
  });

  it("butir yang belum ada di MARLIN tidak ikut (menunggu pihak lain, surat belum dibuat)", () => {
    const r = rencanaBerkasTermin({ ...dasar, baris: baris() });
    expect(r.some((p) => p.kode.includes("9c") || p.kode.includes("9b"))).toBe(false);
  });

  it("tanpa lokasi aktif: hanya berkas paket dan Kurva S", () => {
    const r = rencanaBerkasTermin({ ...dasar, lokasi: [], baris: baris({ "3": { dokumenId: "x" } }) });
    expect(r.map((p) => p.jenis).sort()).toEqual(["berkas", "kurva_s"]);
  });
});

describe("kunci & periode antrean", () => {
  const p: PekerjaanTermin = { terminKe: 2, jenis: "mingguan", nomor: 9, kode: ["7", "T6"], sumber: null, locationId: "L1" };

  it("periode bolak-balik utuh dan diawali nomor termin", () => {
    const periode = periodePekerjaanTermin(p);
    expect(periode.startsWith(awalanPeriodeTermin(2))).toBe(true);
    expect(periode.startsWith(awalanPeriodeTermin(1))).toBe(false);
    expect(uraiPeriodeTermin(periode, "L1")).toEqual(p);
    const salin: PekerjaanTermin = { terminKe: 1, jenis: "berkas", nomor: null, kode: ["9a"], sumber: "s123", locationId: null };
    expect(uraiPeriodeTermin(periodePekerjaanTermin(salin), null)).toEqual(salin);
  });

  it("termin 1 tidak ikut tersaring sebagai termin 10+", () => {
    expect(awalanPeriodeTermin(1)).toBe("1|");
    expect(periodePekerjaanTermin({ ...p, terminKe: 12 }).startsWith(awalanPeriodeTermin(1))).toBe(false);
  });

  it("refKey tidak berubah saat berkas sumber atau daftar folder berubah – tekan ulang memperbarui baris yang sama", () => {
    const a: PekerjaanTermin = { terminKe: 1, jenis: "berkas", nomor: null, kode: ["3"], sumber: "dlama", locationId: null };
    expect(refKeyPekerjaanTermin("P", a)).toBe(refKeyPekerjaanTermin("P", { ...a, sumber: "dbaru" }));
    expect(refKeyPekerjaanTermin("P", p)).toBe(refKeyPekerjaanTermin("P", { ...p, kode: ["T6"] }));
    expect(refKeyPekerjaanTermin("P", p)).not.toBe(refKeyPekerjaanTermin("P", { ...p, nomor: 10 }));
    expect(refKeyPekerjaanTermin("P", p)).not.toBe(refKeyPekerjaanTermin("P", { ...p, locationId: "L2" }));
  });

  it("periode rusak ditolak", () => {
    for (const rusak of ["", "x|mingguan|1|7|", "1|asal|1|7|", "1|mingguan|0|7|", "1|mingguan|1|99|", "1|mingguan|1||", "1|berkas||3|d|lebih"]) {
      expect(uraiPeriodeTermin(rusak, null), rusak).toBeNull();
    }
  });

  it("nama berkas laporan menyebut minggu dan lokasinya", () => {
    expect(namaLaporanTermin(p, { lokasi: "Asemdoyong", paket: "Paket A" })).toBe("Laporan Mingguan Minggu ke-9 - Asemdoyong.pdf");
    expect(namaLaporanTermin({ ...p, jenis: "kurva_s", nomor: null, locationId: null }, { lokasi: null, paket: "Paket A" })).toBe(
      "Kurva S - Paket A.pdf",
    );
  });
});
