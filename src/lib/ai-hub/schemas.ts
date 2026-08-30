import { z } from "zod";
import type { PortfolioPulse } from "./types";

/**
 * Skema output AI terstruktur (zod) + validator grounding — MURNI, unit-testable.
 * Setiap output AI WAJIB lolos: (1) skema, (2) validasi lokasi ∈ scope,
 * (3) validasi sourceRefId ∈ sumber run, (4) validasi klaim angka. Bagian yang
 * gagal DIBUANG dan dicatat sebagai limitation — tidak pernah tampil sebagai
 * "siap review". DECISIONS 133.
 */

const sev = z.enum(["sedang", "tinggi", "kritis"]);
const refIds = z.array(z.string()).min(1);

export const pulseOutputSchema = z.object({
  summary: z.string().min(20).max(3000),
  overallStatus: z.enum(["normal", "perhatian", "kritis", "data_kurang"]),
  confidence: z.number().int().min(0).max(100),
  priorityLocations: z
    .array(
      z.object({
        locationId: z.string(),
        severity: sev,
        reason: z.string().max(600),
        sourceRefIds: refIds,
      }),
    )
    .max(10),
  actionsToConsider: z
    .array(
      z.object({
        locationId: z.string().nullable(),
        title: z.string().max(160),
        reason: z.string().max(500),
        proposedRole: z.string().nullable(),
        sourceRefIds: refIds,
      }),
    )
    .max(10),
  whatChanged: z.string().max(800).nullable(),
  limitations: z.array(z.string().max(300)).max(10),
});
export type PulseOutput = z.infer<typeof pulseOutputSchema>;

const driver = z.object({
  category: z.enum(["fisik", "material", "cuaca", "sdm", "perizinan", "data", "keuangan", "lainnya"]),
  explanation: z.string().max(500),
  impact: z.enum(["rendah", "sedang", "besar"]),
  confidence: z.number().int().min(0).max(100),
  sourceRefIds: refIds,
});

export const varianceOutputSchema = z.object({
  summary: z.string().min(20).max(3000),
  confidence: z.number().int().min(0).max(100),
  locations: z
    .array(
      z.object({
        locationId: z.string(),
        dataConfidence: z.enum(["rendah", "sedang", "tinggi"]),
        confirmedDrivers: z.array(driver).max(6),
        suspectedDrivers: z.array(driver).max(6),
        requiredValidations: z
          .array(z.object({ action: z.string().max(300), sourceRefIds: refIds }))
          .max(6),
      }),
    )
    .max(25),
  limitations: z.array(z.string().max(300)).max(10),
});
export type VarianceOutput = z.infer<typeof varianceOutputSchema>;

export const riskOutputSchema = z.object({
  summary: z.string().min(20).max(3000),
  confidence: z.number().int().min(0).max(100),
  rationales: z
    .array(
      z.object({
        locationId: z.string(),
        category: z.enum(["schedule", "data_quality", "compliance", "cost"]),
        aiRationale: z.string().max(600),
        sourceRefIds: refIds,
      }),
    )
    .max(30),
  limitations: z.array(z.string().max(300)).max(10),
});
export type RiskOutput = z.infer<typeof riskOutputSchema>;

export const qualityOutputSchema = z.object({
  summary: z.string().min(20).max(3000),
  confidence: z.number().int().min(0).max(100),
  explanations: z
    .array(
      z.object({
        locationId: z.string(),
        findingKey: z.string(),
        explanation: z.string().max(600),
        sourceRefIds: refIds,
      }),
    )
    .max(40),
  limitations: z.array(z.string().max(300)).max(10),
});
export type QualityOutput = z.infer<typeof qualityOutputSchema>;

/**
 * KRONOLOGI LOKASI — AI merangkai, TIDAK menyusun.
 *
 * Urutan peristiwa dan hitungan kondisi terkini sudah pasti sebelum model
 * dipanggil (`src/lib/kronologi/susun.ts`). Yang diminta dari model hanyalah
 * BABAK: mengelompokkan peristiwa yang berdekatan jadi cerita yang bisa dibaca
 * PPK, dengan tiap babak menunjuk peristiwa yang mendasarinya. Babak tanpa
 * sumber dibuang penyaring grounding — sama seperti bagian laporan.
 */
