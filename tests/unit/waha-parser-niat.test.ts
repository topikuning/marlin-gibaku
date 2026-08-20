import { describe, expect, it } from "vitest";
import { bacaPeriodeTeks, parseNiatDeterministik, rencanaDeterministik } from "@/lib/waha/parser-niat";

/**
 * PARSER DETERMINISTIK + kandidat maksud (DECISIONS 375).
 *
 * Dua hal yang dijaga:
 *
 * 1. Pola yang jelas tidak memanggil AI. Ongkosnya bukan cuma uang — tiap
 *    panggilan menambah 1–3 detik dan membuat fitur ini mati total setiap kali
 *    provider-nya bermasalah.
 * 2. Yang tidak jelas DITAWARKAN, bukan ditolak. Keberatan user 2026-08-19:
 *    "niat = null → tidak mengerti" terlalu cepat menyerah dan membuang waktu.
 */

describe("bacaPeriodeTeks", () => {
  it('"kemarin lusa" tidak terbaca sebagai "kemarin"', () => {
    // Urutan periksa yang terbalik akan SELALU membacanya 1 hari, karena
    // kalimatnya memang memuat kata "kemarin".
    expect(bacaPeriodeTeks("progress kemarin lusa")).toEqual({ jenis: "mundur_hari", hari: 2 });
    expect(bacaPeriodeTeks("progress kemarin")).toEqual({ jenis: "mundur_hari", hari: 1 });
  });

  it("ejaan lapangan ikut dikenali", () => {
    // "kemaren" ditulis orang setiap hari; menolaknya berarti melempar
    // pertanyaan sah ke AI tanpa alasan.
    expect(bacaPeriodeTeks("kemaren gimana")).toEqual({ jenis: "mundur_hari", hari: 1 });
  });

  it("minggu/bulan, ini/lalu", () => {
    expect(bacaPeriodeTeks("rekap minggu lalu")).toEqual({ jenis: "rentang", satuan: "minggu", mundur: 1 });
    expect(bacaPeriodeTeks("laporan bulan ini")).toEqual({ jenis: "rentang", satuan: "bulan", mundur: 0 });
    expect(bacaPeriodeTeks("pekan ini")).toEqual({ jenis: "rentang", satuan: "minggu", mundur: 0 });
  });

  it("tanggal yang ditulis penanya dipakai apa adanya", () => {
    expect(bacaPeriodeTeks("laporan 17 agustus")).toEqual({
      jenis: "tanggal", hari: 17, bulan: 8, tahun: null,
    });
    expect(bacaPeriodeTeks("laporan 3 juli 2026")).toEqual({
      jenis: "tanggal", hari: 3, bulan: 7, tahun: 2026,
    });
    expect(bacaPeriodeTeks("laporan tanggal 12")).toEqual({
      jenis: "tanggal", hari: 12, bulan: null, tahun: null,
    });
  });

  it("tahun TIDAK ditebak bila tidak ditulis", () => {
    // Menebaknya menghasilkan angka yang benar untuk tahun yang salah.
    expect(bacaPeriodeTeks("17 agustus")).toMatchObject({ tahun: null });
  });

  it("tanpa keterangan waktu → null, BUKAN 'hari ini'", () => {
    /*
     * Bedanya menentukan apakah kita boleh yakin. "progress" tanpa waktu memang
     * berarti hari ini, tapi "bagaimana yang kemarin" menyebut WAKTU tanpa
     * menyebut NIAT — dan justru itu yang perlu ditanyakan balik.
     */
    expect(bacaPeriodeTeks("mana yang deviasinya negatif")).toBeNull();
  });
});

