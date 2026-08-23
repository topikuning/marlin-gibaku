/*
 * PAPARAN MINGGUAN KKP — LOGIKA MURNI (DECISIONS 416).
 *
 * Yang dijaga di sini adalah bagian yang menentukan JUJUR-tidaknya deck:
 * grounding narasi AI (butir dengan sumber/lokasi/angka yang salah DIBUANG),
 * fallback deterministik, penyebaran foto antar lokasi, dan perakitan slide
 * (tabel panjang pecah halaman, bukan mengecil).
 */
import { describe, expect, it } from "vitest";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";

const { narasiDeterministik, pecah, pilihFotoAwal, saringNarasiPaparan, susunSlides, parsePaparanContent } =
  await import("@/lib/paparan/susun");
const { PAPARAN_TEMPLATE_KEY } = await import("@/lib/paparan/jenis");
import type { PaparanContent, PaparanNarasi, PaparanSnapshot } from "@/lib/paparan/jenis";

/* ── Fixture snapshot: 2 lokasi, nilai RAB BEDA JAUH ──────────────────────
 * Bobot berbeda dipilih sengaja supaya bug rata-rata sederhana ketahuan:
 * rata-rata biasa (10+50)/2 = 30%, tertimbang (12M×10 + 3M×50)/15M = 18%.  */
function snapshot(overrides: Partial<PaparanSnapshot> = {}): PaparanSnapshot {
  return {
    version: 1,
    paket: { id: "pkg-1", name: "Paket Natuna", packageNumber: null, ownerAgency: "KKP", province: "Kepri" },
    kontrak: {
      contractNumber: "SPK-001",
      workTitle: "Pembangunan KNMP Natuna",
      vendorName: "PT Uji",
      contractValue: "15000000000",
      startDateKey: "2026-06-01",
      endDateKey: "2026-10-28",
      durationDays: 150,
      ppkName: null,
      supervisorName: null,
      supervisorFirm: null,
    },
    periode: {
      mingguKe: 6,
      totalMinggu: 22,
      mulaiKey: "2026-07-06",
      akhirKey: "2026-07-12",
      berjalan: false,
      asOfKey: "2026-07-12",
    },
    dataAsOf: "2026-07-12T10:00:00.000Z",
    progres: {
      paket: {
        targetPct: 20,
        realisasiPct: 18,
        deviasiPp: -2,
        realisasiSebelumPct: 15,
        kenaikanPp: 3,
        lokasiDihitung: 2,
        lokasiTanpaKurva: 0,
      },
      lokasi: [
        {
          locationId: "loc-a",
          slug: "loka",
          name: "Lokasi A",
          regency: "Natuna",
          province: "Kepri",
          targetPct: 15,
          realisasiPct: 10,
          deviasiPp: -5,
          realisasiSebelumPct: 8,
          kenaikanPp: 2,
          grandTotal: "12000000000",
          sourceRefIds: ["loka:progress"],
        },
        {
          locationId: "loc-b",
          slug: "lokb",
          name: "Lokasi B",
          regency: "Natuna",
          province: "Kepri",
          targetPct: 40,
          realisasiPct: 50,
          deviasiPp: 10,
          realisasiSebelumPct: 45,
          kenaikanPp: 5,
          grandTotal: "3000000000",
          sourceRefIds: ["lokb:progress"],
        },
      ],
    },
    kelengkapan: {
      diharapkan: 14,
      final: 9,
      diproses: 2,
      draft: 1,
      perluKoreksi: 1,
      hariNihil: 1,
      lokasiTanpaLaporan: [],
    },
    capaian: [
      {
        locationId: "loc-a",
        lokasiNama: "Lokasi A",
        pekerjaan: "Pasangan batu",
        unit: "m3",
        volume: 25,
        sourceRefIds: ["loka:laporan"],
      },
    ],
    kegiatan: [],
    kendala: { baruMingguIni: [], terbukaSaatIni: [], statusTerkini: true },
    pemulihan: [],
    fotoKandidat: [],
    rencanaMingguDepan: null,
    limitations: [],
    sourceRefs: [
      { id: "paket:rekap", entityType: "package", entityId: "pkg-1", label: "Rekap paket" },
      { id: "loka:progress", entityType: "location", entityId: "loc-a", label: "Lokasi A progres" },
      { id: "lokb:progress", entityType: "location", entityId: "loc-b", label: "Lokasi B progres" },
      { id: "loka:laporan", entityType: "location", entityId: "loc-a", label: "Lokasi A laporan" },
    ],
    ...overrides,
  };
}

