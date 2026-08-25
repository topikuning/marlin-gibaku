/*
 * SIAPA MENEKEN APA (DECISIONS 402).
 *
 * Ketetapan user 2026-08-21: harian & mingguan diteken Pelaksana Lapangan;
 * bulanan, MC, dan CCO diteken Direktur.
 *
 * Yang dijaga di sini bukan kerapian melainkan satu hal yang tidak bisa
 * dibatalkan sesudah kertasnya diserahkan ke KKP: dokumen resmi tidak boleh
 * menyatakan orang yang tidak melakukannya.
 */
import { describe, expect, it } from "vitest";
import {
  JABATAN_PELAKSANA_BAWAAN,
  asalPelaksana,
  peringatanPelaksana,
  pihakPenyedia,
  pilihPelaksana,
  pilihPengawas,
  asalPengawas,
  type SumberPelaksana,
  type SumberPengawas,
  type SumberPengawasKontrak,
} from "@/lib/laporan/penandatangan";

const PAKET: SumberPelaksana = {
  pelaksanaName: "Budi Santoso",
  pelaksanaTitle: null,
  pelaksanaTtdKey: "ttd/paket.png",
};

const LOKASI: SumberPelaksana = {
  pelaksanaName: "Sari Handayani",
  pelaksanaTitle: "Site Manager",
  pelaksanaTtdKey: "ttd/lokasi.png",
};

const KOSONG: SumberPelaksana = {
  pelaksanaName: null,
  pelaksanaTitle: null,
  pelaksanaTtdKey: null,
};

describe("dokumen mana diteken siapa", () => {
  it("harian & mingguan → Pelaksana Lapangan", () => {
    expect(pihakPenyedia("harian")).toBe("pelaksana");
    expect(pihakPenyedia("mingguan")).toBe("pelaksana");
  });

  it("bulanan, MC, dan CCO → Direktur", () => {
    expect(pihakPenyedia("bulanan")).toBe("direktur");
    expect(pihakPenyedia("mc")).toBe("direktur");
    expect(pihakPenyedia("cco")).toBe("direktur");
  });
});

describe("pelaksana lokasi menimpa pelaksana paket", () => {
  it("lokasi kosong → ikut paket", () => {
    const b = pilihPelaksana(KOSONG, PAKET);
    expect(b.nama).toBe("Budi Santoso");
    expect(b.ttdKey).toBe("ttd/paket.png");
  });

  it("lokasi terisi → milik lokasi", () => {
    const b = pilihPelaksana(LOKASI, PAKET);
    expect(b.nama).toBe("Sari Handayani");
    expect(b.jabatan).toBe("Site Manager");
  });

  it("nama berisi spasi saja dihitung KOSONG", () => {
    // Kolom yang "terlihat terisi" di layar tapi berisi spasi akan mencetak
    // baris nama kosong tanpa satu pun peringatan.
    const b = pilihPelaksana({ ...KOSONG, pelaksanaName: "   " }, PAKET);
    expect(b.nama).toBe("Budi Santoso");
  });

  it("PALING PENTING: tanda tangan tidak pernah dicampur antar orang", () => {
    /*
     * Lokasi menyebut nama sendiri tapi BELUM mengunggah tanda tangan. Kalau
     * gambarnya jatuh ke milik paket, yang tercetak adalah coretan tanda tangan
     * Budi di bawah nama Sari. Pada berkas yang diserahkan ke KKP itu bukan
     * cacat tampilan.
     *
     * Karena itu penentunya NAMA, dan bloknya diambil utuh — termasuk
     * ketiadaan tanda tangannya.
     */
    const b = pilihPelaksana({ ...LOKASI, pelaksanaTtdKey: null }, PAKET);
    expect(b.nama).toBe("Sari Handayani");
    expect(b.ttdKey).toBeNull();
  });

  it("keduanya kosong → tanpa nama, jabatan tetap terbaca", () => {
    const b = pilihPelaksana(KOSONG, KOSONG);
    expect(b.nama).toBeNull();
    expect(b.jabatan).toBe(JABATAN_PELAKSANA_BAWAAN);
    expect(b.ttdKey).toBeNull();
  });

  it("jabatan kosong memakai sebutan bawaan", () => {
    expect(pilihPelaksana(KOSONG, PAKET).jabatan).toBe(JABATAN_PELAKSANA_BAWAAN);
  });

  it("TIDAK PERNAH jatuh ke Direktur", () => {
    /*
     * Ditegaskan sebagai uji tersendiri karena inilah godaan yang paling masuk
     * akal: "biar dokumennya lengkap". Dokumen yang selalu tampak lengkap sambil
     * menyebut orang yang salah lebih berbahaya daripada baris kosong yang
     * jelas-jelas menunggu tanda tangan.
     */
    const b = pilihPelaksana(KOSONG, KOSONG);
    expect(b.nama).toBeNull();
    expect(peringatanPelaksana(b)).toContain("belum diisi");
  });
});