describe("pola jelas: dijawab tanpa AI", () => {
  const yakin = (teks: string) => {
    const r = parseNiatDeterministik(teks);
    expect(r.jenis, teks).toBe("yakin");
    return r.jenis === "yakin" ? r.kandidat : null!;
  };

  it("progress, deviasi, kendala, kelengkapan, bantuan", () => {
    expect(yakin("progress hari ini").niat).toBe("progress");
    expect(yakin("mana yang deviasinya negatif").niat).toBe("deviasi");
    expect(yakin("ada kendala apa").niat).toBe("kendala");
    expect(yakin("siapa yang belum lapor").niat).toBe("kelengkapan");
    expect(yakin("kamu bisa apa saja").niat).toBe("bantuan");
  });

  it("laporan harian bertanggal", () => {
    const k = yakin("minta laporan tanggal 12");
    expect(k.niat).toBe("laporan");
    expect(k.periode).toEqual({ jenis: "tanggal", hari: 12, bulan: null, tahun: null });
  });

  it("kata kunci yang saling MEMUAT bukan dua niat yang bersaing", () => {
    /*
     * Ini pernah rusak: begitu akhiran ditoleransi, "belum lapor" ikut kena pola
     * `lapor\w*` milik niat `laporan`, dan pertanyaan yang paling gamblang
     * ("siapa yang belum lapor") justru dilempar ke AI karena dianggap ambigu.
     *
     * Yang menentukan bukan daftar pasangan, melainkan letaknya: kata kunci yang
     * TERMUAT di dalam kata kunci lain menyebut satu maksud yang sama.
     */
    expect(yakin("siapa yang belum lapor").niat).toBe("kelengkapan");
    // "laporan MINGGUAN" selalu rekap sepekan, bukan laporan harian
    // (DECISIONS 358), dan ia selalu memuat kata "laporan".
    expect(yakin("minta laporan mingguan").niat).toBe("laporan_mingguan");
    expect(yakin("sudah lapor semua?").niat).toBe("kelengkapan");
  });

  it("tanpa keterangan waktu → hari ini", () => {
    expect(yakin("progress").periode).toEqual({ jenis: "hari_ini" });
  });
});

describe("yang tidak jelas: DITAWARKAN, bukan ditolak", () => {
  it('"bagaimana yang kemarin?" → tiga tafsir yang masuk akal', () => {
    // Contoh yang diberikan user sendiri.
    const r = parseNiatDeterministik("bagaimana yang kemarin?");
    expect(r.jenis).toBe("ambigu");
    const niat = r.jenis === "ambigu" ? r.kandidat.map((k) => k.niat) : [];
    expect(niat).toEqual(["progress", "laporan", "kendala_dibuka"]);
  });

  it("pilihannya memakai KATA yang ditulis penanya", () => {
    // Menu generik yang sama untuk semua orang persis yang dikeluhkan.
    const r = parseNiatDeterministik("bagaimana yang kemarin?");
    const label = r.jenis === "ambigu" ? r.kandidat.map((k) => k.label) : [];
    expect(label[0]).toContain("kemarin");
    expect(label[1]).toContain("kemarin");
  });

  it("kendala MENGHORMATI periode yang ditulis penanya", () => {
    /*
     * Dulu kandidat ini sengaja berbunyi "(yang masih terbuka sekarang)" tanpa
     * periode, karena MARLIN belum bisa menjawab kendala per periode sama
     * sekali (WATANYA-02). Sejak `kendala_dibuka` ada, kalimat itu berubah dari
     * pengakuan jujur menjadi pembatasan yang tidak perlu — orang yang menulis
     * "kemarin" memang menanyakan kemarin.
     */
    const r = parseNiatDeterministik("bagaimana yang kemarin?");
    const kendala =
      r.jenis === "ambigu" ? r.kandidat.find((k) => k.niat === "kendala_dibuka") : null;
    expect(kendala?.label).toContain("kemarin");
    expect(kendala?.label).not.toMatch(/masih terbuka sekarang/i);
  });

  it('"minta laporan minggu lalu" TIDAK ditawarkan – sudah diputus DECISIONS 358', () => {
    /*
     * Sekilas ini kandidat tawaran yang sempurna: laporan harian selalu SATU
     * tanggal, rekap mingguan meliputi sepekan. Tapi kasus ini sudah diputus
     * setelah keluhan user 2026-08-18 — jawabannya laporan harian pada hari
     * terakhir rentang, dan balasannya menyebut tanggal mana yang diambil.
     *
     * Menawarkan pilihan di sini menukar jawaban langsung yang sudah jujur
     * dengan satu putaran tanya-jawab tambahan, untuk mandor yang sedang di
     * lapangan. Tawaran disediakan untuk yang BELUM diputuskan.
     */
    const r = parseNiatDeterministik("minta laporan minggu lalu");
    expect(r.jenis).toBe("yakin");
    expect(r.jenis === "yakin" && r.kandidat.niat).toBe("laporan");
  });

  it("maksimal tiga pilihan", () => {
    // Menu panjang di WhatsApp tidak dibaca; ia dilipat lalu dilewati.
    for (const t of ["bagaimana yang kemarin?", "bagaimana minggu lalu?"]) {
      const r = parseNiatDeterministik(t);
      if (r.jenis === "ambigu") expect(r.kandidat.length, t).toBeLessThanOrEqual(3);
    }
  });
});

