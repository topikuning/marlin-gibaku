import type ExcelJS from "exceljs";
import { bacaAngkaLokal } from "@/lib/rab/angka-lokal";

/**
 * BERKAS TAMBAH/KURANG KKP — dibaca APA ADANYA, bukan dipaksa ke bentuk MARLIN.
 *
 * Permintaan user 2026-08-07: *"itu adalah format dari kkp, bisa jadi tim
 * terlanjur mengerjakan di file seperti itu, lalu baru masuk ke sistem, jadi
 * kamu harus lebih luwes."* Betul: tim lapangan mengerjakan adendum di berkas
 * KKP, dan menolaknya sampai mereka menyalin ulang ke template MARLIN adalah
 * memindahkan pekerjaan tanpa menambah kebenaran — malah menambah peluang
 * salah salin.
 *
 * ### Bentuknya sama, NAMANYA yang menipu
 *
 * Dua berkas nyata dari paket yang sama:
 *
 * | | blok 1 | blok 2 | blok 3 | blok 4 |
 * |---|---|---|---|---|
 * | `MC_0_*.xlsx` | **RAB** | PEKERJAAN TAMBAH | PEKERJAAN KURANG | **MC 0** |
 * | `CCO01_*.xlsx` | **MC - 0** | PEKERJAAN TAMBAH | PEKERJAAN KURANG | **CCO - 01** |
 *
 * Perhatikan "MC-0": di berkas pertama ia HASIL, di berkas kedua ia KEADAAN
 * AWAL. Label yang sama, arti berlawanan. Karena itu modul ini TIDAK PERNAH
 * menyimpulkan peran blok dari namanya.
 *
 * ### Yang dipakai: posisi + aritmetika
 *
 * 1. Baris grup dikenali dari adanya blok TAMBAH **dan** KURANG.
 * 2. Blok DASAR = blok terakhir sebelum "tambah"; blok HASIL = blok terakhir
 *    sesudah "kurang". Urutan kolom inilah yang stabil di semua varian, bukan
 *    penamaannya.
 * 3. Kolom di dalam blok ditentukan dengan MEMBUKTIKAN `volume × harga ≈
 *    jumlah` pada baris-baris contoh. Header tidak dipercaya — pada berkas
 *    `MC_0_*` sel header ter-merge membuat labelnya bergeser satu kolom
 *    terhadap datanya, dan deteksi berbasis label memang salah membaca SATUAN
 *    sebagai harga. Angka tidak bisa bergeser diam-diam; label bisa.
 *
 * Modul MURNI: tanpa DB, tanpa I/O. Yang menentukan benar-salah di sini adalah
 * angkanya.
 */

/** Sekelompok kolom di bawah satu label grup (mis. "PEKERJAAN TAMBAH"). */
export type BlokNilai = { label: string; mulai: number; akhir: number };

export type PetaCco = {
  /** Baris berisi label grup — header rincian ada di bawahnya. */
  barisGrup: number;
  blokDasar: BlokNilai;
  blokHasil: BlokNilai;
  /**
   * Blok adendum masih KOSONG, jadi blok DASAR sendiri yang dipakai sebagai
   * hasil. Terjadi pada berkas DRAFT (mis. MC-0 yang kolom CCO-01-nya belum
   * diisi). Dipakai halaman impor untuk mengatakannya apa adanya.
   */
  hasilDariDasar: boolean;
  /** Peta kolom siap pakai untuk walker RAB: volume dari blok HASIL. */
  col: { vol: number; unit: number; price: number; amount: number; tkdn: number };
  /** Kolom volume blok DASAR — dipakai melaporkan berapa item yang berubah. */
  volDasar: number;
  /**
   * Harga satuan TIDAK terlihat di blok dasar (kolomnya disembunyikan), jadi
   * dihitung per baris dari JUMLAH ÷ VOLUME blok hasil – atau blok kurang/
   * tambah untuk item yang volumenya nol – dan ditulis ke kolom bantu
   * `col.price`. DECISIONS 623.
   */
  hargaTurunan?: { dari: string[] };
};

