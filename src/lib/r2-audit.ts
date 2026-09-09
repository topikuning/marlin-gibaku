import "server-only";
import { db } from "@/lib/db";
import { r2List, type R2Obyek } from "@/lib/r2";

/**
 * AUDIT PENYIMPANAN R2: mana berkas hidup, mana sampah.
 *
 * Pertanyaan user 2026-09-09: *"saat ini di cloudflare sudah mencapai 10GB,
 * bagaimana mengecek itu memang file-file efektif, atau ada beberapa sampah?"* —
 * disusul, ketika jawabannya berupa perintah terminal: *"sejak kapan harus buka
 * console lalu harus jalankan perintah itu! kalau kamu ngasih solusi yang
 * praktis!"*. Benar. Karena itu logikanya di sini, dan yang memakainya adalah
 * LAYAR `/sistem`.
 *
 * Sampah di object storage tidak pernah mengumumkan diri. Ia lahir dari
 * hal-hal yang justru dirancang supaya tidak berisik: `r2Delete(...)` yang
 * ditulis `.catch(() => {})` supaya penghapusan gagal tidak menggagalkan
 * pekerjaan orang, unggahan yang berhasil lalu transaksinya batal, kunci
 * ber-`Date.now()` yang tidak pernah menimpa pendahulunya, dan sisa
 * `healthcheck/` dari diagnostik R2. Semuanya benar sebagai keputusan;
 * semuanya menumpuk.
 *
 * ### Aturannya: obyek YATIM = tidak dirujuk satu kolom pun di DB
 *
 * Daftar kolomnya TIDAK ditulis tangan. Kalau ditulis tangan, satu kolom baru
 * yang lupa didaftarkan langsung membuat ribuan berkas HIDUP terbaca "sampah" —
 * kesalahan yang paling mahal di alat semacam ini. Jadi himpunan rujukan
 * dipungut dari `information_schema`: SETIAP kolom teks yang namanya mengandung
 * "key", di setiap tabel, plus nilai `app_settings` (logo pemilik disimpan
 * sebagai setelan, bukan kolom).
 *
 * Jaringnya sengaja lebar. Salah baca "masih dipakai" cuma menyisakan sampah;
 * salah baca "yatim" bisa membuat orang menghapus satu-satunya salinan foto
 * lapangan ber-GPS.
 */

export type BarisPrefix = {
  prefix: string;
  obyek: number;
  bytes: number;
  yatim: number;
  yatimBytes: number;
};

export type ObyekYatim = { key: string; bytes: number; umurHari: number | null };

export type RujukanHilang = { label: string; hilang: number; contoh: string[] };

export type HasilAuditR2 = {
  dijalankanPada: string;
  totalObyek: number;
  totalBytes: number;
  yatimObyek: number;
  yatimBytes: number;
  /** Bucket terlalu besar untuk dibaca sekali jalan – angkanya sebagian. */
  terpotong: boolean;
  perPrefix: BarisPrefix[];
  /** Yatim TERBESAR lebih dulu – itu yang sepadan diperiksa orang. */
  yatimTerbesar: ObyekYatim[];
  /** Sisa diagnostik R2 yang gagal membersihkan dirinya. Selalu aman dibuang. */
  healthcheck: { obyek: number; bytes: number };
  /** Baris DB yang menunjuk berkas TIDAK ADA di R2 – kehilangan, bukan sampah. */
  rujukanHilang: RujukanHilang[];
  /** Berapa kolom ber-"key" yang dipindai – supaya angkanya bisa dipercaya. */
  kolomDipindai: number;
  /** Obyek yang belum cukup tua untuk dinilai (penjaga umur). */
  terlaluBaru: number;
  /**
   * Porsi yatim setinggi ini jauh lebih mungkin berarti SALAH BUCKET daripada
   * berarti sekian persen berkas memang sampah — mis. satu bucket dipakai dua
   * lingkungan, sehingga masing-masing menganggap punya yang lain sebagai
   * sampah. Ditandai supaya ketahuan SEBELUM ada yang dihapus.
   */
  porsiJanggal: boolean;
};

/** Ambang "ini tidak masuk akal": lebih dari separuh bucket terbaca sampah. */
const PORSI_JANGGAL = 0.5;

const prefixDari = (key: string) => key.split("/")[0] || "(akar)";
const umurHari = (d: Date | null) =>
  d ? Math.floor((Date.now() - d.getTime()) / 86_400_000) : null;

