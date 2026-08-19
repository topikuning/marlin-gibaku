import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { COUNTED_REPORT_STATUSES } from "@/lib/progress";
import { jakartaDateKey } from "@/lib/format";

/**
 * PENCARIAN NARASI LAPANGAN (DECISIONS 382, Fase F1).
 *
 * Sesudah Fase A–E, MARLIN bisa menjawab dari fakta TERSTRUKTUR — progress,
 * deviasi, kelengkapan, kendala, kontrak, RAB. Yang masih tidak bisa dijawab
 * sama sekali adalah pertanyaan yang jawabannya ada di TEKS BEBAS:
 *
 *   *"kenapa Kedung Mutih tertinggal?"*
 *   *"masalah material di Demak bulan ini apa saja?"*
 *
 * Jawabannya ada di catatan laporan harian, catatan kegiatan, dan uraian
 * kendala — dan sampai sekarang tidak pernah bisa dicari.
 *
 * ### Kenapa pencarian kata, bukan embedding
 *
 * Diperiksa langsung pada PostgreSQL 16.13 yang dipakai proyek ini: pgvector
 * TIDAK tersedia, sementara konfigurasi teks `indonesian` bawaan ADA dan
 * benar-benar melakukan stemming ("pengecoran" → "ecor", "tertunda" → "tunda").
 *
 * Jadi pencarian ini: tidak menambah ekstensi apa pun, tidak berbiaya per
 * pertanyaan, dan **tetap hidup saat penyedia AI mati** — sejalan dengan alasan
 * jalur deterministik di DECISIONS 375. Embedding baru layak ditambahkan kalau
 * ini terbukti kurang pada pertanyaan nyata, bukan karena terdengar lebih maju.
 *
 * ### Lingkup disaring DI DALAM query, bukan sesudahnya
 *
 * Penyaringan lokasi ikut ke dalam SQL. Menyaring sesudah hasil diperingkat
 * akan membocorkan keberadaan lokasi lain lewat jumlah hasil dan skornya —
 * kebocoran yang tidak menampilkan satu huruf pun teks asing, tapi tetap
 * kebocoran.
 *
 * ### Hanya laporan yang sudah masuk hitungan
 *
 * Laporan `draft`/`perlu_koreksi` TIDAK dicari (keputusan user 2026-08-19).
 * Menjawab dari laporan yang sedang diperbaiki berarti menyebarkan keterangan
 * yang justru belum sah — dan yang sudah terkirim ke WhatsApp tidak bisa
 * ditarik kembali. Batasnya memakai `COUNTED_REPORT_STATUSES`, sama dengan yang
 * dipakai calculation layer, supaya tidak lahir definisi "laporan sah" kedua.
 */

export const JENIS_NARASI = [
  "laporan",
  "item_laporan",
  "kegiatan",
  "kendala",
  "recovery",
] as const;
export type JenisNarasi = (typeof JENIS_NARASI)[number];

export const LABEL_JENIS: Record<JenisNarasi, string> = {
  laporan: "Catatan laporan harian",
  item_laporan: "Catatan item pekerjaan",
  kegiatan: "Kegiatan lapangan",
  kendala: "Kendala",
  recovery: "Tindakan recovery",
};

export type PotonganNarasi = {
  /** Id sitasi, mis. `narasi:laporan:<uuid>` — dipakai sebagai sourceRefId. */
  id: string;
  jenis: JenisNarasi;
  locationId: string;
  namaLokasi: string;
  slugLokasi: string;
  /** Tanggal kejadian (YYYY-MM-DD); null bila sumbernya memang tak bertanggal. */
  tanggal: string | null;
  /** Teks APA ADANYA. Kutipan divalidasi terhadap teks ini (DECISIONS 382). */
  teks: string;
  skor: number;
  href: string;
};

type BarisMentah = {
  jenis: JenisNarasi;
  sumber_id: string;
  location_id: string;
  nama: string;
  slug: string;
  tanggal: Date | null;
  teks: string;
  skor: number;
};

/** Batas bawaan — cukup untuk menjawab, cukup pendek untuk dibaca di WhatsApp. */
export const BATAS_POTONGAN = 8;

/**
 * Cari potongan narasi yang relevan dengan pertanyaan, dalam lingkup lokasi.
 *
 * Mengembalikan larik kosong bila pertanyaannya tidak menghasilkan satu pun
 * kata pencarian — itu keadaan yang sah, bukan galat, dan pemanggil harus
 * memperlakukannya sebagai "tidak ada catatan yang cocok".
 */