/**
 * Kolom bantu tempat harga satuan turunan ditulis — jauh di luar area data
 * berkas mana pun, jadi tidak pernah menimpa isi asli.
 */
export const KOLOM_HARGA_TURUNAN = 200;

/**
 * Kolom yang DISEMBUNYIKAN di Excel tidak pernah dibaca (DECISIONS 604) – juga
 * di jalur CCO. Salinan kecil `kolomTersembunyi` di hps-parser (yang mengimpor
 * modul ini, jadi tidak bisa diimpor balik).
 */
function kolomSembunyi(ws: ExcelJS.Worksheet): Set<number> {
  const keluar = new Set<number>();
  for (let c = 1; c <= NC; c++) {
    const kol = ws.getColumn(c);
    if (kol?.hidden === true || kol?.width === 0) keluar.add(c);
  }
  return keluar;
}

const NC = 30; // kolom A..AD — cukup untuk semua varian CCO KKP yang ditemui

function teks(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (typeof v === "object") {
    if ("richText" in v) return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join("");
    if ("result" in v) return teks((v as { result: ExcelJS.CellValue }).result);
    if ("text" in v) return String((v as { text: string }).text);
    return "";
  }
  return String(v).trim();
}

/**
 * Pembaca angka BERSAMA. Versi lama di sini menolak SEMUA teks, sehingga
 * berkas yang kolom angkanya ber-format Text tidak pernah lolos pembuktian
 * `volume x harga ~ jumlah` dan deteksi CCO menyerah tanpa sebab yang terbaca.
 */
const angka = bacaAngkaLokal;

const punyaTambah = (s: string) => /PEKERJAAN\s*TAMBAH|TAMBAH/i.test(s);
const punyaKurang = (s: string) => /PEKERJAAN\s*KURANG|KURANG/i.test(s);

/**
 * Blok label kontinu di baris grup (sel ter-merge terbaca berulang — itu dipakai).
 * Kolom tersembunyi MEMOTONG blok dan tidak pernah masuk ke dalamnya.
 */
function blokDi(ws: ExcelJS.Worksheet, baris: number, sembunyi: Set<number> = new Set()): BlokNilai[] {
  const blok: BlokNilai[] = [];
  let kini: BlokNilai | null = null;
  for (let c = 1; c <= NC; c++) {
    const label = sembunyi.has(c) ? "" : teks(ws.getRow(baris).getCell(c).value).replace(/\s+/g, " ").trim();
    if (!label) {
      kini = null;
      continue;
    }
    if (kini && kini.label === label) kini.akhir = c;
    else {
      kini = { label, mulai: c, akhir: c };
      blok.push(kini);
    }
  }
  return blok;
}

/** Baris-baris contoh: ada uraian (kolom teks kiri) dan sedikitnya satu angka. */
function barisContoh(ws: ExcelJS.Worksheet, mulai: number, blok: BlokNilai): number[] {
  const out: number[] = [];
  for (let r = mulai; r <= ws.rowCount && out.length < 60; r++) {
    const row = ws.getRow(r);
    let adaAngka = false;
    for (let c = blok.mulai; c <= blok.akhir; c++) if (angka(row.getCell(c).value) != null) adaAngka = true;
    if (adaAngka) out.push(r);
  }
  return out;
}

/** Cocok bila selisihnya ≤1% (pembulatan harga satuan di Excel itu lazim). */
const cocok = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.01);

/**
 * Cari (volume, harga, jumlah) di dalam satu blok dengan MEMBUKTIKAN
 * `volume × harga ≈ jumlah`. Semua kombinasi kolom dicoba; yang menang adalah
 * yang paling sering terbukti — bukan yang namanya paling mirip.
 */
