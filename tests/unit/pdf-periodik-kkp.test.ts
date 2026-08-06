import { describe, expect, it } from "vitest";
import type { PeriodItemRow, PeriodReport } from "@/lib/periodic-report";

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
      supervisorName: "Dedi Kurniawan, S.T.",
      supervisorFirm: "CV Konsultan Bahari Nusantara",
      contractorSignerName: "Hendra Gunawan",
      contractorSignerTitle: "Direktur Utama",
    },
    categories: CATS.map((name, ci) => ({
      code: CODES[ci],
      name,
      rows: Array.from({ length: 6 }, (_, i) => item(ci * 6 + i + 1, `${name} — butir ${i + 1}`)),
      subtotalAmount: 150_000_000,
      subtotalBobot: 25,
      subtotalBobotLalu: 1.2,
      subtotalBobotIni: 1.8,
      subtotalBobotSd: 3,
      subtotalBobotRencana: 4.6,
    })),
    totals: { bobotLalu: 4.8, bobotIni: 7.2, bobotSd: 12, bobotRencana: 18.4 },
    planPct: 18.4,
    actualPct: 12,
    deviationPct: -6.4,
    scurve: {
      planPct: Array.from({ length: N }, (_, i) => Math.round(((i + 1) / N) * 10_000) / 100),
      actualPct: Array.from({ length: N }, (_, i) => (i < 6 ? (i + 1) * 2 : null)),
      currentWeek: 6,
    },
    kurvaSchedule: CATS.map((name, ci) => ({
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
