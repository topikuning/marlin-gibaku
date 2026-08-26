/*
 * PEMBACA KELUARAN AI PEMETA SURAT (DECISIONS 434).
 *
 * Ketetapan user 2026-08-26: satu permintaan AI memetakan SELURUH isian
 * formulir. Berkas ini yang menerjemahkannya — dan taruhannya bukan sekadar
 * kerapian: **formulir yang terisi tebakan lebih berbahaya daripada formulir
 * kosong**, karena orang cenderung menyetujui apa yang sudah terisi. Karena
 * itu yang diuji terutama adalah kapan parser MENOLAK mengisi.
 */
import { describe, expect, it } from "vitest";
import { bacaHasilSurat, cocokkanSebutan } from "@/lib/surat/baca-hasil";

const LENGKAP = `
NOMOR: 421/SP-02/VIII/2026
TANGGAL: 2026-08-14
PIHAK: wakil_ppk
NAMA_PIHAK: Ir. Bagus Setiawan, M.T.
ARAH: masuk
PERIHAL: Teguran keterlambatan pekerjaan dermaga
KATEGORI: jadwal
LOKASI: Kedungmutih
PAKET: PKT-2026-001
BUTUH_JAWABAN: ya
TENGGAT: 2026-08-21
RINGKASAN: Surat menegur keterlambatan pemasangan dermaga dan meminta penjelasan tertulis.
POTENSI: kendala
ALASAN_POTENSI: Menyebut pekerjaan terhenti karena material belum tiba.
`;

describe("keluaran lengkap terbaca utuh", () => {
  const h = bacaHasilSurat(LENGKAP);

  it("medan pokok terisi apa adanya", () => {
    expect(h.nomor).toBe("421/SP-02/VIII/2026");
    expect(h.tanggal).toBe("2026-08-14");
    expect(h.pihak).toBe("wakil_ppk");
    expect(h.namaPihak).toBe("Ir. Bagus Setiawan, M.T.");
    expect(h.arah).toBe("masuk");
    expect(h.kategori).toBe("jadwal");
  });

  it("lokasi dan paket dibaca TERPISAH – surat bisa menyebut salah satu saja", () => {
    expect(h.lokasiSebutan).toBe("Kedungmutih");
    expect(h.paketSebutan).toBe("PKT-2026-001");
  });

  it("utang jawab dan potensinya ikut terpetakan sekali jalan", () => {
    expect(h.butuhJawaban).toBe(true);
    expect(h.tenggat).toBe("2026-08-21");
    expect(h.potensi).toBe("kendala");
    expect(h.ringkasan).toContain("menegur");
  });
});

describe("yang tidak diketahui TIDAK ditebak", () => {
  it("tanda minus berarti kosong, bukan teks '-'", () => {
    const h = bacaHasilSurat("NOMOR: -\nTANGGAL: -\nLOKASI: -\nPAKET: -\nTENGGAT: -");
    expect(h.nomor).toBeNull();
    expect(h.tanggal).toBeNull();
    expect(h.lokasiSebutan).toBeNull();
    expect(h.paketSebutan).toBeNull();
    expect(h.tenggat).toBeNull();
  });

  it("keluaran kosong/berantakan tidak melempar, hanya menghasilkan formulir kosong", () => {
    const h = bacaHasilSurat("maaf saya tidak bisa membaca berkas ini");
    expect(h.nomor).toBeNull();
    expect(h.perihal).toBeNull();
    expect(h.butuhJawaban).toBe(false);
    expect(h.potensi).toBe("tidak");
  });

  it("tanggal yang tidak sah ditolak, bukan digeser diam-diam", () => {
    // 31 Februari akan "terbentuk" jadi 3 Maret bila tidak diperiksa.
    expect(bacaHasilSurat("TANGGAL: 2026-02-31").tanggal).toBeNull();
    expect(bacaHasilSurat("TANGGAL: 14 Agustus 2026").tanggal).toBeNull();
  });

  it("hanya kata 'ya' yang memasang tenggat penagih", () => {
    expect(bacaHasilSurat("BUTUH_JAWABAN: mungkin").butuhJawaban).toBe(false);
    expect(bacaHasilSurat("BUTUH_JAWABAN: sepertinya perlu").butuhJawaban).toBe(false);
    expect(bacaHasilSurat("BUTUH_JAWABAN: Ya").butuhJawaban).toBe(true);
  });

  it("nilai enum di luar daftar jatuh ke 'lainnya', bukan diteruskan mentah", () => {
    const h = bacaHasilSurat("PIHAK: kontraktor utama\nKATEGORI: keuangan");
    expect(h.pihak).toBe("lainnya");
    expect(h.kategori).toBe("lainnya");
  });
});

describe("kerapian keluaran model tidak mengganggu", () => {
  it("tanda kutip & bintang tebal dibersihkan", () => {
    expect(bacaHasilSurat('NOMOR: **421/SP/2026**').nomor).toBe("421/SP/2026");
    expect(bacaHasilSurat('PERIHAL: "Permohonan adendum"').perihal).toBe("Permohonan adendum");
  });

  it("label huruf kecil tetap terbaca", () => {
    expect(bacaHasilSurat("perihal: Undangan rapat").perihal).toBe("Undangan rapat");
  });
});

describe("pencocokan sebutan ke data – ketat, bukan menebak", () => {
  const lokasi = [
    { id: "a", name: "Kedungmutih" },
    { id: "b", name: "Karanggondang" },
    { id: "c", name: "Batah Timur" },
  ];

  it("cocok persis dan cocok-memuat", () => {
    expect(cocokkanSebutan("Kedungmutih", lokasi)?.id).toBe("a");
    expect(cocokkanSebutan("Kampung Nelayan Kedungmutih", lokasi)?.id).toBe("a");
  });

  it("tidak ada yang cocok → null, tidak memilih yang termirip", () => {
    expect(cocokkanSebutan("Demak", lokasi)).toBeNull();
    expect(cocokkanSebutan(null, lokasi)).toBeNull();
    expect(cocokkanSebutan("ab", lokasi)).toBeNull();
  });

  it("ambigu (dua sama-sama cocok) → null, jangan menautkan ke lokasi yang salah", () => {
    const kembar = [
      { id: "x", name: "Pasir" },
      { id: "y", name: "Pasir Putih" },
    ];
    expect(cocokkanSebutan("Pasir Putih Utara", kembar)).toBeNull();
  });
});
