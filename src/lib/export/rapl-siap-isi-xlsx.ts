import ExcelJS from "exceljs";
import { siapCetakA4 } from "@/lib/export/cetak-a4";
import { kunciSumberDaya, type BiayaItem } from "@/lib/ahsp/rapl-calc";
import type { LokasiRaplSiapIsi } from "@/lib/rapl-siap-isi/data";

/**
 * EXCEL "RAPL SIAP ISI HARGA" – sekali klik (DECISIONS 803).
 *
 * Permintaan user 2026-11-28: *"modul/fitur rapl itu sekali klik jadi file
 * siap download … yang tinggal isi harga tiap item breakdown"*, dengan
 * keputusan: harga kosong kecuali yang sudah disetujui; di kolom sebelahnya
 * usulan harga estimasi UNTUK LOKASI ITU (DECISIONS 805 – bukan harga
 * prototipe referensi, yang hanya contoh proyek lain).
 *
 * Susunannya (mengikuti contoh keluaran referensi user):
 * - **Rekapitulasi** – per lokasi: bahan, upah, alat & angkutan, jasa, biaya
 *   umum, tak terduga, total RAPL, nilai RAB, selisih; plus asal rincian.
 * - **Isi Harga** – SATU baris per sumber daya (lintas lokasi). Kolom HARGA
 *   DIPAKAI (kuning) satu-satunya tempat mengisi harga komponen; terisi bila
 *   harga lokasi (HSD) sudah ada. Usulan di sebelahnya belum ikut jumlah.
 * - **Rincian** per lokasi – tiap item RAB beserta komponennya. Harga komponen
 *   menunjuk Isi Harga lewat rumus, kecuali harga analisa kontrak per item
 *   (ditulis angkanya). Di bawahnya biaya di luar item RAB (staf, operasional,
 *   pengujian, jaminan) dan tak terduga, yang volume & harganya diisi di situ.
 *
 * Angka kebutuhan (volume komponen) datang dari `keadaanItemRapl`
 * (calculation layer `rapl-calc.ts`); berkas ini tidak menghitungnya. Rumus
 * Excel hanya volume × harga yang diisi orang, dan penjumlahannya.
 */

const FMT_RP = "#,##0";
const FMT_VOL = "#,##0.000";
/** Satuan hitungan: dua desimal cukup (referensi: `qf`); panjang/luas/isi tiga desimal. */
const SATUAN_HITUNG = /^(zak|bh|buah|lbr|ls|kg|unit|btg|set|org|orang|orang-bln|ttk|psg|ltr|oh|jam|hari|bln|bulan|rp|paket)$/i;
const fmtVolume = (satuan: string) => (SATUAN_HITUNG.test(satuan.trim()) ? "#,##0.00" : FMT_VOL);
const FMT_PERSEN = "0.0%";
const KUNING: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
const BIRU_TUA: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
const ABU: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
const BIRU_MUDA: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE6F1" } };
const GARIS: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFBFBFBF" } },
  left: { style: "thin", color: { argb: "FFBFBFBF" } },
  bottom: { style: "thin", color: { argb: "FFBFBFBF" } },
  right: { style: "thin", color: { argb: "FFBFBFBF" } },
};

/** Kategori komponen RAPL MARLIN → kolom rekap. Urutan = urutan kolom. */
export const KATEGORI_REKAP = [
  { kunci: "bahan", label: "Bahan" },
  { kunci: "upah", label: "Upah" },
  { kunci: "alat", label: "Alat dan angkutan" },
  { kunci: "jasa", label: "Jasa, subkon dan biaya resmi" },
  { kunci: "umum", label: "Biaya umum lapangan" },
] as const;
const LABEL_TAK_TERDUGA = "Tak terduga";

/** Kategori lain (mis. `fasilitas` dari AHSP) dihitung sebagai jasa/biaya lain. */
export function labelKategori(kategori: string): string {
  return KATEGORI_REKAP.find((k) => k.kunci === kategori)?.label ?? (kategori === "fasilitas" ? "Alat dan angkutan" : "Jasa, subkon dan biaya resmi");
}

