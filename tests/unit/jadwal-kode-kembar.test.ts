// KODE KATEGORI RAB TIDAK UNIK – PENCOCOKAN JADWAL TIDAK BOLEH MENGANDALKANNYA.
//
// Berkas HPS nyata KNMP memakai nomor romawi yang berulang: IX, X, dan XIV
// masing-masing dua kali. Importir RAB membedakannya lewat `lineageKey`
// ber-suffix `#N`, bukan lewat kode.
//
// Pencocok jadwal versi lama membangun `kode → lineageKey` tanpa memeriksa
// keunikan, jadi kode kembar ditimpa yang terakhir. Baris Excel "IX" mendarat
// di `IX#2`, baris "IX" berikutnya dibuang karena kuncinya sudah terpakai, dan
// kategori `IX` tidak pernah dapat jadwal. Tiga kategori sekaligus – 27,38%
// bobot – sehingga template Time Schedule terbitan MARLIN DITOLAK MARLIN
// sendiri saat diunggah balik: "Total bobot di Excel 72,62%".
//
// E2E `perbarui-kurva-s.spec.ts` merah di CI 2026-09-16.
import { describe, expect, it } from "vitest";
import { cocokkanKategoriJadwal } from "@/lib/scurve/jadwal-import";

/** Cuplikan persis dari basis RAB lokasi Kedungmutih. */
const KATEGORI = [
  { code: "VIII", name: "PEKERJAAN AREA PARKIR", lineageKey: "VIII" },
  { code: "IX", name: "PEKERJAAN BANGUNAN SHELTER COOL BOX", lineageKey: "IX" },
  { code: "IX", name: "PEKERJAAN BANGUNAN KIOS PERBEKALAN", lineageKey: "IX#2" },
  { code: "X", name: "PEKERJAAN BANGUNAN KANTOR PENGELOLA", lineageKey: "X" },
  { code: "X", name: "PEKERJAAN PLUMBING DISTRIBUSI AIR BERSIH DAN SUMUR BOR", lineageKey: "X#2" },
];

const baris = (code: string, name: string) => ({ code, name, weekly: [1, 2] });

describe("pencocokan baris jadwal Excel ke kategori RAB", () => {
  it("kode kembar TIDAK menelan kategori lain – tiap baris mendarat di kunci yang benar", () => {
    const hasil = cocokkanKategoriJadwal(
      KATEGORI.map((k) => baris(k.code, k.name)),
      KATEGORI,
    );
    expect(hasil.map((h) => h.lineageKey)).toEqual(["VIII", "IX", "IX#2", "X", "X#2"]);
  });

  it("tidak ada kategori yang kehilangan jadwalnya", () => {
    const hasil = cocokkanKategoriJadwal(
      KATEGORI.map((k) => baris(k.code, k.name)),
      KATEGORI,
    );
    expect(hasil).toHaveLength(KATEGORI.length);
  });

  it("kode UNIK tetap dipakai walau namanya disunting orang di Excel", () => {
    const hasil = cocokkanKategoriJadwal([baris("VIII", "Pekerjaan Area Parkir (revisi)")], KATEGORI);
    expect(hasil).toEqual([{ lineageKey: "VIII", weekly: [1, 2] }]);
  });

  it("baris yang tidak dikenali dilewati, bukan dipaksakan ke kategori terdekat", () => {
    const hasil = cocokkanKategoriJadwal([baris("ZZ", "PEKERJAAN ENTAH")], KATEGORI);
    expect(hasil).toEqual([]);
  });
});
