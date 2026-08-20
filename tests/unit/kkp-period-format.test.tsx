// FMT-01 (docs/OPEN_ISSUES) — blanko periodik KKP dulu mencampur dua konvensi
// desimal di SATU halaman: rupiah & volume lewat Intl id-ID ("1.234,56")
// sementara bobot/prestasi lewat `toFixed` ("12.40"). Pembaca Indonesia membaca
// "12.40" sebagai dua belas ribu empat ratus.
//
// Yang dikunci berkas ini adalah cacat SENYAP: dokumen tetap terbit, tetap
// rapi, dan angkanya tetap "benar" secara aritmetika — hanya terbaca salah oleh
// PPK yang menerimanya.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { KkpPeriodReport } from "@/components/knmp/kkp-period-report";
import type { PeriodItemRow, PeriodReport } from "@/lib/periodic-report";

const item = (over: Partial<PeriodItemRow> & { no: number; name: string }): PeriodItemRow => ({
  code: "",
  volK: 120,
  unit: "m3",
  unitPrice: 250_000,
  amount: 30_000_000,
  bobot: 12.4,
  volLalu: 10,
  prestasiLalu: 8.33,
  bobotLalu: 1.03,
  volIni: 15,
  prestasiIni: 12.5,
  bobotIni: 1.55,
  volSd: 25,
  prestasiSd: 20.83,
  bobotSd: 2.58,
  bobotRencana: 3.75,
  sisaVol: 95,
  sisaPrestasi: 79.17,
  ...over,
});

function fixture(): PeriodReport {
  const start = new Date(Date.UTC(2026, 6, 22));
  return {
    kind: "mingguan",
    n: 2,
    maxN: 20,
    totalWeeks: 20,
    totalMonths: 5,
    header: {
      locationName: "Pasar Banggi",
      village: "Pasar Banggi",
      district: null,
      regency: "Rembang",
      province: "Jawa Tengah",
      packageName: "Paket Uji",
      ownerAgency: "KKP",
      contractNumber: "B.17105/DJPT.6/PI.420/PPK/VI/2026",
      vendorName: "PT Kurnia Alam Sentosa",
      contractValue: 5_872_342_857n,
      locationValue: 5_872_342_857n,
      masaPelaksanaanHari: 135,
      tahunAnggaran: 2026,
      contractStart: start,
      periodeStart: start,
      periodeEnd: new Date(start.getTime() + 6 * 86_400_000),
      ppkName: null,
      ppkNip: null,
      supervisorName: null,
      supervisorFirm: null,
      contractorSignerName: null,
      contractorSignerTitle: null,
    },
    categories: [
      {
        lineageKey: "I",
        code: "I",
        name: "PEKERJAAN PERSIAPAN",
        rows: [item({ no: 1, name: "Pembersihan lahan" })],
        subtotalAmount: 30_000_000,
        subtotalBobot: 12.4,
        subtotalBobotLalu: 1.03,
        subtotalBobotIni: 1.55,
        subtotalBobotSd: 2.58,
        subtotalBobotRencana: 3.75,
      },
    ],
    totals: { bobotLalu: 1.03, bobotIni: 1.55, bobotSd: 2.58, bobotRencana: 3.75 },
    planPct: 3.75,
    planPrevPct: 1.2,
    actualPct: 2.58,
    deviationPct: -1.17,
    scurve: { planPct: [1.2, 3.75], actualPct: [1.03, 2.58], currentWeek: 2 },
    kurvaSchedule: [],
    tenaga: [],
    material: [],
    alat: [],
    cuacaRingkas: "Cerah 5 hari",
    kendala: [],
  };
}

const html = () => renderToStaticMarkup(<KkpPeriodReport r={fixture()} />);

describe("blanko periodik KKP – satu konvensi desimal (FMT-01)", () => {
  it("persen memakai KOMA desimal, bukan titik", () => {
    const t = html();
    expect(t).toContain("12,40%"); // bobot kategori
    expect(t).toContain("2,58%"); // realisasi s/d
    expect(t).toContain("-1,17%"); // deviasi
  });

  it("TIDAK ada satu pun angka desimal bertitik di seluruh halaman", () => {
    // Ini penjaga sesungguhnya: menangkap `toFixed` baru yang diselipkan nanti
    // di kolom mana pun, bukan cuma yang sudah diperbaiki hari ini.
    const teks = html().replace(/<[^>]*>/g, " ");
    // Titik sebagai pemisah RIBUAN (id-ID: "5.872.342") selalu diikuti tepat 3
    // digit — itu benar dan tidak boleh ikut tertangkap. Yang dicari adalah
    // titik sebagai pemisah DESIMAL: 1–2 digit lalu berhenti.
    const bertitik = teks.match(/\d\.\d{1,2}(?!\d)/g) ?? [];
    expect(bertitik, `angka desimal bertitik: ${bertitik.join(", ")}`).toEqual([]);
  });

  it("kolom bobot per item ikut format Indonesia", () => {
    const t = html();
    expect(t).toContain(">1,03<"); // bobot periode lalu
    expect(t).toContain(">1,55<"); // bobot periode ini
    expect(t).toContain(">3,75<"); // bobot rencana
  });
});
