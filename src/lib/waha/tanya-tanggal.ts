/**
 * PERIODE yang diminta penanya → tanggal nyata (DECISIONS 356). MURNI: tanpa
 * DB, tanpa AI, tanpa `Date.now()` tersembunyi — hari ini selalu DIOPER masuk.
 *
 * ### AI menyebut yang ia BACA, kode ini yang MENGHITUNG
 *
 * Godaan yang harus ditolak: menyuruh AI mengisi `"2026-08-16"` untuk
 * *"kemarin"*. Itu melanggar doktrin yang sama yang melarangnya menghasilkan
 * angka (DECISIONS 133/193) — dan gagal secara praktis, karena model tidak tahu
 * hari ini tanggal berapa di Asia/Jakarta, tidak tahu bulan ini ada berapa
 * hari, dan akan menebak tahun untuk *"17 Agustus"*.
 *
 * Jadi AI hanya melaporkan BENTUK yang ia lihat di kalimat — "kemarin",
 * "2 hari lalu", "tanggal 17 bulan 8" — dan seluruh aritmetikanya di sini, di
 * tempat yang bisa diuji tanpa memanggil model.
 *
 * ### Tahun yang tidak disebut = kejadian TERAKHIR yang sudah lewat
 *
 * *"progress 17 agustus"* yang ditanya pada Desember 2026 berarti 17 Agustus
 * 2026, bukan 2027. Menebak ke depan akan menjawab tentang hari yang belum
 * terjadi — dan jawabannya kosong, sehingga terbaca seperti "tidak ada
 * pekerjaan" alih-alih "salah tahun".
 */

/** Semua tanggal dalam bentuk `YYYY-MM-DD` (kunci hari Asia/Jakarta). */
export type TanggalKey = string;

export type PeriodeDiminta =
  /** Tidak disebut sama sekali → hari ini. */
  | { jenis: "hari_ini" }
  /** "kemarin" = 1, "kemarin lusa" = 2, "3 hari lalu" = 3. */
  | { jenis: "mundur_hari"; hari: number }
  /** Tanggal yang DITULIS penanya. Bagian yang tidak ditulis = null. */
  | { jenis: "tanggal"; hari: number; bulan: number | null; tahun: number | null }
  /** "minggu ini" = 0, "minggu lalu" = 1; sama untuk bulan. */
  | { jenis: "rentang"; satuan: "minggu" | "bulan"; mundur: number };

export type PeriodeTerbaca = {
  /** Hari pertama yang dicakup. */
  mulai: TanggalKey;
  /** Hari terakhir yang dicakup — sama dengan `mulai` untuk periode satu hari. */
  akhir: TanggalKey;
  /** Satu hari saja? Menentukan pengambil data mana yang dipakai. */
  satuHari: boolean;
  /** Sebutan untuk DIULANG di balasan, supaya penanya tahu apa yang dijawab. */
  label: string;
  /**
   * Terisi bila permintaannya tidak bisa dipenuhi apa adanya. Balasan WAJIB
   * menyebutkannya — periode yang diam-diam digeser menghasilkan angka yang
   * benar untuk hari yang salah.
   */
  catatan: string | null;
};

const HARI_MS = 86_400_000;

const NAMA_BULAN = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

/** `YYYY-MM-DD` → epoch UTC tengah malam. Null bila bukan tanggal nyata. */
export function keTitik(key: TanggalKey): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const [, y, bl, d] = m;
  const t = Date.UTC(Number(y), Number(bl) - 1, Number(d));
  // Menolak 31 Februari & kawan-kawan: Date.UTC menggulungnya diam-diam.
  const kembali = keKey(t);
  return kembali === key ? t : null;
}

export function keKey(titik: number): TanggalKey {
  return new Date(titik).toISOString().slice(0, 10);
}

function geser(key: TanggalKey, hari: number): TanggalKey {
  const t = keTitik(key);
  if (t == null) return key;
  return keKey(t + hari * HARI_MS);
}

/** Senin = 0 (pekan Indonesia dimulai Senin, sama dengan kalender harian). */
function offsetSenin(key: TanggalKey): number {
  const t = keTitik(key);
  if (t == null) return 0;
  return (new Date(t).getUTCDay() + 6) % 7;
}

function formatKey(key: TanggalKey): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return key;
  return `${Number(m[3])} ${NAMA_BULAN[Number(m[2]) - 1]} ${m[1]}`;
}

/**
 * Terjemahkan periode yang diminta menjadi rentang tanggal NYATA.
 *
 * `hariIniKey` DIOPER, tidak dibaca dari jam mesin: uji yang bergantung pada
 * "hari ini sungguhan" akan berubah hasilnya setiap tengah malam, dan cacat
 * zona waktu justru paling sering muncul di sekitar pergantian hari.
 */