/**
 * Himpunan kunci yang MASIH DIRUJUK, dipungut dari skema — bukan dari daftar
 * yang ditulis tangan. Lihat catatan di kepala berkas: jaring lebar disengaja.
 */
export async function kunciDirujuk(): Promise<{ kunci: Set<string>; kolom: number }> {
  const kolom = await db.$queryRaw<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type IN ('text', 'character varying')
      AND column_name ILIKE '%key%'
    ORDER BY table_name, column_name
  `;
  const kunci = new Set<string>();
  for (const k of kolom) {
    // Nama tabel & kolom datang dari information_schema, bukan dari input orang.
    const rows = await db.$queryRawUnsafe<{ v: string | null }[]>(
      `SELECT DISTINCT "${k.column_name}" AS v FROM "${k.table_name}" WHERE "${k.column_name}" IS NOT NULL`,
    );
    for (const r of rows) if (r.v) kunci.add(r.v);
  }
  const setelan = await db.$queryRaw<{ value: string }[]>`SELECT DISTINCT value FROM app_settings`;
  for (const s of setelan) if (s.value) kunci.add(s.value);
  return { kunci, kolom: kolom.length };
}

/** Berkas yang DIRUJUK DB tapi tidak ada di R2 — bahaya yang berlawanan. */
async function rujukanMenggantung(ada: Set<string>): Promise<RujukanHilang[]> {
  const cek = [
    { tabel: "photos", kolom: "r2_key", label: "Foto" },
    { tabel: "photos", kolom: "original_key", label: "Foto (berkas asli)" },
    { tabel: "photos", kolom: "thumbnail_key", label: "Foto (thumbnail)" },
    { tabel: "documents", kolom: "r2_key", label: "Dokumen" },
    { tabel: "field_activity_attachments", kolom: "r2_key", label: "Lampiran aktivitas" },
  ];
  const out: RujukanHilang[] = [];
  for (const c of cek) {
    const rows = await db
      .$queryRawUnsafe<{ v: string }[]>(
        `SELECT "${c.kolom}" AS v FROM "${c.tabel}" WHERE "${c.kolom}" IS NOT NULL`,
      )
      .catch(() => [] as { v: string }[]);
    const hilang = rows.filter((r) => !ada.has(r.v));
    if (hilang.length > 0)
      out.push({ label: c.label, hilang: hilang.length, contoh: hilang.slice(0, 5).map((h) => h.v) });
  }
  return out;
}

/*
 * PENJAGA UMUR.
 *
 * Pertanyaan user 2026-09-09 — *"kamu yakin yang yatim itu memang benar-benar
 * tidak digunakan?"* — dan jawabannya waktu itu belum. Salah satu lubangnya:
 * tidak ada jeda sama sekali antara "obyek muncul di bucket" dan "obyek boleh
 * dianggap sampah". Unggahan menulis obyek DULU, barisnya belakangan; sebuah
 * kegagalan transaksi di antaranya juga meninggalkan obyek yang beberapa detik
 * kemudian sah disebut yatim.
 *
 * Seminggu, bukan sejam: sampah yang menunggu tujuh hari tidak merugikan siapa
 * pun, sementara foto lapangan yang terhapus karena selisih beberapa detik
 * tidak bisa dikembalikan.
 */
const UMUR_AMAN_HARI = 7;

function cukupTua(o: R2Obyek): boolean {
  // Tanpa tanggal = tidak bisa dibuktikan tua. Yang tidak bisa dibuktikan tidak
  // dihapus — arah kesalahannya memang harus timpang ke sisi ini.
  if (!o.diubah) return false;
  return (umurHari(o.diubah) ?? 0) >= UMUR_AMAN_HARI;
}

/**
 * Buang kandidat yang kuncinya ternyata hidup DI DALAM kolom JSON.
 *
 * 23 kolom json/jsonb di skema tidak terlihat oleh pemindaian kolom teks, dan
 * satu di antaranya TERBUKTI memuat kunci R2: `daily_reports.final_snapshot`
 * membekukan `r2Key` tiap foto (lihat `daily-report/ringkas.ts`). Snapshot itu
 * dokumen resmi yang dicetak — kalau baris fotonya sudah tidak ada sementara
 * kuncinya masih dirujuk di sana, aturan lama menyebutnya sampah lalu
 * menghapus gambar dari laporan yang sudah final.
 *
 * Yang diadu hanya KANDIDAT yatim (biasanya sedikit) terhadap isi JSON, bukan
 * seluruh kunci bucket — mengadu semuanya membuat pemeriksaan 10 GB tidak
 * pernah selesai dalam satu permintaan.
 */
async function saringDipakaiDiJson(kandidat: R2Obyek[]): Promise<R2Obyek[]> {
  if (kandidat.length === 0) return kandidat;
  const kolom = await db.$queryRaw<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type IN ('json', 'jsonb')
    ORDER BY table_name, column_name
  `;
  const dipakaiDiJson = new Set<string>();
  for (const k of kolom) {
    // Satu kueri per kolom, memakai indeks apa adanya: yang ditanyakan cuma
    // "apakah teks ini muncul", jadi `position()` sudah cukup dan tidak menarik
    // seluruh isi JSON ke memori aplikasi.
    for (const o of kandidat) {
      if (dipakaiDiJson.has(o.key)) continue;
      const [{ ada }] = await db.$queryRawUnsafe<{ ada: boolean }[]>(
        `SELECT EXISTS (SELECT 1 FROM "${k.table_name}" WHERE "${k.column_name}"::text LIKE $1) AS ada`,
        `%${o.key}%`,
      );
      if (ada) dipakaiDiJson.add(o.key);
    }
  }
  return kandidat.filter((o) => !dipakaiDiJson.has(o.key));
}