const ASAL: Record<string, string> = {
  kontrak: "Analisa kontrak",
  ahsp: "AHSP PUPR",
  ai: "Usulan AI – diterima",
};

/** Asal rincian satu item, untuk kolom "Asal" dan tabel asal di Rekapitulasi. */
export function asalItem(i: BiayaItem): string {
  if (i.cara === "borongan") return "Borongan";
  if (i.cara === "belum") return "Belum terurai";
  const dasar = i.sumberAnalisa ? ASAL[i.sumberAnalisa] : "Dirinci tangan";
  return i.cara === "campuran" ? `${dasar} + tambahan` : dasar;
}

type SumberDayaBaris = {
  kode: string;
  kategori: string;
  nama: string;
  satuan: string;
  /** Harga lokasi (HSD) – sama di semua lokasi; null = kosong untuk diisi. */
  hargaDipakai: bigint | null;
  /** Catatan bila harga lokasi berbeda antar-lokasi. */
  hargaBeda: string | null;
  /**
   * Usulan harga estimasi untuk lokasi itu (DECISIONS 805) – belum disetujui,
   * tidak ikut jumlah. Sama di semua lokasi → angkanya; berbeda → null dan
   * disebut di `usulanBeda` (tiap sheet Rincian memuat usulan lokasinya).
   */
  usulan: bigint | null;
  usulanBeda: string | null;
  adaKontrak: boolean;
};

const urutKategori = (k: string) => {
  const i = KATEGORI_REKAP.findIndex((x) => x.kunci === k);
  return i < 0 ? 99 : i;
};

/** Daftar sumber daya lintas lokasi, berkode urut kategori lalu nama. MURNI. */
export function daftarSumberDaya(lokasi: readonly LokasiRaplSiapIsi[]): Map<string, SumberDayaBaris> {
  type Kumpul = Pick<SumberDayaBaris, "kategori" | "nama" | "satuan" | "adaKontrak"> & {
    hsd: Map<string, bigint>;
    usul: Map<string, bigint>;
  };
  const peta = new Map<string, Kumpul>();
  for (const l of lokasi)
    for (const kat of l.kategori)
      for (const it of kat.item)
        for (const k of it.komponen) {
          const kunci = kunciSumberDaya(k.kategori, k.nama, k.satuan);
          let b = peta.get(kunci);
          if (!b) {
            b = { kategori: k.kategori, nama: k.nama, satuan: k.satuan, adaKontrak: false, hsd: new Map(), usul: new Map() };
            peta.set(kunci, b);
          }
          const u = l.usulan.get(kunci);
          if (u !== undefined && k.harga === null) b.usul.set(l.nama, u);
          if (k.hargaDariKontrak) b.adaKontrak = true;
          else if (k.harga != null) b.hsd.set(l.nama, k.harga);
        }
  const urut = [...peta.entries()].sort(
    ([, a], [, b]) => urutKategori(a.kategori) - urutKategori(b.kategori) || a.nama.localeCompare(b.nama, "id"),
  );
  const hasil = new Map<string, SumberDayaBaris>();
  urut.forEach(([kunci, b], i) => {
    const nilai = [...new Set([...b.hsd.values()].map(String))];
    const usul = [...new Set([...b.usul.values()].map(String))];
    const daftar = (m: Map<string, bigint>) => [...m.entries()].map(([n, h]) => `${n} Rp${Number(h).toLocaleString("id-ID")}`).join("; ");
    hasil.set(kunci, {
      kode: `H${String(i + 1).padStart(4, "0")}`,
      kategori: b.kategori,
      nama: b.nama,
      satuan: b.satuan,
      hargaDipakai: nilai.length === 1 ? BigInt(nilai[0]) : null,
      hargaBeda: nilai.length > 1 ? `Harga lokasi berbeda: ${daftar(b.hsd)}` : null,
      usulan: usul.length === 1 ? BigInt(usul[0]) : null,
      usulanBeda: usul.length > 1 ? `Usulan berbeda per lokasi: ${daftar(b.usul)}` : null,
      adaKontrak: b.adaKontrak,
    });
  });
  return hasil;
}