describe("yang memang harus diserahkan ke AI", () => {
  it("kalimat tanpa petunjuk apa pun", () => {
    expect(parseNiatDeterministik("halo pak").jenis).toBe("tidak_tahu");
    expect(parseNiatDeterministik("").jenis).toBe("tidak_tahu");
  });

  it("dua kata niat di dua TEMPAT berbeda → biar AI menimbang kalimat utuhnya", () => {
    // "kendala" DAN "progress" di satu kalimat bisa berarti banyak hal; menebak
    // salah satunya lebih buruk daripada membayar satu panggilan AI.
    //
    // Bedanya dengan pasangan yang saling memuat: dua kata ini menempati
    // potongan teks yang TERPISAH, jadi keduanya memang disebut penanya.
    expect(parseNiatDeterministik("kendala apa yang bikin progress turun").jenis).toBe("tidak_tahu");
    expect(parseNiatDeterministik("deviasi dan kendala di lokasi itu").jenis).toBe("tidak_tahu");
  });
});

describe("boleh dijalankan tanpa AI?", () => {
  const KATALOG = [
    { id: "a", nama: "Kedung Mutih", desa: "Kedung Mutih", kecamatan: "Wedung", kabupaten: "Demak", provinsi: "Jawa Tengah" },
    { id: "b", nama: "Tambakbulusan", desa: "Tambakbulusan", kecamatan: "Karangtengah", kabupaten: "Demak", provinsi: "Jawa Tengah" },
    { id: "c", nama: "Puger Kulon", desa: "Puger Kulon", kecamatan: "Puger", kabupaten: "Jember", provinsi: "Jawa Timur" },
  ];

  it("pola jelas TANPA sisa kata → dijawab tanpa AI", () => {
    // Inilah penghematannya: pertanyaan yang paling sering diketik tidak lagi
    // menunggu provider, tidak memakai kuota, dan tetap hidup saat AI mati.
    const r = rencanaDeterministik("progress hari ini", KATALOG);
    expect(r.jenis).toBe("jalan");
    if (r.jenis === "jalan") {
      expect(r.niat).toBe("progress");
      expect(r.lokasiDisebut).toEqual([]);
    }
  });

  it("nama lokasi yang DIKENAL ikut terbawa, bukan dibuang", () => {
    /*
     * Kalau nama lokasinya hilang, "progress di Kedung Mutih" dijawab untuk
     * SELURUH lokasi — benar sebagai angka, tapi menjawab pertanyaan yang tidak
     * ditanyakan, dan penerimanya tidak punya cara mengetahuinya.
     */
    const r = rencanaDeterministik("progress kemarin di Kedung Mutih", KATALOG);
    expect(r.jenis).toBe("jalan");
    if (r.jenis === "jalan") {
      expect(r.lokasiDisebut).toEqual(["kedung mutih"]);
      expect(r.periode).toEqual({ jenis: "mundur_hari", hari: 1 });
    }
  });

  it("nama WILAYAH juga dikenali (Jember)", () => {
    const r = rencanaDeterministik("laporan kemarin jember", KATALOG);
    expect(r.jenis).toBe("jalan");
    if (r.jenis === "jalan") expect(r.lokasiDisebut).toEqual(["jember"]);
  });

  it("ada kata DI LUAR katalog → diserahkan ke AI, BUKAN dijawab untuk semua", () => {
    /*
     * Pagar terpenting di berkas ini. Tanpanya jalur cepat diam-diam melebarkan
     * pertanyaan bernama lokasi menjadi pertanyaan seluruh proyek.
     */
    const r = rencanaDeterministik("progress hari ini di Sumberjaya", KATALOG);
    expect(r.jenis).toBe("serahkan_ai");
  });

  it("kalimat panjang bertele-tele → AI, karena ada yang tak terjelaskan", () => {
    const r = rencanaDeterministik("progress gimana kalau dibandingkan target awal kontrak", KATALOG);
    expect(r.jenis).toBe("serahkan_ai");
  });

  it("ambigu pun tidak memanggil AI – pilihannya sudah cukup", () => {
    const r = rencanaDeterministik("bagaimana yang kemarin?", KATALOG);
    expect(r.jenis).toBe("ambigu");
  });
});


