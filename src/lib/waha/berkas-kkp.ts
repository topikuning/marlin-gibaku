import { totalWeeksBetween, weekDateRange, weekOfDate, type WeekPeriodMode } from "@/lib/progress-calc";
import { mintaRekapHarian } from "./parser-niat";
import type { Niat } from "./tanya-niat";
import { formatKey, type PeriodeDiminta, type PeriodeTerbaca } from "./tanya-tanggal";

/**
 * BERKAS KKP PER LOKASI DARI TANYA MARLIN (DECISIONS 752) – aturan murni.
 *
 * Permintaan user 2026-11-09: di grup, "laporan hari ini" mengirim blanko KKP
 * satu berkas per lokasi; "laporan hari ini <lokasi>" hanya lokasi itu;
 * "laporan mingguan" mengirim laporan mingguan KKP; "rekap harian seminggu"
 * mengirim berkas KKP rekap laporan harian satu minggu.
 *
 * Berkasnya SAMA dengan yang diunduh dari web dan diunggah ke Drive – tidak ada
 * renderer baru di sini. Yang diputuskan modul ini hanya: permintaan mana yang
 * menjadi berkas, minggu kontrak yang mana, dan kalimat pembukanya.
 */

export type JenisBerkasKkp = "harian" | "mingguan" | "rekap_harian";

/**
 * Paling banyak sekian berkas sekali minta. Antrean jawaban menganggap
 * pekerjaan yang berjalan > 10 menit sudah mati lalu MENGULANGNYA (DECISIONS
 * 635) – grup akan menerima berkas yang sama dua kali. Batas ini plus tenggat
 * waktu di pengirimnya menjaga satu jawaban jauh di bawah itu.
 */
export const BATAS_BERKAS_KKP = 15;

/** Artefak yang BUKAN blanko harian/mingguan – tetap jalur produksi lama. */
const POLA_ARTEFAK_LAIN =
  /\b(eksekutif|excel|xls\w*|paparan\w*|presentasi\w*|slide\w*|deck\w*|grafik\w*|kurva\w*|bulanan|dashboard|dasbor)\b/;
/** Bentuk ringkas yang DIMINTA – dokumen bacaan MARLIN, bukan blanko KKP. */
const POLA_RINGKAS = /\b(ringkas\w*|versi marlin)\b/;

/**
 * Permintaan ini menjadi berkas KKP yang mana – `null` = jalur lama.
 *
 * Di GRUP: laporan harian dan mingguan menjadi berkas KKP. Di chat pribadi
 * keduanya tetap teks seperti sebelumnya – permintaan user menyebut grup.
 * `rekap_harian` selalu berkas, di kanal mana pun: tidak ada bentuk teks untuk
 * kumpulan tujuh laporan harian.
 *
 * `produksi` ("kirim laporan hari ini") ikut dibaca karena di grup kata
 * kerjanya tidak mengubah apa yang diminta. Artefak lain (eksekutif, Excel,
 * kurva, bulanan) tetap jalur produksi – mengirim blanko harian untuk
 * "buatkan laporan eksekutif" mengulang cacat audit 2026-08-28 dalam bentuk
 * berkas.
 */
export function jenisBerkasKkp(niat: Niat, teksMentah: string, grup: boolean): JenisBerkasKkp | null {
  if (niat === "rekap_harian") return "rekap_harian";
  if (!grup) return null;
  if (niat !== "laporan" && niat !== "laporan_mingguan" && niat !== "produksi") return null;
  const t = teksMentah.toLowerCase();
  // "kkp" didahulukan, sama dengan `bacaBentukDokumen`.
  if (!/\bkkp\b/.test(t) && POLA_RINGKAS.test(t)) return null;
  if (niat === "laporan") return "harian";
  if (niat === "laporan_mingguan") return "mingguan";
  if (mintaRekapHarian(t)) return "rekap_harian";
  if (POLA_ARTEFAK_LAIN.test(t)) return null;
  if (/\b(mingguan|pekan\w*)\b/.test(t)) return "mingguan";
  if (/\b(laporan\w*|lapor\w*|harian|blanko)\b/.test(t)) return "harian";
  return null;
}

export type KontrakMinggu = { startDate: Date | null; endDate: Date | null; weekMode: WeekPeriodMode };
export type MingguKkp = { n: number; mulai: string; akhir: string; berjalan: boolean };

const keKey = (d: Date) => d.toISOString().slice(0, 10);
const keTanggal = (k: string) => new Date(`${k}T00:00:00.000Z`);

