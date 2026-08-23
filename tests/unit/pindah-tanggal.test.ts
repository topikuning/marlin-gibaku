/*
 * PINDAH TANGGAL LAPORAN HARIAN — ATURAN MURNI (DECISIONS 415).
 *
 * User 2026-08-22: *"ini terlalu ribet untuk edit, padahal bisa sekali klik,
 * ganti tanggal saja."*
 *
 * Yang diuji di sini bagian yang tidak butuh basis data: kapan pemindahan
 * DITOLAK, snapshot siapa saja yang jadi basi karenanya, dan cap foto mana yang
 * ikut salah. Jalur penuhnya (buka final → pindah → finalkan ulang, cuaca
 * dibuang, penanda WA dilepas) diuji di
 * `tests/integration/pindah-tanggal-laporan.test.ts`.
 */
import { describe, expect, it } from "vitest";
import {
  capIkutSalah,
  capTakBisaDiperbaiki,
  periksaPindah,
  rentangSnapshotBasi,
  ringkasAkibatFoto,
} from "@/lib/daily-report/pindah-tanggal";

const DASAR = { lama: "2026-07-21", hariIni: "2026-08-22", adaDiTujuan: false };

describe("kapan pemindahan ditolak", () => {
  it("tanggal mundur maupun maju sama-sama boleh", () => {
    // Salah input bisa ke dua arah. Membolehkan maju saja akan memaksa orang
    // memindahkan laporan lewat jalan memutar untuk kesalahan yang paling
    // biasa: tanggal kemarin diketik untuk pekerjaan hari ini.
    expect(periksaPindah({ ...DASAR, baru: "2026-07-22" })).toBeNull();
    expect(periksaPindah({ ...DASAR, baru: "2026-07-20" })).toBeNull();
  });

  it("tanggal yang belum terjadi ditolak", () => {
    /*
     * Pagar yang SAMA dengan pembuatan laporan. Tanpa ini, pindah tanggal jadi
     * jalan belakang membuat laporan bertanggal besok — persis yang dicegah di
     * pintu depan, lewat pintu yang lain.
     */
    const t = periksaPindah({ ...DASAR, baru: "2026-08-23" });
    expect(t?.sebab).toBe("masa_depan");
  });

  it("hari ini sendiri BOLEH – batasnya belum terjadi, bukan sudah lewat", () => {
    expect(periksaPindah({ ...DASAR, baru: "2026-08-22" })).toBeNull();
  });

  it("tanggal tujuan yang sudah berisi ditolak, tidak digabung", () => {
    /*
     * Satu lokasi satu laporan per hari (`@@unique`). Menggabungkan berarti
     * memutuskan volume siapa yang menang — keputusan yang tidak boleh diambil
     * diam-diam oleh tombol pindah.
     */
    const t = periksaPindah({ ...DASAR, baru: "2026-07-22", adaDiTujuan: true });
    expect(t?.sebab).toBe("terisi");
    expect(t?.pesan).toContain("sudah punya laporan");
  });

  it("pindah ke tanggalnya sendiri ditolak", () => {
    expect(periksaPindah({ ...DASAR, baru: "2026-07-21" })?.sebab).toBe("sama");
  });

  it("format yang bukan tanggal ditolak sebelum apa pun dibaca", () => {
    for (const b of ["", "21-07-2026", "2026-7-21", "besok", "2026-07-21T00:00:00Z"]) {
      expect(periksaPindah({ ...DASAR, baru: b })?.sebab, b).toBe("format");
    }
  });
});

