import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import type { PeriodItemRow, PeriodReport } from "@/lib/periodic-report";
import { ringkasKelompok } from "@/lib/progress-calc";

/**
 * PDF blanko KKP untuk laporan mingguan/bulanan hanya dieksekusi saat unggah ke
 * Google Drive, jadi kegagalannya tidak terlihat dari layar. Uji ini menjaga
 * jalur render itu tetap hidup untuk kedua jenis periode.
 */

// Modul menarik rantai import yang memvalidasi env saat dimuat.
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";

const item = (no: number, name: string): PeriodItemRow => ({
  no,
  name,
  code: "",
  volK: 120,
  unit: "m3",
  unitPrice: 250_000,
  amount: 25_000_000,
  bobot: 2.5,
  volLalu: 10,
  prestasiLalu: 8.3,
  bobotLalu: 0.2,
  volIni: 15,
  prestasiIni: 12.5,
  bobotIni: 0.3,
  volSd: 25,
  prestasiSd: 20.8,
  bobotSd: 0.5,
  bobotRencana: 0.9,
  sisaVol: 95,
  sisaPrestasi: 79.2,
});

const N = 20;
const CATS = ["PEKERJAAN PERSIAPAN", "PEKERJAAN REVETMENT", "PEKERJAAN TAMBATAN PERAHU", "PEKERJAAN KANTOR PENGELOLA"];
const CODES = ["I", "II", "III", "IV"];

function fixture(kind: "mingguan" | "bulanan"): PeriodReport {
  const start = new Date(Date.UTC(2026, 5, 15));
  return {
    kind,
    n: kind === "mingguan" ? 6 : 2,
    maxN: kind === "mingguan" ? N : 5,
    totalWeeks: N,
    totalMonths: 5,
    header: {
      locationName: "Pasar Banggi",
      village: "Pasar Banggi",
      district: "Rembang",
      regency: "Rembang",
      province: "Jawa Tengah",
      packageName: "Pekerjaan Konstruksi Pembangunan Kampung Nelayan Merah Putih di Provinsi Jawa Tengah",
      ownerAgency: "KKP",
      contractNumber: "B.17105/DJPT.6/PI.420/PPK/VI/2026",
      vendorName: "PT Kurnia Alam Sentosa",
      contractValue: 5_872_342_857n,
      locationValue: 5_872_342_857n,
      masaPelaksanaanHari: 135,
      tahunAnggaran: 2026,
      contractStart: start,
      periodeStart: new Date(start.getTime() + 35 * 86_400_000),
      periodeEnd: new Date(start.getTime() + 41 * 86_400_000),
      ppkName: "Budi Santoso, S.T., M.T.",
      ppkNip: "197505121999031002",
      weekMode: "tujuh_hari" as const,
      contractEnd: null,
      wakilSahName: null,
      wakilSahNip: null,
      supervisorName: "Dedi Kurniawan, S.T.",
      supervisorFirm: "CV Konsultan Bahari Nusantara",
      contractorSignerName: "Hendra Gunawan",
      contractorSignerTitle: "Direktur Utama",
  pelaksanaName: "Joko Susilo",
  pelaksanaTitle: "Pelaksana Lapangan",
      supervisorFirmKontrak: "CV Konsultan Bahari Nusantara",
      coTeamLeaderName: null,
      teamLeaderName: null,
      projectManagerName: null,
    },
    categories: CATS.map((name, ci) => ({
      lineageKey: CODES[ci],
      code: CODES[ci],
      name,
      rows: Array.from({ length: 6 }, (_, i) => item(ci * 6 + i + 1, `${name} – butir ${i + 1}`)),
      subtotalAmount: 150_000_000,
      subtotalBobot: 25,
      subtotalBobotLalu: 1.2,
      subtotalBobotIni: 1.8,
      subtotalBobotSd: 3,
      subtotalBobotRencana: 4.6,
    })),
    progresKategori: [],
    progresKategoriTotal: ringkasKelompok([]),
    totals: { bobotLalu: 4.8, bobotIni: 7.2, bobotSd: 12, bobotRencana: 18.4 },
    planPct: 18.4,
    planPrevPct: 12.1,
    actualPct: 12,
    deviationPct: -6.4,
    scurve: {
      planPct: Array.from({ length: N }, (_, i) => Math.round(((i + 1) / N) * 10_000) / 100),
      actualPct: Array.from({ length: N }, (_, i) => (i < 6 ? (i + 1) * 2 : null)),
      currentWeek: 6,
    },
    kurvaSchedule: CATS.map((name, ci) => ({
      lineageKey: CODES[ci],
      code: CODES[ci],
      name,
      weekly: Array.from({ length: N }, (_, w) => (w >= ci * 4 && w < ci * 4 + 8 ? 25 / 8 : 0)),
    })),
    tenaga: [{ role: "mandor" as never, label: "Mandor", count: 12 }],
    material: [{ name: "Semen PC 50kg", unit: "sak", qty: 320 }],
    alat: [{ name: "Excavator", count: 8 }],
    cuacaRingkas: "Cerah 4 hari, hujan ringan 2 hari",
    kendala: [
      { title: "Akses jalan tergenang rob", severity: "tinggi" as never, status: "ditangani" as never, createdAt: start },
    ],
  };
}

