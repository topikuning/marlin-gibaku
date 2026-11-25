import { describe, expect, it } from "vitest";
import {
  barisDiubahSesudah,
  keadaanUsulan,
  periksaPasanganAktif,
  rencanaPulihNol,
} from "@/lib/rab/padanan-aktif-aturan";

/**
 * PEMASANGAN REALISASI SESUDAH AKTIVASI – aturan murni (DECISIONS 777).
 *
 * Permintaan user 2026-11-25: *"buat bisa dipasangkan sesudah aktivasi, menu
 * khusus. mitigasi semua resiko dan penanganannya"*.
 */

const lama = { lineageKey: "IV#3", name: "Urugan pasir", unit: "m3" };
const sasaran = (o: Partial<Parameters<typeof periksaPasanganAktif>[1]> = {}) => ({
  lineageKey: "IV#7",
  kind: "item",
  name: "Urugan pasir t=5 cm",
  unit: "M3",
  punyaAnak: false,
  volume: 12,
  ...o,
});
const konteks = (o: Partial<Parameters<typeof periksaPasanganAktif>[2]> = {}) => ({
  lineageAktif: new Set(["IV#7", "IV#8", "V#1"]),
  lineageDraft: null,
  ...o,
});

describe("periksaPasanganAktif", () => {
  it("item baru di RAB aktif, kategori dan satuan sama → sah", () => {
    expect(periksaPasanganAktif(lama, sasaran(), konteks())).toBeNull();
  });

  it("sasaran harus item pekerjaan di RAB aktif, tanpa rincian, dan bervolume", () => {
    expect(periksaPasanganAktif(lama, sasaran({ lineageKey: "IV#99" }), konteks())).toMatch(/tidak ada di RAB aktif/);
    expect(periksaPasanganAktif(lama, sasaran({ kind: "kategori" }), konteks())).toMatch(/bukan item pekerjaan/);
    expect(periksaPasanganAktif(lama, sasaran({ punyaAnak: true }), konteks())).toMatch(/rincian/);
    expect(periksaPasanganAktif(lama, sasaran({ volume: 0 }), konteks())).toMatch(/volume 0/);
    expect(periksaPasanganAktif(lama, sasaran({ volume: null }), konteks())).toMatch(/volume 0/);
  });

  it("beda kategori atau beda satuan ditolak – volume pindah apa adanya", () => {
    expect(periksaPasanganAktif(lama, sasaran({ lineageKey: "V#1" }), konteks())).toMatch(/Beda kategori/);
    expect(periksaPasanganAktif(lama, sasaran({ unit: "m2" }), konteks())).toMatch(/Beda satuan/);
  });

  it("item yang sama, atau item lama yang muncul lagi di draft adendum, ditolak", () => {
    expect(
      periksaPasanganAktif({ ...lama, lineageKey: "IV#7" }, sasaran(), konteks({ lineageAktif: new Set(["IV#7"]) })),
    ).toMatch(/item yang sama/);
    expect(periksaPasanganAktif(lama, sasaran(), konteks({ lineageDraft: new Set(["IV#3"]) }))).toMatch(
      /draft adendum/,
    );
  });
});

