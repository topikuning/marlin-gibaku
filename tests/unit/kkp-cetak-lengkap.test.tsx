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
import {
  KkpDailyPelengkapPhotos,
  KkpDailyPhotos,
  type FotoCetak,
} from "@/components/knmp/kkp-daily-photos";
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
  link: "https://marlin.uji/api/foto/tok123",
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

  it("foto tanpa item tetap dicetak – bukti tetap bukti", () => {
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

  // GARIS KOLOM WAJIB BERTEMU ANTAR BARIS.
  //
  // Teguran user 2026-08-07: *"kamu bikin garis antara kolom gambar dan bobot
  // saja tidak lurus."* Versi pertama menyusun tiap baris sebagai `flex`
  // tersendiri dengan rasio yang sama (4,2 : 1). Rasionya sama, tapi flex
  // membagi SISA ruang, dan sisa ruang tiap baris berbeda mengikuti padding
  // serta lebar-minimum isinya. Terukur di browser: batas baris judul 506,27px
  // vs baris foto 505,50px — meleset 0,77px, dan pada dokumen bergaris itu
  // langsung terlihat.
  //
  // Obatnya struktural: SATU tabel `table-fixed` dengan SATU `colgroup`, jadi
  // batas kolom dihitung sekali untuk seluruh kartu. Uji ini menjaga
  // strukturnya, bukan angkanya — begitu ada baris yang menghitung lebarnya
  // sendiri lagi, cacat yang sama kembali.
  it("satu kartu = satu tabel table-fixed dengan satu colgroup", () => {
    const html = renderToStaticMarkup(<KkpDailyPhotos d={data()} foto={[foto()]} />);
    expect(html.match(/<table/g) ?? []).toHaveLength(1);
    expect(html).toContain("table-fixed");
    expect(html.match(/<colgroup/g) ?? []).toHaveLength(1);
    // Tidak ada lagi rasio flex yang dihitung per baris.
    expect(html).not.toContain("flex-[4.2]");
  });

  it("sel judul foto & sel gambar berakhir di batas kolom yang SAMA", () => {
    // Keduanya membentang 2 dari 3 kolom, jadi tepi kanannya batas kolom yang
    // sama persis — bukan dua hasil hitungan yang kebetulan mirip.
    const html = renderToStaticMarkup(<KkpDailyPhotos d={data()} foto={[foto()]} />);
    const barisFoto = html.slice(html.indexOf("Bobot (%)") - 400);
    expect((barisFoto.match(/colspan="2"/gi) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  // FOTO BISA DIKLIK KE GAMBAR PENUH, TANPA DIUBAH SEDIKIT PUN.
  //
  // Permintaan user 2026-08-07: *"fotonya harusnya juga bisa diklik ke ukuran
  // yang lebih besar/cloud. tapi tidak perlu di crop, apa adanya seperti
  // sekarang, hanya beri link ke gambar yang lebih besar."*
  //
  // Batas yang dijaga di sini justru kata "apa adanya": menambah tautan tidak
  // boleh diam-diam mengubah ukuran, kerangka, atau pemotongan gambarnya.
  describe("tautan ke gambar penuh", () => {
    it("gambar dibungkus anchor yang membuka tab baru", () => {
      const html = renderToStaticMarkup(<KkpDailyPhotos d={data()} foto={[foto()]} />);
      expect(html).toContain('href="https://marlin.uji/api/foto/tok123"');
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noopener noreferrer"');
    });

    it("gambarnya SAMA PERSIS dengan atau tanpa tautan – tidak di-crop, tidak diubah", () => {
      const tag = (h: string) => h.match(/<img[^>]*>/)?.[0] ?? "";
      const dengan = tag(renderToStaticMarkup(<KkpDailyPhotos d={data()} foto={[foto()]} />));
      const tanpa = tag(renderToStaticMarkup(<KkpDailyPhotos d={data()} foto={[foto({ link: null })]} />));
      expect(dengan).toBe(tanpa);
      expect(dengan).toContain("object-contain"); // bukan object-cover = tidak dipotong
    });

    it("tanpa tautan, fotonya tetap tampil – bukan hilang", () => {
      // origin tidak diketahui (mis. render di luar request) tidak boleh
      // membuat bukti ikut lenyap; cukup tidak bisa diklik.
      const html = renderToStaticMarkup(<KkpDailyPhotos d={data()} foto={[foto({ link: null })]} />);
      expect(html).toContain("https://contoh/1.webp");
      expect(html).not.toContain("<a ");
    });
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

// HALAMAN MATERIAL & ALAT — SENDIRI-SENDIRI, SESUDAH FOTO PEKERJAAN.
//
// Kebutuhan lapangan user 2026-08-08: *"foto material dan alat juga perlu
// disendirikan / start halaman tersendiri setelah data foto-foto pekerjaan"*.
describe("halaman dokumentasi material & peralatan", () => {
  const bukti = (over = {}) => ({
    id: "p1",
    r2Key: "k1",
    nama: "Semen PCC 50kg",
    keterangan: "40 zak",
    url: "https://contoh/m1.webp",
    link: "https://marlin.uji/api/foto/tokM",
    ...over,
  });

  it("memuat nama barang & jumlahnya, dan bisa diklik ke gambar penuh", () => {
    const html = renderToStaticMarkup(
      <KkpDailyPelengkapPhotos d={data()} foto={[bukti()]} judul="Dokumentasi Material Masuk" labelBaris="Material" />,
    );
    expect(html).toContain("Dokumentasi Material Masuk");
    expect(html).toContain("Semen PCC 50kg");
    expect(html).toContain("40 zak");
    expect(html).toContain('href="https://marlin.uji/api/foto/tokM"');
  });

  it("jumlah yang TIDAK diisi ditulis \u2013, bukan 0", () => {
    // "belum diisi" berbeda dari "nol"; menulis 0 mengarang angka yang tidak
    // pernah dilaporkan siapa pun.
    const html = renderToStaticMarkup(
      <KkpDailyPelengkapPhotos d={data()} foto={[bukti({ keterangan: null })]} judul="Dokumentasi Peralatan" labelBaris="Alat" />,
    );
    expect(html).toContain("\u2013");
    expect(html).not.toContain(">0<");
  });

  it("tanpa foto TIDAK menerbitkan halaman kosong", () => {
    expect(
      renderToStaticMarkup(
        <KkpDailyPelengkapPhotos d={data()} foto={[]} judul="Dokumentasi Material Masuk" labelBaris="Material" />,
      ),
    ).toBe("");
  });

  it("mulai di halaman kertas BARU", () => {
    const html = renderToStaticMarkup(
      <KkpDailyPelengkapPhotos d={data()} foto={[bukti()]} judul="Dokumentasi Material Masuk" labelBaris="Material" />,
    );
    expect(html).toContain("break-before-page");
  });

  it("memakai kerangka tabel yang SAMA dengan foto pekerjaan", () => {
    // Kalau halaman ini menyusun kolomnya sendiri, garisnya akan meleset dari
    // halaman pekerjaan — cacat yang sudah ditegur sekali (DECISIONS 301).
    const html = renderToStaticMarkup(
      <KkpDailyPelengkapPhotos d={data()} foto={[bukti()]} judul="Dokumentasi Material Masuk" labelBaris="Material" />,
    );
    expect(html).toContain("table-fixed");
    expect(html.match(/<colgroup/g) ?? []).toHaveLength(1);
    expect(html).toContain("24.444%");
  });
});