function triplet(
  ws: ExcelJS.Worksheet,
  blok: BlokNilai,
  baris: number[],
  /**
   * Kolom VOLUME tambahan di luar blok — kolom BERSAMA di kiri tabel.
   *
   * Sebagian berkas KKP menulis VOL dan SAT sekali saja di kiri, dipakai
   * bersama oleh semua blok; blok dasarnya cuma memuat HARGA SATUAN · JUMLAH ·
   * BOBOT. Mencari volume hanya di dalam blok membuat berkas begitu tidak
   * pernah terbukti, lalu jatuh ke jalur HPS biasa dan terbaca dari kolom yang
   * salah — kategori kembar, Σ item meleset 5,5% (Tambakagung, DECISIONS 566).
   */
  volLuar: readonly number[] = [],
): { vol: number; price: number; amount: number; skor: number } | null {
  let terbaik: { vol: number; price: number; amount: number; skor: number } | null = null;
  const kolomVol = [...volLuar];
  for (let v = blok.mulai; v <= blok.akhir; v++) kolomVol.push(v);
  /**
   * Bukti dari kolom LUAR harus berangka RUPIAH, bukan angka kecil apa pun.
   *
   * `cocok` bertoleransi ±1 supaya pembulatan harga satuan Excel tidak
   * menggagalkan pembuktian. Pada angka rupiah itu tidak berarti apa-apa; pada
   * angka satu digit ia meloloskan hampir semua pasangan kolom. Selama volume
   * dicari di dalam blok saja hal itu tidak pernah jadi masalah — kolomnya
   * sedikit. Begitu kolom bersama ikut dicoba, kandidatnya melonjak dan
   * toleransi itu berubah jadi pintu tebakan. Ambang ini yang menutupnya.
   */
  const AMBANG_LUAR = 1000;
  for (const v of kolomVol)
    for (let p = blok.mulai; p <= blok.akhir; p++) {
      if (p === v) continue;
      for (let a = blok.mulai; a <= blok.akhir; a++) {
        if (a === v || a === p) continue;
        let skor = 0;
        for (const r of baris) {
          const row = ws.getRow(r);
          const nv = angka(row.getCell(v).value);
          const np = angka(row.getCell(p).value);
          const na = angka(row.getCell(a).value);
          if (nv == null || np == null || na == null) continue;
          // Baris nol tidak membuktikan apa pun (0×apa saja = 0) — dilewati
          // supaya kolom BOBOT yang kebetulan nol tidak ikut menang.
          if (nv === 0 || np === 0 || na === 0) continue;
          const dariLuar = v < blok.mulai || v > blok.akhir;
          if (dariLuar && Math.abs(na) < AMBANG_LUAR) continue;
          if (cocok(nv * np, na)) skor++;
        }
        if (skor > 0 && (!terbaik || skor > terbaik.skor)) terbaik = { vol: v, price: p, amount: a, skor };
      }
    }
  return terbaik;
}

/** Kolom SATUAN = kolom yang isinya teks pendek bukan-angka paling sering. */
function kolomSatuan(
  ws: ExcelJS.Worksheet,
  blok: BlokNilai,
  baris: number[],
  /** Kolom di luar blok yang boleh ikut dipertimbangkan (kolom bersama kiri). */
  luar: readonly number[] = [],
): number | null {
  const pilih = (kolom: readonly number[]): number | null => {
    let terbaik: { c: number; skor: number } | null = null;
    for (const c of kolom) {
      let skor = 0;
      for (const r of baris) {
        const sel = ws.getRow(r).getCell(c).value;
        if (angka(sel) != null) continue;
        const t = teks(sel);
        if (t && t.length <= 6) skor++;
      }
      if (skor > 0 && (!terbaik || skor > terbaik.skor)) terbaik = { c, skor };
    }
    return terbaik?.c ?? null;
  };
  const dalam: number[] = [];
  for (let c = blok.mulai; c <= blok.akhir; c++) dalam.push(c);
  // DI DALAM blok lebih dulu; kolom bersama hanya dipakai bila blok ini memang
  // tidak punya kolom satuan sendiri. Urutan itu yang menjaga berkas yang sudah
  // terbaca benar tidak berpindah kolom karena ada kandidat lain di kiri.
  return pilih(dalam) ?? pilih(luar);
}

