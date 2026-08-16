import "server-only";
import ExcelJS from "exceljs";
import type { LogoLaporan } from "@/lib/export/logo-laporan";
import { FMT_ANGKA, FMT_PERSEN, FMT_RUPIAH, KOTAK, WARNA, gayaKepala, isi, logoPasanganKanan } from "@/lib/export/xlsx-gaya";
import type { SimulasiRapl } from "@/lib/ahsp/rapl";

/**
 * Unduhan KEBUTUHAN SUMBER DAYA (RAPL) — DECISIONS 322.
 *
 * ### Kenapa lembar "Tidak masuk hitungan" ikut, dan tidak boleh dihapus
 *
 * Berkas ini akan dibawa ke rapat, dikirim ke suplier, dipakai menawar. Begitu
 * ia keluar dari layar MARLIN, semua peringatan di halaman RAPL hilang —
 * yang tersisa cuma angka. Daftar kebutuhan bahan yang menutup 74% nilai RAB
 * dan tidak mengaku demikian akan dibaca sebagai kebutuhan SELURUH proyek, dan
 * kekurangannya baru ketahuan di lapangan.
 *
 * Karena itu tiga hal dibawa serta di dalam berkasnya sendiri: cakupan di
 * lembar pertama, daftar baris yang dikeluarkan beserta sebab dan nilai
 * rupiahnya, dan penanda "kategori janggal" pada baris yang kategorinya
 * meragukan menurut data sumber.
 *
 * ### Angkanya tidak dihitung di sini
 *
 * Seluruh perhitungan datang dari `src/lib/ahsp/rapl-calc.ts` (CLAUDE.md aturan
 * 7). Berkas ini hanya menata.
 */

const KATEGORI: { kunci: string; judul: string }[] = [
  { kunci: "bahan", judul: "BAHAN" },
  { kunci: "upah", judul: "UPAH / TENAGA KERJA" },
  { kunci: "alat", judul: "PERALATAN" },
];

const ALASAN_JUDUL: Record<string, string> = {
  belum_disetujui: "Padanan AHSP belum disetujui",
  satuan_tidak_sepadan: "Satuan item RAB ≠ satuan analisa",
  tanpa_koefisien: "Analisa belum punya koefisien terstruktur",
  volume_kosong: "Item RAB tidak punya volume",
};

export type KepalaRapl = {
  lokasi: string;
  paket: string;
  kabupaten: string;
  provinsi: string;
  kontrak: string | null;
  penyedia: string | null;
  sumberAhsp: string;
  shaAhsp: string;
  dicetakPada: Date;
  dicetakOleh: string;
};

function tanggal(d: Date): string {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(d);
}

export async function buildRaplXlsx(
  rapl: SimulasiRapl,
  kepala: KepalaRapl,
  opsi: { logo?: LogoLaporan } = {},
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MARLIN";
  wb.created = kepala.dicetakPada;

  tulisRingkasan(wb, rapl, kepala, opsi.logo);
  tulisKebutuhan(wb, rapl);
  tulisDilewat(wb, rapl);

  return wb.xlsx.writeBuffer();
}

/* ------------------------------------------------------------------ ringkas */