/**
 * Minggu KONTRAK yang diminta – dihitung dari SPMK dan mode minggu kontrak.
 *
 * "Minggu lalu" = minggu kontrak SEBELUM minggu berjalan, bukan minggu kontrak
 * yang memuat akhir pekan kalender lalu: pada minggu Jumat–Kamis, Minggu
 * kemarin masih jatuh di minggu kontrak yang sedang berjalan. Tanggal yang
 * disebut → minggu kontrak yang memuat tanggal itu.
 *
 * Tanpa SPMK, sebelum SPMK, atau sesudah masa kontrak → sebab, bukan nomor
 * minggu karangan.
 */
export function mingguKkpDiminta(
  k: KontrakMinggu,
  diminta: PeriodeDiminta,
  terbaca: PeriodeTerbaca,
  hariIniKey: string,
): MingguKkp | { sebab: string } {
  if (!k.startDate) return { sebab: "kontraknya belum punya tanggal SPMK" };
  let n: number;
  if (diminta.jenis === "rentang" && diminta.satuan === "minggu") {
    const kini = weekOfDate(k.startDate, keTanggal(hariIniKey), k.weekMode);
    n = kini === 0 ? 0 : kini - diminta.mundur;
  } else {
    const acuan = terbaca.akhir > hariIniKey ? hariIniKey : terbaca.akhir;
    n = weekOfDate(k.startDate, keTanggal(acuan), k.weekMode);
  }
  if (n < 1) return { sebab: `pekerjaannya belum mulai pada minggu itu (SPMK ${formatKey(keKey(k.startDate))})` };
  if (k.endDate) {
    const total = totalWeeksBetween(k.startDate, k.endDate, k.weekMode);
    if (n > total) return { sebab: `masa kontrak hanya ${total} minggu` };
  }
  const r = weekDateRange(k.startDate, n, k.weekMode);
  const mulai = keKey(r.start);
  const akhir = keKey(r.end);
  return { n, mulai, akhir, berjalan: hariIniKey <= akhir };
}

export type RencanaBerkas =
  | { lokasiId: string; nama: string; kirim: true; keterangan: string; minggu?: MingguKkp }
  | {
      lokasiId: string;
      nama: string;
      kirim: false;
      sebab: string;
      /** Pengelompokan kalimat pembuka. */
      kelompok: "belum_dikirim" | "belum_ada" | "lain";
    };

type Dikirim = Extract<RencanaBerkas, { kirim: true }>;
type Dilewati = Extract<RencanaBerkas, { kirim: false }>;

/** Bagi rencana: yang dikirim (maks `BATAS_BERKAS_KKP`), kelebihannya, yang dilewati. */
export function bagiBatasBerkas(rencana: readonly RencanaBerkas[]): {
  dikirim: Dikirim[];
  kelebihan: Dikirim[];
  dilewati: Dilewati[];
} {
  const kirim = rencana.filter((r): r is Dikirim => r.kirim);
  return {
    dikirim: kirim.slice(0, BATAS_BERKAS_KKP),
    kelebihan: kirim.slice(BATAS_BERKAS_KKP),
    dilewati: rencana.filter((r): r is Dilewati => !r.kirim),
  };
}

/** "9 – 15 November 2026", "30 Oktober – 5 November 2026". */
export function sebutRentang(mulai: string, akhir: string): string {
  const [ym, mm, dm] = mulai.split("-");
  const [ya, ma] = akhir.split("-");
  if (ym === ya && mm === ma) return `${Number(dm)} – ${formatKey(akhir)}`;
  if (ym === ya) return `${formatKey(mulai).replace(/ \d{4}$/, "")} – ${formatKey(akhir)}`;
  return `${formatKey(mulai)} – ${formatKey(akhir)}`;
}

const sebutMinggu = (m: MingguKkp) => `minggu ke-${m.n} (${sebutRentang(m.mulai, m.akhir)})`;

/** "A", "A dan B", "A, B, dan C". */
function sebutDaftar(xs: readonly string[]): string {
  if (xs.length <= 1) return xs.join("");
  if (xs.length === 2) return `${xs[0]} dan ${xs[1]}`;
  return `${xs.slice(0, -1).join(", ")}, dan ${xs[xs.length - 1]}`;
}

/**
 * Lokasi tanpa berkas, DIKELOMPOKKAN per sebab – lima lokasi dengan sebab yang
 * sama cukup satu kalimat, bukan lima kali kalimat yang sama.
 */
function barisTanpaBerkas(dilewati: readonly Dilewati[]): string[] {
  const perSebab = new Map<string, string[]>();
  for (const d of dilewati) perSebab.set(d.sebab, [...(perSebab.get(d.sebab) ?? []), d.nama]);
  if (perSebab.size === 0) return [];
  if (perSebab.size === 1) {
    const [[sebab, nama]] = [...perSebab];
    return [`Tidak ada berkas untuk ${sebutDaftar(nama)}: ${sebab}.`];
  }
  return ["Tidak ada berkas:", ...[...perSebab].map(([sebab, nama]) => `• ${sebutDaftar(nama)}: ${sebab}`)];
}