function narasiValid(): PaparanNarasi {
  return {
    title: "Paparan Mingguan Paket Natuna",
    ringkasanEksekutif: [{ text: "Realisasi paket 18,0% terhadap rencana 20,0%.", sourceRefIds: ["paket:rekap"] }],
    capaianNaratif: [
      { text: "Lokasi A menuntaskan pasangan batu.", locationId: "loc-a", sourceRefIds: ["loka:laporan"] },
    ],
    kegiatanNaratif: [],
    sintesisKendala: [{ text: "Tidak ada kendala berarti.", locationId: null, sourceRefIds: ["paket:rekap"] }],
    rencanaNaratif: [],
    dukunganDibutuhkan: [],
    actionPlan: [
      { text: "Menyelesaikan pasangan batu di Lokasi A.", sourceRefIds: ["paket:rekap"] },
    ],
    limitations: [],
  };
}

describe("grounding narasi AI", () => {
  it("narasi bersumber sah lolos utuh", () => {
    const hasil = saringNarasiPaparan(narasiValid(), snapshot());
    expect(hasil.dibuang).toEqual([]);
    expect(hasil.narasi.ringkasanEksekutif).toHaveLength(1);
  });

  it("sourceRefId yang tidak dikenal → butirnya dibuang", () => {
    const n = narasiValid();
    n.ringkasanEksekutif.push({ text: "Kalimat tanpa sumber.", sourceRefIds: ["asing:ref"] });
    const hasil = saringNarasiPaparan(n, snapshot());
    expect(hasil.narasi.ringkasanEksekutif).toHaveLength(1);
    expect(hasil.dibuang.some((d) => d.includes("sumber tidak dikenal"))).toBe(true);
  });

  it("locationId di luar paket → butirnya dibuang", () => {
    const n = narasiValid();
    n.capaianNaratif.push({ text: "Lokasi asing maju pesat.", locationId: "loc-z", sourceRefIds: ["paket:rekap"] });
    const hasil = saringNarasiPaparan(n, snapshot());
    expect(hasil.narasi.capaianNaratif).toHaveLength(1);
    expect(hasil.dibuang.some((d) => d.includes("lokasi di luar paket"))).toBe(true);
  });

  it("angka lokasi A TIDAK lolos hanya karena sama dengan angka lokasi B", () => {
    /*
     * Inti klaim terikat (spec §17 tes 17). Realisasi 50% adalah milik lokasi
     * B; kalimat yang menempelkannya ke lokasi A harus gugur — walau 50 ada di
     * kolam angka global.
     */
    const n = narasiValid();
    n.capaianNaratif = [
      { text: "Realisasi 50,0% tercapai.", locationId: "loc-a", sourceRefIds: ["loka:progress"] },
    ];
    const hasil = saringNarasiPaparan(n, snapshot());
    expect(hasil.narasi.capaianNaratif).toHaveLength(0);
    expect(hasil.dibuang.some((d) => d.includes("angka tanpa sumber"))).toBe(true);
  });

  it("angka milik lokasi itu sendiri LOLOS", () => {
    const n = narasiValid();
    n.capaianNaratif = [
      { text: "Realisasi 50,0% tercapai.", locationId: "loc-b", sourceRefIds: ["lokb:progress"] },
    ];
    const hasil = saringNarasiPaparan(n, snapshot());
    expect(hasil.narasi.capaianNaratif).toHaveLength(1);
  });

  it("keluaran yang gagal skema → seluruh narasi jatuh ke deterministik", () => {
    const hasil = saringNarasiPaparan({ ngawur: true }, snapshot());
    expect(hasil.dibuang.some((d) => d.includes("deterministik"))).toBe(true);
    expect(hasil.narasi.ringkasanEksekutif.length).toBeGreaterThan(0);
  });

  it("seluruh narasi gugur grounding → jatuh ke deterministik, bukan deck kosong", () => {
    const n = narasiValid();
    n.ringkasanEksekutif = [{ text: "kalimat tanpa sumber sah", sourceRefIds: ["asing:1"] }];
    n.capaianNaratif = [{ text: "lokasi asing", locationId: "loc-z", sourceRefIds: ["asing:2"] }];
    n.sintesisKendala = [{ text: "sumber asing", locationId: null, sourceRefIds: ["asing:3"] }];
    const hasil = saringNarasiPaparan(n, snapshot());
    expect(hasil.dibuang.some((d) => d.includes("gugur grounding"))).toBe(true);
    expect(hasil.narasi.ringkasanEksekutif.length).toBeGreaterThan(0);
  });
});