export async function cariNarasi(opts: {
  locationIds: string[];
  pertanyaan: string;
  batas?: number;
}): Promise<PotonganNarasi[]> {
  const { locationIds, pertanyaan } = opts;
  const batas = opts.batas ?? BATAS_POTONGAN;
  if (locationIds.length === 0 || !pertanyaan.trim()) return [];

  /*
   * Kata pencarian di-OR-kan, BUKAN di-AND-kan.
   *
   * `plainto_tsquery` meng-AND seluruh kata. Untuk pertanyaan orang —
   * *"kenapa terlambat, hujan?"* — itu berarti catatan harus memuat "kenapa"
   * DAN "lambat" DAN "hujan" sekaligus; hampir tidak pernah ada, jadi
   * pencariannya selalu kosong dan fiturnya tidak berguna sama sekali. Diukur:
   * pertanyaan itu mengembalikan 0 hasil terhadap catatan yang jelas relevan.
   *
   * Yang dipakai: lexeme hasil `to_tsvector` di-OR-kan, dan `ts_rank`
   * mengurutkan — catatan yang memuat lebih banyak kata naik sendiri. Jadi
   * ketepatan datang dari PERINGKAT, bukan dari penyaringan yang kaku.
   *
   * Lexeme diambil dari `to_tsvector`, bukan dari teks mentah, dan disaring ke
   * `^[a-z0-9]+$`. Dua-duanya membuat operator tsquery (`&`, `|`, `!`, `:`)
   * tidak mungkin ikut terbawa dari ketikan penanya.
   */
  const q = pertanyaan.trim().slice(0, 300);
  const ids = Prisma.join(locationIds.map((i) => Prisma.sql`${i}::uuid`));
  const statusSah = Prisma.join([...COUNTED_REPORT_STATUSES].map((s) => Prisma.sql`${s}`));

  const baris = await db.$queryRaw<BarisMentah[]>(Prisma.sql`
    WITH kata AS (
      SELECT lexeme FROM unnest(to_tsvector('indonesian', ${q})) AS t(lexeme, positions, weights)
       WHERE lexeme ~ '^[a-z0-9]+$'
    ), q AS (
      SELECT to_tsquery('indonesian', string_agg(lexeme, ' | ')) AS tsq FROM kata
    )
    SELECT * FROM (
      SELECT 'laporan'::text AS jenis, dr.id::text AS sumber_id, l.id::text AS location_id,
             l.name AS nama, l.slug AS slug, dr.report_date AS tanggal,
             dr.notes AS teks, ts_rank(dr.tsv, q.tsq) AS skor
        FROM daily_reports dr
        JOIN locations l ON l.id = dr.location_id
        CROSS JOIN q
       WHERE dr.location_id IN (${ids})
         AND dr.status::text IN (${statusSah})
         AND dr.tsv @@ q.tsq

      UNION ALL

      SELECT 'item_laporan', di.id::text, l.id::text, l.name, l.slug, dr.report_date,
             di.notes, ts_rank(di.tsv, q.tsq)
        FROM daily_report_items di
        JOIN daily_reports dr ON dr.id = di.report_id
        JOIN locations l ON l.id = dr.location_id
        CROSS JOIN q
       WHERE dr.location_id IN (${ids})
         AND dr.status::text IN (${statusSah})
         AND di.tsv @@ q.tsq

      UNION ALL

      SELECT 'kegiatan', fa.id::text, l.id::text, l.name, l.slug, fa.activity_date,
             coalesce(fa.title, '') || ' — ' || coalesce(fa.notes, ''), ts_rank(fa.tsv, q.tsq)
        FROM field_activities fa
        JOIN locations l ON l.id = fa.location_id
        CROSS JOIN q
       WHERE fa.location_id IN (${ids})
         AND fa.tsv @@ q.tsq

      UNION ALL

      SELECT 'kendala', i.id::text, l.id::text, l.name, l.slug, i.created_at::date,
             coalesce(i.title, '') || ' — ' || coalesce(i.description, ''), ts_rank(i.tsv, q.tsq)
        FROM issues i
        JOIN locations l ON l.id = i.location_id
        CROSS JOIN q
       WHERE i.location_id IN (${ids})
         AND i.tsv @@ q.tsq

      UNION ALL

      SELECT 'recovery', ra.id::text, l.id::text, l.name, l.slug, ra.created_at::date,
             ra.description, ts_rank(ra.tsv, q.tsq)
        FROM recovery_actions ra
        JOIN issues i ON i.id = ra.issue_id
        JOIN locations l ON l.id = i.location_id
        CROSS JOIN q
       WHERE i.location_id IN (${ids})
         AND ra.tsv @@ q.tsq
    ) hasil
    ORDER BY skor DESC, tanggal DESC NULLS LAST
    LIMIT ${batas}
  `);

  return baris
    .map((b) => ({
      id: `narasi:${b.jenis}:${b.sumber_id}`,
      jenis: b.jenis,
      locationId: b.location_id,
      namaLokasi: b.nama,
      slugLokasi: b.slug,
      tanggal: b.tanggal ? jakartaDateKey(b.tanggal) : null,
      teks: (b.teks ?? "").trim(),
      skor: Number(b.skor),
      href: hrefPotongan(b.jenis, b.slug),
    }))
    // Potongan kosong bisa lolos `@@` lewat kolom gabungan (mis. judul cocok
    // tapi catatannya kosong). Tidak ada yang bisa dikutip dari teks kosong.
    .filter((p) => p.teks.length > 0);
}

function hrefPotongan(jenis: JenisNarasi, slug: string): string {
  switch (jenis) {
    case "laporan":
    case "item_laporan":
      return `/lokasi/${slug}/laporan`;
    case "kegiatan":
      return `/lokasi/${slug}/kegiatan`;
    case "kendala":
    case "recovery":
      return `/lokasi/${slug}/kendala`;
  }
}
