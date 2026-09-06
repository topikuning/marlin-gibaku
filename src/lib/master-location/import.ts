import "server-only";
import ExcelJS from "exceljs";

/**
 * PARSER XLSX KATALOG LOKASI — sadar berkas MASTER DATA KNMP.
 *
 * Permintaan user 2026-09-06 atas berkas `Data_Lokasi_KNMP_Bersih`: *"lengkapi
 * data lokasi sekalian, sesuaikan kebutuhan marlin ambil data dari sheet master
 * data. ambil hanya yang aktif saja. tidak perlu ambil data perusahaan."*
 *
 * Tiga akibatnya di sini:
 *
 * 1. **Sheet dipilih, bukan diambil yang pertama.** Berkas itu punya lima sheet
 *    (DASHBOARD, MASTER DATA, REKAP PERUSAHAAN, KODE STATUS, DATA ASLI);
 *    membaca yang pertama berarti membaca dasbor.
 * 2. **Hanya lokasi AKTIF.** Berkas memuat lokasi yang batal, drop sosek,
 *    ditolak masyarakat, tidak ada lahan, dan cadangan. Semua itu bukan
 *    pekerjaan; memasukkannya ke katalog membuat orang memilih lokasi yang
 *    sudah gugur. Baris tak-aktif DILEWATI dan jumlahnya disebut di pratinjau.
 * 3. **Data perusahaan tidak dibaca sama sekali** — bukan disaring belakangan,
 *    memang tidak diambil: nama/skala/kedudukan perusahaan, kontak, sponsor,
 *    dan calon penyedia. Yang dipakai MARLIN adalah lokasinya.
 *
 * Kolom dideteksi dari BARIS HEADER (bukan posisi tetap) supaya toleran urutan
 * dan kapitalisasi, dan berkas sederhana berkolom tiga (provinsi/kabupaten/desa)
 * tetap bisa dipakai seperti sebelumnya.
 */

export type ParsedMasterRow = {
  province: string;
  regency: string;
  district: string | null;
  village: string;
  latitude: number | null;
  longitude: number | null;
  /** Nama kampung nelayan bila berkasnya menyebut; kosong = pakai nama desa. */
  name: string | null;
};

/*
 * YANG TIDAK DIAMBIL, DAN ITU DISENGAJA.
 *
 * Berkas MASTER DATA KNMP membawa jauh lebih banyak kolom: klaster, hasil
 * pleno, tahap, luas lahan, jumlah nelayan, jumlah kapal, nilai EE, ID lokasi,
 * keterangan koordinat. Semuanya TIDAK disimpan — MARLIN tidak memakainya untuk
 * apa pun, dan katalog yang menyimpan data yang tidak dipakai hanya menciptakan
 * salinan kedua yang segera basi terhadap berkas aslinya di KKP.
 *
 * Kolom status lokasi tetap DIBACA, tapi hanya untuk menyaring yang aktif
 * (`lokasiAktif`), tidak untuk disimpan.
 */

export type MasterImportResult = {
  rows: ParsedMasterRow[];
  warnings: string[];
  /** Baris yang terbaca tapi lokasinya TIDAK aktif — disebut, bukan didiamkan. */
  tidakAktif: number;
  /** Nama sheet yang benar-benar dibaca. */
  sheet: string | null;
};

const cellStr = (v: ExcelJS.CellValue): string => {
  if (v == null) return "";
  if (typeof v === "object") {
    // Rich text / hyperlink / formula result.
    const o = v as { text?: string; result?: unknown; richText?: { text: string }[] };
    if (o.richText) return o.richText.map((t) => t.text).join("");
    if (typeof o.text === "string") return o.text;
    if (o.result != null) return String(o.result);
    return "";
  }
  return String(v);
};