/**
 * Kenali sheet berformat tambah/kurang. `null` = bukan (biar jalur RAB biasa
 * yang menanganinya) — modul ini tidak boleh menebak-nebak berkas orang lain.
 */
export function deteksiCco(ws: ExcelJS.Worksheet): PetaCco | null {
  const sembunyi = kolomSembunyi(ws);
  let barisGrup = -1;
  let blok: BlokNilai[] = [];
  for (let r = 1; r <= Math.min(40, ws.rowCount); r++) {
    const b = blokDi(ws, r, sembunyi);
    if (b.some((x) => punyaTambah(x.label)) && b.some((x) => punyaKurang(x.label))) {
      barisGrup = r;
      blok = b;
      break;
    }
  }
  if (barisGrup < 0) return null;

  const iTambah = blok.findIndex((b) => punyaTambah(b.label));
  const iKurang = blok.findIndex((b) => punyaKurang(b.label));
  if (iTambah < 1 || iKurang <= iTambah) return null;

  /*
   * Blok DASAR = blok terakhir sebelum "tambah" yang BUKAN kolom bobot/
   * keterangan. Berkas CCO1 Tegalsari (2026-09-27) menaruh kolom "BOBOT" di
   * antara blok KONTRAK dan PEKERJAAN TAMBAH; aturan "tepat sebelum tambah"
   * memilih kolom bobot itu, pembuktian gagal, dan seluruh berkas jatuh ke
   * pembaca HPS biasa – yang lalu membaca blok HPS/penawaran.
   */
  let iDasar = iTambah - 1;
  while (iDasar > 0 && /^(BOBOT|KET|KETERANGAN|%)/i.test(blok[iDasar].label)) iDasar--;
  const blokDasar = blok[iDasar];
  // Kandidat blok HASIL = semua blok sesudah "kurang", tanpa kolom keterangan.
  const sesudah = blok.slice(iKurang + 1).filter((b) => !/^KET|KETERANGAN/i.test(b.label));
  if (sesudah.length === 0) return null;

  // Data mulai beberapa baris di bawah grup (ada 1–3 baris sub-header).
  const contoh = barisContoh(ws, barisGrup + 1, blokDasar);
  if (contoh.length < 3) return null;

  /*
   * KOLOM BERSAMA = kolom di KIRI blok dasar (NO · uraian · VOL · SAT).
   *
   * Dipakai HANYA sebagai cadangan, sesudah pembuktian di dalam blok gagal.
   * Berkas yang sudah terbaca benar karena itu tidak berubah sama sekali;
   * yang berubah hanya berkas yang tadinya menyerah — dan menyerahnya mahal,
   * karena ia lalu dibaca sebagai HPS biasa dari kolom yang salah.
   */
  const bersama: number[] = [];
  for (let c = 1; c < blokDasar.mulai; c++) if (!sembunyi.has(c)) bersama.push(c);

  const dasarTerbukti = triplet(ws, blokDasar, contoh) ?? triplet(ws, blokDasar, contoh, bersama);
  const unit = kolomSatuan(ws, blokDasar, contoh, bersama);
  if (unit == null) return null;
  if (!dasarTerbukti || dasarTerbukti.skor < 3) {
    // Harga satuan dasar tidak terlihat (mis. kolomnya disembunyikan) – coba
    // turunkan dari blok hasil. Tidak terbukti juga → jangan diterka.
    return hargaDariBlokHasil(ws, {
      barisGrup,
      blok,
      iTambah,
      iKurang,
      blokDasar,
      sesudah,
      contoh,
      bersama,
      unit,
    });
  }
  const dasar = dasarTerbukti;

  /**
   * Volume HASIL: kolom yang, dikalikan harga satuan dasar, menghasilkan salah
   * satu kolom di blok hasil.
   */
  const buktikan = (b: BlokNilai): { vol: number; amount: number; skor: number } | null => {
    let terbaik: { vol: number; amount: number; skor: number } | null = null;
    for (let v = b.mulai; v <= b.akhir; v++)
      for (let a = b.mulai; a <= b.akhir; a++) {
        if (a === v) continue;
        let skor = 0;
        for (const r of contoh) {
          const row = ws.getRow(r);
          const nv = angka(row.getCell(v).value);
          const na = angka(row.getCell(a).value);
          const np = angka(row.getCell(dasar.price).value);
          if (nv == null || na == null || np == null || nv === 0 || na === 0 || np === 0) continue;
          if (cocok(nv * np, na)) skor++;
        }
        if (skor >= 3 && (!terbaik || skor > terbaik.skor)) terbaik = { vol: v, amount: a, skor };
      }
    return terbaik;
  };

  /**
   * Blok HASIL = blok TERBUKTI paling kanan sesudah "kurang" — bukan sekadar
   * yang paling kanan.
   *
   * Berkas nyata `DRAFT_MC0_..._KEMANTREN` punya lima blok: RAB KONTRAK · MC-0 ·
   * TAMBAH · KURANG · CCO-01, dan CCO-01-nya MASIH KOSONG karena adendumnya
   * memang belum dikerjakan. Aturan "ambil yang paling kanan" memilih blok
   * kosong itu, gagal membuktikan `volume × harga ≈ jumlah`, lalu seluruh
   * berkas ditolak — padahal blok yang berlaku (MC-0) ada dan angkanya lengkap.
   */
  let blokHasil: BlokNilai | null = null;
  let volHasil = 0;
  let amountHasil = 0;
  /*
   * DARI KIRI, bukan dari kanan.
   *
   * Kegagalan 2026-09-07 (MC 1 FINAL GEMPOLSEWU): berkas itu punya ENAM blok
   * sesudah "kurang" — CCO-01 · KET · KET · CCO-PRC · CCO-PERENCANA · BIAYA
   * PELAKSANAAN. Aturan "paling kanan yang terbukti" memilih CCO-PERENCANA,
   * sebuah skenario perencana, dan mengalikan volumenya dengan harga satuan
   * blok dasar: Σ item 13,24 miliar untuk berkas yang menulis totalnya sendiri
   * 3,67 miliar. Salah blok tidak terlihat salah — angkanya besar dan rapi.
   *
   * Hasil dari tambah/kurang adalah blok BERIKUTNYA; yang di kanannya skenario
   * turunan (perencana, biaya pelaksanaan) yang bukan nilai kontrak. Blok
   * kosong tetap terlewat dengan sendirinya karena harus TERBUKTI dulu —
   * itu yang menjaga berkas DRAFT_MC0_KEMANTREN (CCO-01 masih kosong) tetap
   * jatuh ke blok dasar seperti sebelumnya.
   */
  for (let i = 0; i < sesudah.length; i++) {
    const hit = buktikan(sesudah[i]);
    if (!hit) continue;
    blokHasil = sesudah[i];
    volHasil = hit.vol;
    amountHasil = hit.amount;
    break;
  }

  let hasilDariDasar = false;
  if (!blokHasil) {
    // Ada isinya tapi tidak satu pun terbukti → jangan diterka; biarkan pesan
    // "kolom volume/harga/jumlah tidak bisa dipastikan" yang bicara.
    const adaIsi = sesudah.some((b) =>
      contoh.some((r) => {
        for (let c = b.mulai; c <= b.akhir; c++)
          if (angka(ws.getRow(r).getCell(c).value) != null) return true;
        return false;
      }),
    );
    if (adaIsi) return null;
    // Semua blok adendum kosong = berkas DRAFT. Yang benar bukan menolaknya,
    // melainkan membacanya sebagai keadaan DASAR apa adanya (nol perubahan).
    blokHasil = blokDasar;
    volHasil = dasar.vol;
    amountHasil = dasar.amount;
    hasilDariDasar = true;
  }

  return {
    barisGrup,
    blokDasar,
    blokHasil,
    hasilDariDasar,
    volDasar: dasar.vol,
    col: {
      // Volume ADENDUM (keadaan sesudah) — inti dari impor ini.
      vol: volHasil,
      // Satuan & harga satuan tidak berubah karena adendum; diambil dari dasar.
      unit,
      price: dasar.price,
      amount: amountHasil,
      // Berkas CCO tidak membawa TKDN. Kolom jauh = selalu kosong.
      tkdn: 999,
    },
  };
}