/** Nama sheet Excel yang sah (≤31 huruf, tanpa []:*?/\), unik. */
function namaSheet(dasar: string, dipakai: Set<string>): string {
  const bersih = dasar.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim();
  let n = bersih.slice(0, 31);
  for (let i = 2; dipakai.has(n.toLowerCase()); i++) n = `${bersih.slice(0, 31 - String(i).length - 1)} ${i}`;
  dipakai.add(n.toLowerCase());
  return n;
}
const rujuk = (sheet: string) => `'${sheet.replace(/'/g, "''")}'`;

function judulKolom(ws: ExcelJS.Worksheet, r: number, judul: string[]) {
  judul.forEach((t, i) => {
    const c = ws.getCell(r, i + 1);
    c.value = t;
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = BIRU_TUA;
    c.border = GARIS;
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  ws.getRow(r).height = 30;
}

function sel(
  ws: ExcelJS.Worksheet,
  r: number,
  c: number,
  value: ExcelJS.CellValue,
  o: { fmt?: string; bold?: boolean; fill?: ExcelJS.Fill; indent?: number; abu?: boolean; wrap?: boolean } = {},
) {
  const x = ws.getCell(r, c);
  x.value = value;
  x.border = GARIS;
  if (o.fmt) x.numFmt = o.fmt;
  if (o.bold || o.abu) x.font = { bold: o.bold, italic: o.abu, color: o.abu ? { argb: "FF7F7F7F" } : undefined };
  if (o.fill) x.fill = o.fill;
  x.alignment = { vertical: "top", wrapText: o.wrap ?? false, indent: o.indent };
  return x;
}

function kepala(ws: ExcelJS.Worksheet, judul: string, baris: string[]) {
  ws.getCell(1, 1).value = judul;
  ws.getCell(1, 1).font = { bold: true, size: 13 };
  baris.forEach((t, i) => {
    ws.getCell(2 + i, 1).value = t;
    ws.getCell(2 + i, 1).font = i === 0 ? { bold: true } : {};
  });
}

/**
 * Biaya di luar item RAB: staf, operasional, administrasi, pengujian, jaminan.
 * Hanya POS-nya dan volumenya (dari masa kontrak dan volume beton lokasi
 * ini); harga TIDAK diisikan – angka referensi adalah contoh proyek lain
 * (DECISIONS 805).
 */
export function biayaTambahan(l: LokasiRaplSiapIsi): {
  kelompok: string;
  kategori: string;
  nama: string;
  satuan: string;
  volume: number;
}[] {
  const b = l.bulanKontrak;
  const staf: [string, number][] = [
    ["Manajer lapangan (site manager)", 1],
    ["Pelaksana lapangan", 1],
    ["Pengawas mutu (quality control)", 1],
    ["Surveyor dan drafter as-built", 1],
    ["Administrasi dan logistik", 1],
    ["Penjaga gudang dan keamanan", 2],
  ];
  const benda = 3 * Math.max(2, Math.ceil(l.volumeBetonM3 / 15));
  return [
    ...staf.map(([n, k]) => ({ kelompok: "Gaji staf", kategori: "umum", nama: `Gaji ${n.charAt(0).toLowerCase()}${n.slice(1)}`, satuan: "orang-bln", volume: k * b })),
    { kelompok: "Operasional", kategori: "umum", nama: "Konsumsi staf lapangan", satuan: "bln", volume: b },
    { kelompok: "Operasional", kategori: "umum", nama: "Sewa kendaraan operasional dan BBM", satuan: "bln", volume: b },
    { kelompok: "Operasional", kategori: "umum", nama: "Komunikasi dan internet lapangan", satuan: "bln", volume: b },
    { kelompok: "Operasional", kategori: "umum", nama: "ATK, cetak dan penggandaan dokumen", satuan: "bln", volume: b },
    { kelompok: "Operasional", kategori: "umum", nama: "Air bersih dan MCK sementara", satuan: "bln", volume: b },
    { kelompok: "Administrasi", kategori: "umum", nama: "Dokumentasi progres (foto dan video drone)", satuan: "ls", volume: 1 },
    { kelompok: "Administrasi", kategori: "umum", nama: "Laporan harian, mingguan, bulanan dan gambar as-built", satuan: "ls", volume: 1 },
    { kelompok: "Administrasi", kategori: "umum", nama: "Rapat koordinasi, serah terima PHO dan FHO", satuan: "ls", volume: 1 },
    { kelompok: "Administrasi", kategori: "umum", nama: "Koordinasi dan perizinan dengan pemerintah desa", satuan: "ls", volume: 1 },
    { kelompok: "Pengujian", kategori: "jasa", nama: "Uji kuat tekan beton (benda uji silinder)", satuan: "bh", volume: benda },
    { kelompok: "Pengujian", kategori: "jasa", nama: "Uji tarik baja tulangan (sampel)", satuan: "bh", volume: 4 },
    { kelompok: "Jaminan dan asuransi", kategori: "jasa", nama: "Premi jaminan pelaksanaan", satuan: "ls", volume: 1 },
    { kelompok: "Jaminan dan asuransi", kategori: "jasa", nama: "Asuransi pekerjaan (CAR) dan tenaga kerja", satuan: "ls", volume: 1 },
  ];
}

export async function buildRaplSiapIsiXlsx(args: {
  judul: string;
  lokasi: LokasiRaplSiapIsi[];
}): Promise<ExcelJS.Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MARLIN";
  wb.calcProperties.fullCalcOnLoad = true;
  const dipakai = new Set<string>();
  const sRekap = namaSheet("Rekapitulasi", dipakai);
  const sHarga = namaSheet("Isi Harga", dipakai);
  const sRincian = args.lokasi.map((l) => namaSheet(args.lokasi.length === 1 ? "Rincian" : `Rincian ${l.nama}`, dipakai));
  const wsRekap = wb.addWorksheet(sRekap);
  const wsHarga = wb.addWorksheet(sHarga);
  const sd = daftarSumberDaya(args.lokasi);

  /* ---------------------------------------------------------- Isi Harga */
  const barisHarga = new Map<string, number>();
  {
    const ws = wsHarga;
    kepala(ws, "ISI HARGA SUMBER DAYA – RAPL", [
      args.judul,
      "Isi kolom HARGA DIPAKAI (kuning). Semua rincian dan rekapitulasi ikut berubah.",
      "Usulan harga = estimasi untuk lokasi itu yang belum disetujui di MARLIN; tidak ikut jumlah. Salin bila setuju, atau setujui di layar RAPL.",
    ]);
    const H = 6;
    judulKolom(ws, H, ["Kode", "Kategori", "Uraian sumber daya", "Sat", "Volume total", "Usulan harga (belum disetujui)", "HARGA DIPAKAI", "Jumlah (Rp)", "Keterangan"]);
    let r = H + 1;
    let katSebelum = "";
    for (const [, b] of sd) {
      if (b.kategori !== katSebelum) {
        katSebelum = b.kategori;
        sel(ws, r, 1, null, { fill: BIRU_MUDA });
        sel(ws, r, 2, labelKategori(b.kategori), { bold: true, fill: BIRU_MUDA });
        for (let c = 3; c <= 9; c++) sel(ws, r, c, null, { fill: BIRU_MUDA });
        r++;
      }
      barisHarga.set(b.kode, r);
      sel(ws, r, 1, b.kode);
      sel(ws, r, 2, labelKategori(b.kategori));
      sel(ws, r, 3, b.nama, { wrap: true });
      sel(ws, r, 4, b.satuan);
      const jum = (kol: "D" | "F") =>
        sRincian.map((s) => `SUMIFS(${rujuk(s)}!$${kol}:$${kol},${rujuk(s)}!$A:$A,$A${r})`).join("+");
      sel(ws, r, 5, { formula: jum("D") }, { fmt: fmtVolume(b.satuan) });
      sel(ws, r, 6, b.usulan === null ? null : Number(b.usulan), { fmt: FMT_RP, abu: true });
      sel(ws, r, 7, b.hargaDipakai === null ? null : Number(b.hargaDipakai), { fmt: FMT_RP, fill: KUNING });
      sel(ws, r, 8, { formula: jum("F") }, { fmt: FMT_RP });
      const ket = [
        b.hargaDipakai !== null ? "harga lokasi (HSD)" : "",
        b.hargaBeda ?? "",
        b.adaKontrak ? "sebagian item memakai harga analisa kontrak (tertulis di Rincian)" : "",
        b.usulanBeda ?? "",
      ].filter(Boolean);
      sel(ws, r, 9, ket.join("; ") || null, { wrap: true });
      r++;
    }
    ws.columns = [{ width: 8 }, { width: 22 }, { width: 50 }, { width: 9 }, { width: 14 }, { width: 16 }, { width: 16 }, { width: 18 }, { width: 40 }];
    ws.views = [{ state: "frozen", ySplit: H }];
  }

  /* ----------------------------------------------------- Rincian per lokasi */
  const rekapLokasi: { sheet: string; l: LokasiRaplSiapIsi }[] = [];
  args.lokasi.forEach((l, li) => {
    const sheet = sRincian[li]!;
    rekapLokasi.push({ sheet, l });
    const ws = wb.addWorksheet(sheet);
    kepala(ws, "RINCIAN RAPL PER ITEM PEKERJAAN", [
      `${l.nama} – Desa ${l.desa}, ${l.kabupaten}, ${l.provinsi}`,
      `Paket ${l.paket}${l.nomorKontrak ? ` · Kontrak ${l.nomorKontrak}` : ""}${l.pelaksana ? ` · ${l.pelaksana}` : ""}`,
    ]);
    const H = 5;
    judulKolom(ws, H, ["Kode", "Uraian pekerjaan / komponen", "Sat", "Volume", "Harga satuan (Rp)", "Jumlah (Rp)", "Kategori", "Asal / keterangan", "Usulan harga lokasi ini", "Nilai RAB (Rp)", "Selisih (Rp)"]);
    let r = H + 1;
    const subtotal: number[] = [];
    for (const kat of l.kategori) {
      sel(ws, r, 1, kat.kode, { bold: true, fill: BIRU_MUDA });
      sel(ws, r, 2, kat.nama, { bold: true, fill: BIRU_MUDA });
      for (let c = 3; c <= 11; c++) sel(ws, r, c, null, { fill: BIRU_MUDA });
      r++;
      const itemRows: number[] = [];
      for (const it of kat.item) {
        const ir = r;
        itemRows.push(ir);
        sel(ws, r, 1, it.code, { bold: true, fill: ABU });
        sel(ws, r, 2, it.uraian, { bold: true, fill: ABU, wrap: true });
        sel(ws, r, 3, it.satuan, { fill: ABU });
        sel(ws, r, 4, it.volume, { fmt: fmtVolume(it.satuan), fill: ABU });
        sel(ws, r, 5, { formula: `IFERROR(F${r}/D${r},0)` }, { fmt: FMT_RP, fill: ABU });
        sel(ws, r, 7, null, { fill: ABU });
        sel(ws, r, 8, asalItem(it) + (it.dariLokasi ? ` (dari ${it.dariLokasi})` : ""), { fill: ABU });
        sel(ws, r, 9, null, { fill: ABU });
        sel(ws, r, 10, Number(it.nilaiRab), { fmt: FMT_RP, fill: ABU });
        sel(ws, r, 11, { formula: `J${r}-F${r}` }, { fmt: FMT_RP, fill: ABU });
        r++;
        const awal = r;
        if (it.cara === "borongan" || it.cara === "belum") {
          // Satu baris harga per satuan item: borongan sudah berharga, item
          // yang belum terurai diisi di sini (kuning).
          sel(ws, r, 1, null);
          sel(ws, r, 2, it.cara === "borongan" ? "Harga borongan per satuan" : `Harga per satuan – isi (belum terurai: ${it.rinciLewat ?? ""})`, { indent: 1, wrap: true });
          sel(ws, r, 3, it.satuan);
          sel(ws, r, 4, it.volume, { fmt: fmtVolume(it.satuan) });
          sel(ws, r, 5, it.hargaBorongan === null ? null : Number(it.hargaBorongan), { fmt: FMT_RP, fill: it.cara === "belum" ? KUNING : undefined });
          sel(ws, r, 6, { formula: `ROUND(D${r}*E${r},0)` }, { fmt: FMT_RP });
          sel(ws, r, 7, labelKategori("jasa"));
          sel(ws, r, 8, it.cara === "borongan" ? "borongan (diisi di MARLIN)" : null);
          for (const c of [9, 10, 11]) sel(ws, r, c, null);
          r++;
        } else {
          for (const k of it.komponen) {
            const b = sd.get(kunciSumberDaya(k.kategori, k.nama, k.satuan))!;
            sel(ws, r, 1, b.kode);
            sel(ws, r, 2, k.nama, { indent: 1, wrap: true });
            sel(ws, r, 3, k.satuan);
            sel(ws, r, 4, k.jumlah, { fmt: fmtVolume(k.satuan) });
            sel(
              ws,
              r,
              5,
              k.hargaDariKontrak && k.harga !== null
                ? Number(k.harga)
                : { formula: `${rujuk(sHarga)}!$G$${barisHarga.get(b.kode)}` },
              { fmt: FMT_RP },
            );
            sel(ws, r, 6, { formula: `ROUND(D${r}*E${r},0)` }, { fmt: FMT_RP });
            sel(ws, r, 7, labelKategori(k.kategori));
            sel(ws, r, 8, k.hargaDariKontrak ? "harga analisa kontrak" : k.dariAhsp ? null : "tambahan");
            const usul = k.harga === null ? l.usulan.get(kunciSumberDaya(k.kategori, k.nama, k.satuan)) : undefined;
            sel(ws, r, 9, usul === undefined ? null : Number(usul), { fmt: FMT_RP, abu: true });
            sel(ws, r, 10, null);
            sel(ws, r, 11, null);
            r++;
          }
        }
        sel(ws, ir, 6, r > awal ? { formula: `SUM(F${awal}:F${r - 1})` } : 0, { fmt: FMT_RP, bold: true, fill: ABU });
      }
      sel(ws, r, 1, null, { fill: BIRU_MUDA });
      sel(ws, r, 2, `Jumlah ${kat.nama}`, { bold: true, fill: BIRU_MUDA });
      for (let c = 3; c <= 11; c++) sel(ws, r, c, null, { fill: BIRU_MUDA });
      sel(ws, r, 6, { formula: itemRows.map((x) => `F${x}`).join("+") || "0" }, { fmt: FMT_RP, bold: true, fill: BIRU_MUDA });
      sel(ws, r, 10, { formula: itemRows.map((x) => `J${x}`).join("+") || "0" }, { fmt: FMT_RP, bold: true, fill: BIRU_MUDA });
      subtotal.push(r);
      r++;
    }
    const barisItem = r;
    sel(ws, r, 2, "JUMLAH ITEM RAB", { bold: true, fill: ABU });
    for (const c of [1, 3, 4, 5, 7, 8, 9, 11]) sel(ws, r, c, null, { fill: ABU });
    sel(ws, r, 6, { formula: subtotal.map((x) => `F${x}`).join("+") || "0" }, { fmt: FMT_RP, bold: true, fill: ABU });
    sel(ws, r, 10, { formula: subtotal.map((x) => `J${x}`).join("+") || "0" }, { fmt: FMT_RP, bold: true, fill: ABU });
    r += 2;

    // Biaya di luar item RAB – volume dan harga diisi di sini.
    sel(ws, r, 2, "BIAYA DI LUAR ITEM RAB (isi volume & harga yang kuning)", { bold: true, fill: BIRU_MUDA });
    for (const c of [1, 3, 4, 5, 6, 7, 8, 9, 10, 11]) sel(ws, r, c, null, { fill: BIRU_MUDA });
    r++;
    // Tanpa baris "angkutan material": harga bahan adalah harga sampai di
    // lokasi (DECISIONS 805), jadi baris itu menghitung angkutan dua kali.
    const awalTambahan = r;
    for (const t of biayaTambahan(l)) {
      sel(ws, r, 1, null);
      sel(ws, r, 2, t.nama, { indent: 1, wrap: true });
      sel(ws, r, 3, t.satuan);
      sel(ws, r, 4, t.volume, { fmt: fmtVolume(t.satuan), fill: KUNING });
      sel(ws, r, 5, null, { fmt: FMT_RP, fill: KUNING });
      sel(ws, r, 6, { formula: `ROUND(D${r}*E${r},0)` }, { fmt: FMT_RP });
      sel(ws, r, 7, labelKategori(t.kategori));
      sel(ws, r, 8, t.kelompok);
      sel(ws, r, 9, null);
      sel(ws, r, 10, null);
      sel(ws, r, 11, null);
      r++;
    }
    const akhirTambahan = r - 1;
    // Tak terduga: persen × (item RAB + biaya di luar item RAB).
    const barisTak = r;
    sel(ws, r, 1, null);
    sel(ws, r, 2, "Cadangan biaya tak terduga", { indent: 1 });
    sel(ws, r, 3, "%");
    sel(ws, r, 4, null, { fmt: FMT_PERSEN, fill: KUNING });
    sel(ws, r, 5, { formula: `F${barisItem}+SUM(F${awalTambahan}:F${akhirTambahan})` }, { fmt: FMT_RP });
    sel(ws, r, 6, { formula: `ROUND(D${r}*E${r},0)` }, { fmt: FMT_RP });
    sel(ws, r, 7, LABEL_TAK_TERDUGA);
    sel(ws, r, 8, "isi persen cadangan bila dipakai");
    for (const c of [9, 10, 11]) sel(ws, r, c, null);
    r += 2;
    sel(ws, r, 2, "TOTAL RAPL", { bold: true, fill: BIRU_TUA });
    ws.getCell(r, 2).font = { bold: true, color: { argb: "FFFFFFFF" } };
    for (const c of [1, 3, 4, 5, 7, 8, 9, 11]) sel(ws, r, c, null, { fill: BIRU_TUA });
    sel(ws, r, 6, { formula: `F${barisItem}+SUM(F${awalTambahan}:F${akhirTambahan})+F${barisTak}` }, { fmt: FMT_RP, fill: BIRU_TUA });
    ws.getCell(r, 6).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sel(ws, r, 10, { formula: `J${barisItem}` }, { fmt: FMT_RP, fill: BIRU_TUA });
    ws.getCell(r, 10).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.columns = [{ width: 9 }, { width: 52 }, { width: 9 }, { width: 13 }, { width: 15 }, { width: 17 }, { width: 22 }, { width: 26 }, { width: 15 }, { width: 17 }, { width: 16 }];
    ws.views = [{ state: "frozen", ySplit: H }];
  });

  /* -------------------------------------------------------- Rekapitulasi */
  {
    const ws = wsRekap;
    kepala(ws, "REKAPITULASI RENCANA ANGGARAN PELAKSANAAN LAPANGAN (RAPL)", [
      args.judul,
      "Harga yang belum diisi dihitung 0: total naik begitu kolom HARGA DIPAKAI di sheet Isi Harga dan sel kuning di Rincian diisi.",
    ]);
    const H = 5;
    const kolKat = [...KATEGORI_REKAP.map((k) => k.label), LABEL_TAK_TERDUGA];
    judulKolom(ws, H, ["No", "Lokasi", ...kolKat, "Total RAPL (Rp)", "Nilai RAB (Rp)", "Selisih (Rp)", "Selisih (%)"]);
    let r = H + 1;
    rekapLokasi.forEach(({ sheet, l }, i) => {
      sel(ws, r, 1, i + 1);
      sel(ws, r, 2, l.nama);
      kolKat.forEach((label, j) => {
        sel(ws, r, 3 + j, { formula: `SUMIFS(${rujuk(sheet)}!$F:$F,${rujuk(sheet)}!$G:$G,"${label}")` }, { fmt: FMT_RP });
      });
      const kTot = 3 + kolKat.length;
      const huruf = (c: number) => ws.getColumn(c).letter;
      sel(ws, r, kTot, { formula: `SUM(${huruf(3)}${r}:${huruf(kTot - 1)}${r})` }, { fmt: FMT_RP, bold: true });
      sel(ws, r, kTot + 1, Number(l.nilaiRab), { fmt: FMT_RP });
      sel(ws, r, kTot + 2, { formula: `${huruf(kTot + 1)}${r}-${huruf(kTot)}${r}` }, { fmt: FMT_RP });
      sel(ws, r, kTot + 3, { formula: `IFERROR(${huruf(kTot + 2)}${r}/${huruf(kTot + 1)}${r},0)` }, { fmt: FMT_PERSEN });
      r++;
    });
    if (rekapLokasi.length > 1) {
      sel(ws, r, 2, "JUMLAH", { bold: true, fill: ABU });
      sel(ws, r, 1, null, { fill: ABU });
      for (let c = 3; c <= 3 + kolKat.length + 2; c++) {
        const L = ws.getColumn(c).letter;
        sel(ws, r, c, { formula: `SUM(${L}${H + 1}:${L}${r - 1})` }, { fmt: FMT_RP, bold: true, fill: ABU });
      }
      const kTot = 3 + kolKat.length;
      const huruf = (c: number) => ws.getColumn(c).letter;
      sel(ws, r, kTot + 3, { formula: `IFERROR(${huruf(kTot + 2)}${r}/${huruf(kTot + 1)}${r},0)` }, { fmt: FMT_PERSEN, bold: true, fill: ABU });
      r++;
    }
    r += 2;
    // Asal rincian: supaya usulan AI tidak terbaca sebagai analisa resmi.
    ws.getCell(r, 1).value = "ASAL RINCIAN ITEM";
    ws.getCell(r, 1).font = { bold: true };
    r++;
    const asalUrut = ["Analisa kontrak", "AHSP PUPR", "Usulan AI – diterima", "Dirinci tangan", "Borongan", "Belum terurai"];
    judulKolom(ws, r, ["No", "Lokasi", ...asalUrut.map((a) => `${a} (item)`)]);
    r++;
    rekapLokasi.forEach(({ l }, i) => {
      const hit = new Map<string, number>();
      for (const k of l.kategori) for (const it of k.item) {
        const a = asalItem(it).replace(/ \+ tambahan$/, "");
        hit.set(a, (hit.get(a) ?? 0) + 1);
      }
      sel(ws, r, 1, i + 1);
      sel(ws, r, 2, l.nama);
      asalUrut.forEach((a, j) => sel(ws, r, 3 + j, hit.get(a) ?? 0));
      r++;
    });
    ws.columns = [{ width: 5 }, { width: 26 }, ...Array.from({ length: 11 }, () => ({ width: 17 }))];
    ws.views = [{ state: "frozen", ySplit: H }];
  }

  siapCetakA4(wb);
  return wb.xlsx.writeBuffer();
}
