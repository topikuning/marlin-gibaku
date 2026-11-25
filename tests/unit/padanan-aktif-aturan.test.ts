import { describe, expect, it } from "vitest";
import {
  bagiProporsional,
  barisDiubahSesudah,
  bobotDinolkan,
  keadaanUsulan,
  periksaSasaran,
  rencanaLuarRab,
  satuanSama,
  tentukanMasuk,
} from "@/lib/rab/padanan-aktif-aturan";

/**
 * PEMASANGAN REALISASI SESUDAH AKTIVASI – aturan murni (DECISIONS 777/780/781).
 *
 * Ketetapan user 2026-11-25: *"intinya kasih saja semua list pekerjaan di RAB
 * aktif, untuk dipadankan, satuan dsb mengikuti rab aktif, hanya volume saja
 * disesuaikan atau bisa diinput sesuai sisa. mitigasi total masalah pemetaan
 * manual ini."*
 */

const sasaran = (o: Partial<Parameters<typeof periksaSasaran>[0]> = {}) => ({
  lineageKey: "IV#7",
  kind: "item",
  name: "Urugan pasir t=5 cm",
  punyaAnak: false,
  ...o,
});
const aktif = new Set(["IV#7", "V#1"]);

describe("periksaSasaran – semua item pekerjaan RAB aktif boleh, apa pun kategori dan satuannya", () => {
  it("item pekerjaan RAB aktif tanpa rincian → sah (kategori lain juga)", () => {
    expect(periksaSasaran(sasaran(), aktif, "IV#3")).toBeNull();
    expect(periksaSasaran(sasaran({ lineageKey: "V#1" }), aktif, "IV#3")).toBeNull();
    expect(periksaSasaran(sasaran(), aktif, null)).toBeNull();
  });

  it("yang tersisa hanya syarat bentuk: di RAB aktif, item pekerjaan, tanpa rincian, bukan item yang sama", () => {
    expect(periksaSasaran(sasaran({ lineageKey: "IV#99" }), aktif)).toMatch(/tidak ada di RAB aktif/);
    expect(periksaSasaran(sasaran({ kind: "kategori" }), aktif)).toMatch(/bukan item pekerjaan/);
    expect(periksaSasaran(sasaran({ punyaAnak: true }), aktif)).toMatch(/rincian/);
    expect(periksaSasaran(sasaran(), aktif, "IV#7")).toMatch(/item yang sama/);
  });
});

describe("satuanSama", () => {
  it("penulisan berbeda dianggap sama; yang tidak diketahui cocok dengan apa pun", () => {
    expect(satuanSama("m³", "M3")).toBe(true);
    expect(satuanSama("-", "m2")).toBe(true);
    expect(satuanSama(null, "m2")).toBe(true);
    expect(satuanSama("m", "m2")).toBe(false);
  });
});

describe("tentukanMasuk – volume yang masuk diisi orang, paling banyak sebesar sisa", () => {
  it("kosong + satuan sama → volume asal, dibatasi sisa; kelebihannya disebut", () => {
    expect(tentukanMasuk({ asal: 7, diminta: null, sisa: 12, satuanSama: true, ketat: true })).toEqual({ masuk: 7, dipotong: 0 });
    expect(tentukanMasuk({ asal: 53.17, diminta: null, sisa: 30, satuanSama: true, ketat: true })).toEqual({
      masuk: 30,
      dipotong: 23.17,
    });
  });

  it("beda satuan wajib diisi; isiannya dipakai dan tidak ada 'dipotong' (satuannya lain)", () => {
    expect(tentukanMasuk({ asal: 1, diminta: null, sisa: 10, satuanSama: false, ketat: true })).toEqual({ galat: "isi_volume" });
    expect(tentukanMasuk({ asal: 1, diminta: 2.5, sisa: 10, satuanSama: false, ketat: true })).toEqual({ masuk: 2.5, dipotong: 0 });
  });

  it("isian di atas sisa: ditolak saat diajukan, dipotong ke sisa saat berlaku", () => {
    expect(tentukanMasuk({ asal: 7, diminta: 9, sisa: 8, satuanSama: true, ketat: true })).toEqual({ galat: "melebihi" });
    expect(tentukanMasuk({ asal: 7, diminta: 7, sisa: 2, satuanSama: true, ketat: false })).toEqual({ masuk: 2, dipotong: 5 });
    expect(tentukanMasuk({ asal: 7, diminta: -1, sisa: 8, satuanSama: true, ketat: true })).toEqual({ galat: "negatif" });
  });

  it("sisa 0 tetap boleh – hanya dipetakan, volumenya 0", () => {
    expect(tentukanMasuk({ asal: 7, diminta: null, sisa: 0, satuanSama: true, ketat: true })).toEqual({ masuk: 0, dipotong: 7 });
    expect(tentukanMasuk({ asal: 7, diminta: 0, sisa: 0, satuanSama: false, ketat: true })).toEqual({ masuk: 0, dipotong: 0 });
  });
});

