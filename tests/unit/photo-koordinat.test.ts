// KOORDINAT FOTO — NaN dari EXIF cacat pernah menjatuhkan seluruh unggahan.
//
// Produksi 2026-08-03: `exifGpsLat: "NaN"` dikirim ke kolom Decimal, Prisma
// menolak dengan PrismaClientValidationError (BUKAN PhotoError), errornya
// melompati seluruh penanganan foto dan menjatuhkan permintaannya — volume
// sudah tersimpan, foto batal, pelapor cuma melihat halaman error.
//
// Sebabnya satu baris: `typeof tags.gps.Latitude === "number"` — dan
// `typeof NaN === "number"` bernilai true.
import { describe, expect, it } from "vitest";
import {
  angkaKoordinat,
  pasanganKoordinat,
  desimalKoordinat,
} from "@/lib/photo-koordinat";

describe("KASUS INTI: NaN tidak boleh lolos sebagai koordinat", () => {
  it("NaN ditolak — pemeriksaan tipe saja meloloskannya", () => {
    expect(typeof NaN === "number", "premis bug aslinya").toBe(true);
    expect(angkaKoordinat(NaN, 90)).toBeNull();
  });

  it("Infinity juga ditolak", () => {
    expect(angkaKoordinat(Infinity, 90)).toBeNull();
    expect(angkaKoordinat(-Infinity, 180)).toBeNull();
  });

  it("bukan angka ditolak", () => {
    for (const v of ["-6.9", null, undefined, {}, []]) {
      expect(angkaKoordinat(v, 90), String(v)).toBeNull();
    }
  });

  it("angka wajar diterima apa adanya, termasuk 0", () => {
    expect(angkaKoordinat(-6.917464, 90)).toBe(-6.917464);
    expect(angkaKoordinat(0, 90)).toBe(0);
    expect(angkaKoordinat(-90, 90)).toBe(-90);
    expect(angkaKoordinat(180, 180)).toBe(180);
  });

  it("di luar rentang ditolak — koordinat mustahil bukan koordinat", () => {
    // EXIF cacat bisa memberi angka berhingga tapi mustahil. Kalau lolos, ia
    // jadi bukti GPS palsu di cap foto.
    expect(angkaKoordinat(200, 90)).toBeNull();
    expect(angkaKoordinat(-91, 90)).toBeNull();
    expect(angkaKoordinat(181, 180)).toBeNull();
  });
});

describe("pasangan koordinat: setengah = tidak ada", () => {
  it("lintang tanpa bujur tidak menunjuk tempat mana pun", () => {
    expect(pasanganKoordinat(-6.9, NaN)).toEqual({ lat: null, lng: null });
    expect(pasanganKoordinat(NaN, 110.4)).toEqual({ lat: null, lng: null });
    expect(pasanganKoordinat(-6.9, undefined)).toEqual({ lat: null, lng: null });
  });

  it("pasangan sah diteruskan utuh", () => {
    expect(pasanganKoordinat(-6.917464, 110.435)).toEqual({ lat: -6.917464, lng: 110.435 });
  });

  it("rentang dibedakan: 100 sah sebagai bujur, tidak sebagai lintang", () => {
    expect(pasanganKoordinat(100, 100)).toEqual({ lat: null, lng: null });
    expect(pasanganKoordinat(-6, 100)).toEqual({ lat: -6, lng: 100 });
  });
});

describe("lapis terakhir sebelum kolom Decimal", () => {
  it('NaN/Infinity jadi null, bukan string "NaN"', () => {
    expect(desimalKoordinat(NaN)).toBeNull();
    expect(desimalKoordinat(Infinity)).toBeNull();
    expect(desimalKoordinat(null)).toBeNull();
    expect(desimalKoordinat(undefined)).toBeNull();
  });

  it("angka ditulis 7 desimal — presisi kolom Decimal(10,7)", () => {
    expect(desimalKoordinat(-6.917464)).toBe("-6.9174640");
    expect(desimalKoordinat(0)).toBe("0.0000000");
  });

  it("hasilnya selalu bisa dibaca balik sebagai angka", () => {
    // Ini yang gagal di produksi: "NaN" lolos ke Prisma dan ditolak sebagai
    // "invalid digit found in string. Expected decimal String."
    for (const v of [-6.917464, 0, 90, -180]) {
      expect(Number.isFinite(Number(desimalKoordinat(v))), String(v)).toBe(true);
    }
  });
});
