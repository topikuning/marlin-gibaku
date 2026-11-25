import { describe, expect, it } from "vitest";
import {
  barisDiubahSesudah,
  keadaanUsulan,
  periksaPasanganAktif,
  rencanaPulihNol,
  ruangVolume,
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

describe("ruangVolume", () => {
  it("terlapor + pindahan tidak boleh melebihi volume item sasaran", () => {
    expect(ruangVolume({ volume: 12, terlapor: 7, pindahan: 5 })).toEqual({ cukup: true, kelebihan: 0, sisa: 5 });
    expect(ruangVolume({ volume: 12, terlapor: 7, pindahan: 6.5 })).toEqual({ cukup: false, kelebihan: 1.5, sisa: 5 });
  });

  it("toleransi pembulatan Decimal(15,3)", () => {
    expect(ruangVolume({ volume: 1.2, terlapor: 0.7, pindahan: 0.5 }).cukup).toBe(true);
    expect(ruangVolume({ volume: 1, terlapor: 0.6, pindahan: 0.4004 }).cukup).toBe(true);
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