describe("bagiProporsional – naik atau turun, totalnya persis", () => {
  const jumlah = (v: number[]) => Math.round(v.reduce((t, x) => t + x, 0) * 1000) / 1000;
  it("target sama dengan bobot → bobotnya apa adanya", () => {
    expect(bagiProporsional([4, 3], 7)).toEqual([4, 3]);
    expect(bagiProporsional([0.1, 0.2, 0.3], 0.6)).toEqual([0.1, 0.2, 0.3]);
  });
  it("turun dan naik (beda satuan): sesuai porsi, Σ persis target", () => {
    const turun = bagiProporsional([4, 3], 5.5);
    expect(turun).toEqual([3.143, 2.357]);
    const naik = bagiProporsional([4, 3], 10);
    expect(jumlah(naik)).toBe(10);
    expect(naik[0]).toBeGreaterThan(naik[1]!);
  });
  it("bobot semuanya 0 → dibagi sama rata; target 0 → semuanya 0", () => {
    expect(bagiProporsional([0, 0], 3)).toEqual([1.5, 1.5]);
    expect(bagiProporsional([4, 3], 0)).toEqual([0, 0]);
    expect(bagiProporsional([], 3)).toEqual([]);
  });
});

describe("bobotDinolkan – angka sebelum diturunkan saat aktivasi, kecuali yang sudah diubah orang", () => {
  const jejak = [
    { tanggal: "2026-10-01", dari: 2.5, ke: 0 },
    { tanggal: "2026-10-03", dari: 1.25, ke: 0 },
  ];
  it("baris yang masih seperti sesudah aktivasi → angka sebelumnya; yang diubah → angkanya sekarang", () => {
    const b = bobotDinolkan(jejak, [
      { id: "a", tanggal: "2026-10-01", volume: 0 },
      { id: "b", tanggal: "2026-10-03", volume: 0.5 },
      { id: "c", tanggal: "2026-11-01", volume: 0.7 },
    ]);
    expect([...b]).toEqual([
      ["a", 2.5],
      ["b", 0.5],
      ["c", 0.7],
    ]);
  });
});

describe("keadaanUsulan – diturunkan dari tanggal", () => {
  const t = new Date("2026-11-25T03:00:00Z");
  it("diajukan → berlaku / ditutup → dilepas", () => {
    expect(keadaanUsulan({ berlakuPada: null, ditutupPada: null, dilepasPada: null })).toBe("diajukan");
    expect(keadaanUsulan({ berlakuPada: t, ditutupPada: null, dilepasPada: null })).toBe("berlaku");
    expect(keadaanUsulan({ berlakuPada: null, ditutupPada: t, dilepasPada: null })).toBe("ditutup");
    expect(keadaanUsulan({ berlakuPada: t, ditutupPada: null, dilepasPada: t })).toBe("dilepas");
  });
});

describe("barisDiubahSesudah – Lepas tidak boleh menimpa perubahan orang", () => {
  const berlaku = new Date("2026-11-25T03:00:00Z");
  it("baris yang ditulis saat pemasangan berlaku (dalam semenit) dianggap belum diubah", () => {
    expect(barisDiubahSesudah(new Date("2026-11-25T03:00:20Z"), berlaku)).toBe(false);
  });
  it("baris yang diubah lebih dari semenit sesudahnya dianggap diubah orang", () => {
    expect(barisDiubahSesudah(new Date("2026-11-25T04:00:00Z"), berlaku)).toBe(true);
  });
});

describe("rencanaLuarRab – satu baris per laporan, menumpang di baris yang ada, volume masuk dibagi", () => {
  const c = (id: string, reportId: string, tanggal: string, volume: number) => ({ id, reportId, tanggal, volume });

  it("catatan di laporan yang sama digabung; laporan yang sudah punya baris item tujuan ditambah", () => {
    const r = rencanaLuarRab(
      [c("b", "R2", "2026-10-02", 1.5), c("a", "R1", "2026-10-01", 2), c("a2", "R1", "2026-10-01", 1)],
      new Map([["R2", 4]]),
      4.5,
    );
    expect(r).toEqual([
      { reportId: "R1", tanggal: "2026-10-01", catatanIds: ["a", "a2"], tambah: 3, adaVolume: null },
      { reportId: "R2", tanggal: "2026-10-02", catatanIds: ["b"], tambah: 1.5, adaVolume: 4 },
    ]);
  });

  it("volume masuk lain dari catatan (dipotong, atau satuan lain): dibagi sesuai porsi catatannya", () => {
    expect(rencanaLuarRab([c("a", "R1", "2026-10-01", 6), c("b", "R2", "2026-10-02", 2)], new Map(), 5).map((b) => b.tambah)).toEqual([
      3.75, 1.25,
    ]);
    expect(rencanaLuarRab([c("a", "R1", "2026-10-01", 1)], new Map(), 2.5).map((b) => b.tambah)).toEqual([2.5]);
  });
});