function tulisRingkasan(
  wb: ExcelJS.Workbook,
  rapl: SimulasiRapl,
  kepala: KepalaRapl,
  logo?: LogoLaporan,
): void {
  const ws = wb.addWorksheet("Ringkasan");
  ws.columns = [{ width: 34 }, { width: 30 }, { width: 22 }, { width: 58 }];

  ws.mergeCells("A1:D1");
  const judul = ws.getCell("A1");
  judul.value = "RENCANA ANGGARAN PELAKSANAAN LAPANGAN — KEBUTUHAN SUMBER DAYA";
  gayaKepala(judul, { size: 12 });
  ws.getRow(1).height = 26;
  logoPasanganKanan(wb, ws, logo, { rowAtas: 1, kolomKiri: 1, kolomKanan: 4, tinggiPx: 26 });

  const identitas: [string, string][] = [
    ["Lokasi", kepala.lokasi],
    ["Paket", kepala.paket],
    ["Wilayah", `${kepala.kabupaten}, ${kepala.provinsi}`],
    ["Kontrak", kepala.kontrak ?? "—"],
    ["Penyedia jasa", kepala.penyedia ?? "—"],
    ["Sumber analisa", kepala.sumberAhsp],
    ["Versi berkas AHSP (sha256)", kepala.shaAhsp],
    ["Dicetak", `${tanggal(kepala.dicetakPada)} oleh ${kepala.dicetakOleh}`],
  ];
  let r = 3;
  for (const [k, v] of identitas) {
    ws.getCell(r, 1).value = k;
    ws.getCell(r, 1).font = { bold: true, color: { argb: WARNA.teksRedup }, size: 10 };
    ws.mergeCells(r, 2, r, 4);
    ws.getCell(r, 2).value = v;
    ws.getCell(r, 2).font = { size: 10 };
    ws.getCell(r, 1).fill = isi(WARNA.identitas);
    r += 1;
  }

  r += 1;
  ws.mergeCells(r, 1, r, 4);
  const j2 = ws.getCell(r, 1);
  j2.value = "SEBERAPA BANYAK PROYEK YANG SUDAH TERTUTUP HITUNGAN INI";
  gayaKepala(j2, { sub: true, size: 10 });
  r += 1;

  const pct = rapl.nilaiRab > 0n ? (Number(rapl.dipakai.nilai) / Number(rapl.nilaiRab)) * 100 : 0;
  const angka: [string, number | string, string, string][] = [
    [
      "Nilai RAB yang MASUK hitungan",
      Number(rapl.dipakai.nilai),
      "rupiah",
      `${rapl.dipakai.baris} dari ${rapl.barisRab} baris kerja`,
    ],
    ["Nilai RAB seluruhnya", Number(rapl.nilaiRab), "rupiah", "seluruh item kerja RAB aktif"],
    [
      "Cakupan",
      pct,
      "persen",
      "Di bawah 100% berarti daftar kebutuhan di lembar berikutnya BELUM mencakup seluruh proyek. Rinciannya di lembar “Tidak masuk hitungan”.",
    ],
    [
      "Jenis sumber daya",
      rapl.kebutuhan.length,
      "baris",
      `bahan ${rapl.kebutuhan.filter((k) => k.kategori === "bahan").length} · upah ${rapl.kebutuhan.filter((k) => k.kategori === "upah").length} · alat ${rapl.kebutuhan.filter((k) => k.kategori === "alat").length}`,
    ],
  ];
  for (const [nama, nilai, satuan, ket] of angka) {
    ws.getCell(r, 1).value = nama;
    ws.getCell(r, 1).font = { bold: true, size: 10 };
    const c = ws.getCell(r, 2);
    c.value = nilai;
    c.numFmt = satuan === "rupiah" ? FMT_RUPIAH : satuan === "persen" ? FMT_PERSEN : FMT_ANGKA;
    c.font = { bold: true, size: 10 };
    ws.getCell(r, 3).value = satuan;
    ws.getCell(r, 3).font = { size: 10, color: { argb: WARNA.teksRedup } };
    ws.getCell(r, 4).value = ket;
    ws.getCell(r, 4).alignment = { wrapText: true, vertical: "top" };
    ws.getCell(r, 4).font = { size: 10, color: { argb: WARNA.teksRedup } };
    for (let c2 = 1; c2 <= 4; c2 += 1) ws.getCell(r, c2).border = KOTAK;
    r += 1;
  }

  r += 1;
  ws.mergeCells(r, 1, r, 4);
  const j3 = ws.getCell(r, 1);
  j3.value = "YANG DIKELUARKAN DARI HITUNGAN";
  gayaKepala(j3, { sub: true, size: 10 });
  r += 1;

  const perAlasan = new Map<string, { baris: number; nilai: bigint }>();
  for (const d of rapl.dilewat) {
    const a = perAlasan.get(d.alasan) ?? { baris: 0, nilai: 0n };
    a.baris += 1;
    a.nilai += d.amount;
    perAlasan.set(d.alasan, a);
  }
  if (perAlasan.size === 0) {
    ws.mergeCells(r, 1, r, 4);
    ws.getCell(r, 1).value = "Tidak ada — seluruh baris kerja masuk hitungan.";
    r += 1;
  } else {
    for (const [alasan, a] of [...perAlasan].sort((x, y) => Number(y[1].nilai - x[1].nilai))) {
      ws.getCell(r, 1).value = ALASAN_JUDUL[alasan] ?? alasan;
      ws.getCell(r, 1).font = { size: 10 };
      ws.getCell(r, 2).value = Number(a.nilai);
      ws.getCell(r, 2).numFmt = FMT_RUPIAH;
      ws.getCell(r, 3).value = `${a.baris} baris`;
      ws.getCell(r, 3).font = { size: 10, color: { argb: WARNA.teksRedup } };
      for (let c2 = 1; c2 <= 4; c2 += 1) ws.getCell(r, c2).border = KOTAK;
      r += 1;
    }
  }

  r += 1;
  ws.mergeCells(r, 1, r + 3, 4);
  const catatan = ws.getCell(r, 1);
  catatan.value =
    "CARA MEMBACA. Angka di lembar “Kebutuhan” adalah Σ (koefisien AHSP × volume item RAB) — VOLUME kebutuhan, BUKAN harga. " +
    "Hanya baris yang padanan AHSP-nya sudah disetujui orang yang ikut dihitung; usulan mesin yang belum disetujui sengaja tidak dipakai. " +
    "Nama sumber daya tidak disatukan antar ejaan yang berbeda (“Semen PC” dan “Semen Portland” tetap dua baris) — menggabungkannya keputusan yang harus diambil manusia. " +
    "Baris bertanda “kategori janggal” adalah komponen yang di berkas AHSP resminya terdaftar sebagai UPAH padahal satuannya satuan bahan; MARLIN tidak memindahkannya sendiri.";
  catatan.alignment = { wrapText: true, vertical: "top" };
  catatan.font = { size: 10, color: { argb: WARNA.teksRedup } };
  catatan.fill = isi(WARNA.identitas);
  catatan.border = KOTAK;
}