export function bacaPeriode(
  minta: PeriodeDiminta | null | undefined,
  hariIniKey: TanggalKey,
): PeriodeTerbaca {
  const hariIni: PeriodeTerbaca = {
    mulai: hariIniKey,
    akhir: hariIniKey,
    satuHari: true,
    label: "hari ini",
    catatan: null,
  };
  if (!minta) return hariIni;

  if (minta.jenis === "hari_ini") return hariIni;

  if (minta.jenis === "mundur_hari") {
    // Nol/negatif = hari ini; membiarkannya menjadi tanggal DEPAN adalah cara
    // paling mudah menjawab hari yang belum terjadi.
    const mundur = Math.max(0, Math.floor(minta.hari));
    if (mundur === 0) return hariIni;
    const key = geser(hariIniKey, -mundur);
    return {
      mulai: key,
      akhir: key,
      satuHari: true,
      label: mundur === 1 ? "kemarin" : mundur === 2 ? "kemarin lusa" : `${mundur} hari lalu`,
      catatan: null,
    };
  }

  if (minta.jenis === "rentang") {
    const mundur = Math.max(0, Math.floor(minta.mundur));
    if (minta.satuan === "minggu") {
      const seninIni = geser(hariIniKey, -offsetSenin(hariIniKey));
      const mulai = geser(seninIni, -7 * mundur);
      const akhirPenuh = geser(mulai, 6);
      // Minggu BERJALAN dipotong di hari ini: menjanjikan sampai Minggu depan
      // berarti menghitung hari yang belum terjadi ke dalam penyebut.
      const akhir = akhirPenuh > hariIniKey ? hariIniKey : akhirPenuh;
      return {
        mulai,
        akhir,
        satuHari: mulai === akhir,
        label: mundur === 0 ? "minggu ini" : mundur === 1 ? "minggu lalu" : `${mundur} minggu lalu`,
        catatan:
          akhir !== akhirPenuh ? `Minggu berjalan dihitung sampai hari ini (${formatKey(akhir)}).` : null,
      };
    }
    const t = keTitik(hariIniKey);
    const d = new Date(t ?? 0);
    const mulaiBulan = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - mundur, 1);
    const akhirBulan = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - mundur + 1, 0);
    const mulai = keKey(mulaiBulan);
    const akhirPenuh = keKey(akhirBulan);
    const akhir = akhirPenuh > hariIniKey ? hariIniKey : akhirPenuh;
    return {
      mulai,
      akhir,
      satuHari: mulai === akhir,
      label:
        mundur === 0
          ? "bulan ini"
          : mundur === 1
            ? "bulan lalu"
            : `${NAMA_BULAN[new Date(mulaiBulan).getUTCMonth()]} ${new Date(mulaiBulan).getUTCFullYear()}`,
      catatan:
        akhir !== akhirPenuh ? `Bulan berjalan dihitung sampai hari ini (${formatKey(akhir)}).` : null,
    };
  }

  /* ---- tanggal yang ditulis penanya ---- */
  const t = keTitik(hariIniKey);
  const kini = new Date(t ?? 0);
  const hari = Math.floor(minta.hari);
  const bulan = minta.bulan == null ? kini.getUTCMonth() + 1 : Math.floor(minta.bulan);
  if (hari < 1 || hari > 31 || bulan < 1 || bulan > 12) {
    return { ...hariIni, catatan: "Tanggal yang Anda sebut tidak saya kenali – saya jawab untuk hari ini." };
  }

  const rakit = (tahun: number) => `${tahun}-${String(bulan).padStart(2, "0")}-${String(hari).padStart(2, "0")}`;
  let tahun = minta.tahun ?? kini.getUTCFullYear();
  let key = rakit(tahun);
  if (keTitik(key) == null) {
    return {
      ...hariIni,
      catatan: `Tanggal ${hari}/${bulan} tidak ada di kalender – saya jawab untuk hari ini.`,
    };
  }
  // Tahun tidak disebut & tanggalnya masih di depan → maksudnya tahun lalu.
  if (minta.tahun == null && key > hariIniKey) {
    tahun -= 1;
    key = rakit(tahun);
    if (keTitik(key) == null) {
      return { ...hariIni, catatan: `Tanggal ${hari}/${bulan} tidak ada di tahun ${tahun}.` };
    }
  }

  const catatan =
    key > hariIniKey
      ? `Tanggal ${formatKey(key)} belum terjadi – belum ada data yang bisa saya laporkan.`
      : null;
  return { mulai: key, akhir: key, satuHari: true, label: formatKey(key), catatan };
}