export const kronologiOutputSchema = z.object({
  summary: z.string().min(20).max(3000),
  confidence: z.number().int().min(0).max(100),
  babak: z
    .array(
      z.object({
        locationId: z.string(),
        judul: z.string().max(160),
        /** Rentang tanggal babak ini, apa adanya dari peristiwanya. */
        periode: z.string().max(80),
        reason: z.string().max(1200),
        sourceRefIds: refIds,
      }),
    )
    .max(12),
  /** Keadaan lokasi HARI INI, dalam kalimat — angkanya sudah pasti dari data. */
  kondisiTerkini: z.string().min(20).max(1500),
  limitations: z.array(z.string().max(300)).max(10),
});
export type KronologiOutput = z.infer<typeof kronologiOutputSchema>;

export const reportOutputSchema = z.object({
  title: z.string().max(160),
  executiveSummary: z.string().min(20).max(4000),
  /** Sumber khusus ringkasan; tanpa ini ringkasan model tidak boleh dipercaya. */
  executiveSummarySourceRefIds: z.array(z.string()).max(12).default([]),
  overallStatus: z.enum(["normal", "perhatian", "kritis", "data_kurang"]),
  confidence: z.number().int().min(0).max(100),
  sections: z
    .array(
      z.object({
        heading: z.string().max(120),
        body: z.string().max(4000),
        locationId: z.string().nullable(),
        sourceRefIds: z.array(z.string()).max(12).default([]),
      }),
    )
    .min(1)
    .max(12),
  recommendations: z
    .array(
      z.object({
        title: z.string().max(160),
        reason: z.string().max(500),
        locationId: z.string().nullable(),
        sourceRefIds: z.array(z.string()).max(12).default([]),
      }),
    )
    .max(10),
  waSummary: z.string().min(10).max(1800),
  waSummarySourceRefIds: z.array(z.string()).max(12).default([]),
  limitations: z.array(z.string().max(300)).max(10),
});
export type ReportOutput = z.infer<typeof reportOutputSchema>;

/**
 * METRIK yang boleh diklaim AI, beserta SATUANNYA (DECISIONS 378).
 *
 * Metrik disebut EKSPLISIT, bukan disimpulkan dari teks. Itu yang membedakan
 * validasi klaim terikat dari cara lama: dulu angka diambil dengan regex dari
 * kalimat, lalu dicocokkan ke kolam angka resmi SELURUH lokasi. Akibatnya
 * "realisasi Kedung Mutih 42%" bisa lolos hanya karena ADA lokasi lain yang
 * realisasinya 42% — jawaban yang benar untuk lokasi yang salah, dan tidak ada
 * yang bisa membedakannya.
 *
 * Karena satuannya diketahui per metrik, hitungan (jumlah laporan, jumlah
 * kendala) ikut bisa divalidasi. Cara lama tidak bisa: ia hanya menangkap
 * "%"/"pp", jadi kolamnya WAJIB sesatuan persen (DECISIONS 196) dan seluruh
 * klaim hitungan lolos tanpa diperiksa sama sekali.
 */