/**
 * HARGA SATUAN TURUNAN (DECISIONS 623).
 *
 * Berkas CCO1 Tegalsari (user 2026-09-27): blok KONTRAK hanya menyisakan VOL
 * dan SAT yang terlihat – kolom HPS, penawaran, dan harga kontraknya
 * DISEMBUNYIKAN penyusunnya. Blok hasil ("CCO 1") memuat VOLUME · JUMLAH
 * HARGA · BOBOT, tanpa harga satuan. Harga satuan tetap bisa diketahui tanpa
 * membaca satu pun kolom tersembunyi: JUMLAH ÷ VOLUME di blok hasil, atau di
 * blok PEKERJAAN KURANG/TAMBAH untuk item yang volumenya jadi nol.
 *
 * Pembuktiannya: pasangan (volume, jumlah) di blok hasil harus menghasilkan
 * harga berskala rupiah (≥100) DAN volumenya sama dengan volume dasar pada
 * sedikitnya tiga baris (item yang tidak berubah). Tanpa bukti itu → null.
 */
function hargaDariBlokHasil(
  ws: ExcelJS.Worksheet,
  k: {
    barisGrup: number;
    blok: BlokNilai[];
    iTambah: number;
    iKurang: number;
    blokDasar: BlokNilai;
    sesudah: BlokNilai[];
    contoh: number[];
    bersama: number[];
    unit: number;
  },
): PetaCco | null {
  // Kolom VOLUME dasar: berlabel VOL di baris sub-header, di blok dasar atau
  // kolom bersama kiri.
  const kandidatVol = [...k.bersama];
  for (let c = k.blokDasar.mulai; c <= k.blokDasar.akhir; c++) kandidatVol.push(c);
  let volDasar: number | null = null;
  for (let r = k.barisGrup; r <= k.barisGrup + 3 && volDasar == null; r++)
    for (const c of kandidatVol)
      if (/^VOL/i.test(teks(ws.getRow(r).getCell(c).value))) {
        volDasar = c;
        break;
      }
  if (volDasar == null) return null;

  const HARGA_MIN = 100;
  /** Pasangan (vol, jumlah) dalam satu blok yang menghasilkan harga rupiah. */
  const pasangan = (
    b: BlokNilai,
    bukti: (row: ExcelJS.Row, nv: number) => boolean,
  ): { vol: number; amount: number; skor: number } | null => {
    let terbaik: { vol: number; amount: number; skor: number } | null = null;
    for (let v = b.mulai; v <= b.akhir; v++)
      for (let a = b.mulai; a <= b.akhir; a++) {
        if (a === v) continue;
        let skor = 0;
        for (let r = k.barisGrup + 1; r <= ws.rowCount; r++) {
          const row = ws.getRow(r);
          if (row.hidden) continue;
          const nv = angka(row.getCell(v).value);
          const na = angka(row.getCell(a).value);
          if (nv == null || na == null || nv <= 0 || na <= 0) continue;
          if (na / nv < HARGA_MIN) continue;
          if (bukti(row, nv)) skor++;
          if (skor >= 60) break;
        }
        if (skor >= 3 && (!terbaik || skor > terbaik.skor)) terbaik = { vol: v, amount: a, skor };
      }
    return terbaik;
  };

  let blokHasil: BlokNilai | null = null;
  let hasil: { vol: number; amount: number } | null = null;
  for (const b of k.sesudah) {
    const hit = pasangan(b, (row, nv) => {
      const d = angka(row.getCell(volDasar!).value);
      return d != null && d > 0 && cocok(nv, d);
    });
    if (hit) {
      blokHasil = b;
      hasil = hit;
      break;
    }
  }
  if (!blokHasil || !hasil) return null;

  // Blok kurang/tambah: cukup menghasilkan harga rupiah – dipakai hanya untuk
  // item yang volume hasilnya nol (dihapus), yang tidak punya harga di blok hasil.
  const cadangan: { label: string; vol: number; amount: number }[] = [];
  for (const i of [k.iKurang, k.iTambah]) {
    const b = k.blok[i];
    const hit = pasangan(b, () => true);
    if (hit) cadangan.push({ label: b.label, vol: hit.vol, amount: hit.amount });
  }

  const sumber = [{ label: blokHasil.label, vol: hasil.vol, amount: hasil.amount }, ...cadangan];
  const dipakai = new Set<string>();
  for (let r = k.barisGrup + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    for (const s of sumber) {
      const nv = angka(row.getCell(s.vol).value);
      const na = angka(row.getCell(s.amount).value);
      if (nv == null || na == null || nv === 0 || na === 0) continue;
      const harga = Math.abs(na / nv);
      if (harga < HARGA_MIN) continue;
      row.getCell(KOLOM_HARGA_TURUNAN).value = Math.round(harga * 100) / 100;
      dipakai.add(s.label);
      break;
    }
  }

  return {
    barisGrup: k.barisGrup,
    blokDasar: k.blokDasar,
    blokHasil,
    hasilDariDasar: false,
    volDasar,
    hargaTurunan: { dari: sumber.map((s) => s.label).filter((l) => dipakai.has(l)) },
    col: { vol: hasil.vol, unit: k.unit, price: KOLOM_HARGA_TURUNAN, amount: hasil.amount, tkdn: 999 },
  };
}