/**
 * Pekan (Senin–Minggu) yang MEMUAT akhir periode ini — DECISIONS 358.
 *
 * Dipakai niat "laporan mingguan", yang jawabannya selalu satu pekan penuh
 * berapa pun bentuk periode yang ditulis penanya:
 *
 *   "laporan mingguan"              → pekan berjalan
 *   "laporan mingguan minggu lalu"  → pekan lalu (utuh Senin–Minggu)
 *   "laporan mingguan 17 agustus"   → pekan yang memuat 17 Agustus
 *
 * Pekan BERJALAN dipotong di hari ini: menghitung hari yang belum terjadi ke
 * dalam penyebut "berapa hari sudah dilaporkan" membuat angkanya bohong.
 */
export function pekanDari(p: PeriodeTerbaca, hariIniKey: TanggalKey): PeriodeTerbaca {
  const t = keTitik(p.akhir) ?? keTitik(hariIniKey);
  if (t == null) return p;
  const acuan = keKey(t);
  const senin = geser(acuan, -offsetSenin(acuan));
  const minggu = geser(senin, 6);
  const akhir = minggu > hariIniKey ? hariIniKey : minggu;
  /*
   * Pekan masih BERJALAN sampai hari Minggu-nya LEWAT — termasuk pada hari
   * Minggu itu sendiri. Perbandingan lama (`akhir !== minggu`) membuat catatan
   * "Pekan berjalan" hilang tepat di hari Minggu, padahal laporan hari itu
   * belum masuk dan angkanya masih akan bergerak. Ketahuan dari uji integrasi
   * yang kebetulan berjalan lewat tengah malam WIB hari Minggu.
   */
  const berjalan = hariIniKey <= minggu;
  return {
    mulai: senin,
    akhir,
    satuHari: senin === akhir,
    label: `pekan ${formatKey(senin)} – ${formatKey(minggu)}`,
    catatan: berjalan
      ? `Pekan berjalan – baru dihitung sampai hari ini (${formatKey(akhir)}).`
      : null,
  };
}

/**
 * BULAN KALENDER yang memuat akhir periode yang diminta (audit 2026-08-28).
 *
 * Pasangan `pekanDari` untuk rekap bulanan. Aturannya sengaja SAMA persis —
 * awal bulan sampai akhir bulan, dipotong hari ini bila bulannya masih
 * berjalan, dan pemotongan itu DIKATAKAN. Dua rekap yang aturan potongnya
 * berbeda akan menghasilkan dua angka untuk hal yang sama, dan tidak ada yang
 * bisa menebak mana yang benar.
 *
 * Tidak ada rumus baru di sini: rekap bulanan memakai pengambil data yang sama
 * dengan mingguan (`dataMingguan` menerima rentang apa pun), jadi yang berbeda
 * hanya batas tanggalnya.
 */
export function bulanDari(p: PeriodeTerbaca, hariIniKey: TanggalKey): PeriodeTerbaca {
  const acuan = keTitik(p.akhir) != null ? p.akhir : hariIniKey;
  const [ys, ms] = acuan.split("-");
  const tahun = Number(ys);
  const bulan = Number(ms);
  if (!Number.isFinite(tahun) || !Number.isFinite(bulan)) return p;

  const awal = `${ys}-${ms}-01`;
  // Hari ke-0 bulan BERIKUTNYA = hari terakhir bulan ini; ikut menangani
  // kabisat tanpa tabel jumlah hari sendiri.
  const hariTerakhir = new Date(Date.UTC(tahun, bulan, 0)).getUTCDate();
  const ujung = `${ys}-${ms}-${String(hariTerakhir).padStart(2, "0")}`;
  const akhir = ujung > hariIniKey ? hariIniKey : ujung;
  const berjalan = hariIniKey <= ujung;

  return {
    mulai: awal,
    akhir,
    satuHari: awal === akhir,
    label: `bulan ${formatKey(awal)} – ${formatKey(ujung)}`,
    catatan: berjalan
      ? `Bulan berjalan – baru dihitung sampai hari ini (${formatKey(akhir)}).`
      : null,
  };
}

/** Rentang dijadikan daftar tanggal — dibatasi supaya tidak meledak. */
export function daftarTanggal(p: PeriodeTerbaca, batas = 40): TanggalKey[] {
  const a = keTitik(p.mulai);
  const b = keTitik(p.akhir);
  if (a == null || b == null || b < a) return [];
  const keluar: TanggalKey[] = [];
  for (let t = a; t <= b && keluar.length < batas; t += HARI_MS) keluar.push(keKey(t));
  return keluar;
}
