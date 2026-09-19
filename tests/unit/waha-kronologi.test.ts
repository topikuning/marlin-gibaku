// Balasan WhatsApp untuk LAPORAN LENGKAP satu lokasi — permintaan user
// 2026-09-19 (semula kronologi kendala + kegiatan, DECISIONS 484/486).
//
// Berkas ini HANYA menguji perakit balasan (`balasLaporanLokasi`) atas fixture
// `laporanLokasiFixture`. Pembacaan niatnya ("kesimpulan X", "laporan lengkap
// X", kalimat imperatif) dijaga `waha-parser-niat.test.ts`, yang tidak butuh
// fixture — supaya fixture yang berubah bentuk tidak ikut menggugurkan uji
// parser yang tidak ada hubungannya.
//
// Yang dikunci:
//
// 1. Kesimpulan dikutip APA ADANYA dari snapshot — tidak ditulis ulang.
// 2. Angkanya SAMA dengan snapshot, ditulis KONKRET dari fixture: perakit hanya
//    memformat, tidak menghitung; asersi yang menyalin rumus perakit ke dalam
//    uji tidak membuktikan apa-apa.
// 3. Yang belum ada DIKATAKAN "belum" dengan sebab yang MEMANG diketahui
//    snapshot (RAB, kurva-S, SPMK), bukan nol dan bukan sebab tebakan.
// 4. Deck yang diminta tapi belum ada juga dikatakan.
import { describe, expect, it } from "vitest";
import { balasKronologiTanpaLokasi, balasLaporanLokasi } from "@/lib/waha/tanya-format";
import { laporanLokasiFixture } from "../fixtures/laporan-lokasi-lengkap";

describe("balasLaporanLokasi – fixture penuh (Kemadang)", () => {
  const l = laporanLokasiFixture();
  const teks = balasLaporanLokasi(l, {});
  const baris = teks.split("\n");

  it("berjudul laporan lengkap, menyebut lokasi, tanggal posisi, dan wilayahnya", () => {
    expect(baris[0]).toBe("*Laporan lengkap Kemadang* – s.d. 2026-09-18");
    expect(baris[1]).toBe("_Gunungkidul, DI Yogyakarta_");
    expect(teks).not.toContain("belum berkontrak");
  });

  it("membuka dengan KESIMPULAN apa adanya, satu kalimat per baris, sebelum angka", () => {
    const iKesimpulan = teks.indexOf("*Kesimpulan*");
    const iAngka = teks.indexOf("*Angka kondisi terkini*");
    expect(iKesimpulan).toBeGreaterThan(-1);
    expect(iAngka).toBeGreaterThan(iKesimpulan);
    expect(l.kesimpulan).toHaveLength(3);
    for (const k of l.kesimpulan) expect(baris).toContain(k);
  });

  it("progres: rencana/realisasi/deviasi/minggu persis angka snapshot", () => {
    expect(baris).toContain(
      "• Progres: rencana 27,90% · realisasi 21,40% · deviasi −6,50% – minggu ke-7/18",
    );
  });

  it("laporan harian: final/diharapkan, hari tanpa laporan, laporan terakhir + umurnya", () => {
    expect(baris).toContain(
      "• Laporan harian: 30 final dari 49 hari yang diharapkan · 6 hari tanpa laporan · terakhir 2026-09-16 (2 hari lalu)",
    );
  });

  it("kendala: terbuka, lewat tenggat, tertua – dari kendala.ringkas", () => {
    expect(baris).toContain("• Kendala: 2 terbuka (1 lewat tenggat); tertua 23 hari");
  });

  it("temuan pemeriksa: terbuka, kritis, lewat tenggat – dari temuan.ringkas", () => {
    expect(baris).toContain("• Temuan pemeriksa: 2 terbuka (1 kritis, 1 lewat tenggat)");
  });

  it("administrasi: milestone dijumlahkan lintas fase (7+3 dari 9+12), surat perlu balas", () => {
    expect(baris).toContain("• Administrasi: milestone 10/21 selesai · 1 surat perlu dibalas");
  });

  it("perhatian: satu baris per EwsWarning – objek lalu alasannya", () => {
    expect(teks).toContain("*Perhatian*");
    expect(baris).toContain(
      "• *Lokasi Kemadang* – Realisasi 21,4% vs rencana 27,9% pada minggu ke-7 (deviasi -6,5 pp).",
    );
    expect(teks).not.toContain("lainnya di PDF");
  });

  it("perhatian maksimal tiga, sisanya disebut jumlahnya", () => {
    const satu = l.perhatian[0]!;
    const lima = laporanLokasiFixture({
      perhatian: [1, 2, 3, 4, 5].map((i) => ({ ...satu, ruleId: `r${i}`, objek: `Objek ${i}` })),
    });
    const t = balasLaporanLokasi(lima, {});
    expect(t).toContain("*Objek 3*");
    expect(t).not.toContain("*Objek 4*");
    expect(t).toContain("_…dan 2 lainnya di PDF._");
  });

  it("menjanjikan PDF menyusul, dan mengajak meminta deck dengan kutip lengkung", () => {
    expect(teks).toContain("📎 PDF laporan lengkap menyusul sebagai berkas.");
    expect(teks).toContain("Ketik “deck Kemadang” untuk versi presentasi.");
    expect(teks).not.toContain("Deck 16:9 belum tersedia");
  });

  it("deck diminta tapi belum tersedia: DIKATAKAN, dan ajakan deck tidak diulang", () => {
    const t = balasLaporanLokasi(l, { deckDiminta: true, deckTersedia: false });
    expect(t).toContain("Deck 16:9 belum tersedia – yang terkirim laporan A4.");
    expect(t).not.toContain("Ketik “deck");
  });

  it("deck diminta dan tersedia: tidak ada pengakuan yang salah, tidak ada ajakan mubazir", () => {
    const t = balasLaporanLokasi(l, { deckDiminta: true, deckTersedia: true });
    expect(t).not.toContain("belum tersedia");
    expect(t).not.toContain("Ketik “deck");
  });

  it("kaki balasan (pemotongan lingkup) tetap tercetak", () => {
    const t = balasLaporanLokasi(l, { catatanPemotongan: "Dipotong ke paket grup." });
    expect(t).toContain("ℹ️ Dipotong ke paket grup.");
  });

  it("tanda pisah memakai en-dash, bukan em-dash", () => {
    // Ditulis sebagai escape supaya penjaga em-dash tidak menandai uji ini sendiri.
    expect(teks).not.toContain(String.fromCharCode(0x2014));
  });
});

