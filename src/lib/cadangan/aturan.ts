/**
 * ATURAN CADANGAN KE GOOGLE DRIVE (DECISIONS 650) – murni, tanpa DB dan
 * jaringan, supaya bisa diuji apa adanya.
 */

/* ── Database ────────────────────────────────────────────────────────────── */

/** Satu cadangan database per hari; jeda 20 jam supaya jadwal yang telat sedikit tidak melewatkan satu hari. */
export const JEDA_DB_JAM = 20;
/** Cadangan harian yang disimpan utuh. */
export const SIMPAN_HARIAN = 30;
/** Cadangan bulanan (yang pertama tiap bulan) yang disimpan. */
export const SIMPAN_BULANAN = 12;

const POLA_NAMA_DB = /^marlin-db-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})\.dump\.enc$/;

/** Nama berkas cadangan database – urut waktu bila diurut menurut nama. */
export function namaBerkasDb(pada: Date): string {
  const iso = pada.toISOString();
  return `marlin-db-${iso.slice(0, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}.dump.enc`;
}

function waktuDariNama(nama: string): Date | null {
  const m = POLA_NAMA_DB.exec(nama);
  if (!m) return null;
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00Z`);
}

export function cadanganDbJatuhTempo(terakhirBerhasil: Date | null, sekarang: Date): boolean {
  if (!terakhirBerhasil) return true;
  return sekarang.getTime() - terakhirBerhasil.getTime() >= JEDA_DB_JAM * 3_600_000;
}

/**
 * Id berkas cadangan database yang boleh dibuang: di luar 30 hari terakhir,
 * kecuali cadangan PERTAMA tiap bulan selama 12 bulan. Berkas yang namanya
 * bukan cadangan MARLIN tidak pernah dipilih – folder itu milik akun pribadi
 * orang, dan bisa saja ada yang menaruh berkas lain di sana.
 */
export function pilihCadanganDbDibuang(daftar: { id: string; name: string }[], sekarang: Date): string[] {
  const batasHarian = sekarang.getTime() - SIMPAN_HARIAN * 86_400_000;
  const bulanSekarang = sekarang.getUTCFullYear() * 12 + sekarang.getUTCMonth();
  const dikenal = daftar
    .map((b) => ({ ...b, waktu: waktuDariNama(b.name) }))
    .filter((b): b is { id: string; name: string; waktu: Date } => b.waktu !== null)
    .sort((a, b) => a.waktu.getTime() - b.waktu.getTime());

  const pertamaTiapBulan = new Set<string>();
  const bulanTerlihat = new Set<number>();
  for (const b of dikenal) {
    const bulan = b.waktu.getUTCFullYear() * 12 + b.waktu.getUTCMonth();
    if (!bulanTerlihat.has(bulan)) {
      bulanTerlihat.add(bulan);
      if (bulanSekarang - bulan < SIMPAN_BULANAN) pertamaTiapBulan.add(b.id);
    }
  }
  return dikenal
    .filter((b) => b.waktu.getTime() < batasHarian && !pertamaTiapBulan.has(b.id))
    .map((b) => b.id);
}

/**
 * Parameter yang dipahami libpq. `DATABASE_URL` Railway bisa membawa parameter
 * khusus Prisma (`schema`, `connection_limit`, …) yang membuat pg_dump menolak
 * alamatnya – parameter selain daftar ini dibuang.
 */
const PARAM_LIBPQ = new Set([
  "sslmode",
  "sslrootcert",
  "sslcert",
  "sslkey",
  "sslpassword",
  "connect_timeout",
  "application_name",
  "options",
  "target_session_attrs",
  "channel_binding",
]);

export function urlUntukPgDump(databaseUrl: string): string {
  const u = new URL(databaseUrl);
  for (const k of [...u.searchParams.keys()]) if (!PARAM_LIBPQ.has(k)) u.searchParams.delete(k);
  return u.search ? u.toString() : u.toString().replace(/\?$/, "");
}

/* ── Berkas ──────────────────────────────────────────────────────────────── */

/** Kunci berjalur (`photos/x/y.jpg`) jadi SATU nama berkas di Drive. Kunci aslinya disimpan di deskripsi berkas. */
export function namaDiDrive(kunci: string): string {
  return kunci.replace(/\//g, "__");
}

/* ── Kapan perlu orang ───────────────────────────────────────────────────── */

export const AMBANG_DB_JAM = 36;
export const AMBANG_BERKAS_MACET_JAM = 24;

export type FaktaCadangan = {
  aktif: boolean;
  terhubung: boolean;
  adaKunci: boolean;
  dbTerakhirBerhasil: Date | null;
  berkasMenunggu: number;
  berkasTerakhirBerhasil: Date | null;
  galatTerakhir: string | null;
};

export type MasalahCadangan = { kode: string; teks: string };

/**
 * Yang dilaporkan hanya keadaan yang butuh orang. Cadangan yang DIMATIKAN
 * orang bukan masalah – itu disengaja.
 */
export function kenaliMasalahCadangan(f: FaktaCadangan, sekarang: Date): MasalahCadangan[] {
  if (!f.aktif) return [];
  const m: MasalahCadangan[] = [];
  if (!f.terhubung) {
    m.push({
      kode: "akun-terputus",
      teks: "Akun Google untuk cadangan tidak tersambung, jadi tidak ada cadangan yang bisa dibuat. Sambungkan lagi di MARLIN – Sistem – Cadangan ke Google Drive.",
    });
  }
  if (!f.adaKunci) {
    m.push({
      kode: "tanpa-kunci",
      teks: "BACKUP_ENCRYPTION_KEY belum diisi di Railway, jadi database tidak dicadangkan.",
    });
  }
  if (f.terhubung && f.adaKunci) {
    const jam = f.dbTerakhirBerhasil ? (sekarang.getTime() - f.dbTerakhirBerhasil.getTime()) / 3_600_000 : Infinity;
    if (jam > AMBANG_DB_JAM) {
      m.push({
        kode: "db-terlambat",
        teks: f.dbTerakhirBerhasil
          ? `Database terakhir tercadangkan ${Math.floor(jam)} jam lalu.${f.galatTerakhir ? ` Penyebab terakhir: ${f.galatTerakhir}` : ""}`
          : `Database belum pernah berhasil dicadangkan.${f.galatTerakhir ? ` Penyebab terakhir: ${f.galatTerakhir}` : ""}`,
      });
    }
  }
  if (f.terhubung && f.berkasMenunggu > 0) {
    const jam = f.berkasTerakhirBerhasil
      ? (sekarang.getTime() - f.berkasTerakhirBerhasil.getTime()) / 3_600_000
      : Infinity;
    if (jam > AMBANG_BERKAS_MACET_JAM && f.berkasTerakhirBerhasil) {
      m.push({
        kode: "berkas-macet",
        teks: `${f.berkasMenunggu} berkas menunggu dicadangkan, tapi tidak satu pun berhasil sejak ${Math.floor(jam)} jam lalu.`,
      });
    }
  }
  return m;
}