/** Kunci yatim SAAT INI — dihitung ulang, tidak pernah dipercaya dari klien. */
export async function kunciYatim(): Promise<Set<string>> {
  const { obyek } = await r2List();
  const { kunci } = await kunciDirujuk();
  const kandidat = obyek.filter((o) => !kunci.has(o.key) && cukupTua(o));
  return new Set((await saringDipakaiDiJson(kandidat)).map((o) => o.key));
}

export async function auditR2(): Promise<HasilAuditR2> {
  /*
   * URUTANNYA MENENTUKAN KEBENARAN, bukan sekadar gaya. Daftar obyek dibaca
   * DULU, rujukan DB SESUDAHNYA: apa pun yang diunggah selama pemeriksaan
   * berjalan pasti tertangkap bacaan DB yang belakangan. `Promise.all`
   * memberangkatkan keduanya bersamaan — di situ foto yang masuk tepat di
   * tengah pemeriksaan bisa sudah ada di daftar obyek tapi belum ada di bacaan
   * DB, lalu terbaca yatim. Itu bentuk lamanya.
   */
  const { obyek, terpotong } = await r2List();
  const { kunci, kolom } = await kunciDirujuk();

  const kandidat = obyek.filter((o) => !kunci.has(o.key) && cukupTua(o));
  const yatim: R2Obyek[] = await saringDipakaiDiJson(kandidat);
  const setYatim = new Set(yatim.map((o) => o.key));
  const perPrefixMap = new Map<string, BarisPrefix>();
  for (const o of obyek) {
    const p = prefixDari(o.key);
    const b =
      perPrefixMap.get(p) ?? { prefix: p, obyek: 0, bytes: 0, yatim: 0, yatimBytes: 0 };
    b.obyek++;
    b.bytes += o.bytes;
    if (setYatim.has(o.key)) {
      b.yatim++;
      b.yatimBytes += o.bytes;
    }
    perPrefixMap.set(p, b);
  }

  const hc = obyek.filter((o) => o.key.startsWith("healthcheck/"));
  const ada = new Set(obyek.map((o) => o.key));

  return {
    dijalankanPada: new Date().toISOString(),
    totalObyek: obyek.length,
    totalBytes: obyek.reduce((t, o) => t + o.bytes, 0),
    yatimObyek: yatim.length,
    yatimBytes: yatim.reduce((t, o) => t + o.bytes, 0),
    terpotong,
    perPrefix: [...perPrefixMap.values()].sort((a, b) => b.bytes - a.bytes),
    yatimTerbesar: [...yatim]
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 50)
      .map((o) => ({ key: o.key, bytes: o.bytes, umurHari: umurHari(o.diubah) })),
    healthcheck: { obyek: hc.length, bytes: hc.reduce((t, o) => t + o.bytes, 0) },
    rujukanHilang: await rujukanMenggantung(ada),
    kolomDipindai: kolom,
    terlaluBaru: obyek.filter((o) => !kunci.has(o.key) && !cukupTua(o)).length,
    porsiJanggal:
      obyek.length > 0 && yatim.reduce((t, o) => t + o.bytes, 0) >
        obyek.reduce((t, o) => t + o.bytes, 0) * PORSI_JANGGAL,
  };
}
