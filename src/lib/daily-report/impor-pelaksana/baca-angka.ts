/**
 * Angka & tanggal dari laporan pelaksana (DECISIONS 733). MURNI.
 *
 * Laporan ditulis dengan kebiasaan Indonesia: koma desimal ("122,51"), titik
 * ribuan ("1.234,5"), satuan menempel ("80,6 m3", "1 Orang"), dan tanggal
 * dalam berbagai rupa ("12 Oktober 2026", "01-Nov-26", "30 Oktober").
 */

/** Angka pertama dalam teks, kebiasaan Indonesia. `null` bila tidak ada. */
export function angkaId(teks: string | null | undefined): number | null {
  if (!teks) return null;
  const m = teks.replace(/\s+/g, " ").match(/-?\d[\d.]*(?:,\d+)?/);
  if (!m) return null;
  let s = m[0];
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Satuan yang menempel di belakang angka: "80,6 m3" → "m3", "1 Orang" → "Orang". */
export function satuanSesudahAngka(teks: string | null | undefined): string | null {
  if (!teks) return null;
  const m = teks.trim().match(/-?\d[\d.,]*\s*([A-Za-z][A-Za-z0-9²³'.]*(?:\s*[A-Za-z0-9²³]+)?)\s*$/);
  return m ? m[1].trim() : null;
}

/** Satuan diseragamkan untuk dibandingkan: "M3"/"m³"/"m^3" → "m3". */
export function rapiSatuan(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/³/g, "3")
    .replace(/²/g, "2")
    .replace(/[\s.^']/g, "")
    .replace(/^m1$/, "m")
    .replace(/^(bh|buah)$/, "bh")
    .replace(/^(ls|lumpsum)$/, "ls");
}

const BULAN: Record<string, number> = {
  januari: 1, jan: 1, februari: 2, feb: 2, peb: 2, maret: 3, mar: 3, april: 4, apr: 4,
  mei: 5, may: 5, juni: 6, jun: 6, juli: 7, jul: 7, agustus: 8, agu: 8, agt: 8, ags: 8, aug: 8,
  september: 9, sep: 9, sept: 9, oktober: 10, okt: 10, oct: 10, november: 11, nov: 11, nop: 11,
  desember: 12, des: 12, dec: 12,
};

const dua = (n: number) => String(n).padStart(2, "0");

/**
 * Tanggal berkas → `YYYY-MM-DD`. Tahun yang tidak ditulis diambil dari
 * `tahunCadangan` (baris "T. A." berkas). `null` bila tidak terbaca.
 */
export function tanggalId(teks: string | null | undefined, tahunCadangan: number | null): string | null {
  if (!teks) return null;
  const t = teks.toLowerCase().replace(/[,]/g, " ").replace(/\s+/g, " ").trim();
  const susun = (d: number, m: number, y: number | null) => {
    let tahun = y ?? tahunCadangan;
    if (tahun == null) return null;
    if (tahun < 100) tahun += 2000;
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const tgl = new Date(Date.UTC(tahun, m - 1, d));
    if (tgl.getUTCMonth() !== m - 1) return null;
    return `${tahun}-${dua(m)}-${dua(d)}`;
  };
  // 12 Oktober 2026 · 01-Nov-26 · 30 Oktober
  const nama = t.match(/(\d{1,2})[\s\-./]+([a-z]+)\.?(?:[\s\-./]+(\d{2,4}))?/);
  if (nama && BULAN[nama[2]] != null) return susun(Number(nama[1]), BULAN[nama[2]], nama[3] ? Number(nama[3]) : null);
  // 12/10/2026 · 12-10-26
  const angka = t.match(/(\d{1,2})[\-./](\d{1,2})[\-./](\d{2,4})/);
  if (angka) return susun(Number(angka[1]), Number(angka[2]), Number(angka[3]));
  return null;
}

const HARI = ["minggu", "senin", "selasa", "rabu", "kamis", "jumat", "sabtu"];

/** Nama hari untuk `YYYY-MM-DD` (kalender, bukan zona waktu). */
export function namaHari(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return HARI[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** Nama hari dari teks berkas ("Jum'at", "SABTU") → bentuk baku, atau null. */
export function hariId(teks: string | null | undefined): string | null {
  const t = (teks ?? "").toLowerCase().replace(/[^a-z]/g, "");
  return HARI.find((h) => t === h || t.startsWith(h)) ?? null;
}