describe("balasLaporanLokasi – fixture kosong (belum berkontrak, tanpa RAB/kurva/SPMK)", () => {
  const kosong = laporanLokasiFixture({
    identitas: { ...laporanLokasiFixture().identitas, kontrak: null },
    kesimpulan: [],
    progres: {
      rencanaPct: null,
      realisasiPct: 0,
      deviasiPp: null,
      terverifikasiPct: 0,
      nilaiRab: "0",
      nilaiTerpasang: "0",
      mingguKe: 0,
      totalMinggu: 0,
      punyaRab: false,
      punyaKurva: false,
    },
    kelengkapan: null,
    kendala: { ringkas: { terbuka: 0, kritis: 0, lewatTenggat: 0, selesai: 0, tertuaHari: null }, terbuka: [], selesaiTerbaru: [] },
    temuan: {
      ringkas: { total: 0, terbuka: 0, kritis: 0, lewatTenggat: 0, selesai: 0, inspeksi: 0, inspeksiTerakhirKey: null },
      terbuka: [],
    },
    administrasi: {
      milestone: [],
      dokumen: { total: 0, kedaluwarsa: 0, segeraKedaluwarsa: 0, perFase: [] },
      surat: { masuk: 0, keluar: 0, perluBalas: 0, lewatTenggatBalas: 0, terakhir: [] },
    },
    perhatian: [],
  });
  const teks = balasLaporanLokasi(kosong, {});
  const baris = teks.split("\n");

  it("tidak melempar, dan mengatakan paket belum berkontrak", () => {
    expect(baris[2]).toBe("_Paket belum berkontrak – laporan disusun dari data yang sudah ada._");
  });

  it("kesimpulan kosong DIKATAKAN, bukan dikarang", () => {
    expect(baris).toContain("Belum ada kesimpulan dari sistem untuk tanggal ini.");
  });

  it("progres: 'belum ada RAB aktif' – bukan 0% dan bukan sebab tebakan", () => {
    expect(baris).toContain("• Progres: belum ada RAB aktif.");
    expect(teks).not.toContain("0,00%");
    expect(teks).not.toContain("minggu ke-");
  });

  it("laporan harian: belum ada hari kerja yang diharapkan", () => {
    expect(baris).toContain("• Laporan harian: belum ada hari kerja yang diharapkan (SPMK belum berjalan).");
  });

  it("kendala & temuan nihil ditulis 'tidak ada yang masih terbuka'", () => {
    expect(baris).toContain("• Kendala: tidak ada yang masih terbuka.");
    expect(baris).toContain("• Temuan pemeriksa: tidak ada yang masih terbuka.");
  });

  it("milestone 0 → 'belum ditetapkan', bukan 0/0", () => {
    expect(baris).toContain("• Administrasi: milestone belum ditetapkan · tidak ada surat menunggu balasan");
    expect(teks).not.toContain("0/0");
  });

  it("tanpa perhatian → bagian Perhatian tidak dicetak; baris PDF tetap ada", () => {
    expect(teks).not.toContain("*Perhatian*");
    expect(teks).toContain("📎 PDF laporan lengkap menyusul");
  });
});

describe("balasLaporanLokasi – RAB ada, kurva-S belum", () => {
  it("menulis realisasi apa adanya dan menyebut kurva-S yang belum ada", () => {
    const l = laporanLokasiFixture({
      progres: { ...laporanLokasiFixture().progres, punyaKurva: false, rencanaPct: null, deviasiPp: null },
    });
    const t = balasLaporanLokasi(l, {});
    expect(t).toContain(
      "• Progres: realisasi 21,40% · belum ada kurva-S aktif, rencana & deviasi belum bisa dibandingkan.",
    );
    expect(t).not.toContain("belum ada RAB");
  });

  it("kelengkapan dengan 0 hari diharapkan diperlakukan sama dengan null", () => {
    const l = laporanLokasiFixture({
      kelengkapan: { ...laporanLokasiFixture().kelengkapan!, hariDiharapkan: 0, final: 0 },
    });
    expect(balasLaporanLokasi(l, {})).toContain("belum ada hari kerja yang diharapkan (SPMK belum berjalan)");
  });
});

describe("balasKronologiTanpaLokasi", () => {
  it("menyebutkan pilihannya, bukan menolak", () => {
    const t = balasKronologiTanpaLokasi(["Danasari", "Kedung Mutih"], 5);
    expect(t).toContain("Danasari");
    expect(t).toContain("3 lokasi lain");
    expect(t).toContain("kesimpulan Danasari");
  });
});