describe("kendala + periode LAMPAU: dua tafsir, penanya yang memilih (DECISIONS 381)", () => {
  it('"kendala minggu lalu" ditawari dua cara baca', () => {
    /*
     * Koreksi user 2026-08-19: mesin klarifikasi memang dibuat untuk kasus ini.
     * Sebelumnya MARLIN memilih sendiri — menjawab SEMUA yang terbuka sekarang
     * (kapan pun dibukanya) lalu menempel catatan bahwa itu bukan keadaan pada
     * periode yang ditanya. Jujur, tapi menjawab pertanyaan yang tidak
     * ditanyakan.
     */
    const r = parseNiatDeterministik("kendala minggu lalu");
    expect(r.jenis).toBe("ambigu");
    const niat = r.jenis === "ambigu" ? r.kandidat.map((k) => k.niat) : [];
    expect(niat).toEqual(["kendala_dibuka", "kendala_periode_terbuka"]);
  });

  it("pilihannya menyebut BEDANYA, bukan sekadar dua kata mirip", () => {
    const r = parseNiatDeterministik("kendala kemarin");
    const label = r.jenis === "ambigu" ? r.kandidat.map((k) => k.label) : [];
    expect(label[0]).toContain("DIBUKA");
    expect(label[1]).toContain("MASIH TERBUKA");
  });

  it("kalimat pilihannya BISA DIBACA – periodenya di tempat yang benar", () => {
    /*
     * Bukan uji gaya. Ini kalimat yang dibaca orang lapangan sebagai pilihan
     * yang harus mereka putuskan; kalau canggung, ia dibaca ulang lalu
     * ditebak. Versi sebelumnya menempel periode di ujung label yang sudah
     * menyebut "periode itu", jadi berbunyi "…MASIH TERBUKA sekarang minggu
     * lalu". Lolos `toContain("MASIH TERBUKA")` tanpa masalah – yang
     * membuktikan asersi `toContain` saja tidak menjaga keterbacaan.
     */
    const r = parseNiatDeterministik("kendala minggu lalu");
    const label = r.jenis === "ambigu" ? r.kandidat.map((k) => k.label) : [];
    expect(label[0]).toBe("Semua kendala yang DIBUKA minggu lalu");
    expect(label[1]).toBe("Kendala minggu lalu yang MASIH TERBUKA sekarang");
    // Periode tidak boleh terdampar di belakang kata "sekarang".
    expect(label[1]).not.toMatch(/sekarang\s+(minggu|bulan|kemarin|hari|tanggal)/i);
  });

  it('"ada kendala apa" (tanpa periode) tetap langsung dijawab', () => {
    // Tidak ada yang ambigu di sini: tanpa periode, yang dimaksud memang
    // keadaan sekarang. Menawarkan pilihan justru membuang waktu.
    const r = parseNiatDeterministik("ada kendala apa");
    expect(r.jenis).toBe("yakin");
    expect(r.jenis === "yakin" && r.kandidat.niat).toBe("kendala");
  });

  it('"kendala hari ini" juga langsung dijawab', () => {
    const r = parseNiatDeterministik("kendala hari ini");
    expect(r.jenis).toBe("yakin");
    expect(r.jenis === "yakin" && r.kandidat.niat).toBe("kendala");
  });
});
