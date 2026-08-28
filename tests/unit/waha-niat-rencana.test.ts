// PERTANYAAN YANG MENGHADAP KE DEPAN PUNYA JAWABANNYA SENDIRI (DECISIONS 458).
//
// Tangkapan layar user 2026-08-28 memuat tiga pertanyaan tentang yang AKAN
// datang, dan tidak satu pun terjawab:
//
//   • WhatsApp  — "rencana seminggu ke depan untuk kemantren?"
//   • Ask MARLIN — "apa yang perlu dilakukan minggu depan?"
//   • Ask MARLIN — "pekerjaan apa yang perlu dilakukan untuk mengejar progress?"
//
// Yang lewat WhatsApp paling merusak: ia dibalas KUTIPAN notulen rapat 10
// Agustus di bawah judul "Catatan lapangan", ditutup catatan *"Tidak saya
// kenali: rencana seminggu, depan"*. Kutipannya benar apa adanya, tetapi
// diletakkan sebagai jawaban atas pertanyaan tentang pekan depan — dan
// pembacanya tidak punya cara tahu bahwa MARLIN sebenarnya tidak menjawab.
//
// Datanya sudah ada sejak lama (`WeeklyPlan`, dipakai formulir rencana
// mingguan, PDF, Excel, siaran WA). Yang tidak ada cuma sambungannya.
import { describe, expect, it } from "vitest";
import { mintaPekanDepan, parseNiatDeterministik, frasaSisa } from "@/lib/waha/parser-niat";
import { balasRencana } from "@/lib/waha/tanya-format";

describe("niat rencana dikenali tanpa AI", () => {
  it("REGRESI: 'rencana seminggu ke depan untuk kemantren?'", () => {
    const h = parseNiatDeterministik("rencana seminggu ke depan untuk kemantren?");
    expect(h.jenis).toBe("yakin");
    if (h.jenis !== "yakin") return;
    expect(h.kandidat.niat).toBe("rencana");
  });

  it("REGRESI: penanda waktunya TIDAK lagi dilaporkan sebagai kata asing", () => {
    /*
     * Balasan lama menutup dengan *"Tidak saya kenali: rencana seminggu,
     * depan"*. Kata-kata itu justru inti pertanyaannya; melaporkannya sebagai
     * salah ketik membuat penanya mengira dirinya yang keliru.
     */
    const sisa = frasaSisa("rencana seminggu ke depan untuk kemantren?");
    expect(sisa.join(" ")).not.toContain("seminggu");
    expect(sisa.join(" ")).not.toContain("depan");
    // Nama lokasinya tetap tersisa – itu memang tugas pencocok lokasi.
    expect(sisa).toContain("kemantren");
  });

  it("'rencana mingguan' TIDAK bercabang jadi laporan mingguan", () => {
    // Kata "mingguan" juga milik niat `laporan_mingguan`; kalau potongannya
    // tidak menelan kedua kata, pertanyaan yang gamblang berubah jadi ambigu.
    const h = parseNiatDeterministik("rencana mingguan kemantren");
    expect(h.jenis).toBe("yakin");
    if (h.jenis !== "yakin") return;
    expect(h.kandidat.niat).toBe("rencana");
  });

  it("'apa yang perlu dikerjakan' terbaca sebagai rencana", () => {
    const h = parseNiatDeterministik("apa yang perlu dikerjakan minggu depan");
    expect(h.jenis === "yakin" && h.kandidat.niat === "rencana").toBe(true);
  });

  it("pertanyaan LAMPAU tidak ikut tertarik ke rencana", () => {
    // Penjagaan arah sebaliknya: kalau "rencana" terlalu rakus, "progress
    // kemarin" akan ikut terbaca sebagai rencana dan jawabannya salah total.
    const h = parseNiatDeterministik("progress kemarin di kemantren");
    expect(h.jenis === "yakin" && h.kandidat.niat === "progress").toBe(true);
  });
});

describe("penanda pekan depan", () => {
  it.each([
    "rencana seminggu ke depan",
    "rencana minggu depan",
    "rencana pekan depan",
    "rencana kedepan",
    "rencana minggu mendatang",
    "rencana pekan berikutnya",
  ])("%s → pekan depan", (t) => {
    expect(mintaPekanDepan(t)).toBe(true);
  });

  it.each(["rencana minggu ini", "rencana kerja", "rencana mingguan kemantren"])(
    "%s → pekan berjalan",
    (t) => {
      expect(mintaPekanDepan(t)).toBe(false);
    },
  );

  it("superlatif 'paling depan' BUKAN keterangan waktu", () => {
    // "depan" di sini bagian dari "paling depan" — urutan, bukan pekan.
    expect(mintaPekanDepan("progress paling depan")).toBe(false);
  });
});

describe("balasan rencana", () => {
  const dasar = {
    lokasi: "Kemantren",
    minggu: 6,
    totalMinggu: 20,
    periode: "31 Agu 2026 – 6 Sep 2026",
    targetPct: 8.4,
    realisasiPct: 7.19,
    deviasiPct: -1.21,
    itemTersembunyi: 0,
    bobotTarget: 1.8,
    tidakTuntas: [],
  };

  it("merinci komitmen pekan itu berikut sisanya", () => {
    const t = balasRencana({
      pekanDepan: true,
      baris: [
        {
          ...dasar,
          item: [
            { nama: "Pondasi Batu Belah 1 : 5", satuan: "m³", target: 12.5, sisa: 40, pic: "Budi" },
          ],
        },
      ],
    });
    expect(t).toContain("pekan depan");
    expect(t).toContain("minggu 6/20");
    expect(t).toContain("target kurva-S 8,40%");
    expect(t).toContain("Pondasi Batu Belah 1 : 5 – 12,5 m³ (sisa 40 m³) · Budi");
  });

  it("REGRESI: rencana yang BELUM disusun diakui, bukan diganti yang mirip", () => {
    /*
     * Inti keluhannya. Kosong yang diakui menyuruh orang menyusun rencananya;
     * kutipan catatan lama yang berjudul meyakinkan menyuruh orang percaya
     * bahwa rencananya sudah ada.
     */
    const t = balasRencana({ pekanDepan: true, baris: [{ ...dasar, item: [] }] });
    expect(t).toContain("BELUM disusun");
  });

  it("lokasi tanpa kontrak/kurva-S disebut sebabnya", () => {
    const t = balasRencana({
      pekanDepan: false,
      baris: [
        {
          lokasi: "Baru",
          minggu: null,
          totalMinggu: null,
          periode: null,
          targetPct: null,
          realisasiPct: null,
          deviasiPct: null,
          item: [],
          itemTersembunyi: 0,
          bobotTarget: null,
          tidakTuntas: [],
        },
      ],
    });
    expect(t).toContain("Belum ada kontrak/kurva-S aktif");
  });

  it("komitmen pekan lalu yang meleset ikut disebut", () => {
    // Itulah bahan pertama untuk mengejar; menyembunyikannya membuat rencana
    // baru disusun di atas kegagalan yang tidak dibaca siapa pun.
    const t = balasRencana({
      pekanDepan: false,
      baris: [
        {
          ...dasar,
          item: [{ nama: "Galian", satuan: "m³", target: 10, sisa: 30, pic: null }],
          tidakTuntas: [{ nama: "Urugan", satuan: "m³", target: 20, realisasi: 12 }],
        },
      ],
    });
    expect(t).toContain("Belum tuntas pekan lalu:");
    expect(t).toContain("Urugan – target 20 m³, terealisasi 12 m³");
  });
});