describe("PDF blanko KKP periodik (yang disetor ke Drive)", () => {
  // Render PDF pertama menarik pdfkit + font-nya sekali; di runner yang sibuk
  // impor dingin itu saja bisa lewat 5 detik. Batas bawaan membuat uji ini
  // gagal-hilang-timbul — dan uji yang kadang merah mengajari orang mengabaikan
  // merah.
  it.each(["mingguan", "bulanan"] as const)("merender laporan %s tanpa gagal", { timeout: 30_000 }, async (kind) => {
    const { buildPeriodikKkpPdf } = await import("@/lib/pdf/periodik-kkp");
    const buf = await buildPeriodikKkpPdf(fixture(kind), "MARLIN");
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    // Blanko = halaman kurva-S + halaman rincian; selalu >1 halaman.
    const pages = buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g)?.length ?? 0;
    expect(pages, "jumlah halaman").toBeGreaterThanOrEqual(2);
    expect(buf.length).toBeGreaterThan(10_000);
  });
});

describe("PDF Time Schedule berdiri sendiri (halaman cetak jadwal)", () => {
  /*
   * Dokumen jadwal = lembar kurva-S SAJA, bukan laporan periodik. Ketetapan
   * user 2026-08-21: *"kurva s yang menyatu dalam laporan mingguan adalah
   * laporan mingguan, jangan campuradukkan dengan kurva s sebagai jadwal."*
   * Kalau rincian ikut tercetak, yang beredar adalah laporan mingguan berjudul
   * jadwal.
   */
  const pages = (buf: Buffer) => buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g)?.length ?? 0;

  it("hanya lembar kurva – tanpa halaman rincian laporan", { timeout: 30_000 }, async () => {
    const { buildJadwalKkpPdf } = await import("@/lib/pdf/periodik-kkp");
    const r = fixture("mingguan");
    const buf = await buildJadwalKkpPdf(r, "MARLIN", null, {
      periode: { start: r.header.contractStart, end: new Date(Date.UTC(2026, 9, 27)) },
      catatan: null,
    });
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pages(buf), "jumlah halaman").toBe(1);
  });

  it("catatan asumsi SPMK ikut tercetak tanpa menambah halaman", { timeout: 30_000 }, async () => {
    const { buildJadwalKkpPdf } = await import("@/lib/pdf/periodik-kkp");
    const r = fixture("mingguan");
    const opsi = { periode: { start: r.header.contractStart, end: new Date(Date.UTC(2026, 9, 27)) } };
    const tanpa = await buildJadwalKkpPdf(r, "MARLIN", null, { ...opsi, catatan: null });
    const dengan = await buildJadwalKkpPdf(r, "MARLIN", null, {
      ...opsi,
      catatan: "Catatan: SPMK belum diterbitkan. Jadwal ini dihitung dari asumsi mulai 15 Juni 2026.",
    });
    expect(pages(dengan)).toBe(1);
    expect(dengan.length).toBeGreaterThan(tanpa.length);
  });
});

describe("PDF laporan mingguan: halaman progres per kategori (DECISIONS 670)", () => {
  const pages = (buf: Buffer) => buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g)?.length ?? 0;

  it("mingguan mendapat SATU halaman tambahan; bulanan tidak", { timeout: 30_000 }, async () => {
    const { buildPeriodikKkpPdf } = await import("@/lib/pdf/periodik-kkp");
    const isi = (kind: "mingguan" | "bulanan") => {
      const r = fixture(kind);
      r.progresKategori = r.categories.map((c) => ({ tingkat: 1 as const, code: c.code, name: c.name, ...ringkasKelompok(c.rows) }));
      r.progresKategoriTotal = ringkasKelompok(r.categories.flatMap((c) => c.rows));
      return r;
    };
    const mingguan = await buildPeriodikKkpPdf(isi("mingguan"), "MARLIN");
    const bulanan = await buildPeriodikKkpPdf(isi("bulanan"), "MARLIN");
    expect(pages(mingguan)).toBe(pages(bulanan) + 1);
  });
});

