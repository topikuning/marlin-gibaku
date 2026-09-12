// TEMPLATE TERBITAN MARLIN, DIIMPOR BALIK, TIDAK BOLEH MENGHASILKAN "ITEM BARU".
//
// Dilaporkan user 2026-09-12 dengan tangkapan layar. Template adendum diunduh
// dari MARLIN, diisi kolom volumenya, diimpor balik ke draft adendum di lokasi
// yang sama — dan pratinjaunya berbunyi:
//
//   676 item baru · 52 volume berubah · 676 item hilang · 175 tetap
//   140 item yang SUDAH dikerjakan tidak ada di file ini
//
// Angka 676 yang muncul DUA KALI bukan perubahan data: itu satu himpunan item
// yang tidak saling kenal. Dan yang paling merusak bukan angkanya melainkan
// artinya di layar — terbaca sebagai adendum yang membuang separuh kontrak
// berikut realisasinya, padahal tidak ada satu pun yang berubah.
//
// ### Sebabnya
//
// Importir menjalankan `samakanLineage` pada SETIAP berkas. Fungsi itu ada
// untuk HPS/MC mentah, yang identitasnya memang harus disimpulkan dari pola
// kode: satu baris disisipkan menggeser seluruh nomor di bawahnya, dan tanpa
// penebakan itu "item 6" berkas baru dipasangkan dengan "item 6" kontrak yang
// berbeda pekerjaannya.
//
// Template adendum bukan berkas seperti itu. Ia membawa `lineageKey` kontrak
// APA ADANYA di kolom identitas. Tidak ada yang perlu ditebak — dan menebaknya
// justru merusak yang sudah benar: kunci `I#6#6.1#6.1.a` ditulis ulang menjadi
// `I#6#2#6.1#6.1.a`, satu ruas disisipkan, dan sejak itu 674 dari 903 item
// kehilangan pasangannya.
//
// ### Kenapa memakai berkas sungguhan
//
// Cacat ini TIDAK muncul pada contoh kecil: ia butuh pohon dengan induk
// berharga, sub berlapis, dan kode berulang antar kategori — yaitu bentuk RAB
// KKP yang sesungguhnya. Dua berkas di `tests/fixtures/` adalah keduanya
// terbitan MARLIN sendiri dari lokasi user (revisi aktif #1, 903 item):
// template adendum dan ekspor RAB aktifnya. Menguji dengan contoh buatan akan
// hijau untuk alasan yang salah.
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";
process.env.DATABASE_URL ??= "postgresql://marlin:marlin@localhost:5432/marlin_dev";

const { parseAdendumTemplate } = await import("@/lib/rab/adendum-template-parse");
const { parseHpsWorkbook } = await import("@/lib/rab/hps-parser");
const { flattenParsedRab } = await import("@/lib/rab/flatten");
const { bandingkanTerhadapAktif } = await import("@/lib/rab/diff-parsed");
const { samakanLineage } = await import("@/lib/rab/cocok-lineage");

const berkas = (n: string) => new URL(`../fixtures/${n}`, import.meta.url).pathname;

async function muat(nama: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(berkas(nama));
  return wb;
}

const indukDari = (k: string) => (k.includes("#") ? k.slice(0, k.lastIndexOf("#")) : null);

async function sisiAktif() {
  const wb = await muat("rab-aktif-situbondo.xlsx");
  return flattenParsedRab(parseHpsWorkbook(wb).parsed).map((n) => ({
    lineageKey: n.lineageKey,
    parentLineageKey: indukDari(n.lineageKey),
    kind: n.kind,
    code: n.code,
    name: n.name,
    unit: n.unit ?? null,
    volume: n.volume ?? null,
    unitPrice: n.unitPrice ?? null,
    amount: n.amount,
  }));
}

describe("RAB-ADD-01 · template adendum bolak-balik", () => {
  it("kedua berkas terbitan MARLIN memang berbicara tentang RAB yang sama", async () => {
    // Penjaga atas penjaga: kalau fixture-nya suatu hari tertukar, uji di bawah
    // akan hijau/merah untuk alasan yang tidak ada hubungannya dengan cacatnya.
    const t = parseAdendumTemplate(await muat("template-adendum-situbondo.xlsx"));
    const aktif = await sisiAktif();
    expect(t.nodes.filter((n) => n.kind === "item")).toHaveLength(903);
    expect(aktif.filter((n) => n.kind === "item")).toHaveLength(903);
  });

  it("identitas template dipakai APA ADANYA – nol item baru", async () => {
    const t = parseAdendumTemplate(await muat("template-adendum-situbondo.xlsx"));
    const beda = bandingkanTerhadapAktif(await sisiAktif(), t.nodes, new Map());
    expect(beda.itemBaru, "template terbitan sendiri tidak boleh terbaca sebagai item baru").toHaveLength(0);
    // Yang tersisa memang perubahan volume yang diisi user – itu gunanya template.
    expect(beda.volumeBerubah.length).toBeGreaterThan(0);
    expect(beda.hargaBerubah).toHaveLength(0);
  });

  it("PENYEBABNYA tetap ditangkap: menebak-ulang identitas merusak yang sudah benar", async () => {
    /*
     * Uji ini yang membuat perbaikannya tidak bisa dibatalkan diam-diam. Ia
     * membuktikan `samakanLineage` MEMANG merusak berkas ini — jadi kalau suatu
     * hari ada yang mengembalikan pemanggilannya ke jalur template, uji di atas
     * langsung merah dan uji ini menjelaskan kenapa.
     */
    const t = parseAdendumTemplate(await muat("template-adendum-situbondo.xlsx"));
    const aktif = await sisiAktif();
    const ditebak = samakanLineage(t.nodes, aktif, { padanan: [] });
    const beda = bandingkanTerhadapAktif(aktif, ditebak.nodes, new Map());
    expect(
      beda.itemBaru.length,
      "kalau ini 0, penebakannya sudah aman dan pengecualian template boleh ditinjau ulang",
    ).toBeGreaterThan(500);
  });
});