describe("narasi deterministik (tanpa AI)", () => {
  it("selalu menghasilkan ringkasan + limitation yang menyebut AI tidak tersedia", () => {
    const n = narasiDeterministik(snapshot());
    expect(n.ringkasanEksekutif.length).toBeGreaterThan(0);
    expect(n.limitations.some((l) => l.includes("Narasi AI tidak tersedia"))).toBe(true);
    // Angka yang ia tulis sendiri harus konsisten dengan snapshot.
    expect(n.ringkasanEksekutif[0].text).toContain("18,0%");
  });

  it("tanpa kurva-S paket: tidak menyebut rencana yang tidak ada", () => {
    const s = snapshot();
    s.progres.paket.targetPct = null;
    s.progres.paket.deviasiPp = null;
    const n = narasiDeterministik(s);
    expect(n.ringkasanEksekutif[0].text).toContain("belum bisa dihitung");
  });
});

describe("pemilihan foto awal", () => {
  const foto = (id: string, loc: string) => ({
    id,
    locationId: loc,
    lokasiNama: loc,
    tanggalKey: "2026-07-07",
    keterangan: null,
    r2Key: `${id}.webp`,
    thumbnailKey: null,
  });

  it("disebar antar lokasi – satu lokasi tidak memonopoli", () => {
    const kandidat = [
      ...["a1", "a2", "a3", "a4", "a5", "a6"].map((id) => foto(id, "loc-a")),
      ...["b1", "b2"].map((id) => foto(id, "loc-b")),
    ];
    const hasil = pilihFotoAwal(kandidat, 6);
    expect(hasil).toHaveLength(6);
    expect(hasil.filter((id) => id.startsWith("b"))).toHaveLength(2);
  });

  it("kandidat kosong → tidak memilih apa pun", () => {
    expect(pilihFotoAwal([], 6)).toEqual([]);
  });
});

/* ── Perakitan slide ────────────────────────────────────────────────────── */

function content(s: PaparanSnapshot, narasi: PaparanNarasi): PaparanContent {
  return {
    scopeHash: "abc",
    templateKey: PAPARAN_TEMPLATE_KEY,
    templateVersion: 1,
    packageId: "pkg-1",
    weekNumber: s.periode.mingguKe,
    snapshot: s,
    narasi,
    narasiSumber: "deterministik",
    selectedPhotoIds: [],
    humanEdits: null,
  };
}