const JUDUL: Record<JenisBerkasKkp, string> = {
  harian: "Laporan harian KKP",
  mingguan: "Laporan mingguan KKP",
  rekap_harian: "Rekap laporan harian KKP",
};

/**
 * Kalimat pembuka yang dikirim SEBELUM berkas-berkasnya.
 *
 * Yang tidak dikirim selalu DISEBUT beserta sebabnya – grup PPK yang menerima
 * dua berkas dari lima lokasi harus tahu tiga sisanya belum lapor, bukan
 * mengira hanya dua lokasi yang ada (CLAUDE.md: "tidak muncul" ≠ "tidak ada").
 */
export function kepalaBerkasKkp(a: {
  jenis: JenisBerkasKkp;
  /** Tanggal laporan harian (jenis `harian`). */
  tanggalKey: string;
  dikirim: readonly Dikirim[];
  dilewati: readonly Dilewati[];
  kelebihan: readonly Dikirim[];
  catatan: string | null;
}): string {
  const baris: string[] = [];
  const nama = (xs: readonly { nama: string }[]) => sebutDaftar(xs.map((x) => x.nama));
  const minggu = a.dikirim.map((d) => d.minggu).filter((m): m is MingguKkp => !!m);
  const mingguSama =
    minggu.length > 0 && minggu.length === a.dikirim.length && minggu.every((m) => m.n === minggu[0].n && m.mulai === minggu[0].mulai);

  if (a.jenis === "harian") {
    baris.push(`*${JUDUL.harian} – ${formatKey(a.tanggalKey)}*`);
  } else if (mingguSama) {
    baris.push(`*${JUDUL[a.jenis]} – ${sebutMinggu(minggu[0])}*`);
  } else {
    baris.push(`*${JUDUL[a.jenis]}*`);
  }

  if (a.dikirim.length === 0) {
    baris.push(
      a.jenis === "harian"
        ? `Belum ada laporan harian yang dikirim pelapor untuk ${formatKey(a.tanggalKey)}, jadi belum ada berkas.`
        : "Tidak ada berkas yang bisa saya kirim.",
    );
  } else if (a.dikirim.length === 1) {
    baris.push(`Berkasnya menyusul: ${a.dikirim[0].nama}${!mingguSama && a.dikirim[0].minggu ? `, ${sebutMinggu(a.dikirim[0].minggu)}` : ""}.`);
  } else if (a.jenis === "harian" || mingguSama) {
    baris.push(`${a.dikirim.length} berkas menyusul, satu per lokasi: ${nama(a.dikirim)}.`);
  } else {
    baris.push(`${a.dikirim.length} berkas menyusul, satu per lokasi:`);
    for (const d of a.dikirim) baris.push(`• ${d.nama}${d.minggu ? ` – ${sebutMinggu(d.minggu)}` : ""}`);
  }

  const berjalan = a.dikirim.some((d) => d.minggu?.berjalan);
  if (a.jenis === "mingguan" && berjalan) baris.push("Minggu ini masih berjalan, jadi angkanya baru sampai hari ini.");
  if (a.jenis === "rekap_harian" && a.dikirim.length > 0) {
    baris.push(
      berjalan
        ? "Hanya laporan yang sudah dikirim pelapor yang dimuat. Hari lain, termasuk yang belum tiba, tercetak sebagai blanko kosong."
        : "Hanya laporan yang sudah dikirim pelapor yang dimuat. Hari lain tercetak sebagai blanko kosong.",
    );
  }

  if (a.jenis === "harian") {
    const belumDikirim = a.dilewati.filter((d) => d.kelompok === "belum_dikirim");
    const belumAda = a.dilewati.filter((d) => d.kelompok === "belum_ada");
    const lain = a.dilewati.filter((d) => d.kelompok === "lain");
    if (belumDikirim.length > 0) {
      baris.push(
        `Belum dikirim pelapor, jadi tidak saya kirim: ${sebutDaftar(belumDikirim.map((d) => `${d.nama} (${d.sebab})`))}.`,
      );
    }
    if (belumAda.length > 0) baris.push(`Belum ada laporan: ${nama(belumAda)}.`);
    baris.push(...barisTanpaBerkas(lain));
  } else {
    baris.push(...barisTanpaBerkas(a.dilewati));
  }

  if (a.kelebihan.length > 0) {
    baris.push(
      `${a.kelebihan.length} lokasi lain belum saya kirim karena paling banyak ${BATAS_BERKAS_KKP} berkas sekali minta: ${nama(a.kelebihan)}. Sebut nama lokasinya untuk menerimanya.`,
    );
  }
  if (a.catatan) baris.push(a.catatan);
  return baris.join("\n");
}