describe("snapshot cetak yang jadi basi", () => {
  it("laporan yang belum terhitung tidak membuat apa pun basi", () => {
    /*
     * Draft & perlu koreksi tidak pernah masuk angka resmi, jadi memindahkannya
     * tidak menggeser kumulatif siapa pun. Membangun ulang snapshot di situ
     * berarti menulis ulang dokumen beku tanpa satu angka pun berubah.
     */
    for (const status of ["draft", "perlu_koreksi"] as const) {
      expect(rentangSnapshotBasi({ lama: "2026-07-21", baru: "2026-07-25", status })).toBeNull();
    }
  });

  it("rentangnya SETENGAH TERBUKA – tanggal tujuan tidak ikut", () => {
    /*
     * Pada pindah 21→25, laporan tanggal 25 sudah menghitung laporan itu
     * sebelum MAUPUN sesudah pindah (21 ≤ 25 dan 25 ≤ 25), jadi angkanya tidak
     * berubah. Memasukkannya berarti membangun ulang snapshot yang tidak
     * bergeser sedikit pun.
     */
    expect(rentangSnapshotBasi({ lama: "2026-07-21", baru: "2026-07-25", status: "final" })).toEqual({
      dari: "2026-07-21",
      sampaiSebelum: "2026-07-25",
    });
  });

  it("mundur menghasilkan rentang yang sama, bukan rentang terbalik", () => {
    // Kalau urutannya tidak dinormalkan, pindah mundur menghasilkan `gte`
    // lebih besar daripada `lt` — query yang selalu kosong, jadi snapshot
    // yang basi tidak pernah dibangun ulang DAN tidak ada yang bersuara.
    expect(rentangSnapshotBasi({ lama: "2026-07-25", baru: "2026-07-21", status: "final" })).toEqual({
      dari: "2026-07-21",
      sampaiSebelum: "2026-07-25",
    });
  });

  it("status dikirim & disetujui juga terhitung", () => {
    for (const status of ["dikirim", "disetujui", "final"] as const) {
      expect(rentangSnapshotBasi({ lama: "2026-07-21", baru: "2026-07-22", status })).not.toBeNull();
    }
  });
});

describe("cap foto yang ikut salah", () => {
  const asli = new Date("2026-07-22T09:15:00+07:00");

  it("foto yang punya waktu jepret sendiri TIDAK ikut salah", () => {
    /*
     * Capnya menyebut kapan foto itu benar-benar diambil, bukan tanggal
     * laporannya. Sesudah laporan dipindah, justru capnya yang cocok — mencap
     * ulang di sini malah akan merusak yang sudah benar.
     */
    expect(capIkutSalah({ exifTakenAt: asli })).toBe(false);
  });

  it("foto tanpa waktu jepret memakai tanggal laporan, jadi ikut salah", () => {
    expect(capIkutSalah({ exifTakenAt: null })).toBe(true);
  });

  it("yang arsip aslinya hilang tidak bisa diperbaiki lagi", () => {
    // Cap dibakar ke gambar dan dirender ULANG dari berkas asli. Tanpa
    // aslinya, tidak ada yang bisa dilakukan — dan itu harus dikatakan, bukan
    // dihitung sebagai pekerjaan yang tinggal dikerjakan.
    expect(
      capTakBisaDiperbaiki({ exifTakenAt: null, originalKey: null, originalPurgedAt: null }),
    ).toBe(true);
    expect(
      capTakBisaDiperbaiki({
        exifTakenAt: null,
        originalKey: "asli/a.jpg",
        originalPurgedAt: new Date("2026-08-01T00:00:00Z"),
      }),
    ).toBe(true);
    expect(
      capTakBisaDiperbaiki({ exifTakenAt: null, originalKey: "asli/a.jpg", originalPurgedAt: null }),
    ).toBe(false);
  });

  it("yang tak bisa diperbaiki adalah BAGIAN dari yang perlu dicap ulang", () => {
    // Kalau dua angka itu terpisah, layarnya akan menjumlahkannya dan
    // menyebut lebih banyak foto bermasalah daripada yang sebenarnya ada.
    const hasil = ringkasAkibatFoto([
      { exifTakenAt: asli, originalKey: "a", originalPurgedAt: null }, // aman
      { exifTakenAt: null, originalKey: "b", originalPurgedAt: null }, // perlu, bisa
      { exifTakenAt: null, originalKey: null, originalPurgedAt: null }, // perlu, tidak bisa
    ]);
    expect(hasil).toEqual({ perluCapUlang: 2, takBisaDiperbaiki: 1 });
    expect(hasil.takBisaDiperbaiki).toBeLessThanOrEqual(hasil.perluCapUlang);
  });

  it("laporan tanpa foto tidak menghasilkan angka apa pun", () => {
    expect(ringkasAkibatFoto([])).toEqual({ perluCapUlang: 0, takBisaDiperbaiki: 0 });
  });
});