/* --------------------------------------------------------------- kebutuhan */

function tulisKebutuhan(wb: ExcelJS.Workbook, rapl: SimulasiRapl): void {
  const ws = wb.addWorksheet("Kebutuhan");
  ws.columns = [
    { width: 6 },
    { width: 52 },
    { width: 16 },
    { width: 12 },
    { width: 13 },
    { width: 30 },
  ];

  const kepala = ["NO", "URAIAN SUMBER DAYA", "KEBUTUHAN", "SATUAN", "DARI BARIS", "CATATAN"];
  ws.addRow(kepala);
  ws.getRow(1).eachCell((c) => gayaKepala(c, { size: 10 }));
  ws.getRow(1).height = 22;
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 6 } };

  let r = 2;
  for (const kat of KATEGORI) {
    const baris = rapl.kebutuhan.filter((k) => k.kategori === kat.kunci);
    if (baris.length === 0) continue;

    ws.mergeCells(r, 1, r, 6);
    const jc = ws.getCell(r, 1);
    jc.value = kat.judul;
    jc.font = { bold: true, size: 10, color: { argb: WARNA.teks } };
    jc.fill = isi(WARNA.kategori);
    jc.border = KOTAK;
    r += 1;

    let no = 1;
    for (const k of baris) {
      ws.getCell(r, 1).value = no;
      ws.getCell(r, 2).value = k.nama;
      const jum = ws.getCell(r, 3);
      jum.value = k.jumlah;
      jum.numFmt = FMT_ANGKA;
      ws.getCell(r, 4).value = k.satuan || "—";
      ws.getCell(r, 5).value = k.dariBaris;
      ws.getCell(r, 6).value = k.janggal
        ? "kategori janggal — terdaftar sebagai upah di berkas AHSP padahal satuannya satuan bahan"
        : "";
      if (k.janggal) {
        ws.getCell(r, 6).font = { size: 9, color: { argb: WARNA.negatif } };
        ws.getCell(r, 2).font = { size: 10, color: { argb: WARNA.negatif } };
      }
      ws.getCell(r, 6).alignment = { wrapText: true, vertical: "top" };
      for (let c = 1; c <= 6; c += 1) {
        ws.getCell(r, c).border = KOTAK;
        if (ws.getCell(r, c).font === undefined) ws.getCell(r, c).font = { size: 10 };
      }
      ws.getCell(r, 1).alignment = { horizontal: "center" };
      ws.getCell(r, 4).alignment = { horizontal: "center" };
      ws.getCell(r, 5).alignment = { horizontal: "center" };
      no += 1;
      r += 1;
    }
  }

  if (rapl.kebutuhan.length === 0) {
    ws.mergeCells(r, 1, r, 6);
    ws.getCell(r, 1).value =
      "Belum ada padanan AHSP yang disetujui, jadi belum ada kebutuhan yang bisa diturunkan. Setujui padanan di halaman RAPL lebih dulu.";
    ws.getCell(r, 1).alignment = { wrapText: true };
    ws.getCell(r, 1).font = { italic: true, size: 10 };
  }
}

