import { describe, expect, it } from "vitest";
import {
  MAKS_BARIS,
  pesanKendalaTenggat,
  sidikTenggat,
  type BarisTenggat,
} from "@/lib/kendala/pesan-tenggat";

/**
 * DECISIONS 392 — pengingat kendala lewat tenggat ke grup paket.
 *
 * Poin 2.3 di `docs/rebuild/PETA_KENDALA.md`: perhitungan "lewat tenggat" sudah
 * benar sejak lama, yang tidak ada adalah SESEORANG YANG DIBERI TAHU. Pesan ini
 * masuk ke grup berisi orang-orang nyata, jadi yang diuji di sini bukan
 * formatnya saja melainkan apa yang boleh dan tidak boleh dikatakannya.
 */

const b = (o: Partial<BarisTenggat> = {}): BarisTenggat => ({
  judul: "Lahan belum bisa clear",
  lokasi: "Kedungrejo",
  pic: "Budi",
  lewatHari: 4,
  ...o,
});

describe("pesanKendalaTenggat", () => {
  it("tidak ada yang lewat tenggat → TIDAK mengirim apa pun", () => {
    // Peringatan yang tetap datang saat tidak ada apa-apa akan berhenti
    // dibaca, dan pada saat itulah peringatan yang sungguhan ikut hilang.
    expect(pesanKendalaTenggat("KNMP Banyuwangi", [])).toBeNull();
  });

  it("menyebut paket, judul, lokasi, PIC, dan berapa hari lewat", () => {
    const teks = pesanKendalaTenggat("KNMP Banyuwangi", [b()])!;
    expect(teks).toContain("KNMP Banyuwangi");
    expect(teks).toContain("Lahan belum bisa clear");
    expect(teks).toContain("Kedungrejo");
    expect(teks).toContain("PIC Budi");
    expect(teks).toContain("lewat 4 hari");
    expect(teks).toContain("1 kendala sudah lewat tenggat");
  });

  it("kendala tanpa PIC disebut apa adanya, tidak dikosongkan", () => {
    /*
     * Baris tanpa keterangan PIC terbaca seperti sudah ada yang menangani –
     * padahal justru kendala tanpa pemilik yang paling perlu ditagih.
     */
    const teks = pesanKendalaTenggat("KNMP Banyuwangi", [b({ pic: null })])!;
    expect(teks).toContain("belum ada PIC");
  });

  it("yang paling lama lewat tampil lebih dulu", () => {
    const teks = pesanKendalaTenggat("P", [
      b({ judul: "Baru", lewatHari: 1 }),
      b({ judul: "Lama", lewatHari: 30 }),
    ])!;
    expect(teks.indexOf("Lama")).toBeLessThan(teks.indexOf("Baru"));
  });

  it("daftar dipangkas, tapi yang disembunyikan DISEBUT jumlahnya", () => {
    const banyak = Array.from({ length: 9 }, (_, i) =>
      b({ judul: `Kendala ${i}`, lewatHari: i + 1 }),
    );
    const teks = pesanKendalaTenggat("P", banyak)!;
    expect(teks).toContain("9 kendala sudah lewat tenggat");
    expect(teks.split("\n").filter((l) => l.startsWith("• Kendala"))).toHaveLength(MAKS_BARIS);
    expect(teks).toContain(`dan ${9 - MAKS_BARIS} kendala lain`);
  });

  it("REGRESI: `total` dari pemanggil menang atas panjang daftar terpotong", () => {
    /*
     * Penjadwal hanya menarik potongan teratas ke memori. Kalau hitungannya
     * diambil dari potongan itu, grup diberi tahu "20 kendala" saat yang
     * sebenarnya 137 – angka yang lebih kecil daripada kenyataan, persis jenis
     * kesalahan yang membuat orang berhenti percaya angka MARLIN.
     */
    const potongan = Array.from({ length: 20 }, (_, i) => b({ judul: `K${i}`, lewatHari: i + 1 }));
    const teks = pesanKendalaTenggat("P", potongan, 137)!;
    expect(teks).toContain("137 kendala sudah lewat tenggat");
    expect(teks).toContain(`dan ${137 - MAKS_BARIS} kendala lain`);
  });

  it("tidak memakai em-dash", () => {
    // DECISIONS 385 berlaku juga untuk teks yang dikirim ke WhatsApp.
    // Karakternya ditulis lewat kode titik, bukan literal: berkas uji ini ikut
    // disapu penjaga tanda pisah, dan menuliskannya utuh akan memerahkan
    // penjaga itu oleh uji yang justru menegakkannya.
    expect(pesanKendalaTenggat("P", [b()])!).not.toContain(String.fromCharCode(0x2014));
  });
});

describe("sidikTenggat", () => {
  it("urutan baris tidak mengubah sidik", () => {
    const x = b({ judul: "A" });
    const y = b({ judul: "B" });
    expect(sidikTenggat([x, y])).toBe(sidikTenggat([y, x]));
  });

  it("REGRESI: umur keterlambatan TIDAK mengubah sidik", () => {
    /*
     * Kalau `lewatHari` ikut dihitung, sidiknya berubah setiap hari dan
     * peredam pengulangan tidak pernah bekerja sama sekali – grup dikirimi
     * daftar yang sama tiap 24 jam, yang persis ingin dihindari.
     */
    expect(sidikTenggat([b({ lewatHari: 4 })])).toBe(sidikTenggat([b({ lewatHari: 5 })]));
  });

  it("kendala yang berganti mengubah sidik", () => {
    expect(sidikTenggat([b({ judul: "A" })])).not.toBe(sidikTenggat([b({ judul: "B" })]));
    expect(sidikTenggat([b({ lokasi: "X" })])).not.toBe(sidikTenggat([b({ lokasi: "Y" })]));
  });

  it("REGRESI: perubahan DI LUAR potongan teratas tetap terdeteksi", () => {
    /*
     * Kendala ke-40 ditutup dan ke-41 muncul: daftar teratasnya sama persis.
     * Tanpa jumlah total ikut dihitung, peredam menahan pesan yang justru
     * seharusnya berubah.
     */
    const potongan = [b({ judul: "A" }), b({ judul: "B" })];
    expect(sidikTenggat(potongan, 40)).not.toBe(sidikTenggat(potongan, 41));
  });
});