describe("perakitan slide", () => {
  it("sampul deck LOKASI menaruh nama lokasi sebagai judul besar (DECISIONS 420)", () => {
    const c = content(snapshot({ lingkup: { jenis: "lokasi", locationId: "loc-1", nama: "Kemantren" } }), narasiValid());
    const sampul = susunSlides(c, { draf: true })[0];
    if (sampul.jenis !== "sampul") throw new Error("slide pertama bukan sampul");
    /*
     * Kebalikannya – judul kontrak besar, lokasi kecil – membuat deck satu
     * lokasi terbaca sebagai deck seluruh kontrak. Itu yang harus dicegah.
     */
    expect(sampul.judulKerja).toBe("Kemantren");
    expect(sampul.subJudul).toContain(c.snapshot.paket.name);
  });

  it("tanpa lingkup (artefak lama) sampul tetap seperti dulu: lingkup paket", () => {
    const c = content(snapshot(), narasiValid());
    delete c.snapshot.lingkup;
    const sampul = susunSlides(c, { draf: true })[0];
    if (sampul.jenis !== "sampul") throw new Error("slide pertama bukan sampul");
    expect(sampul.judulKerja).toBe(c.snapshot.kontrak.workTitle ?? c.snapshot.paket.name);
  });

  it("urutan inti pola Mataram: sampul → … → action_plan → lampiran → penutup", () => {
    const slides = susunSlides(content(snapshot(), narasiDeterministik(snapshot())), { draf: true });
    const jenis = slides.map((s) => s.jenis);
    expect(jenis[0]).toBe("sampul");
    expect(jenis).toContain("ringkasan");
    expect(jenis).toContain("progres_lokasi"); // paket 2 lokasi
    expect(jenis).toContain("action_plan");
    expect(jenis[jenis.length - 2]).toBe("lampiran");
    expect(jenis[jenis.length - 1]).toBe("penutup");
    // Slide action_plan datang SETELAH kendala (posisi akhir seperti contoh).
    expect(jenis.indexOf("action_plan")).toBeGreaterThan(jenis.indexOf("kendala"));
  });

  it("lokasi lebih dari 10 → tabel pecah ke slide lanjutan, bukan mengecil", () => {
    const s = snapshot();
    s.progres.lokasi = Array.from({ length: 23 }, (_, i) => ({
      ...s.progres.lokasi[0],
      locationId: `loc-${i}`,
      name: `Lokasi ${i}`,
    }));
    const slides = susunSlides(content(s, narasiDeterministik(s)), { draf: true });
    const bagian = slides.filter((sl) => sl.jenis === "progres_lokasi");
    expect(bagian).toHaveLength(3);
    expect(bagian.every((sl) => sl.jenis === "progres_lokasi" && sl.baris.length <= 10)).toBe(true);
  });

  it("urutan lokasi exception-first: deviasi terburuk / tanpa kurva di atas", () => {
    const s = snapshot();
    const slides = susunSlides(content(s, narasiDeterministik(s)), { draf: true });
    const sl = slides.find((x) => x.jenis === "progres_lokasi");
    if (sl?.jenis !== "progres_lokasi") throw new Error("slide tidak ada");
    expect(sl.baris[0].locationId).toBe("loc-a"); // deviasi −5 di atas +10
  });

  it("suntingan manusia menggantikan narasi, angka slide TIDAK berubah", () => {
    const c = content(snapshot(), narasiDeterministik(snapshot()));
    c.humanEdits = { ringkasanEksekutif: ["Kalimat hasil suntingan reviewer."] };
    const slides = susunSlides(c, { draf: true });
    const ringkasan = slides.find((x) => x.jenis === "ringkasan");
    if (ringkasan?.jenis !== "ringkasan") throw new Error("slide tidak ada");
    expect(ringkasan.butir).toEqual(["Kalimat hasil suntingan reviewer."]);
    // Angka tetap dari snapshot — jalur edit tidak menyentuhnya.
    expect(ringkasan.angka.realisasi).toBe(18);
  });

  it("Action Plan TIDAK pernah kosong – narasi tanpa saran jatuh ke saran deterministik", () => {
    /*
     * Permintaan user 2026-08-22: Action Plan = saran NYATA minggu depan dari
     * minggu terakhir. Snapshot fixture punya deviasi −2 pp, jadi minimal
     * saran "mengejar ketertinggalan" harus muncul walau narasi tak membawa
     * actionPlan sama sekali.
     */
    const n = narasiDeterministik(snapshot());
    n.actionPlan = [];
    const slides = susunSlides(content(snapshot(), n), { draf: true });
    const ap = slides.find((x) => x.jenis === "action_plan");
    if (ap?.jenis !== "action_plan") throw new Error("slide tidak ada");
    expect(ap.butir.length).toBeGreaterThan(0);
    expect(ap.butir.join(" ")).toContain("ketertinggalan");
  });

  it("suntingan manusia pada Action Plan menggantikan saran narasi", () => {
    const c = content(snapshot(), narasiDeterministik(snapshot()));
    c.humanEdits = { actionPlan: ["Prioritaskan pengecoran balai nelayan."] };
    const slides = susunSlides(c, { draf: true });
    const ap = slides.find((x) => x.jenis === "action_plan");
    if (ap?.jenis !== "action_plan") throw new Error("slide tidak ada");
    expect(ap.butir).toEqual(["Prioritaskan pengecoran balai nelayan."]);
  });

  it("minggu lampau: slide kendala membawa penanda status terkini", () => {
    const s = snapshot();
    s.kendala.terbukaSaatIni = [
      {
        id: "i1",
        judul: "Lahan belum clear",
        severity: "tinggi",
        status: "terbuka",
        locationId: "loc-a",
        lokasiNama: "Lokasi A",
        punyaRecovery: false,
      },
    ];
    const slides = susunSlides(content(s, narasiDeterministik(s)), { draf: true });
    const kendala = slides.find((x) => x.jenis === "kendala");
    if (kendala?.jenis !== "kendala") throw new Error("slide tidak ada");
    expect(kendala.statusTerkini).toBe(true);
  });
});