export const METRIK = {
  rencana: { satuan: "persen", toleransi: 0.6 },
  realisasi: { satuan: "persen", toleransi: 0.6 },
  deviasi: { satuan: "pp", toleransi: 0.6 },
  kesiapan: { satuan: "skor", toleransi: 0.6 },
  laporan_final: { satuan: "hitungan", toleransi: 0 },
  laporan_diharapkan: { satuan: "hitungan", toleransi: 0 },
  kendala_terbuka: { satuan: "hitungan", toleransi: 0 },
  kendala_kritis: { satuan: "hitungan", toleransi: 0 },

  /*
   * RENCANA KERJA — satu-satunya metrik yang menghadap KE DEPAN (DECISIONS 458).
   *
   * Tanpa keduanya, pertanyaan *"pekerjaan apa yang perlu dilakukan untuk
   * mengejar progress?"* tidak punya SATU pun fakta yang boleh diklaim, dan
   * jawabannya jatuh ke "Saya tidak punya angka bersumber" — penolakan yang
   * jujur atas kekosongan yang kita sendiri buat.
   *
   * Toleransi nol: ini cacahan item, bukan persen yang boleh dibulatkan.
   */
  rencana_item_pekan_ini: { satuan: "hitungan", toleransi: 0 },
  komitmen_belum_tuntas: { satuan: "hitungan", toleransi: 0 },

  /*
   * LAPISAN PENGENDALIAN (DECISIONS 459) — kesiapan termin/PHO/FHO, peringatan
   * dini, verifikasi eksternal, inspeksi lapangan.
   *
   * Semuanya cacahan, jadi toleransinya nol: "3 syarat belum terpenuhi" yang
   * dijawab "sekitar 3" bukan jawaban, dan angka kesiapan dibaca orang yang
   * sedang memutuskan mengajukan termin.
   */
  kesiapan_syarat_belum: { satuan: "hitungan", toleransi: 0 },
  peringatan_terbuka: { satuan: "hitungan", toleransi: 0 },
  peringatan_kritis: { satuan: "hitungan", toleransi: 0 },
  laporan_belum_diverifikasi: { satuan: "hitungan", toleransi: 0 },
  laporan_sudah_diverifikasi: { satuan: "hitungan", toleransi: 0 },
  inspeksi_final: { satuan: "hitungan", toleransi: 0 },
  surat_perlu_jawab: { satuan: "hitungan", toleransi: 0 },
  surat_lewat_tenggat: { satuan: "hitungan", toleransi: 0 },

  /*
   * Metrik dari adapter sumber (DECISIONS 379) — kontrak, RAB, keuangan,
   * milestone KKP.
   *
   * Rupiah bertoleransi 0: uang tidak punya "kira-kira". Angka yang meleset
   * seribu rupiah pada nilai kontrak bukan pembulatan tampilan, melainkan
   * angka yang salah — dan di dokumen KKP ia dibaca sebagai angka resmi.
   */
  nilai_kontrak: { satuan: "rupiah", toleransi: 0 },
  durasi_kontrak_hari: { satuan: "hitungan", toleransi: 0 },
  sisa_hari_kontrak: { satuan: "hitungan", toleransi: 0 },
  rab_aktif: { satuan: "rupiah", toleransi: 0 },
  rab_revisi_no: { satuan: "hitungan", toleransi: 0 },
  anggaran_total: { satuan: "rupiah", toleransi: 0 },
  anggaran_tersedia: { satuan: "rupiah", toleransi: 0 },
  pengeluaran_disetujui: { satuan: "rupiah", toleransi: 0 },
  utang_belum_bayar: { satuan: "rupiah", toleransi: 0 },
  tertagih_owner: { satuan: "rupiah", toleransi: 0 },
  cair_owner: { satuan: "rupiah", toleransi: 0 },
  retensi_ditahan: { satuan: "rupiah", toleransi: 0 },
  milestone_total: { satuan: "hitungan", toleransi: 0 },
  milestone_selesai: { satuan: "hitungan", toleransi: 0 },
  milestone_perlu_perbaikan: { satuan: "hitungan", toleransi: 0 },

  // Temuan pemeriksa (DECISIONS 426) — hitungan, tanpa toleransi.
  temuan_terbuka: { satuan: "hitungan", toleransi: 0 },
  temuan_kritis: { satuan: "hitungan", toleransi: 0 },
  temuan_lewat_tenggat: { satuan: "hitungan", toleransi: 0 },
  temuan_dibuka_kembali: { satuan: "hitungan", toleransi: 0 },
} as const;
export type Metrik = keyof typeof METRIK;
export const NAMA_METRIK = Object.keys(METRIK) as Metrik[];

/** Satu angka resmi yang boleh dijadikan rujukan klaim. */
export type FaktaResmi = {
  locationId: string;
  metric: Metrik;
  value: number;
  /** Tanggal berlakunya angka ini (YYYY-MM-DD) — bukan "sekarang". */
  periodKey: string;
  sourceRefId: string;
};

/** Kunci pencarian fakta: satu angka per (lokasi, metrik). */
export function kunciFakta(locationId: string, metric: string): string {
  return `${locationId}|${metric}`;
}

export const klaimSchema = z.object({
  locationId: z.string(),
  metric: z.enum(NAMA_METRIK as [Metrik, ...Metrik[]]),
  value: z.number(),
  periodKey: z.string().max(20),
  sourceRefId: z.string(),
});
export type Klaim = z.infer<typeof klaimSchema>;

/* ── Kutipan narasi lapangan (DECISIONS 382) ─────────────────────────── */

export const kutipanSchema = z.object({
  /** Id potongan yang dikutip — harus dari daftar yang benar-benar ditemukan. */
  chunkId: z.string(),
  /** Teks APA ADANYA dari potongan itu. Parafrase ditolak. */
  teks: z.string().min(3).max(500),
});
export type Kutipan = z.infer<typeof kutipanSchema>;

