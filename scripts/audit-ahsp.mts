/**
 * Audit berkas master AHSP: kumpulkan semua yang JANGGAL jadi satu Excel untuk
 * diperiksa manusia terhadap dokumen resminya. DECISIONS 320/321.
 *
 * Kenapa ini ada sebagai skrip, bukan perbaikan otomatis: yang ditemukan di
 * sini adalah cacat pada DATA SUMBER — analisa yang mendaftarkan semen sebagai
 * upah, koefisien nol, komponen kembar. MARLIN tidak membetulkannya sendiri,
 * karena menebak maksud dokumen resmi lalu menyajikannya sebagai fakta adalah
 * cara paling halus membuat angka yang tak bisa dipertanggungjawabkan. Yang
 * bisa dilakukan mesin adalah MENUNJUK, lengkap dengan nomor halaman PDF-nya,
 * supaya ada yang memeriksa.
 *
 * Jalankan: pnpm audit:ahsp   → berkas .xlsx di root repo.
 */
import { writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import ExcelJS from "exceljs";

const BERKAS = join(process.cwd(), "seed-data", "ahsp-se-djbk-47-2026.json");
const KELUARAN = join(process.cwd(), "AUDIT_AHSP_JANGGAL.xlsx");

/** Satuan yang wajar untuk komponen UPAH — sama persis dengan `rapl-calc.ts`. */
const SATUAN_UPAH = new Set(["oh", "jam", "hari", "org", "orang"]);
/** Satuan waktu; kalau dipakai BAHAN, berarti kategorinya patut dicurigai. */
const SATUAN_WAKTU = new Set(["oh", "jam", "hari", "org", "orang"]);

type Komponen = {
  kategori?: string;
  nama_material?: string;
  satuan?: string | null;
  koefisien?: number | null;
  urutan?: number;
};
type Record_ = {
  id?: string;
  kode?: string;
  uraian?: string;
  satuan?: string;
  bidang?: string;
  work_group?: string | null;
  notes?: string | null;
  components?: Komponen[] | null;
  source?: { lampiran?: string; toc_pdf_page?: number; analysis_pdf_page?: number; analysis_excerpt_id?: string };
};

type BarisTemuan = {
  kode: string;
  uraian: string;
  bidang: string;
  satuanAnalisa: string;
  lampiran: string;
  halamanDaftarIsi: string;
  halamanAnalisa: string;
  kategori: string;
  komponen: string;
  satuanKomponen: string;
  koefisien: string;
  catatan: string;
};

function s(v: unknown): string {
  return typeof v === "string" && v.trim() ? v.trim() : "";
}
function n(v: unknown): string {
  return typeof v === "number" && Number.isFinite(v) ? String(v) : "";
}

async function main() {
  const isi = await readFile(BERKAS);
  const sha = createHash("sha256").update(isi).digest("hex");
  const d = JSON.parse(isi.toString("utf8")) as {
    metadata?: { schema_version?: string; generated_at?: string };
    records?: Record_[];
    supplemental_records?: Record_[];
    duplicate_codes?: Record<string, unknown>;
  };

  const recs = d.records ?? [];
  const supp = d.supplemental_records ?? [];
  const semua: [Record_, boolean][] = [
    ...recs.map((r) => [r, false] as [Record_, boolean]),
    ...supp.map((r) => [r, true] as [Record_, boolean]),
  ];

  const dasar = (r: Record_) => ({
    kode: s(r.kode) || "—",
    uraian: s(r.uraian),
    bidang: s(r.bidang),
    satuanAnalisa: s(r.satuan) || "—",
    lampiran: s(r.source?.lampiran),
    halamanDaftarIsi: n(r.source?.toc_pdf_page),
    halamanAnalisa: n(r.source?.analysis_pdf_page),
  });

  const upahBahan: BarisTemuan[] = [];
  const bahanWaktu: BarisTemuan[] = [];
  const koefNol: BarisTemuan[] = [];
  const kembar: BarisTemuan[] = [];
  const tanpaKoefisien: BarisTemuan[] = [];
  const satuanTakTerbaca: BarisTemuan[] = [];

  for (const [r, adalahSupp] of semua) {
    const b = dasar(r);
    const asal = adalahSupp ? "supplemental (perlu verifikasi)" : "records (kanonik)";
    const comps = r.components ?? [];

    if (comps.length === 0) {
      tanpaKoefisien.push({
        ...b,
        kategori: "",
        komponen: "",
        satuanKomponen: "",
        koefisien: "",
        catatan: `${asal}; excerpt: ${s(r.source?.analysis_excerpt_id) || "—"}`,
      });
    }
    if (!s(r.satuan) || s(r.satuan) === "-" || s(r.satuan) === "—") {
      satuanTakTerbaca.push({
        ...b,
        kategori: "",
        komponen: "",
        satuanKomponen: "",
        koefisien: "",
        catatan: `${asal}; satuan analisa tidak terbaca — tanpa ini koefisien tidak bisa dikalikan volume`,
      });
    }

    const hitungKembar = new Map<string, number>();
    for (const c of comps) {
      const kat = s(c.kategori);
      const nama = s(c.nama_material);
      const sat = s(c.satuan);
      const koef = c.koefisien;
      const baris: BarisTemuan = {
        ...b,
        kategori: kat,
        komponen: nama,
        satuanKomponen: sat || "—",
        koefisien: typeof koef === "number" ? String(koef) : "",
        catatan: asal,
      };

      if (kat === "upah" && sat && !SATUAN_UPAH.has(sat.toLowerCase())) {
        upahBahan.push({
          ...baris,
          catatan: `${asal}; berkategori UPAH tapi satuannya satuan bahan — upah lazim OH/jam`,
        });
      }
      if (kat === "bahan" && sat && SATUAN_WAKTU.has(sat.toLowerCase())) {
        bahanWaktu.push({
          ...baris,
          catatan: `${asal}; berkategori BAHAN tapi satuannya satuan waktu — mestinya upah/alat?`,
        });
      }
      if (koef === 0) {
        koefNol.push({
          ...baris,
          catatan: `${asal}; koefisien NOL — komponennya tercatat tapi tidak menyumbang apa pun`,
        });
      }

      const kunci = JSON.stringify([kat, nama, sat.toLowerCase()]);
      hitungKembar.set(kunci, (hitungKembar.get(kunci) ?? 0) + 1);
    }

    for (const [kunci, jumlah] of hitungKembar) {
      if (jumlah <= 1) continue;
      const [kat, nama, sat] = JSON.parse(kunci) as [string, string, string];
      const total = comps
        .filter(
          (c) => s(c.kategori) === kat && s(c.nama_material) === nama && s(c.satuan).toLowerCase() === sat,
        )
        .reduce((a, c) => a + (typeof c.koefisien === "number" ? c.koefisien : 0), 0);
      kembar.push({
        ...b,
        kategori: kat,
        komponen: nama,
        satuanKomponen: sat || "—",
        koefisien: String(total),
        catatan: `${asal}; MUNCUL ${jumlah}× dalam satu analisa — koefisien di kolom ini sudah dijumlahkan. Panduan berkas terbitan 5.0 menyatakan pengulangan seperti ini SENGAJA ("jangan gabungkan komponen berulang yang perannya berbeda di sumber resmi"), jadi kemungkinan besar sah; tetap didaftarkan supaya bisa dipastikan`,
      });
    }
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "MARLIN — audit basis AHSP";
  wb.created = new Date();

  const ringkas = wb.addWorksheet("Ringkasan");
  ringkas.columns = [
    { header: "Temuan", key: "a", width: 42 },
    { header: "Jumlah", key: "b", width: 10 },
    { header: "Kenapa ini janggal", key: "c", width: 96 },
  ];
  const ringkasBaris: [string, number, string][] = [
    [
      "Komponen UPAH bersatuan bahan",
      upahBahan.length,
      "Berkategori upah tapi satuannya kg/m3/m2/buah/liter. Contoh: analisa Saluran U Pracetak mendaftarkan Semen (Kg) dan Besi Beton (Kg) sebagai upah. Akibatnya tabel kebutuhan UPAH memuat bahan bangunan.",
    ],
    [
      "Komponen BAHAN bersatuan waktu",
      bahanWaktu.length,
      "Kebalikannya: berkategori bahan tapi satuannya OH/jam. Kemungkinan mestinya upah atau alat.",
    ],
    [
      "Koefisien NOL",
      koefNol.length,
      "Komponennya tercatat tapi koefisiennya 0, jadi tidak menyumbang kebutuhan apa pun. Perlu dipastikan apakah memang nol di dokumen, atau angkanya gagal terbaca saat penyusunan berkas.",
    ],
    [
      "Komponen kembar dalam satu analisa",
      kembar.length,
      "Kombinasi kategori + nama + satuan yang sama muncul lebih dari sekali pada satu analisa. Panduan berkas terbitan 5.0 menyatakan pengulangan begini SENGAJA (perannya berbeda di sumber resmi) dan melarang menggabungkannya — jadi kemungkinan besar sah. MARLIN menjumlahkannya untuk kebutuhan total; didaftarkan di sini supaya bisa dipastikan, bukan karena diduga salah.",
    ],
    [
      "Analisa tanpa koefisien terstruktur",
      tanpaKoefisien.length,
      "Analisa resmi yang di berkas ini baru berupa kutipan halaman, belum terurai jadi komponen. Tidak bisa dipakai menghitung kebutuhan bahan sama sekali — kolom halaman PDF menunjukkan tempat mengambilnya.",
    ],
    [
      "Satuan analisa tidak terbaca",
      satuanTakTerbaca.length,
      "Satuan analisanya kosong atau '-'. Tanpa satuan, koefisien tidak bisa dikalikan volume item RAB: koefisien AHSP selalu 'per satu satuan analisa'.",
    ],
    [
      "Kode AHSP dipakai lebih dari satu analisa",
      Object.keys(d.duplicate_codes ?? {}).length,
      "Berkasnya sendiri mencatat ini. MARLIN memakai id sebagai kunci, bukan kode, supaya analisa yang berbeda tidak tergabung — tapi kalau kamu mencari berdasarkan kode, ingat satu kode bisa menunjuk lebih dari satu analisa.",
    ],
  ];
  for (const [a, b, c] of ringkasBaris) ringkas.addRow({ a, b, c });
  ringkas.addRow({});
  ringkas.addRow({ a: "Berkas", c: "seed-data/ahsp-se-djbk-47-2026.json" });
  ringkas.addRow({ a: "sha256", c: sha });
  ringkas.addRow({ a: "Skema", c: s(d.metadata?.schema_version) });
  ringkas.addRow({ a: "Dibangkitkan", c: s(d.metadata?.generated_at) });
  ringkas.addRow({ a: "Analisa dibaca", b: semua.length, c: `${recs.length} kanonik + ${supp.length} supplemental` });
  ringkas.addRow({});
  ringkas.addRow({
    a: "CATATAN",
    c: "MARLIN TIDAK membetulkan satu pun temuan di berkas ini secara otomatis. Semuanya cacat pada data sumber; yang bisa dilakukan mesin adalah menunjuk beserta nomor halaman PDF-nya. Kolom Lampiran + Halaman analisa adalah tempat memverifikasinya.",
  });
  ringkas.getRow(1).font = { bold: true };
  ringkas.getColumn("c").alignment = { wrapText: true, vertical: "top" };

  const KOLOM = [
    { header: "Kode AHSP", key: "kode", width: 16 },
    { header: "Uraian analisa", key: "uraian", width: 62 },
    { header: "Bidang", key: "bidang", width: 17 },
    { header: "Satuan analisa", key: "satuanAnalisa", width: 13 },
    { header: "Lampiran", key: "lampiran", width: 10 },
    { header: "Hal. daftar isi", key: "halamanDaftarIsi", width: 13 },
    { header: "Hal. analisa", key: "halamanAnalisa", width: 12 },
    { header: "Kategori", key: "kategori", width: 10 },
    { header: "Komponen", key: "komponen", width: 40 },
    { header: "Satuan komp.", key: "satuanKomponen", width: 13 },
    { header: "Koefisien", key: "koefisien", width: 14 },
    { header: "Catatan", key: "catatan", width: 74 },
  ];

  const tambahLembar = (nama: string, baris: BarisTemuan[], penjelasan: string) => {
    const ws = wb.addWorksheet(nama);
    ws.addRow([penjelasan]);
    ws.mergeCells(1, 1, 1, KOLOM.length);
    ws.getRow(1).font = { italic: true };
    ws.getRow(1).alignment = { wrapText: true, vertical: "top" };
    ws.getRow(1).height = 30;
    ws.addRow(KOLOM.map((c) => c.header));
    ws.getRow(2).font = { bold: true };
    for (const b of baris) ws.addRow(KOLOM.map((c) => b[c.key as keyof BarisTemuan]));
    KOLOM.forEach((c, i) => {
      ws.getColumn(i + 1).width = c.width;
    });
    ws.getColumn(2).alignment = { wrapText: true, vertical: "top" };
    ws.getColumn(KOLOM.length).alignment = { wrapText: true, vertical: "top" };
    ws.views = [{ state: "frozen", ySplit: 2 }];
    ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: KOLOM.length } };
  };

  tambahLembar(
    "Upah bersatuan bahan",
    upahBahan,
    "Komponen berkategori UPAH yang satuannya satuan bahan (kg/m3/m2/buah/liter). Upah lazim OH atau jam. Periksa halaman analisanya: apakah dokumen resminya memang menaruhnya di kolom tenaga kerja, atau ini salah baca saat penyusunan berkas.",
  );
  tambahLembar(
    "Bahan bersatuan waktu",
    bahanWaktu,
    "Kebalikannya: berkategori BAHAN tapi satuannya OH/jam. Kemungkinan mestinya upah atau alat.",
  );
  tambahLembar(
    "Koefisien nol",
    koefNol,
    "Komponen tercatat dengan koefisien 0 — tidak menyumbang kebutuhan apa pun. Pastikan memang nol di dokumen, bukan angka yang gagal terbaca.",
  );
  tambahLembar(
    "Komponen kembar",
    kembar,
    "Kategori + nama + satuan yang sama muncul lebih dari sekali dalam satu analisa. Kolom Koefisien di sini SUDAH dijumlahkan. Bisa sah (dua baris berbeda ukuran yang namanya kebetulan sama) atau salah salin — kalau salah salin, kebutuhannya jadi dobel.",
  );
  tambahLembar(
    "Tanpa koefisien",
    tanpaKoefisien,
    "Analisa yang belum terurai jadi komponen — tidak bisa dipakai menghitung kebutuhan bahan sama sekali. Kolom Lampiran + Hal. analisa menunjuk tempat mengambil koefisiennya dari PDF resmi.",
  );
  tambahLembar(
    "Satuan tidak terbaca",
    satuanTakTerbaca,
    "Satuan analisanya kosong atau '-'. Koefisien AHSP selalu 'per satu satuan analisa'; tanpa satuan ia tidak bisa dikalikan volume item RAB, jadi barisnya selalu dikeluarkan dari simulasi RAPL.",
  );

  const dup = wb.addWorksheet("Kode duplikat");
  dup.addRow(["Kode AHSP", "Jumlah analisa", "id analisa"]);
  dup.getRow(1).font = { bold: true };
  for (const [kode, isiDup] of Object.entries(d.duplicate_codes ?? {})) {
    const daftar = Array.isArray(isiDup) ? isiDup : [];
    dup.addRow([kode, daftar.length, daftar.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(", ")]);
  }
  dup.getColumn(1).width = 18;
  dup.getColumn(2).width = 15;
  dup.getColumn(3).width = 80;
  dup.getColumn(3).alignment = { wrapText: true, vertical: "top" };

  const buf = await wb.xlsx.writeBuffer();
  await writeFile(KELUARAN, Buffer.from(buf));

  console.log(`Ditulis: ${KELUARAN}`);
  for (const [a, b] of ringkasBaris) console.log(`  ${String(b).padStart(5)}  ${a}`);
}

await main();
