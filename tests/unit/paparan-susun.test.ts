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
  it("urutan inti lengkap: sampul → ringkasan → progres → … → lampiran", () => {
    const slides = susunSlides(content(snapshot(), narasiDeterministik(snapshot())), { draf: true });
    const jenis = slides.map((s) => s.jenis);
    expect(jenis[0]).toBe("sampul");
    expect(jenis[1]).toBe("ringkasan");
    expect(jenis[2]).toBe("progres_paket");
    expect(jenis).toContain("progres_lokasi");
    expect(jenis[jenis.length - 1]).toBe("lampiran");
    // 10–12 slide utama untuk paket kecil (spec §4).
    expect(slides.length).toBeGreaterThanOrEqual(8);
    expect(slides.length).toBeLessThanOrEqual(13);
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

  it("rencana belum diisi → slide menyatakan itu, bukan mengarang", () => {
    const slides = susunSlides(content(snapshot(), narasiDeterministik(snapshot())), { draf: true });
    const rencana = slides.find((x) => x.jenis === "rencana");
    if (rencana?.jenis !== "rencana") throw new Error("slide tidak ada");
    expect(rencana.adaRencana).toBe(false);
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
