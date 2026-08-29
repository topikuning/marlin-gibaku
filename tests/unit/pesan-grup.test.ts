// Teks pengingat harian yang masuk ke GRUP paket.
//
// Yang diuji di sini bukan keindahan kalimatnya, melainkan satu hal yang tidak
// bisa ditarik kembali: pesan ini dibaca PPK dan konsultan pengawas. Dua
// kegagalan yang harus mustahil — berbunyi padahal semua sudah melapor, dan
// menyebut nama orang alih-alih nama lokasi.
import { describe, expect, it } from "vitest";
import { pesanPengingatGrup } from "@/lib/harian/pesan-grup";

/** Em-dash ditulis lewat kode karakter supaya berkas uji ini sendiri lolos
 * penjaga `tanda-pisah-ui.test.ts` — yang memindai string di seluruh repo. */
const EM_DASH = String.fromCharCode(0x2014);

const DASAR = { namaPaket: "Paket 3 Jateng", tanggalTampil: "29 Agu 2026" };

describe("pesanPengingatGrup", () => {
  it("tidak berbunyi sama sekali kalau semua lokasi sudah melapor", () => {
    expect(pesanPengingatGrup({ ...DASAR, belum: [], sudah: 4 })).toBeNull();
  });

  it("menyebut yang belum, dan berapa dari berapa", () => {
    const teks = pesanPengingatGrup({
      ...DASAR,
      belum: [
        { nama: "Kranji", adaDraft: false },
        { nama: "Pasir", adaDraft: true },
      ],
      sudah: 3,
    })!;
    expect(teks).toContain("2 dari 5 lokasi belum lengkap");
    expect(teks).toContain("• Kranji – belum ada laporan");
    expect(teks).toContain("• Pasir – masih DRAF, belum dikirim");
    expect(teks).toContain("Paket 3 Jateng");
    expect(teks).toContain("29 Agu 2026");
  });

  it("menyebut LOKASI, bukan nama orang – ini grup pemberi kerja", () => {
    const teks = pesanPengingatGrup({
      ...DASAR,
      belum: [{ nama: "Kranji", adaDraft: false }],
      sudah: 0,
    })!;
    // Tidak ada sapaan ke perorangan seperti pada pengingat pribadi.
    expect(teks).not.toMatch(/Halo /);
  });

  it("memakai en-dash, bukan em-dash (DECISIONS 385)", () => {
    const teks = pesanPengingatGrup({
      ...DASAR,
      belum: [{ nama: "Kranji", adaDraft: false }],
      sudah: 1,
    })!;
    expect(teks).not.toContain(EM_DASH);
  });
});