export const askOutputSchema = z.object({
  answer: z.string().min(5).max(4000),
  /**
   * Jawaban dipecah menjadi bagian-bagian, masing-masing membawa klaimnya
   * sendiri. Bagian yang klaimnya tidak tervalidasi DIBUANG — bukan sekadar
   * ditandai — sesuai PROJECT.md §5a.
   */
  answerParts: z
    .array(
      z.object({
        text: z.string().min(1).max(800),
        claims: z.array(klaimSchema).max(8),
        /** Kutipan VERBATIM catatan lapangan (DECISIONS 382). */
        kutipan: z.array(kutipanSchema).max(4).default([]),
        /** Sumber kualitatif yang menopang bagian tanpa klaim angka/kutipan. */
        sourceRefIds: z.array(z.string()).max(8).default([]),
      }),
    )
    .max(12)
    .default([]),
  citations: z.array(z.object({ sourceRefId: z.string(), note: z.string().max(200).nullable() })).max(12),
  /**
   * Diisi model, tapi SELALU ditimpa angka deterministik sesudah validasi
   * (`hitungKeyakinan`). Dibiarkan di skema supaya keluaran model yang lama
   * tetap lolos parse.
   */
  confidence: z.number().int().min(0).max(100),
  limitations: z.array(z.string().max(300)).max(6),
});
export type AskOutput = z.infer<typeof askOutputSchema>;

/**
 * Fakta resmi TERIKAT (lokasi, metrik) → nilai + periode + sumbernya
 * (DECISIONS 378).
 *
 * Beda dari `officialNumbersByLocation` yang cuma daftar angka: di sini setiap
 * angka tahu ia metrik apa, berlaku kapan, dan bisa diperiksa di mana. Itulah
 * yang membuat klaim bisa diikat kelima-limanya sekaligus — dan yang membuat
 * hitungan (jumlah laporan, jumlah kendala) ikut bisa divalidasi, padahal jalur
 * regex lama hanya menangkap "%"/"pp".
 *
 * `periodKey` diambil dari akhir periode run, sama dengan `asOf` yang dipakai
 * `buildPortfolioPulse` — jadi angka lampau tidak pernah divalidasi seolah
 * angka hari ini.
 */
export function faktaResmi(pulse: PortfolioPulse): Map<string, FaktaResmi> {
  const out = new Map<string, FaktaResmi>();
  const periodKey = pulse.periodEnd;
  for (const r of pulse.rows) {
    const tambah = (metric: Metrik, value: number, sourceRefId: string) =>
      out.set(kunciFakta(r.locationId, metric), {
        locationId: r.locationId,
        metric,
        value,
        periodKey,
        sourceRefId,
      });
    const progres = `${r.slug}:progress`;
    tambah("rencana", r.planPct, progres);
    tambah("realisasi", r.actualPct, progres);
    tambah("deviasi", r.deviationPp, progres);
    tambah("kesiapan", r.readiness.score, progres);
    const laporan = `${r.slug}:laporan`;
    tambah("laporan_final", r.finalReports, laporan);
    tambah("laporan_diharapkan", r.expectedReports, laporan);
    const kendala = `${r.slug}:kendala`;
    tambah("kendala_terbuka", r.openIssues, kendala);
    tambah("kendala_kritis", r.criticalIssues, kendala);
    // Fakta rencana hanya didaftarkan bila pekannya memang bernomor; `null`
    // berarti lokasi ini belum punya kontrak/baseline, dan mengarang nol di
    // situ akan membuat model menyatakan "tidak ada yang direncanakan" untuk
    // lokasi yang memang belum boleh merencanakan apa pun.
    if (r.plannedItemsThisWeek != null) {
      tambah("rencana_item_pekan_ini", r.plannedItemsThisWeek, `${r.slug}:rencana`);
    }
    if (r.unfinishedLastWeek != null) {
      tambah("komitmen_belum_tuntas", r.unfinishedLastWeek, `${r.slug}:rencana`);
    }
  }
  return out;
}

/* ── Kutipan narasi lapangan (DECISIONS 382, Fase F2) ─────────────────── */

export type BagianJawaban = { text: string; claims: Klaim[]; kutipan?: Kutipan[]; sourceRefIds?: string[] };

