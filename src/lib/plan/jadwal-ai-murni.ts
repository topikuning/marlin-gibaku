/**
 * ANALISA AI URUTAN PELAKSANAAN RAB – bagian MURNI (DECISIONS 667).
 *
 * Permintaan user 2026-10-11: *"marlin langsung kirim rab ke AI, untuk
 * dianalisa secara real time dan maksimal, untuk kemudian bisa dijadikan dasar
 * saran rencana pekerjaan mingguan"*.
 *
 * AI diminta STRUKTUR, bukan angka resmi: urutan pekerjaan di dalam satu
 * bangunan, prasyarat antar-pekerjaan, porsi waktu tiap pekerjaan di jendela
 * bangunannya, mana yang kritis dan mana yang peka cuaca. Volume target, bobot,
 * dan progres tetap dihitung kode (suggest-core + calculation layer).
 */
import { z } from "zod";

/** Satu permintaan AI memuat paling banyak sekian pekerjaan – jawaban tetap utuh. */
export const ITEM_PER_BAGIAN = 70;
/** Jendela pekerjaan paling sempit, sebagai porsi jendela bangunan. */
const SPAN_MIN = 0.05;
const PRASYARAT_MAKS = 6;

export type PekerjaanRab = {
  lineageKey: string;
  code: string;
  name: string;
  unit: string | null;
  volume: number;
  /** Nama sub-kelompok di dalam bangunan ("STRUKTUR › Kolom"), untuk konteks. */
  jalur: string;
};

export type KelompokRab = {
  kategoriKey: string;
  nama: string;
  bagian: number;
  /** Pekerjaan yang dianalisa di bagian ini. */
  item: PekerjaanRab[];
  /** Semua pekerjaan bangunan ini – rujukan prasyarat lintas bagian. */
  semua: PekerjaanRab[];
};

/** Bangunan besar dipecah per `ITEM_PER_BAGIAN` pekerjaan, urutan dokumen tetap. */
export function bagiKelompok(
  kategori: { lineageKey: string; name: string }[],
  item: PekerjaanRab[],
): KelompokRab[] {
  const out: KelompokRab[] = [];
  const urut = [...kategori].sort((a, b) => b.lineageKey.length - a.lineageKey.length);
  const milik = new Map<string, PekerjaanRab[]>();
  for (const it of item) {
    const k = urut.find((c) => it.lineageKey === c.lineageKey || it.lineageKey.startsWith(`${c.lineageKey}#`));
    if (!k) continue;
    const arr = milik.get(k.lineageKey) ?? [];
    arr.push(it);
    milik.set(k.lineageKey, arr);
  }
  for (const k of kategori) {
    const semua = milik.get(k.lineageKey) ?? [];
    for (let i = 0; i < semua.length; i += ITEM_PER_BAGIAN) {
      out.push({
        kategoriKey: k.lineageKey,
        nama: k.name,
        bagian: i / ITEM_PER_BAGIAN + 1,
        item: semua.slice(i, i + ITEM_PER_BAGIAN),
        semua,
      });
    }
  }
  return out;
}

export const hasilKelompokAiSchema = z.object({
  catatan: z.string().max(1200).optional().default(""),
  item: z
    .array(
      z.object({
        kunci: z.string().min(1).max(300),
        mulai: z.number(),
        selesai: z.number(),
        prasyarat: z.array(z.string().max(300)).max(20).optional().default([]),
        kritis: z.boolean().optional().default(false),
        cuaca: z.boolean().optional().default(false),
        alasan: z.string().max(400).optional().default(""),
      }),
    )
    .max(400),
});
export type HasilKelompokAi = z.infer<typeof hasilKelompokAiSchema>;

export const SKEMA_HINT_JADWAL =
  '{"catatan":"strategi pelaksanaan bangunan ini, maks 600 karakter","item":[{"kunci":"II#A#1","mulai":0.1,"selesai":0.35,"prasyarat":["II#A#0"],"kritis":true,"cuaca":false,"alasan":"maks 160 karakter"}]}';

export type JadwalAiItem = {
  /** Porsi jendela bangunan (0..1). */
  mulai: number;
  selesai: number;
  prasyarat: string[];
  kritis: boolean;
  cuaca: boolean;
  alasan: string;
};

export type KelompokTernormal = { catatan: string; item: Record<string, JadwalAiItem> };

const jepit = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const pendek = (s: string, n: number) => s.replace(/\s+/g, " ").trim().slice(0, n);

/**
 * Saring jawaban AI: hanya kunci pekerjaan bagian ini, porsi waktu dijepit ke
 * 0..1 dengan rentang minimum, prasyarat hanya kunci yang ADA di revisi ini.
 * Yang tidak lolos dibuang diam-diam di sini dan dihitung di `dibuang` –
 * pekerjaannya kembali memakai aturan bawaan, bukan tebakan.
 */
