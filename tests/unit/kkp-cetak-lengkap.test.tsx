// HALAMAN CETAK HTML HARUS MEMUAT DOKUMEN LENGKAP, BUKAN BLANKO SAJA.
//
// Pertanyaan user 2026-08-07: *"kenapa pratinjau dan cetak laporan kkp di
// halaman harian masih satu halaman blanko saja?"* — format resmi KKP (sampul +
// blanko + dokumentasi) baru dipasang di jalur PDF, sementara `/cetak/harian`
// adalah tumpukan render yang berbeda dan masih memuat blanko saja.
//
// Cacatnya SENYAP: halamannya terbit, rapi, dan tidak ada pesan galat sama
// sekali — yang hilang cuma dua pertiga dokumennya. Orang baru sadar setelah
// membandingkan hasil Ctrl+P dengan PDF yang diunduh.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { KkpDailyCover } from "@/components/knmp/kkp-daily-cover";
import { KkpDailyPhotos, type FotoCetak } from "@/components/knmp/kkp-daily-photos";
import type { KkpDailyData } from "@/components/knmp/kkp-daily-report";

function data(over: Partial<KkpDailyData> = {}): KkpDailyData {
  return {
    locationName: "Sugihwaras",
    regency: "Kab. Pemalang",
    province: "Jawa Tengah",
    hari: "Senin",
    tanggalFull: "10 Agustus 2026",
    weekNo: 2,
    tahunAnggaran: 2026,
    workerMap: {},
    totalWorkers: 0,
    activeWeather: null,
    weatherByHour: null,
    workStart: null,
    workEnd: null,
    notes: null,
    materials: [],
    equipment: [],
    items: [],
    isFinal: true,
    pekerjaan: "Pembangunan Kampung Nelayan Merah Putih",
    ownerName: "Kementerian Kelautan dan Perikanan",
    ownerSubtitle: "Direktorat Jenderal Perikanan Tangkap",
    ownerAddress: "Jl. Medan Merdeka Timur No. 16\nJakarta Pusat 10110\nTelepon (021) 3519070",
    contractNumber: "SPK-123/KKP/2026",
    contractDate: "25 Mei 2026",
    periodStart: "8 Agustus 2026",
    periodEnd: "14 Agustus 2026",
    contractorFirm: "PT Bangun Bahari",
    contractorAddress: "Jl. Pelabuhan No. 9, Pemalang",
    supervisorFirm: "CV Pengawas Nusantara",
    ...over,
  };
}

const foto = (over: Partial<FotoCetak> = {}): FotoCetak => ({
  url: "https://contoh/1.webp",
  pekerjaan: "Pasangan batu",
  kategori: "DERMAGA",
  bobot: 1.25,
  ...over,
});

describe("sampul cetak HTML", () => {
  it("memuat identitas kontrak yang tidak ada di blanko", () => {
    const html = renderToStaticMarkup(<KkpDailyCover d={data()} />);
    expect(html).toContain("LAPORAN HARIAN");
    expect(html).toContain("MINGGU KE-2 (DUA)");
    expect(html).toContain("SPK-123/KKP/2026");
    expect(html).toContain("8 Agustus 2026");
    expect(html).toContain("KONSULTAN PENGAWAS");
    expect(html).toContain("KONTRAKTOR PELAKSANA");
    expect(html).toContain("PT Bangun Bahari");
  });

  it("alamat pemilik dicetak BARIS PER BARIS apa adanya", () => {
    // Kop asli KKP memuat alamat, telepon, dan laman. Menggabungkannya jadi
    // satu baris panjang membuat kop tidak lagi menyerupai kop resmi.
    // Huruf besarnya urusan CSS (`uppercase`); yang diperiksa di sini adalah
    // pemisahan barisnya — tiga baris alamat = tiga elemen, bukan satu.
    const html = renderToStaticMarkup(<KkpDailyCover d={data()} />);
    expect(html).toContain(">Jl. Medan Merdeka Timur No. 16<");
    expect(html).toContain(">Jakarta Pusat 10110<");
    expect(html).toContain(">Telepon (021) 3519070<");
  });

  it("baris yang datanya tidak ada TIDAK dicetak sebagai baris kosong", () => {
    // Sampul dengan "NOMOR KONTRAK : " kosong terbaca seperti data hilang.
    const html = renderToStaticMarkup(
      <KkpDailyCover d={data({ contractNumber: null, periodStart: null, periodEnd: null })} />,
    );
    expect(html).not.toContain("NOMOR KONTRAK");
    expect(html).not.toContain("PERIODE");
    expect(html).toContain("PEKERJAAN"); // yang ada tetap tercetak
  });
});

describe("halaman dokumentasi cetak HTML", () => {
  it("tiap foto tampil dengan bobotnya, dikelompokkan per pekerjaan", () => {
    const html = renderToStaticMarkup(
      <KkpDailyPhotos d={data()} foto={[foto(), foto({ url: "https://contoh/2.webp" })]} />,
    );
    expect(html).toContain("Dokumentasi Pekerjaan");
    expect(html).toContain("https://contoh/1.webp");
    expect(html).toContain("https://contoh/2.webp");
    expect(html).toContain("Pasangan batu");
    expect(html).toContain("DERMAGA");
    // Bobot dalam konvensi id-ID (FMT-01) — "1,25", bukan "1.25".
    expect(html).toContain("1,25");
  });

  it("bobot yang TIDAK diketahui dibiarkan kosong, bukan ditulis 0", () => {
    // "belum diketahui" berbeda dari "nol persen"; menulis 0,00 mengarang data.
    const html = renderToStaticMarkup(<KkpDailyPhotos d={data()} foto={[foto({ bobot: null })]} />);
    expect(html).not.toContain("0,00");
  });

  it("foto tanpa item tetap dicetak — bukti tetap bukti", () => {
    const html = renderToStaticMarkup(
      <KkpDailyPhotos d={data()} foto={[foto({ pekerjaan: null, kategori: null })]} />,
    );
    expect(html).toContain("(tanpa item pekerjaan)");
    expect(html).toContain("https://contoh/1.webp");
  });

  it("tanpa foto TIDAK menerbitkan halaman kosong berjudul dokumentasi", () => {
    // Halaman kosong berjudul "DOKUMENTASI PEKERJAAN" membuat pembaca mengira
    // fotonya hilang di perjalanan.
    expect(renderToStaticMarkup(<KkpDailyPhotos d={data()} foto={[]} />)).toBe("");
  });

  it("tiap halaman dokumentasi mulai di halaman kertas baru", () => {
    // Tanpa ini, kartu dokumentasi menempel di ekor blanko dan hasil Ctrl+P
    // tidak lagi menyerupai PDF-nya.
    const banyak = Array.from({ length: 5 }, (_, i) => foto({ pekerjaan: `Pekerjaan ${i}` }));
    const html = renderToStaticMarkup(<KkpDailyPhotos d={data()} foto={banyak} />);
    // 5 pekerjaan berbeda = 5 kartu = 3 halaman (2 kartu per halaman).
    expect(html.match(/break-before-page/g) ?? []).toHaveLength(3);
  });
});
