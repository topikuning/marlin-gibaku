import type { BacaanLaporan, BahanDibaca, PekerjaanDibaca, PotongTeks, TenagaDibaca } from "./bentuk";
import { angkaId, satuanSesudahAngka } from "./baca-angka";

/**
 * PEMBACA TEMPLAT "LAPORAN HARIAN" ala blanko KKP (DECISIONS 733). MURNI.
 *
 * Contoh yang dipakai user 2026-11-01: tiga laporan PT. Trans Sinergi
 * Indonesia (Modis, Botuliodu, Minanga Tiga) – satu templat, tapi judul
 * kolomnya tidak seragam ("VOLUME | SATUAN", "VOL REALISASI | VOL RENCANA",
 * "VOL.REALISASI | VOL.RENCNA"), satuan kadang menempel di angka, tanggal
 * kadang tanpa tahun, dan judul ditulis berjarak ("J A M  K E R J A").
 *
 * Karena itu kolom ditentukan dari LETAK judul tabelnya, bukan dari urutan
 * teks, dan baris pekerjaan dari letak NOMOR barisnya (uraian bisa dua
 * baris). Yang tidak terbaca dibiarkan kosong – tidak ditebak.
 */

const rapat = (s: string) => s.replace(/\s+/g, "").toUpperCase();
const tengah = (i: PotongTeks) => i.x + i.w / 2;
const NOMOR = /^(\d{1,2}|[A-Z])\.$/;

/** Kelompokkan potongan teks per baris (y berdekatan), kiri ke kanan. */
function perBaris(items: readonly PotongTeks[], toleransi = 4): PotongTeks[][] {
  const urut = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const hasil: PotongTeks[][] = [];
  for (const i of urut) {
    const akhir = hasil.at(-1);
    if (akhir && Math.abs(i.y - akhir[0].y) <= toleransi) akhir.push(i);
    else hasil.push([i]);
  }
  return hasil.map((b) => b.sort((a, c) => a.x - c.x));
}

const cari = (items: readonly PotongTeks[], pola: RegExp) => items.find((i) => pola.test(rapat(i.s)));

/** Templat ini dikenali dari tiga judul tabelnya. */
export function kenaliTemplatKkp(items: readonly PotongTeks[]): boolean {
  return [/^TENAGAKERJA$/, /^PEKERJAANYANGDILAKSANAKAN$/, /^BAHAN\/?ALATYANGDIDATANGKAN$/].every((p) => cari(items, p));
}

