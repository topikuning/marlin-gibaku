import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));

const { buildExistingLocationIndex, locationKey } = await import(
  "../../src/lib/master-location/queries"
);

/**
 * Bug lapangan (user 2026-07-31): dropdown koreksi lokasi menampilkan lokasi
 * yang SUDAH dipakai. Akarnya pencocokan katalog ↔ Location riil memakai kunci
 * alami penuh termasuk kecamatan, padahal Location riil lazim dibuat tanpa
 * kecamatan (kolom opsional) sementara baris katalog mengisinya — tidak pernah
 * ada yang cocok, jadi 73 dari 73 baris lolos sebagai "tersedia".
 */

const L = (province: string, regency: string, district: string | null, village: string) => ({
  province,
  regency,
  district,
  village,
});

describe("buildExistingLocationIndex – katalog ↔ Location riil", () => {
  it("KASUS BUG: Location riil tanpa kecamatan tetap mengenali katalog yang berkecamatan", () => {
    const idx = buildExistingLocationIndex([L("Jawa Tengah", "Jepara", null, "Ujungwatu")]);
    expect(idx.has(L("Jawa Tengah", "Jepara", "Donorojo", "Ujungwatu"))).toBe(true);
  });

  it("kebalikannya juga: katalog tanpa kecamatan vs Location riil berkecamatan", () => {
    const idx = buildExistingLocationIndex([L("Jawa Timur", "Lamongan", "Paciran", "Kemantren")]);
    expect(idx.has(L("Jawa Timur", "Lamongan", null, "Kemantren"))).toBe(true);
    expect(idx.has(L("Jawa Timur", "Lamongan", "", "Kemantren"))).toBe(true);
  });

  it("kecamatan sama → cocok", () => {
    const idx = buildExistingLocationIndex([L("Bali", "Jembrana", "Melaya", "Candikusuma")]);
    expect(idx.has(L("Bali", "Jembrana", "Melaya", "Candikusuma"))).toBe(true);
  });

  it("desa senama di kecamatan BERBEDA (dua-duanya terisi) tetap dibedakan", () => {
    const idx = buildExistingLocationIndex([L("Jawa Tengah", "Demak", "Bonang", "Purworejo")]);
    expect(idx.has(L("Jawa Tengah", "Demak", "Wedung", "Purworejo"))).toBe(false);
  });

  it("beda kabupaten / provinsi / desa → tidak cocok", () => {
    const idx = buildExistingLocationIndex([L("Jawa Tengah", "Demak", null, "Purworejo")]);
    expect(idx.has(L("Jawa Tengah", "Kebumen", null, "Purworejo"))).toBe(false);
    expect(idx.has(L("Jawa Timur", "Demak", null, "Purworejo"))).toBe(false);
    expect(idx.has(L("Jawa Tengah", "Demak", null, "Kedungmutih"))).toBe(false);
  });

  it("tahan beda kapital & spasi ganda", () => {
    const idx = buildExistingLocationIndex([L("  JAWA   TENGAH ", "Demak", null, "Kedung  Mutih")]);
    expect(idx.has(L("Jawa Tengah", "demak", "Wedung", "Kedung Mutih"))).toBe(true);
  });

  it("KASUS BUG 2: nama desa beda spasi tetap dikenali (Kedungmutih ↔ Kedung Mutih)", () => {
    const idx = buildExistingLocationIndex([L("Jawa Tengah", "Demak", null, "Kedung Mutih")]);
    expect(idx.has(L("Jawa Tengah", "Demak", "Wedung", "Kedungmutih"))).toBe(true);
  });

  it("index kosong tidak mencocokkan apa pun", () => {
    const idx = buildExistingLocationIndex([]);
    expect(idx.size).toBe(0);
    expect(idx.has(L("Bali", "Buleleng", null, "Sumberkima"))).toBe(false);
  });
});

describe("locationKey – pembanding KETAT, tetap menyertakan kecamatan", () => {
  it("dipakai untuk katalog ↔ katalog: kecamatan berbeda = baris berbeda", () => {
    expect(locationKey(L("Jawa Tengah", "Demak", "Bonang", "Purworejo"))).not.toBe(
      locationKey(L("Jawa Tengah", "Demak", "Wedung", "Purworejo")),
    );
  });

  it("normalisasi kapital/spasi tetap berlaku", () => {
    expect(locationKey(L("Jawa  Tengah", "DEMAK", "Bonang", "Purworejo"))).toBe(
      locationKey(L("jawa tengah", "demak", "bonang", "purworejo")),
    );
  });
});
