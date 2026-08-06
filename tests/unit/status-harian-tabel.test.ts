// PEMIPIH BARIS PAPAN STATUS → BARIS GRID.
//
// Teguran user 2026-08-06: *"kenapa tidak kamu model grid saja, yang per
// kolomnya tombol... tiap kolom sortable... kamu ini terlalu rumit!"*
//
// Grid hanya bisa menyortir & menyaring nilai yang DATAR. Selama jejak Drive
// masih objek bersarang dan jejak WA masih `Date | null`, kolomnya tidak bisa
// disortir dengan benar — dan sortir yang salah di papan pengawasan lebih buruk
// daripada tidak ada sortir, karena ia terlihat meyakinkan.
import { describe, expect, it } from "vitest";
import { barisTabel, type SumberBaris } from "@/lib/daily-report/status-harian-tabel";

const sumber = (over: Partial<SumberBaris> = {}): SumberBaris => ({
  locationName: "Pasir",
  regency: "Kebumen",
  slug: "pasir",
  packageName: "KNMP Kebumen",
  driveFolderId: "fld-1",
  waGroupId: "grp-1",
  status: "final",
  itemCount: 3,
  fotoCount: 4,
  kegiatanCount: 1,
  kegiatanFotoCount: 2,
  waSentAt: null,
  drive: { status: null, webLink: null, at: null, error: null, fileSukses: 0 },
  ...over,
});

describe("barisTabel — nilai datar yang bisa disortir", () => {
  it("prasyarat jadi kolom sendiri, bukan kalimat panjang", () => {
    // Inti tegurannya: "kalau memang belum punya folder drive, kasih aja
    // seperti tombol atau symbol X warna merah". Kolom boolean itulah yang
    // membuat tandanya mungkin DAN membuat kolomnya bisa disortir.
    const b = barisTabel(sumber({ driveFolderId: null, waGroupId: null }));
    expect(b.punyaFolderDrive).toBe(false);
    expect(b.punyaGrupWa).toBe(false);
  });

  it("`diDrive` bernilai TIGA, bukan boolean", () => {
    // "Gagal" menuntut tindakan yang berbeda dari "belum dicoba": yang satu
    // perlu diperiksa sebabnya, yang lain tinggal diunggah. Melebur keduanya
    // jadi satu silang merah menyembunyikan bedanya.
    expect(barisTabel(sumber()).diDrive).toBe("Belum");
    expect(
      barisTabel(sumber({ drive: { status: "sukses", webLink: "x", at: null, error: null, fileSukses: 3 } }))
        .diDrive,
    ).toBe("Sudah");
    expect(
      barisTabel(sumber({ drive: { status: "gagal", webLink: null, at: null, error: "kuota", fileSukses: 0 } }))
        .diDrive,
    ).toBe("Gagal");
  });

  it("PUNYA folder tapi BELUM naik terpisah dari TIDAK punya folder", () => {
    // Pertanyaan yang paling sering diajukan ke papan ini, dan yang dulu
    // mustahil dijawab dengan menggulung: dua kolom berbeda, jadi menyortir
    // keduanya berturut-turut langsung mengelompokkannya.
    const punyaBelum = barisTabel(sumber({ driveFolderId: "fld-1" }));
    const tidakPunya = barisTabel(sumber({ driveFolderId: null }));
    expect([punyaBelum.punyaFolderDrive, punyaBelum.diDrive]).toEqual([true, "Belum"]);
    expect([tidakPunya.punyaFolderDrive, tidakPunya.diDrive]).toEqual([false, "Belum"]);
  });

  it("tanpa laporan jadi 'belum' (ditampilkan 'Belum lapor'), bukan null yang menggagalkan sortir", () => {
    expect(barisTabel(sumber({ status: null })).status).toBe("belum");
    expect(barisTabel(sumber({ status: "draft" })).status).toBe("draft");
  });

  it("WA jadi boolean; waktunya pindah ke keterangan", () => {
    const belum = barisTabel(sumber());
    expect(belum.waTerkirim).toBe(false);
    expect(belum.waKeterangan).toBe("Belum dikirim");

    const sudah = barisTabel(sumber({ waSentAt: new Date("2026-08-06T02:00:00.000Z") }));
    expect(sudah.waTerkirim).toBe(true);
    expect(sudah.waKeterangan).toMatch(/^Terkirim /);
  });

  it("foto kegiatan ikut dihitung di kolom Foto", () => {
    // Bagi yang membaca papan ini, "berapa foto hari itu" tidak membedakan foto
    // item dan foto kegiatan — keduanya bukti lapangan yang sama-sama terunggah.
    expect(barisTabel(sumber({ fotoCount: 4, kegiatanFotoCount: 2 })).foto).toBe(6);
  });

  it("`adaIsi` false hanya bila BENAR-BENAR kosong", () => {
    // Tombol unggah/kirim dimatikan lewat nilai ini. Salah sedikit saja,
    // tombolnya menjanjikan yang tidak bisa ditepati.
    expect(barisTabel(sumber({ itemCount: 0, fotoCount: 0, kegiatanCount: 0 })).adaIsi).toBe(false);
    expect(barisTabel(sumber({ itemCount: 1, fotoCount: 0, kegiatanCount: 0 })).adaIsi).toBe(true);
    expect(barisTabel(sumber({ itemCount: 0, fotoCount: 1, kegiatanCount: 0 })).adaIsi).toBe(true);
    expect(barisTabel(sumber({ itemCount: 0, fotoCount: 0, kegiatanCount: 1 })).adaIsi).toBe(true);
  });

  it("keterangan Drive memuat sebab kegagalan — di `title`, bukan di kolom", () => {
    const b = barisTabel(
      sumber({ drive: { status: "gagal", webLink: null, at: null, error: "kuota habis", fileSukses: 0 } }),
    );
    expect(b.driveKeterangan).toContain("GAGAL");
    expect(b.driveKeterangan).toContain("kuota habis");
  });
});