describe("pecah()", () => {
  it("membagi rata dan tidak menelan sisa", () => {
    expect(pecah([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(pecah([], 4)).toEqual([[]]);
  });
});

describe("parsePaparanContent", () => {
  it("menolak bentuk yang bukan paparan", () => {
    expect(() => parsePaparanContent({ templateKey: "laporan_biasa" })).toThrow();
    expect(() => parsePaparanContent(null)).toThrow();
  });
  it("menerima konten kanonik", () => {
    const c = content(snapshot(), narasiDeterministik(snapshot()));
    expect(parsePaparanContent(JSON.parse(JSON.stringify(c))).weekNumber).toBe(6);
  });
});

describe("slide gaya Mataram (kurva, durasi, status kategori, penutup)", () => {
  const sMataram = (): PaparanSnapshot => ({
    ...snapshot(),
    kurva: {
      totalMinggu: 22,
      planPct: Array.from({ length: 22 }, (_, i) => ((i + 1) / 22) * 100),
      jendela: [
        { minggu: 4, realisasiPct: 10, kenaikanPp: null },
        { minggu: 5, realisasiPct: 15, kenaikanPp: 5 },
        { minggu: 6, realisasiPct: 18, kenaikanPp: 3 },
      ],
    },
    durasi: { totalHari: 150, hariBerjalan: 42, sisaHari: 108, pctWaktu: 28 },
    kategori: [
      {
        locationId: "loc-a",
        lokasiNama: "Lokasi A",
        kelompok: [
          { lineageKey: "I", nama: "Pekerjaan Persiapan", realisasiPct: 88, bobotPct: 10 },
          { lineageKey: "II", nama: "Jalan Lingkungan & Saluran", realisasiPct: 5.4, bobotPct: 30 },
          { lineageKey: "III", nama: "Balai Pertemuan Nelayan", realisasiPct: 41, bobotPct: 20 },
        ],
      },
    ],
  });

  it("kurva, durasi, dan status kategori masuk deck; penutup selalu terakhir", () => {
    const slides = susunSlides(content(sMataram(), narasiDeterministik(sMataram())), { draf: true });
    const jenis = slides.map((x) => x.jenis);
    expect(jenis).toContain("kurva");
    expect(jenis).toContain("durasi");
    expect(jenis).toContain("status_kategori");
    expect(jenis[jenis.length - 1]).toBe("penutup");
    // Urutan pembuka mengikuti contoh: sampul → kurva → durasi.
    expect(jenis.slice(0, 3)).toEqual(["sampul", "kurva", "durasi"]);
  });

  it("snapshot v1 (tanpa kurva/durasi/kategori) tetap terakit tanpa slide itu", () => {
    const slides = susunSlides(content(snapshot(), narasiDeterministik(snapshot())), { draf: true });
    const jenis = slides.map((x) => x.jenis);
    expect(jenis).not.toContain("kurva");
    expect(jenis).not.toContain("durasi");
    expect(jenis[0]).toBe("sampul");
    expect(jenis[jenis.length - 1]).toBe("penutup");
  });

  it("Action Plan deterministik menyebut PEKERJAAN NYATA, bukan kalimat umum", () => {
    const n = narasiDeterministik(sMataram());
    const teks = n.actionPlan.map((b) => b.text).join(" ");
    // Hampir tuntas → didorong selesai; terendah → ditambah atensi.
    expect(teks).toContain("Pekerjaan Persiapan");
    expect(teks).toContain("Jalan Lingkungan & Saluran");
  });

  it("foto per pekerjaan: dikelompokkan per kategori dgn persen kategorinya", () => {
    const s = sMataram();
    s.fotoKandidat = [
      { id: "11111111-1111-4111-8111-111111111111", locationId: "loc-a", lokasiNama: "Lokasi A", tanggalKey: "2026-07-08", keterangan: "Galian saluran", lineageKey: "II#1", r2Key: "a.webp", thumbnailKey: null },
      { id: "22222222-2222-4222-8222-222222222222", locationId: "loc-a", lokasiNama: "Lokasi A", tanggalKey: "2026-07-09", keterangan: "Pasang batu saluran", lineageKey: "II#2", r2Key: "b.webp", thumbnailKey: null },
      { id: "33333333-3333-4333-8333-333333333333", locationId: "loc-a", lokasiNama: "Lokasi A", tanggalKey: "2026-07-09", keterangan: "Kolom balai", lineageKey: "III#1", r2Key: "c.webp", thumbnailKey: null },
    ];
    const c = content(s, narasiDeterministik(s));
    c.selectedPhotoIds = s.fotoKandidat.map((f) => f.id);
    const slides = susunSlides(c, { draf: true });
    const fp = slides.filter((x) => x.jenis === "foto_pekerjaan");
    expect(fp).toHaveLength(2); // dua kategori → dua slide
    const saluran = fp.find((x) => x.jenis === "foto_pekerjaan" && x.judul === "Jalan Lingkungan & Saluran");
    if (saluran?.jenis !== "foto_pekerjaan") throw new Error("slide saluran tidak ada");
    expect(saluran.foto).toHaveLength(2);
    expect(saluran.pct).toBeCloseTo(5.4, 5);
  });
});

describe("Action Plan: rencana mingguan didahulukan, kosong → rekomendasi kejar bobot", () => {
  const dasarMataram = (): PaparanSnapshot => ({
    ...snapshot(),
    kurva: {
      totalMinggu: 22,
      planPct: Array.from({ length: 22 }, (_, i) => ((i + 1) / 22) * 100),
      jendela: [{ minggu: 6, realisasiPct: 18, kenaikanPp: 3 }],
    },
    kategori: [
      {
        locationId: "loc-a",
        lokasiNama: "Lokasi A",
        kelompok: [
          { lineageKey: "I", nama: "Pekerjaan Persiapan", realisasiPct: 88, bobotPct: 10 },
          { lineageKey: "II", nama: "Jalan Lingkungan & Saluran", realisasiPct: 5.4, bobotPct: 30 },
          { lineageKey: "III", nama: "Balai Pertemuan Nelayan", realisasiPct: 41, bobotPct: 20 },
        ],
      },
    ],
  });

  it("rencana mingguan TERISI → butir PERTAMA mengeksekusi rencananya", () => {
    const s = dasarMataram();
    s.rencanaMingguDepan = [
      {
        locationId: "loc-a",
        lokasiNama: "Lokasi A",
        catatan: null,
        item: [{ nama: "Pengecoran balai", unit: "m3", targetVolume: 12 }],
      },
    ];
    const n = narasiDeterministik(s);
    expect(n.actionPlan[0].text).toContain("Melaksanakan rencana minggu ke-7");
    expect(n.actionPlan[0].text).toContain("Pengecoran balai");
    // Rekomendasi kejar TIDAK ikut — rencananya sudah ada, jangan menimpanya.
    expect(n.actionPlan.map((b) => b.text).join(" ")).not.toContain("belum diisi");
  });

  it("rencana KOSONG → butir pertama rekomendasi kejar rencana minggu depan, prioritas SISA BOBOT terbesar", () => {
    const s = dasarMataram(); // rencanaMingguDepan: null
    const n = narasiDeterministik(s);
    const pertama = n.actionPlan[0].text;
    expect(pertama).toContain("belum diisi");
    // Rencana kumulatif minggu ke-7 kurva linier /22 = 31,8%.
    expect(pertama).toContain("31,8%");
    // Kebutuhan kenaikan dari realisasi 18% = 13,8 pp — menutup deviasi
    // SEKALIGUS kenaikan minggu depan.
    expect(pertama).toContain("13,8 pp");
    /*
     * Prioritas = sisa bobot, BUKAN persentase terendah semata:
     * Jalan 30×94,6% = 28,4 > Balai 20×59% = 11,8 > Persiapan 10×12% = 1,2.
     */
    const posJalan = pertama.indexOf("Jalan Lingkungan & Saluran");
    const posBalai = pertama.indexOf("Balai Pertemuan Nelayan");
    expect(posJalan).toBeGreaterThan(-1);
    expect(posBalai).toBeGreaterThan(posJalan);
    expect(pertama).toContain("sisa bobot 28,4%");
  });

  it("grounding: Action Plan AI yang menyebut angka kejar minggu depan LOLOS", () => {
    const s = dasarMataram();
    const n = narasiValid();
    n.actionPlan = [
      {
        text: "Kejar rencana kumulatif 31,8% minggu depan dengan menuntaskan Jalan Lingkungan & Saluran (sisa bobot 28,4%).",
        sourceRefIds: ["paket:rekap"],
      },
    ];
    const hasil = saringNarasiPaparan(n, s);
    expect(hasil.narasi.actionPlan.some((b) => b.text.includes("31,8%"))).toBe(true);
  });
});
