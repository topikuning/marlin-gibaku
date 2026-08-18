// KESEHATAN AKUN (DECISIONS 359).
//
// Yang diuji di sini bukan "apakah fungsinya mengembalikan array", melainkan
// bahwa ia tidak menuduh akun yang baik-baik saja dan tidak melewatkan akun
// yang benar-benar tidak bisa dipakai.
import { describe, expect, it } from "vitest";
import { butuhPenugasan, masalahAkun, type AkunRingkas } from "@/lib/users/kesehatan-akun";
import { ALL_ROLES, isCrossLocation } from "@/lib/authz";

const SEHAT: AkunRingkas = {
  role: "site_manager",
  isActive: true,
  mustChangePassword: false,
  waNumber: "628123456789",
  jumlahPenugasan: 2,
  pernahMasuk: true,
};

describe("butuhPenugasan", () => {
  it("mengikuti aturan akses yang sebenarnya, bukan daftar salinan", () => {
    // Kalau suatu saat sebuah peran dipindah ke lintas-lokasi, tes ini ikut
    // pindah sendiri — daftar peran yang ditulis ulang tidak akan.
    for (const r of ALL_ROLES) {
      expect(butuhPenugasan(r), r).toBe(!isCrossLocation(r));
    }
  });

  it("super admin & program director TIDAK butuh penugasan", () => {
    expect(butuhPenugasan("super_admin")).toBe(false);
    expect(butuhPenugasan("program_director")).toBe(false);
  });
});

describe("masalahAkun", () => {
  it("akun sehat tidak punya masalah sama sekali", () => {
    expect(masalahAkun(SEHAT)).toEqual([]);
  });

  it("peran ter-scope tanpa penugasan = tidak bisa melihat apa pun", () => {
    expect(masalahAkun({ ...SEHAT, jumlahPenugasan: 0 })).toEqual(["tanpa_penugasan"]);
  });

  it("super admin tanpa penugasan BUKAN masalah", () => {
    // Ia melihat seluruh organisasi tanpa penugasan; menandainya merah membuat
    // bilah "perlu perhatian" selalu berisi dan karenanya berhenti dibaca.
    expect(masalahAkun({ ...SEHAT, role: "super_admin", jumlahPenugasan: 0 })).toEqual([]);
  });

  it("nonaktif MENELAN masalah lain — cuma satu yang perlu dikerjakan", () => {
    const m = masalahAkun({
      ...SEHAT,
      isActive: false,
      jumlahPenugasan: 0,
      waNumber: null,
      mustChangePassword: true,
      pernahMasuk: false,
    });
    expect(m).toEqual(["nonaktif"]);
  });

  it("wajib ganti password + belum pernah masuk = belum dipakai", () => {
    expect(masalahAkun({ ...SEHAT, mustChangePassword: true, pernahMasuk: false })).toEqual([
      "belum_dipakai",
    ]);
  });

  it("wajib ganti password TAPI sudah pernah masuk bukan 'belum dipakai'", () => {
    // Bedanya penting: yang pertama berarti password awal masih beredar, yang
    // kedua hanya berarti orangnya diminta mengganti pada login berikutnya.
    expect(masalahAkun({ ...SEHAT, mustChangePassword: true, pernahMasuk: true })).toEqual([]);
  });

  it("nomor WA berisi SPASI tetap dihitung kosong", () => {
    // Kolom berisi " " lolos dari cek `!= null`, dan akun itu diam-diam tidak
    // pernah menerima pengingat laporan harian.
    expect(masalahAkun({ ...SEHAT, waNumber: "   " })).toEqual(["tanpa_wa"]);
    expect(masalahAkun({ ...SEHAT, waNumber: null })).toEqual(["tanpa_wa"]);
  });

  it("beberapa masalah sekaligus disebut semua, urut prioritas", () => {
    expect(
      masalahAkun({
        ...SEHAT,
        jumlahPenugasan: 0,
        mustChangePassword: true,
        pernahMasuk: false,
        waNumber: null,
      }),
    ).toEqual(["tanpa_penugasan", "belum_dipakai", "tanpa_wa"]);
  });
});