const gabung = (xs: readonly PotongTeks[]) =>
  xs
    .map((i) => i.s.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
const tanpaTitikDua = (s: string) => s.replace(/^[:\s]+/, "").trim();

export function bacaTemplatKkp(items: readonly PotongTeks[]): BacaanLaporan {
  const catatanBaca: string[] = [];
  const baris = perBaris(items);

  /* ── Kepala laporan ─────────────────────────────────────────────────── */
  // Kolom kanan (Hari/Tanggal/Minggu Ke) memisahkan isian kiri dari kanan.
  const labelKanan = cari(items, /^HARI:?$/) ?? cari(items, /^TANGGAL:?$/);
  const xKanan = labelKanan?.x ?? Number.POSITIVE_INFINITY;
  const nilai = (pola: RegExp): { teks: string | null; barisKe: number } => {
    for (let k = 0; k < baris.length; k++) {
      const b = baris[k];
      const label = b.find((i) => pola.test(rapat(i.s)));
      if (!label) continue;
      const kanan = label.x >= xKanan - 5;
      const isi = b.filter((i) => i !== label && i.x >= label.x + label.w - 1 && (kanan || i.x < xKanan - 5));
      const teks = tanpaTitikDua(gabung(isi));
      return { teks: teks || null, barisKe: k };
    }
    return { teks: null, barisKe: -1 };
  };
  const tanggal = nilai(/^TANGGAL:?$/);
  const hari = nilai(/^HARI:?$/);
  const lokasi = nilai(/^LOKASI:?$/);
  // Baris lanjutan alamat ("PROV. …") tanpa label di kolom kiri.
  let lokasiTeks = lokasi.teks;
  if (lokasiTeks && lokasi.barisKe >= 0) {
    const lanjut = baris[lokasi.barisKe + 1] ?? [];
    const adaLabel = lanjut.some((i) => i.x < 150 && /^[A-Z.\s]+$/.test(i.s.trim()) && i.s.trim().length > 1 && !i.s.includes("PROV"));
    const isiLanjut = lanjut.filter((i) => i.x < xKanan - 5 && i.x > 140);
    if (!adaLabel && isiLanjut.length) lokasiTeks = `${lokasiTeks} ${gabung(isiLanjut)}`;
  }
  const ta = nilai(/^T\.?A\.?:?$/);
  const tahunAnggaran = ta.teks ? (angkaId(ta.teks) ?? null) : null;

  /* ── Tenaga kerja & bahan/alat (dua tabel berdampingan) ─────────────── */
  const hPekerjaan = cari(items, /^PEKERJAANYANGDILAKSANAKAN$/)!;
  const kepalaPekerjaan = items.filter(
    (i) => Math.abs(i.y - hPekerjaan.y) <= 12 && /^(NO\.?|VOL|VOLUME|SATUAN|REALISASI|RENC|CATATAN)/.test(rapat(i.s)),
  );
  const yBatasPekerjaan = Math.min(hPekerjaan.y, ...kepalaPekerjaan.map((i) => i.y)) - 2;

  const pagi = cari(items, /^PAGI$/);
  const siang = cari(items, /^SIANG$/);
  const jenis = cari(items, /^JENISBAHAN/);
  const merk = cari(items, /TYPE\/?MERK$|^MERK$/);
  const terima = cari(items, /^TERIMA$/);
  const tolak = cari(items, /^TOLAK$/);
  const alasan = cari(items, /^ALASAN$/);
  const kepalaTabel = [pagi, siang, jenis, merk, terima, tolak, alasan].filter((i): i is PotongTeks => !!i);
  const yMulaiTabel = kepalaTabel.length ? Math.max(...kepalaTabel.map((i) => i.y)) + 3 : Number.POSITIVE_INFINITY;

  const tenaga: TenagaDibaca[] = [];
  const bahan: BahanDibaca[] = [];
  if (!pagi && !siang) catatanBaca.push("Kolom PAGI/SIANG tenaga kerja tidak ditemukan – tenaga kerja tidak dibaca.");
  if (!jenis || !terima) catatanBaca.push("Kolom bahan/alat tidak lengkap – bahan/alat tidak dibaca.");

  const pc = pagi ? tengah(pagi) : null;
  const sc = siang ? tengah(siang) : null;
  const jarakKolom = pc != null && sc != null ? Math.abs(sc - pc) / 2 : 15;
  const batasKiriBahan = jenis ? jenis.x - 15 : Number.POSITIVE_INFINITY;
  const batasKananLabel = Math.min(pagi?.x ?? Number.POSITIVE_INFINITY, siang?.x ?? Number.POSITIVE_INFINITY) - 5;
  let bagianKonsultan = false;

  for (const b of baris) {
    const y = b[0].y;
    if (y < yMulaiTabel || y >= yBatasPekerjaan) continue;

    // Tenaga kerja: label di kiri kolom PAGI, angka di bawah PAGI/SIANG.
    if (b.some((i) => rapat(i.s) === "KONSULTAN")) bagianKonsultan = true;
    if (!bagianKonsultan && (pc != null || sc != null)) {
      const label = gabung(b.filter((i) => i.x + i.w <= batasKananLabel && !NOMOR.test(i.s.trim()) && i.s.trim() !== "-"));
      const angkaDi = (c: number | null) =>
        c == null ? null : angkaId(gabung(b.filter((i) => Math.abs(tengah(i) - c) <= jarakKolom && i.x < batasKiriBahan)));
      const p = angkaDi(pc);
      const s = angkaDi(sc);
      if (label && rapat(label) !== "KONTRAKTOR" && (p != null || s != null)) tenaga.push({ jabatan: label, pagi: p, siang: s });
    }

    // Bahan/alat: kolom JENIS · TYPE/MERK · TERIMA · TOLAK (ALASAN diabaikan).
    if (jenis && terima) {
      const xMerk = merk?.x ?? terima.x;
      const xTolak = tolak?.x ?? (alasan?.x ?? Number.POSITIVE_INFINITY);
      const xAlasan = alasan?.x ?? Number.POSITIVE_INFINITY;
      const di = (a: number, z: number) => b.filter((i) => i.x >= batasKiriBahan && tengah(i) >= a && tengah(i) < z);
      const nama = gabung(di(batasKiriBahan, xMerk - 3));
      if (nama) {
        const teksTerima = gabung(di(terima.x - 10, xTolak - 3)) || null;
        const teksTolak = gabung(di(xTolak - 3, xAlasan - 3)) || null;
        bahan.push({
          nama: nama.replace(/\s*\($/, ""),
          merk: gabung(di(xMerk - 3, terima.x - 10)) || null,
          teksTerima: centang(teksTerima),
          teksTolak: centang(teksTolak),
        });
      }
    }
  }

  /* ── Pekerjaan yang dilaksanakan ─────────────────────────────────────── */
  const pekerjaan: PekerjaanDibaca[] = [];
  const kolom = {
    realisasi:
      kepalaPekerjaan.find((i) => /REALISASI/.test(rapat(i.s))) ??
      kepalaPekerjaan.find((i) => /^VOLUME$/.test(rapat(i.s))) ??
      kepalaPekerjaan.find((i) => /^VOL\.?$/.test(rapat(i.s))),
    rencana: kepalaPekerjaan.find((i) => /RENC/.test(rapat(i.s))),
    satuan: kepalaPekerjaan.find((i) => /^SATUAN$/.test(rapat(i.s))),
    catatan: kepalaPekerjaan.find((i) => /^CATATAN/.test(rapat(i.s))),
  };
  if (!kolom.realisasi) {
    catatanBaca.push("Kolom volume pekerjaan tidak ditemukan – volume tidak dibaca.");
  } else {
    const yKepalaBawah = Math.max(...kepalaPekerjaan.map((i) => i.y), hPekerjaan.y) + 3;
    const akhir = items
      .filter((i) => i.y > yKepalaBawah && /^(JAMKERJA|JAM|CUACA|INSPEKTOR)/.test(rapat(i.s)))
      .sort((a, b) => a.y - b.y)[0];
    const yAkhir = akhir ? akhir.y - 2 : Number.POSITIVE_INFINITY;
    const xUraianMaks = kolom.realisasi.x - 8;
    const nomor = items
      .filter((i) => i.y > yKepalaBawah && i.y < yAkhir && /^\d{1,2}\.$/.test(i.s.trim()) && i.x < xUraianMaks - 100)
      .sort((a, b) => a.y - b.y);
    const kolomAngka = (Object.entries(kolom) as [keyof typeof kolom, PotongTeks | undefined][]).filter(
      (e): e is [keyof typeof kolom, PotongTeks] => !!e[1],
    );
    for (let k = 0; k < nomor.length; k++) {
      const n = nomor[k];
      const atas = k === 0 ? yKepalaBawah : (nomor[k - 1].y + n.y) / 2;
      const bawah = k === nomor.length - 1 ? yAkhir : (n.y + nomor[k + 1].y) / 2;
      const pita = items.filter((i) => i !== n && i.y >= atas && i.y < bawah);
      const uraian = gabung(
        pita.filter((i) => i.x > n.x + n.w && i.x < xUraianMaks).sort((a, b) => a.y - b.y || a.x - b.x),
      );
      if (!uraian) continue;
      const isi: Partial<Record<keyof typeof kolom, PotongTeks[]>> = {};
      for (const i of pita.filter((i) => i.x >= xUraianMaks)) {
        const [nama] = kolomAngka.reduce(
          (best, [nm, h]) => (Math.abs(tengah(i) - tengah(h)) < best[1] ? [nm, Math.abs(tengah(i) - tengah(h))] : best),
          ["realisasi" as keyof typeof kolom, Number.POSITIVE_INFINITY] as [keyof typeof kolom, number],
        );
        (isi[nama] ??= []).push(i);
      }
      const teksVol = isi.realisasi ? gabung(isi.realisasi) : null;
      const teksSatuan = isi.satuan ? gabung(isi.satuan) : null;
      pekerjaan.push({
        no: n.s.trim().replace(/\.$/, ""),
        uraian,
        volume: angkaId(teksVol),
        satuan: teksSatuan || satuanSesudahAngka(teksVol),
        volumeRencana: isi.rencana ? angkaId(gabung(isi.rencana)) : null,
        catatan: isi.catatan ? gabung(isi.catatan) : null,
      });
    }
  }

  return {
    sumber: "templat_kkp",
    tanggalTeks: tanggal.teks,
    hariTeks: hari.teks,
    lokasiTeks,
    tahunAnggaran,
    pekerjaan,
    tenaga,
    bahan,
    catatanBaca,
  };
}

/** Tanda centang dari huruf simbol (Wingdings "P", "√", "v") → "✓". */
function centang(teks: string | null): string | null {
  if (!teks) return null;
  return /^(P|√|v|V|✓|✔)$/.test(teks.trim()) ? "✓" : teks;
}