describe("asal pelaksana disebut apa adanya", () => {
  it.each([
    [LOKASI, PAKET, "lokasi"],
    [KOSONG, PAKET, "paket"],
    [KOSONG, KOSONG, "belum diisi"],
  ] as const)("%#", (l, p, harap) => {
    expect(asalPelaksana(l, p)).toBe(harap);
  });

  it("peringatan hilang begitu namanya ada", () => {
    expect(peringatanPelaksana(pilihPelaksana(KOSONG, PAKET))).toBeNull();
  });
});


/* ────────────────────────────────────────────────────────────────────────────
 * KONSULTAN PENGAWAS PER LOKASI (DECISIONS 409)
 *
 * User 2026-08-22: *"untuk tanda tangan laporan, ternyata pengawas per lokasi
 * beda orang."*
 *
 * Aturannya sama dengan Pelaksana, tapi taruhannya lebih tinggi: pengawas
 * adalah pihak KETIGA yang memeriksa pekerjaan kita. Coretan tanda tangan
 * pengawas paket di bawah nama pengawas lokasi memalsukan pemeriksaan.
 * ──────────────────────────────────────────────────────────────────────────── */

const KONTRAK: SumberPengawasKontrak = {
  supervisorName: "Dedi Kurniawan",
  supervisorFirm: "PT Pengawas Nusantara",
  supervisorTtdKey: "ttd/kontrak-pengawas.webp",
  supervisorStempelKey: "stempel/pengawas.webp",
};

const PENGAWAS_LOKASI: SumberPengawas = {
  supervisorName: "Rina Wijaya",
  supervisorFirm: null,
  supervisorTtdKey: "ttd/lokasi-pengawas.webp",
};

describe("pengawas per lokasi", () => {
  it("lokasi kosong → ikut kontrak, lengkap dengan stempelnya", () => {
    const b = pilihPengawas({ supervisorName: null, supervisorFirm: null, supervisorTtdKey: null }, KONTRAK);
    expect(b.nama).toBe("Dedi Kurniawan");
    expect(b.firma).toBe("PT Pengawas Nusantara");
    expect(b.ttdKey).toBe("ttd/kontrak-pengawas.webp");
    expect(b.stempelKey).toBe("stempel/pengawas.webp");
  });

  it("lokasi menyebut nama sendiri → SELURUH bloknya milik lokasi", () => {
    const b = pilihPengawas(PENGAWAS_LOKASI, KONTRAK);
    expect(b.nama).toBe("Rina Wijaya");
    expect(b.ttdKey).toBe("ttd/lokasi-pengawas.webp");
    // Firma tidak disebut lokasi → tetap firma kontrak, dan stempelnya sah.
    expect(b.firma).toBe("PT Pengawas Nusantara");
    expect(b.stempelKey).toBe("stempel/pengawas.webp");
  });

  it("lokasi berpengawas sendiri TANPA tanda tangan tetap tanpa tanda tangan", () => {
    /*
     * Inti aturannya. Kalau nama diambil dari lokasi sementara coretannya jatuh
     * ke milik kontrak, yang tercetak adalah tanda tangan Dedi di bawah nama
     * Rina — pada dokumen yang menyatakan pekerjaan ini SUDAH DIPERIKSA.
     */
    const b = pilihPengawas({ ...PENGAWAS_LOKASI, supervisorTtdKey: null }, KONTRAK);
    expect(b.nama).toBe("Rina Wijaya");
    expect(b.ttdKey).toBeNull();
  });

  it("FIRMA berbeda → stempel kontrak TIDAK dipakai", () => {
    /*
     * Stempel milik FIRMA (DECISIONS 408). Stempel PT Pengawas Nusantara di
     * bawah nama CV Pengawas Mandiri adalah pernyataan yang tidak benar, bukan
     * gambar yang kebetulan keliru — jadi bloknya dikosongkan untuk dibubuhi
     * stempel basah.
     */
    const b = pilihPengawas(
      { ...PENGAWAS_LOKASI, supervisorFirm: "CV Pengawas Mandiri" },
      KONTRAK,
    );
    expect(b.firma).toBe("CV Pengawas Mandiri");
    expect(b.stempelKey).toBeNull();
  });

  it("firma DISEBUT SAMA persis → stempel kontrak tetap sah", () => {
    // Kalau tidak, orang yang mengetik ulang nama firma yang sama kehilangan
    // stempelnya tanpa sebab yang bisa ia lihat.
    const b = pilihPengawas(
      { ...PENGAWAS_LOKASI, supervisorFirm: "PT Pengawas Nusantara" },
      KONTRAK,
    );
    expect(b.stempelKey).toBe("stempel/pengawas.webp");
  });

  it("keduanya kosong → tanpa nama, bukan nama orang lain", () => {
    const b = pilihPengawas(null, {
      supervisorName: null,
      supervisorFirm: null,
      supervisorTtdKey: null,
      supervisorStempelKey: null,
    });
    expect(b.nama).toBeNull();
    expect(b.ttdKey).toBeNull();
  });

  it("asalPengawas menyebut sumbernya", () => {
    expect(asalPengawas(PENGAWAS_LOKASI, KONTRAK)).toBe("lokasi");
    expect(asalPengawas(null, KONTRAK)).toBe("kontrak");
    expect(asalPengawas(null, null)).toBe("belum diisi");
  });
});