/**
 * Sheet ber-BENTUK tambah/kurang (ada blok PEKERJAAN TAMBAH dan KURANG yang
 * terlihat), terlepas dari apakah kolomnya bisa dibuktikan. Dipakai pembaca
 * HPS untuk MENOLAK membaca blok HPS/penawaran dari berkas CCO (DECISIONS 623):
 * berkas adendum yang terbaca sebagai HPS menghasilkan RAB yang rapi, meyakinkan,
 * dan salah.
 */
export function berbentukCco(ws: ExcelJS.Worksheet): boolean {
  const sembunyi = kolomSembunyi(ws);
  for (let r = 1; r <= Math.min(40, ws.rowCount); r++) {
    const b = blokDi(ws, r, sembunyi);
    if (b.some((x) => punyaTambah(x.label)) && b.some((x) => punyaKurang(x.label))) return true;
  }
  return false;
}

/** Berapa item yang volumenya BERBEDA antara blok dasar dan blok hasil. */
export function hitungPerubahan(
  ws: ExcelJS.Worksheet,
  peta: PetaCco,
): { berubah: number; total: number } {
  let berubah = 0;
  let total = 0;
  for (let r = peta.barisGrup + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const harga = angka(row.getCell(peta.col.price).value);
    if (harga == null || harga === 0) continue;
    const a = angka(row.getCell(peta.volDasar).value) ?? 0;
    const b = angka(row.getCell(peta.col.vol).value) ?? 0;
    if (a === 0 && b === 0) continue;
    total++;
    if (Math.abs(a - b) > 1e-9) berubah++;
  }
  return { berubah, total };
}