/* ----------------------------------------------------------------- dilewat */

function tulisDilewat(wb: ExcelJS.Workbook, rapl: SimulasiRapl): void {
  const ws = wb.addWorksheet("Tidak masuk hitungan");
  ws.columns = [
    { width: 12 },
    { width: 60 },
    { width: 20 },
    { width: 36 },
    { width: 44 },
  ];

  ws.addRow(["KODE", "URAIAN ITEM RAB", "NILAI (Rp)", "SEBAB", "KETERANGAN"]);
  ws.getRow(1).eachCell((c) => gayaKepala(c, { size: 10 }));
  ws.getRow(1).height = 22;
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 5 } };

  // Diurut dari nilai terbesar: yang paling perlu diselesaikan lebih dulu
  // adalah lubang yang paling mahal, bukan yang kebetulan paling atas di RAB.
  const urut = [...rapl.dilewat].sort((a, b) => Number(b.amount - a.amount));
  let r = 2;
  for (const d of urut) {
    ws.getCell(r, 1).value = d.code;
    ws.getCell(r, 2).value = d.uraian;
    const n = ws.getCell(r, 3);
    n.value = Number(d.amount);
    n.numFmt = FMT_RUPIAH;
    ws.getCell(r, 4).value = ALASAN_JUDUL[d.alasan] ?? d.alasan;
    ws.getCell(r, 5).value = d.rinci;
    for (let c = 1; c <= 5; c += 1) {
      ws.getCell(r, c).border = KOTAK;
      ws.getCell(r, c).font = { size: 10 };
      ws.getCell(r, c).alignment = { wrapText: true, vertical: "top" };
    }
    r += 1;
  }

  if (urut.length === 0) {
    ws.mergeCells(2, 1, 2, 5);
    ws.getCell(2, 1).value = "Tidak ada — seluruh baris kerja RAB masuk hitungan.";
    ws.getCell(2, 1).font = { italic: true, size: 10 };
    return;
  }

  ws.getCell(r, 1).value = "TOTAL";
  ws.getCell(r, 1).font = { bold: true, size: 10 };
  const tot = ws.getCell(r, 3);
  tot.value = { formula: `SUM(C2:C${r - 1})` };
  tot.numFmt = FMT_RUPIAH;
  tot.font = { bold: true, size: 10 };
  for (let c = 1; c <= 5; c += 1) {
    ws.getCell(r, c).fill = isi(WARNA.total);
    ws.getCell(r, c).border = KOTAK;
  }
}