describe("rencanaPulihNol: volume yang dinolkan saat aktivasi dipulihkan dari jejak auditnya", () => {
  const jejak = [
    { tanggal: "2026-10-01", dari: 2.5, ke: 0 },
    { tanggal: "2026-10-03", dari: 1.25, ke: 0 },
  ];

  it("baris yang masih seperti sesudah aktivasi → dipulihkan ke angka sebelumnya", () => {
    const r = rencanaPulihNol(jejak, [
      { id: "a", tanggal: "2026-10-01", volume: 0 },
      { id: "b", tanggal: "2026-10-03", volume: 0 },
    ]);
    expect(r).toEqual({ ok: true, pulih: new Map([["a", 2.5], ["b", 1.25]]) });
  });

  it("baris yang angkanya sudah berubah sesudah aktivasi → ditolak dengan tanggalnya, tidak ada yang dipulihkan", () => {
    const r = rencanaPulihNol(jejak, [
      { id: "a", tanggal: "2026-10-01", volume: 0 },
      { id: "b", tanggal: "2026-10-03", volume: 0.5 },
    ]);
    expect(r).toEqual({ ok: false, tanggal: ["2026-10-03"] });
  });

  it("baris yang tidak ada di jejak (tidak pernah diturunkan) tidak disentuh", () => {
    const r = rencanaPulihNol(jejak, [{ id: "c", tanggal: "2026-11-01", volume: 0 }]);
    expect(r).toEqual({ ok: true, pulih: new Map() });
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

/*
 * KELEBIHAN DIPOTONG, TIDAK DITOLAK (DECISIONS 780). Keluhan user 2026-11-25
 * (tangkapan layar "3 item cocok tetapi sisa volumenya kurang"): *"apa
 * gunanya ini? gimana aku mau memasangkan ini ke rab aktif?"*.
 */
describe("bagiMasuk – yang masuk sebatas sisa volume, kelebihannya dipotong dibagi rata", () => {
  it("muat: tidak ada yang dipotong", async () => {
    const { bagiMasuk } = await import("@/lib/rab/padanan-aktif-aturan");
    expect(bagiMasuk([4, 3], { volume: 12, terlapor: 1 })).toEqual({ hasil: [4, 3], masuk: 7, dipotong: 0 });
  });

  it("tidak muat: dibagi rata ke sisa, totalnya persis sisa", async () => {
    const { bagiMasuk } = await import("@/lib/rab/padanan-aktif-aturan");
    const r = bagiMasuk([40, 13.17], { volume: 45, terlapor: 5 })!;
    expect(r.masuk).toBe(40);
    expect(r.dipotong).toBe(13.17);
    expect(Math.round(r.hasil.reduce((t, v) => t + v, 0) * 1000) / 1000).toBe(40);
    expect(r.hasil[0]).toBeGreaterThan(r.hasil[1]!);
  });

  it("sisa 0: tidak bisa menampung apa pun", async () => {
    const { bagiMasuk } = await import("@/lib/rab/padanan-aktif-aturan");
    expect(bagiMasuk([2], { volume: 10, terlapor: 10 })).toBeNull();
    expect(bagiMasuk([2], { volume: 10, terlapor: 11 })).toBeNull();
  });
});

/*
 * CATATAN PEKERJAAN DI LUAR RAB → ITEM RAB AKTIF (DECISIONS 780). Keluhan user
 * 2026-11-25: *"ada pekerjaan-pekerjaan di luar RAB yang sudah diinput manual,
 * itu dimana matchingkan dengan RAB aktifnya?"*.
 */
describe("rencanaLuarRab – satu baris per laporan, menumpang di baris yang ada, kelebihan dipotong", () => {
  const c = (id: string, reportId: string, tanggal: string, volume: number) => ({ id, reportId, tanggal, volume });

  it("catatan di laporan yang sama digabung; laporan yang sudah punya baris item tujuan ditambah", async () => {
    const { rencanaLuarRab } = await import("@/lib/rab/padanan-aktif-aturan");
    const r = rencanaLuarRab(
      [c("b", "R2", "2026-10-02", 1.5), c("a", "R1", "2026-10-01", 2), c("a2", "R1", "2026-10-01", 1)],
      new Map([["R2", 4]]),
      { volume: 20, terlapor: 5 },
    )!;
    expect(r.baris).toEqual([
      { reportId: "R1", tanggal: "2026-10-01", catatanIds: ["a", "a2"], tambah: 3, adaVolume: null },
      { reportId: "R2", tanggal: "2026-10-02", catatanIds: ["b"], tambah: 1.5, adaVolume: 4 },
    ]);
    expect([r.masuk, r.dipotong]).toEqual([4.5, 0]);
  });

  it("sisa kurang: dibagi rata per laporan, totalnya persis sisa; sisa 0 → null", async () => {
    const { rencanaLuarRab } = await import("@/lib/rab/padanan-aktif-aturan");
    const r = rencanaLuarRab([c("a", "R1", "2026-10-01", 6), c("b", "R2", "2026-10-02", 2)], new Map(), {
      volume: 8,
      terlapor: 3,
    })!;
    expect(r.baris.map((b) => b.tambah)).toEqual([3.75, 1.25]);
    expect([r.masuk, r.dipotong]).toEqual([5, 3]);
    expect(rencanaLuarRab([c("a", "R1", "2026-10-01", 1)], new Map(), { volume: 8, terlapor: 8 })).toBeNull();
  });
});

describe("periksaSasaranLuarRab – catatan tanpa kategori: yang diperiksa item dan satuannya", () => {
  const s = (o: Partial<Parameters<typeof periksaPasanganAktif>[1]> = {}) => sasaran({ lineageKey: "V#1", ...o });
  it("satuan sama (penulisan berbeda) atau tidak diketahui → sah, lintas kategori boleh", async () => {
    const { periksaSasaranLuarRab } = await import("@/lib/rab/padanan-aktif-aturan");
    const aktif = new Set(["V#1"]);
    expect(periksaSasaranLuarRab([{ uraian: "Urugan", satuan: "m³" }], s(), aktif)).toBeNull();
    expect(periksaSasaranLuarRab([{ uraian: "Urugan", satuan: "-" }], s(), aktif)).toBeNull();
    expect(periksaSasaranLuarRab([{ uraian: "Urugan", satuan: "m3" }], s({ unit: null }), aktif)).toBeNull();
  });
  it("beda satuan, bukan item, berincian, volume 0, tidak di RAB aktif → ditolak dengan sebabnya", async () => {
    const { periksaSasaranLuarRab } = await import("@/lib/rab/padanan-aktif-aturan");
    const aktif = new Set(["V#1"]);
    const cat = [{ uraian: "Urugan", satuan: "m3" }];
    expect(periksaSasaranLuarRab([...cat, { uraian: "Plester", satuan: "m2" }], s(), aktif)).toMatch(/Beda satuan: catatan "Plester"/);
    expect(periksaSasaranLuarRab(cat, s({ kind: "kategori" }), aktif)).toMatch(/bukan item pekerjaan/);
    expect(periksaSasaranLuarRab(cat, s({ punyaAnak: true }), aktif)).toMatch(/rincian/);
    expect(periksaSasaranLuarRab(cat, s({ volume: 0 }), aktif)).toMatch(/volume 0/);
    expect(periksaSasaranLuarRab(cat, s({ lineageKey: "V#2" }), aktif)).toMatch(/tidak ada di RAB aktif/);
  });
});