/** Samakan spasi supaya kutipan tidak gagal hanya karena baris baru. */
function ratakan(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Setiap ANGKA yang muncul di sebuah teks — bukan hanya persen.
 *
 * `extractNumericClaims` sengaja sempit: ia hanya menangkap "%"/"pp" karena
 * dibuat untuk klaim metrik. Catatan lapangan menulis angka tanpa satuan itu —
 * *"cor 12 m3, tenaga 8 orang"* — jadi memakai penyaring lama di jalur narasi
 * berarti seluruh angka lapangan lolos tanpa pernah diperiksa.
 */
export function semuaAngka(teks: string): number[] {
  /*
   * Dibandingkan sebagai NILAI, bukan sebagai teks.
   *
   * Uang ditulis dalam bentuk Indonesia — "Rp 5.000.000.000" — sementara
   * calculation layer menyimpan 5000000000. Membandingkan teksnya membuat klaim
   * uang yang BENAR ditolak, lalu keyakinannya jatuh ke 0: pagar yang menghukum
   * jawaban yang tepat. Terukur: uji klaim nilai kontrak merah karenanya.
   *
   * Titik = pemisah ribuan, koma = desimal (konvensi yang dipakai seluruh
   * pemformat MARLIN).
   *
   * Lookbehind `(?<![\p{L}])` mencegah angka yang menempel huruf ikut terbaca:
   * tanpa itu "m3" menyumbang angka 3 yang tidak pernah ditulis siapa pun, dan
   * bagian yang sah ikut dibuang.
   */
  return [...teks.matchAll(/(?<![\p{L}])\d[\d.]*(?:,\d+)?/gu)]
    .map((m) => Number(m[0].replace(/\.+$/, "").replace(/\./g, "").replace(",", ".")))
    .filter((n) => Number.isFinite(n));
}

export type HasilValidasiKutipan = {
  sah: Kutipan[];
  dibuang: string[];
};

/**
 * Kutipan harus VERBATIM — diperiksa sebagai potongan teks aslinya
 * (DECISIONS 382).
 *
 * Inilah pagar anti-karangan yang bisa diuji, bukan imbauan di prompt. Model
 * boleh menyampaikan angka yang MEMANG tertulis di catatan lapangan — itu angka
 * MARLIN, bukan karangan — tapi hanya dengan menyalinnya apa adanya. Begitu ia
 * menyusun ulang kalimatnya, tidak ada lagi cara otomatis membedakan angka yang
 * benar-benar ditulis pelapor dari angka yang dikarang model.
 *
 * Perbandingannya meratakan spasi dan huruf besar-kecil saja. Lebih longgar
 * dari itu (mis. mengabaikan tanda baca) akan membuat "12" dan "1,2" bisa
 * saling lolos.
 */
export function validasiKutipan(
  kutipan: Kutipan[],
  potongan: ReadonlyMap<string, string>,
): HasilValidasiKutipan {
  const sah: Kutipan[] = [];
  const dibuang: string[] = [];
  for (const k of kutipan) {
    const asli = potongan.get(k.chunkId);
    if (asli == null) {
      dibuang.push(`kutipan menunjuk catatan yang tidak ada: ${k.chunkId}`);
      continue;
    }
    if (!ratakan(asli).includes(ratakan(k.teks))) {
      dibuang.push(`kutipan bukan salinan persis dari ${k.chunkId}`);
      continue;
    }
    sah.push(k);
  }
  return { sah, dibuang };
}

/**
 * Angka pada satu bagian yang TIDAK bisa dipertanggungjawabkan.
 *
 * Sebuah angka boleh muncul bila ia berasal dari salah satu dari dua sumber
 * yang keduanya milik MARLIN sendiri:
 *
 *   1. klaim metrik yang lolos validasi (calculation layer, DECISIONS 378), atau
 *   2. kutipan VERBATIM dari catatan lapangan (DECISIONS 382).
 *
 * Selain itu ia karangan — dan itulah satu-satunya hal yang dilarang tanpa
 * toleransi (penegasan user 2026-08-19). Yang dikembalikan adalah angka-angka
 * yang tak tertutup keduanya.
 */
export function angkaTakBersumber(
  bagian: BagianJawaban,
  klaimSah: readonly Klaim[],
  kutipanSah: readonly Kutipan[],
): number[] {
  const boleh = [
    ...kutipanSah.flatMap((k) => semuaAngka(k.teks)),
    ...klaimSah.map((k) => k.value),
  ];
  /*
   * Toleransi kecil untuk pembulatan tampilan: calculation layer menghasilkan
   * 42.499 sementara balasan menulis "42,5". Uang tetap ketat karena nilainya
   * besar — selisih 0,05 pada rupiah tidak mungkin lolos sebagai angka lain.
   */
  return semuaAngka(bagian.text).filter((a) => !boleh.some((b) => Math.abs(a - b) <= 0.05));
}

export type HasilValidasiKlaim = {
  hidup: BagianJawaban[];
  dibuang: string[];
  /** Jumlah klaim yang benar-benar cocok fakta resmi — dasar keyakinan. */
  klaimValid: number;
};

/**
 * Validasi klaim TERIKAT: lokasi + metrik + nilai + periode + sourceRef
 * (DECISIONS 378).
 *
 * Kelima-limanya harus cocok pada SATU fakta resmi yang sama. Mengendurkan
 * salah satunya membuat sisanya nyaris tak berarti:
 *
 * - tanpa **lokasi**, angka lokasi lain memvalidasi klaim lokasi ini;
 * - tanpa **metrik**, "realisasi 42%" lolos karena rencananya 42%;
 * - tanpa **periode**, angka hari ini memvalidasi klaim tentang bulan lalu;
 * - tanpa **sourceRef**, pembaca tidak punya jalan memeriksanya sendiri.
 *
 * Bagian yang MENYEBUT ANGKA tapi tidak membawa klaim juga dibuang. Tanpa
 * aturan itu, model cukup berhenti mengisi `claims` dan seluruh validasi ini
 * menjadi hiasan.
 */
export function validasiKlaimTerikat(
  parts: BagianJawaban[],
  fakta: ReadonlyMap<string, FaktaResmi>,
  allowedSourceRefIds: ReadonlySet<string>,
  /** Teks potongan narasi per `chunkId` — untuk memeriksa kutipan verbatim. */
  potongan: ReadonlyMap<string, string> = new Map(),
): HasilValidasiKlaim {
  const dibuang: string[] = [];
  const hidup: BagianJawaban[] = [];
  let klaimValid = 0;

  for (const part of parts) {
    const alasan: string[] = [];
    const klaimSah: Klaim[] = [];
    const referensiSah = (part.sourceRefIds ?? []).filter((id) => allowedSourceRefIds.has(id));
    if (referensiSah.length !== (part.sourceRefIds ?? []).length) {
      alasan.push("bagian menunjuk sumber yang tidak tersedia");
    }

    for (const k of part.claims) {
      const f = fakta.get(kunciFakta(k.locationId, k.metric));
      if (!f) {
        alasan.push(`metrik "${k.metric}" tidak tersedia untuk lokasi itu`);
        continue;
      }
      if (!allowedSourceRefIds.has(k.sourceRefId) || k.sourceRefId !== f.sourceRefId) {
        alasan.push(`sumber "${k.sourceRefId}" bukan sumber angka itu`);
        continue;
      }
      if (k.periodKey !== f.periodKey) {
        alasan.push(`periode "${k.periodKey}" ≠ periode angka resmi (${f.periodKey})`);
        continue;
      }
      if (Math.abs(k.value - f.value) > METRIK[k.metric].toleransi) {
        alasan.push(`nilai ${k.value} ≠ ${f.value} (${k.metric})`);
        continue;
      }
      klaimValid += 1;
      klaimSah.push(k);
    }

    /*
     * KUTIPAN diperiksa verbatim (DECISIONS 382). Kutipan yang tidak sah
     * membatalkan bagiannya: menyodorkan tanda kutip di sekeliling kalimat yang
     * tidak pernah ditulis siapa pun lebih buruk daripada tidak mengutip.
     */
    const hasilKutipan = validasiKutipan(part.kutipan ?? [], potongan);
    if (hasilKutipan.dibuang.length > 0) alasan.push(hasilKutipan.dibuang[0]);
    klaimValid += hasilKutipan.sah.length;

    // Bagian kualitatif tetap harus dapat ditelusuri. Sebelumnya kalimat tanpa
    // angka dapat lolos tanpa satu sumber pun, sehingga "grounded" hanya benar
    // untuk angka dan bukan untuk kesimpulan operasionalnya.
    klaimValid += referensiSah.length;

    /*
     * ANGKA yang tidak berasal dari calculation layer MAUPUN dari kutipan
     * verbatim = karangan, dan itu satu-satunya hal yang dilarang tanpa
     * toleransi (penegasan user 2026-08-19).
     *
     * Pemeriksaannya kini menjangkau SEMUA angka, bukan hanya persen: catatan
     * lapangan menulis "cor 12 m3" tanpa satuan persen, dan penyaring lama
     * meloloskan seluruhnya tanpa pernah memeriksa.
     */
    const liar = angkaTakBersumber(part, klaimSah, hasilKutipan.sah);
    if (liar.length > 0) {
      alasan.push(`angka tanpa sumber: ${liar.slice(0, 3).join(", ")}`);
    }
    if (klaimSah.length === 0 && hasilKutipan.sah.length === 0 && referensiSah.length === 0) {
      alasan.push("bagian tidak memiliki sumber yang dapat diperiksa");
    }

    if (alasan.length > 0) {
      dibuang.push(`bagian dibuang – ${alasan[0]}`);
      continue;
    }
    hidup.push(part);
  }
  return { hidup, dibuang, klaimValid };
}

/**
 * Keyakinan DETERMINISTIK — dihitung, bukan diakui sendiri oleh model
 * (DECISIONS 378).
 *
 * Angka `confidence` dari model tidak pernah punya arti yang bisa diperiksa:
 * ia keluaran dari hal yang sama yang sedang kita ragukan. Yang dipakai di sini
 * hanya hasil validasi:
 *
 * - **0 bila tidak ada satu pun klaim yang valid** — syarat keras brief butir
 *   26. Jawaban tanpa sitasi yang sah tidak boleh tampil "80% yakin".
 * - selebihnya = porsi bagian yang selamat.
 */
export function hitungKeyakinan(hasil: HasilValidasiKlaim, totalBagian: number): number {
  if (hasil.klaimValid === 0) return 0;
  if (totalBagian === 0) return 0;
  return Math.round((hasil.hidup.length / totalBagian) * 100);
}

/* ── Validasi grounding (pasca-skema) ──────────────────────────────────── */

export type GroundingContext = {
  allowedLocationIds: ReadonlySet<string>;
  allowedSourceRefIds: ReadonlySet<string>;
  /** Angka resmi per lokasi (plan/actual/deviasi/readiness/…) utk validasi klaim. */
  officialNumbersByLocation: ReadonlyMap<string, readonly number[]>;
};

/** Ekstrak klaim angka "penting" dari teks: berpola persen/pp (mis. "12,5%", "−90,2 pp"). */
export function extractNumericClaims(text: string): number[] {
  const out: number[] = [];
  // Normalisasi tanda minus tipografis (U+2212) → ASCII agar ikut tertangkap.
  const norm = text.replace(/−/g, "-");
  const re = /(-?\d+(?:[.,]\d+)?)\s*(?:%|pp\b|poin persen)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(norm)) !== null) {
    const v = Number(m[1].replace(",", "."));
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

/**
 * Klaim angka valid bila tiap angka cocok (±0.6) dengan salah satu angka resmi,
 * TERMASUK TANDANYA (audit 2026-07-27, B10): versi lama membandingkan
 * `Math.abs` kedua sisi, sehingga klaim "+12,5 pp" lolos padahal angka resminya
 * −12,5 pp — narasi terdistribusi WA membalik makna deviasi.
 *
 * Klaim yang ditulis TANPA tanda ("deviasi 12,5 pp") tetap boleh cocok dengan
 * angka resmi negatif — gaya bahasa umum ("tertinggal 12,5 pp"); yang DILARANG
 * hanyalah tanda yang tegas-tegas BERLAWANAN (klaim "+" utk resmi "−" atau
 * sebaliknya).
 */
export function numericClaimsValid(text: string, official: readonly number[]): boolean {
  const claims = extractNumericClaims(text);
  return claims.every((c) =>
    official.some((o) => {
      if (Math.abs(Math.abs(c) - Math.abs(o)) > 0.6) return false;
      // Tanda eksplisit berlawanan = tolak; klaim tak bertanda (≥0 ditulis polos)
      // dibiarkan cocok dgn resmi negatif.
      if (c < 0 && o > 0.6) return false;
      return true;
    }),
  );
}

export type GroundingReport = { dropped: string[] };

/**
 * Saring bagian output yang tidak tergrounding: lokasi di luar scope, sourceRef
 * tak dikenal, atau klaim angka tanpa sumber. Mutasi-out immutable — kembalikan
 * salinan + daftar alasan yang dibuang (jadi limitations).
 */
export function filterGrounded<
  T extends { locationId?: string | null; sourceRefIds?: string[]; reason?: string; explanation?: string; aiRationale?: string },
>(items: T[], ctx: GroundingContext): { kept: T[]; report: GroundingReport } {
  const dropped: string[] = [];
  const kept = items.filter((it) => {
    if (it.locationId != null && !ctx.allowedLocationIds.has(it.locationId)) {
      dropped.push(`lokasi di luar scope (${it.locationId}) dibuang`);
      return false;
    }
    if (it.sourceRefIds && !it.sourceRefIds.every((r) => ctx.allowedSourceRefIds.has(r))) {
      dropped.push("bagian dengan sourceRef tidak dikenal dibuang");
      return false;
    }
    const text = it.reason ?? it.explanation ?? it.aiRationale ?? "";
    if (text && it.locationId != null) {
      const official = ctx.officialNumbersByLocation.get(it.locationId) ?? [];
      if (!numericClaimsValid(text, official)) {
        dropped.push(`klaim angka tanpa sumber utk lokasi ${it.locationId} dibuang`);
        return false;
      }
    }
    return true;
  });
  return { kept, report: { dropped } };
}

/** Hint skema ringkas untuk prompt (dibaca model, bukan zod dump). */
export const SCHEMA_HINTS = {
  pulse: `{
  "summary": string,                       // ringkasan situasi (Bahasa Indonesia)
  "overallStatus": "normal"|"perhatian"|"kritis"|"data_kurang",
  "confidence": number 0-100,
  "priorityLocations": [{ "locationId": string (HARUS dari daftar scope), "severity": "sedang"|"tinggi"|"kritis", "reason": string, "sourceRefIds": [string dari daftar sumber] }],
  "actionsToConsider": [{ "locationId": string|null, "title": string, "reason": string, "proposedRole": string|null, "sourceRefIds": [string] }],
  "whatChanged": string|null,
  "limitations": [string]
}`,
  variance: `{
  "summary": string,
  "confidence": number 0-100,
  "locations": [{ "locationId": string, "dataConfidence": "rendah"|"sedang"|"tinggi",
    "confirmedDrivers": [{ "category": "fisik"|"material"|"cuaca"|"sdm"|"perizinan"|"data"|"keuangan"|"lainnya", "explanation": string, "impact": "rendah"|"sedang"|"besar", "confidence": number, "sourceRefIds": [string] }],
    "suspectedDrivers": [sama seperti confirmedDrivers],
    "requiredValidations": [{ "action": string, "sourceRefIds": [string] }] }],
  "limitations": [string]
}`,
  risk: `{
  "summary": string, "confidence": number 0-100,
  "rationales": [{ "locationId": string, "category": "schedule"|"data_quality"|"compliance"|"cost", "aiRationale": string, "sourceRefIds": [string] }],
  "limitations": [string]
}`,
  quality: `{
  "summary": string, "confidence": number 0-100,
  "explanations": [{ "locationId": string, "findingKey": string, "explanation": string, "sourceRefIds": [string] }],
  "limitations": [string]
}`,
  kronologi: `{
  "summary": string,                       // satu paragraf: cerita lokasi ini dari awal jendela sampai hari ini
  "confidence": number 0-100,
  "babak": [{ "locationId": string (HARUS dari daftar scope), "judul": string, "periode": string (mis. "1–24 Agu 2026"), "reason": string (apa yang terjadi di babak ini dan artinya), "sourceRefIds": [string dari daftar sumber] }],
  "kondisiTerkini": string,                // keadaan HARI INI; pakai angka yang SUDAH ada di DATA, jangan menghitung sendiri
  "limitations": [string]
}`,
  report: `{
  "title": string,
  "executiveSummary": string (maksimal 3 kalimat: kondisi, penyebab utama, keputusan/fokus),
  "executiveSummarySourceRefIds": [string dari daftar sumber],
  "overallStatus": "normal"|"perhatian"|"kritis"|"data_kurang",
  "confidence": number 0-100,
  "sections": [{ "heading": string, "body": string, "locationId": string|null, "sourceRefIds": [string dari daftar sumber] }],
  "recommendations": [{ "title": string, "reason": string, "locationId": string|null, "sourceRefIds": [string dari daftar sumber] }],
  "waSummary": string (maksimal 3 kalimat, siap dibaca pimpinan di WhatsApp, tanpa markdown),
  "waSummarySourceRefIds": [string dari daftar sumber],
  "limitations": [string]
}`,
  ask: `{
  "answer": string (Bahasa Indonesia, langsung ke inti),
  "answerParts": [{
    "text": string (satu bagian jawaban, boleh 1-3 kalimat),
    "kutipan": [{ "chunkId": string dari daftar CATATAN LAPANGAN, "teks": string SALINAN PERSIS }],
    "sourceRefIds": [string dari daftar sumber yang menopang bagian ini],
    "claims": [{
      "locationId": string (dari daftar scope),
      "metric": ${NAMA_METRIK.map((metric) => `"${metric}"`).join("|")},
      "value": number (PERSIS seperti angka resmi yang kamu kutip),
      "periodKey": string (tanggal berlaku angka itu, YYYY-MM-DD, dari daftar sumber),
      "sourceRefId": string (sumber angka itu)
    }]
  }],
  "citations": [{ "sourceRefId": string dari daftar sumber, "note": string|null }],
  "confidence": number 0-100,
  "limitations": [string]
}
ATURAN KERAS: setiap bagian wajib membawa claims, kutipan, atau sourceRefIds yang sah; setiap bagian yang MENYEBUT ANGKA wajib membawa claims/kutipan angkanya.
Bagian yang menyebut angka tanpa claims akan DIBUANG dan tidak sampai ke penanya.`,
} as const;