const cellNum = (v: ExcelJS.CellValue): number | null => {
  const s = cellStr(v).replace(/\s/g, "").replace(",", ".").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

type KolomKunci =
  | "province"
  | "regency"
  | "district"
  | "village"
  | "latitude"
  | "longitude"
  | "name"
  | "statusCode"
  | "statusLabel";

type ColMap = Record<KolomKunci, number>;

/**
 * Urutan MATCHERS penting: yang lebih khusus lebih dulu, karena satu kolom
 * hanya boleh dipakai satu kunci. "Status Koordinat" harus diuji sebelum
 * "Status Lokasi" tidak akan menabraknya, dan "Kode Status Lokasi" sebelum
 * "Status Lokasi".
 */
const MATCHERS: { key: KolomKunci; re: RegExp }[] = [
  { key: "province", re: /PROVINSI|PROPINSI/i },
  { key: "regency", re: /KABUPATEN|KOTA/i },
  { key: "district", re: /KECAMATAN/i },
  { key: "village", re: /DESA|KELURAHAN/i },
  { key: "name", re: /KAMPUNG\s*NELAYAN/i },
  { key: "latitude", re: /LATITUDE|LINTANG|\bLAT\b/i },
  { key: "longitude", re: /LONGITUDE|BUJUR|\bLNG\b|\bLONG?\b/i },
  { key: "statusCode", re: /KODE\s*STATUS\s*LOKASI/i },
  { key: "statusLabel", re: /^STATUS\s*LOKASI$/i },
];

const KOSONG: ColMap = Object.fromEntries(MATCHERS.map((m) => [m.key, -1])) as ColMap;

/** Cari baris header di ≤8 baris pertama (yang memuat ≥3 kolom wajib). */
function detectHeader(ws: ExcelJS.Worksheet): { headerRow: number; cols: ColMap } | null {
  const maxScan = Math.min(ws.rowCount, 8);
  for (let r = 1; r <= maxScan; r++) {
    const row = ws.getRow(r);
    const cols: ColMap = { ...KOSONG };
    const dipakai = new Set<number>();
    for (let c = 1; c <= ws.columnCount; c++) {
      const text = cellStr(row.getCell(c).value).trim();
      if (!text || dipakai.has(c)) continue;
      for (const m of MATCHERS) {
        if (cols[m.key] === -1 && m.re.test(text)) {
          cols[m.key] = c;
          dipakai.add(c);
          break;
        }
      }
    }
    const known = [cols.province, cols.regency, cols.village].filter((x) => x > 0).length;
    if (known >= 3) return { headerRow: r, cols };
  }
  return null;
}

/**
 * Sheet yang dibaca: yang bernama MASTER DATA lebih dulu, lalu sheet pertama
 * yang punya baris header dikenali. Sheet REKAP PERUSAHAAN dan DATA ASLI
 * sengaja tidak pernah dipilih lebih dulu — yang satu data perusahaan, yang
 * lain salinan mentah sebelum dibersihkan.
 */
function pilihSheet(wb: ExcelJS.Workbook): { ws: ExcelJS.Worksheet; header: { headerRow: number; cols: ColMap } } | null {
  const urut = [...wb.worksheets].sort((a, b) => skor(a.name) - skor(b.name));
  for (const ws of urut) {
    const header = detectHeader(ws);
    if (header) return { ws, header };
  }
  return null;
}

function skor(nama: string): number {
  const t = nama.trim().toUpperCase();
  if (t === "MASTER DATA") return 0;
  if (/MASTER/.test(t)) return 1;
  if (/PERUSAHAAN|DASHBOARD|KODE STATUS/.test(t)) return 9; // jelas bukan daftar lokasi
  if (/DATA ASLI/.test(t)) return 8; // salinan mentah; kalah dari yang sudah bersih
  return 5;
}

/**
 * Lokasi dianggap AKTIF bila berkasnya tidak menyatakan sebaliknya.
 *
 * Kode `SL-AKT` (atau label "Aktif") = aktif. Kode/label lain yang dikenal
 * berarti gugur: cadangan, drop sosek, batal, ditolak masyarakat, tidak ada
 * lahan, tidak ada lokasi, tidak masuk pleno, drop lainnya. Berkas TANPA kolom
 * status tidak disaring sama sekali — di situ tidak ada yang bisa dipercaya
 * sebagai penanda, dan menebak berarti membuang data orang.
 */
export function lokasiAktif(kode: string, label: string): boolean {
  const k = kode.trim().toUpperCase();
  const l = label.trim().toLowerCase();
  if (!k && !l) return true;
  if (k) return k === "SL-AKT";
  return l === "aktif";
}

export async function parseMasterLocationXlsx(buffer: Buffer): Promise<MasterImportResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  if (wb.worksheets.length === 0)
    return { rows: [], warnings: ["File tidak memiliki sheet."], tidakAktif: 0, sheet: null };

  const pilihan = pilihSheet(wb);
  if (!pilihan) {
    return {
      rows: [],
      warnings: [
        "Baris header tidak dikenali di sheet mana pun. Pastikan ada kolom PROVINSI, KABUPATEN/KOTA, DESA/KELURAHAN – atau unduh templatnya dari tombol di panel ini.",
      ],
      tidakAktif: 0,
      sheet: null,
    };
  }
  const { ws, header } = pilihan;
  const { headerRow, cols } = header;
  const warnings: string[] = [];
  if (ws.name.trim().toUpperCase() !== "MASTER DATA" && wb.worksheets.length > 1)
    warnings.push(`Sheet yang dibaca: "${ws.name}".`);
  if (cols.district === -1) warnings.push("Kolom KECAMATAN tidak ditemukan – dikosongkan.");
  if (cols.latitude === -1 || cols.longitude === -1)
    warnings.push("Kolom koordinat tidak lengkap – sebagian lat/lng kosong.");
  if (cols.statusCode === -1 && cols.statusLabel === -1)
    warnings.push(
      "Kolom status lokasi tidak ada – SEMUA baris diambil. Berkas MASTER DATA KNMP punya kolomnya; kalau ini bukan berkas itu, periksa dulu isinya.",
    );

  const rows: ParsedMasterRow[] = [];
  let skipped = 0;
  let tidakAktif = 0;
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const get = (c: number) => (c > 0 ? cellStr(row.getCell(c).value).trim() : "");
    const num = (c: number) => (c > 0 ? cellNum(row.getCell(c).value) : null);
    const province = get(cols.province);
    const regency = get(cols.regency);
    const village = get(cols.village);
    if (!province && !regency && !village) continue; // baris kosong
    if (!province || !regency || !village) {
      skipped++;
      continue; // baris tak lengkap → lewati
    }
    if (!lokasiAktif(get(cols.statusCode), get(cols.statusLabel))) {
      tidakAktif++;
      continue;
    }
    rows.push({
      province,
      regency,
      district: get(cols.district) || null,
      village,
      latitude: num(cols.latitude),
      longitude: num(cols.longitude),
      name: get(cols.name) || null,
    });
  }
  if (skipped > 0) warnings.push(`${skipped} baris dilewati (provinsi/kabupaten/desa tidak lengkap).`);
  if (tidakAktif > 0)
    warnings.push(
      `${tidakAktif} lokasi TIDAK aktif di berkas (cadangan/drop/batal/ditolak) dan tidak diimpor.`,
    );
  if (rows.length === 0) warnings.push("Tidak ada baris lokasi aktif yang valid.");
  return { rows, warnings, tidakAktif, sheet: ws.name };
}

/** Header templat impor — SATU sumber untuk parser, templat, dan ujinya. */
export const HEADER_TEMPLAT: { judul: string; contoh: string; catatan: string }[] = [
  { judul: "Provinsi", contoh: "Jawa Tengah", catatan: "WAJIB." },
  { judul: "Kabupaten/Kota", contoh: "Rembang", catatan: "WAJIB." },
  { judul: "Kecamatan", contoh: "Rembang", catatan: "Opsional, tapi dipakai memeriksa lokasi ganda." },
  { judul: "Desa/Kelurahan", contoh: "Pasar Banggi", catatan: "WAJIB." },
  { judul: "Kampung Nelayan", contoh: "Pasar Banggi", catatan: "Nama kampung; kosong = pakai nama desa." },
  { judul: "Latitude", contoh: "-6.6893", catatan: "Desimal, titik sebagai pemisah." },
  { judul: "Longitude", contoh: "111.4123", catatan: "Desimal." },
  { judul: "Kode Status Lokasi", contoh: "SL-AKT", catatan: "HANYA SL-AKT yang diimpor. Tidak disimpan." },
  { judul: "Status Lokasi", contoh: "Aktif", catatan: "Dipakai bila kolom kode kosong. Tidak disimpan." },
];