export function normalisasiKelompok(
  kelompok: KelompokRab,
  semuaKunci: Set<string>,
  raw: HasilKelompokAi,
): KelompokTernormal & { dibuang: number } {
  const milik = new Set(kelompok.item.map((i) => i.lineageKey));
  const item: Record<string, JadwalAiItem> = {};
  let dibuang = 0;
  for (const r of raw.item) {
    if (!milik.has(r.kunci) || item[r.kunci]) {
      dibuang++;
      continue;
    }
    let mulai = jepit(r.mulai);
    let selesai = jepit(r.selesai);
    if (selesai < mulai) [mulai, selesai] = [selesai, mulai];
    if (selesai - mulai < SPAN_MIN) {
      selesai = Math.min(1, mulai + SPAN_MIN);
      mulai = Math.max(0, selesai - SPAN_MIN);
    }
    const prasyarat = [...new Set(r.prasyarat)].filter((k) => k !== r.kunci && semuaKunci.has(k)).slice(0, PRASYARAT_MAKS);
    item[r.kunci] = {
      mulai: Math.round(mulai * 1000) / 1000,
      selesai: Math.round(selesai * 1000) / 1000,
      prasyarat,
      kritis: r.kritis,
      cuaca: r.cuaca,
      alasan: pendek(r.alasan, 160),
    };
  }
  return { catatan: pendek(raw.catatan, 600), item, dibuang };
}

/**
 * Gabungkan hasil semua bagian, lalu putus prasyarat yang membentuk lingkaran
 * (A menunggu B, B menunggu A) – lingkaran membuat keduanya tidak pernah
 * disarankan. Sisi yang membentuk lingkaran dibuang, urutan masuknya dipakai.
 */
export function petaJadwalAi(bagian: KelompokTernormal[]): Map<string, JadwalAiItem> {
  const peta = new Map<string, JadwalAiItem>();
  for (const b of bagian) for (const [k, v] of Object.entries(b.item)) peta.set(k, { ...v, prasyarat: [...v.prasyarat] });

  const sampai = (dari: string, ke: string, lihat = new Set<string>()): boolean => {
    if (dari === ke) return true;
    if (lihat.has(dari)) return false;
    lihat.add(dari);
    return (peta.get(dari)?.prasyarat ?? []).some((p) => sampai(p, ke, lihat));
  };
  // Sisi diterima satu per satu menurut urutan masuk; yang ditolak hanya sisi
  // yang menutup lingkaran dengan sisi yang SUDAH diterima.
  const calon = new Map([...peta].map(([k, v]) => [k, v.prasyarat]));
  for (const v of peta.values()) v.prasyarat = [];
  for (const [k, ps] of calon) {
    // k menunggu p. Bila p (lewat prasyaratnya) sudah menunggu k → lingkaran.
    for (const p of ps) if (!sampai(p, k)) peta.get(k)!.prasyarat.push(p);
  }
  return peta;
}

export type KonteksLokasi = { lokasi: string; kabupaten: string; provinsi: string; mingguKontrak: number };

/** Isi permintaan untuk satu bagian bangunan. */
export function promptKelompok(k: KelompokRab, ctx: KonteksLokasi, total: number): string {
  const baris = (i: PekerjaanRab) =>
    `${i.lineageKey} | ${i.code} | ${i.name} | ${i.jalur || "-"} | ${i.volume} ${i.unit ?? ""}`.trim();
  return [
    `Lokasi proyek: ${ctx.lokasi}, ${ctx.kabupaten}, ${ctx.provinsi}, Indonesia – Kampung Nelayan (bangunan dan prasarana pesisir).`,
    `Masa pelaksanaan kontrak: ${ctx.mingguKontrak} minggu.`,
    `BANGUNAN: ${k.nama}${total > 1 ? ` (bagian ${k.bagian} dari ${total})` : ""}.`,
    "",
    "Tugas: susun URUTAN PELAKSANAAN pekerjaan bangunan ini seperti jadwal pelaksana yang berpengalaman.",
    "- mulai/selesai = porsi waktu di dalam jendela bangunan ini (0 = awal jendela, 1 = akhir), bukan minggu kalender.",
    "- prasyarat = kunci pekerjaan yang harus HAMPIR SELESAI sebelum pekerjaan ini bisa mulai (mis. bekisting & besi sebelum cor; pondasi sebelum sloof). Hanya ketergantungan fisik yang nyata – jangan semua pekerjaan dirantai.",
    "- Pekerjaan yang bisa jalan bersamaan dibuat tumpang-tindih waktunya.",
    "- kritis = keterlambatannya menunda bangunan ini selesai.",
    "- cuaca = peka hujan/pasang (galian, cor, pengecatan luar, pekerjaan di air).",
    "- Isi SETIAP pekerjaan di DAFTAR YANG DIANALISA dengan kunci PERSIS seperti tertulis.",
    `- Pakai hanya kunci yang ada di daftar. JANGAN MENGARANG pekerjaan, kunci, volume, atau harga. Hasil ini BUKAN angka resmi – hanya dasar saran rencana mingguan yang diperiksa orang.`,
    "",
    "DAFTAR YANG DIANALISA (kunci | kode | uraian | sub-kelompok | volume satuan):",
    ...k.item.map(baris),
    ...(k.semua.length > k.item.length
      ? [
          "",
          "PEKERJAAN LAIN DI BANGUNAN INI (boleh dirujuk sebagai prasyarat, tidak perlu dianalisa):",
          ...k.semua.filter((s) => !k.item.includes(s)).map((s) => `${s.lineageKey} | ${s.name}`),
        ]
      : []),
  ].join("\n");
}