/*
 * PDF yang "berantakan mulai halaman 19" (laporan user 2026-10-12): blok tanda
 * tangan meminta halaman baru tapi tetap digambar di posisi lama (dasar halaman
 * sebelumnya), lalu meluber – pdfkit menambah halaman berisi sepotong tanda
 * tangan atau catatan kaki saja. Uji ini menggeser panjang tabel supaya tanda
 * tangan jatuh di berbagai posisi dekat batas bawah, lalu memeriksa tidak ada
 * halaman yang isinya cuma sisa luberan.
 */
describe("PDF periodik: tidak ada halaman luberan", () => {
  const isiHalaman = (buf: Buffer): number[] => {
    const teks = buf.toString("latin1");
    const objek = new Map<number, { kamus: string; awal: number }>();
    for (const m of teks.matchAll(/(\d+) 0 obj\s*<<([\s\S]*?)>>\s*(stream\r?\n)?/g)) {
      objek.set(Number(m[1]), { kamus: m[2], awal: m[3] ? (m.index ?? 0) + m[0].length : -1 });
    }
    const panjang: number[] = [];
    for (const { kamus } of objek.values()) {
      if (!/\/Type\s*\/Page[^s]/.test(kamus)) continue;
      const ref = /\/Contents\s+(\d+)\s+0\s+R/.exec(kamus);
      const isi = ref ? objek.get(Number(ref[1])) : undefined;
      if (!isi || isi.awal < 0) {
        panjang.push(0);
        continue;
      }
      const akhir = teks.indexOf("endstream", isi.awal);
      const mentah = buf.subarray(isi.awal, akhir);
      let n = mentah.length;
      try {
        n = inflateSync(mentah).length;
      } catch {
        // tidak terkompresi
      }
      panjang.push(n);
    }
    return panjang;
  };

  it("tanda tangan pindah utuh ke halaman berikut – tidak ada halaman berisi sisa saja", { timeout: 120_000 }, async () => {
    const { buildPeriodikKkpPdf } = await import("@/lib/pdf/periodik-kkp");
    const kosong: number[] = [];
    for (let n = 4; n <= 46; n += 3) {
      const r = fixture("mingguan");
      r.categories[3].rows = Array.from({ length: n }, (_, i) => item(1000 + i, `Butir tambahan ${i + 1}`));
      const buf = await buildPeriodikKkpPdf(r, "MARLIN");
      // Halaman sah selalu memuat tabel/kop (ribuan byte perintah gambar);
      // luberan cuma catatan kaki atau satu-dua baris teks.
      if (isiHalaman(buf).some((b) => b < 1500)) kosong.push(n);
    }
    expect(kosong, "panjang tabel yang menghasilkan halaman luberan").toEqual([]);
  });
});

/*
 * Kop halaman progres mingguan memasang TIGA logo (PENYEDIA JASA · KONSULTAN
 * PENGAWAS · PEMBERI TUGAS) seperti contoh Lampiran Termin (DECISIONS 671).
 * Logo yang dikirim sebagai Buffer pernah hilang diam-diam: pdfkit membacanya
 * sebagai nama berkas, melempar, dan `catch` menelannya.
 */
describe("PDF laporan mingguan: tiga logo di kop halaman progres", () => {
  it("logo penyedia, konsultan, dan pemberi tugas benar-benar tergambar", { timeout: 30_000 }, async () => {
    const sharp = (await import("sharp")).default;
    const logo = async (w: number, h: number, warna: string) => ({
      buffer: await sharp({ create: { width: w, height: h, channels: 3, background: warna } }).png().toBuffer(),
      width: w,
      height: h,
    });
    const { buildPeriodikKkpPdf } = await import("@/lib/pdf/periodik-kkp");
    const r = fixture("mingguan");
    r.progresKategori = r.categories.map((c) => ({ tingkat: 1 as const, code: c.code, name: c.name, ...ringkasKelompok(c.rows) }));
    r.progresKategoriTotal = ringkasKelompok(r.categories.flatMap((c) => c.rows));
    const gambar = (buf: Buffer) => buf.toString("latin1").match(/\/Subtype\s*\/Image/g)?.length ?? 0;
    const tanpa = await buildPeriodikKkpPdf(r, "MARLIN", null, null);
    const dengan = await buildPeriodikKkpPdf(r, "MARLIN", null, {
      kontraktor: await logo(240, 110, "#1d4ed8"),
      konsultan: await logo(120, 140, "#0ea5e9"),
      pemilik: await logo(150, 150, "#f59e0b"),
    });
    expect(gambar(dengan) - gambar(tanpa)).toBe(3);
  });
});
