import type { WeekSegment } from "@/lib/scurve/generate";
import { allocateRounded } from "@/lib/round-alloc";
import { bobotPct } from "@/lib/progress-calc";

/**
 * RINCIAN TIME SCHEDULE sampai level ITEM — penyusun barisnya, MURNI (tanpa db,
 * tanpa Excel), supaya aturannya bisa diuji langsung.
 *
 * ### Yang fakta dan yang WARISAN — dan kenapa dibedakan keras di sini
 *
 * Permintaan user 2026-08-15: unduhan kurva-S hanya sampai kategori, perlu
 * rincian sampai item.
 *
 * **Bobot per item adalah FAKTA**: RAB menyimpan volume, harga satuan, dan
 * jumlah tiap item, jadi porsinya terhadap nilai pekerjaan bisa dihitung tepat.
 *
 * **Waktu per item TIDAK ADA di sistem.** Baseline menyimpan matriks mingguan
 * berkunci lineageKey KATEGORI (`BaselineScheduleItem`), dan
 * `autoCategorySchedule` menyebutnya sendiri: "jadwal per-KATEGORI … bukan
 * tahap absolut per-item". Tidak ada satu pun tempat yang menyatakan "item X
 * dikerjakan minggu 5–8".
 *
 * Karena itu kolom waktu di sini adalah jadwal KATEGORI INDUK, diwarisi apa
 * adanya dan DISEBUT demikian — bukan sebaran per item yang dikarang lalu
 * dicetak sebagai rencana resmi (keputusan user: "bobot rinci + waktu diwarisi
 * kategori"). Menyebarkannya proporsional ke tiap item memang bisa dan hasilnya
 * tetap berjumlah 100%, tapi ia menyelundupkan asumsi bahwa semua item dalam
 * satu kategori bergerak dengan laju yang sama — padahal galian selesai duluan
 * dan finishing belakangan. DECISIONS 316.
 */

/** Simpul RAB seadanya — hanya yang dipakai penyusun baris. */
export type SimpulRab = {
  id: string;
  parentId: string | null;
  kind: "kategori" | "sub" | "grup" | "item";
  code: string;
  name: string;
  volume: number | null;
  unit: string | null;
  unitPrice: number | null;
  /** Rupiah. */
  amount: number;
  lineageKey: string;
};

/** Jadwal satu kategori (dari baseline aktif atau derivasi otomatis). */
export type JadwalKategori = { lineageKey: string; segments: WeekSegment[] };

export type BarisRincian = {
  /** 0 = kategori, 1 = sub, 2 = grup, 3 = item. Menentukan indentasi & tebal. */
  level: number;
  kind: SimpulRab["kind"];
  code: string;
  name: string;
  volume: number | null;
  unit: string | null;
  unitPrice: number | null;
  amount: number;
  /** Porsi terhadap nilai pekerjaan (%) — FAKTA, dari RAB. */
  bobotPct: number;
  /** Kategori induk (untuk kolom keterangan). Kategori sendiri = namanya. */
  kategori: string;
  /** lineageKey kategori induk — kunci penyebaran mingguan. */
  kategoriKey: string | null;
  /** WARISAN dari kategori induk — bukan jadwal item ini sendiri. */
  segments: WeekSegment[];
  /** "M5–M12" / "M5–M8, M11–M14" / "—" bila kategorinya belum dijadwalkan. */
  jadwal: string;
};

const LEVEL: Record<SimpulRab["kind"], number> = { kategori: 0, sub: 1, grup: 2, item: 3 };

/**
 * Label rentang minggu. Jeda ditulis sebagai segmen terpisah — kalau digabung
 * jadi "M5–M14", pembaca akan mengira minggu 9–10 dikerjakan padahal jadwalnya
 * memang kosong di situ.
 */
export function labelJadwal(segments: WeekSegment[]): string {
  if (segments.length === 0) return "–";
  return segments
    .map((s) => (s.startWeek === s.endWeek ? `M${s.startWeek}` : `M${s.startWeek}–M${s.endWeek}`))
    .join(", ");
}

/**
 * Susun baris rincian mengikuti urutan pohon RAB (kategori → sub → grup →
 * item), tiap baris membawa bobotnya sendiri dan jadwal kategori induknya.
 *
 * `nodes` HARUS sudah urut sesuai `sortOrder` — urutan itulah yang membuat
 * berkasnya terbaca seperti RAB aslinya, dan mengurutkan ulang di sini akan
 * memisahkan item dari sub-nya.
 *
 * `grandTotal` sengaja DITERIMA, bukan dihitung dari `nodes`: pembagi resmi
 * bobot adalah Σ kategori pada revisi aktif (lihat `lib/progress.ts`).
 * Menjumlahkan semua simpul akan menghitung ganda (kategori + anaknya), dan
 * menjumlahkan item saja bisa meleset dari total kategori karena pembulatan.
 */
export function susunRincian(
  nodes: SimpulRab[],
  grandTotal: number,
  jadwal: JadwalKategori[],
): BarisRincian[] {
  if (nodes.length === 0 || grandTotal <= 0) return [];

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const segByKategori = new Map(jadwal.map((j) => [j.lineageKey, j.segments]));

  /** Naik ke atas sampai ketemu simpul berjenis kategori. */
  const kategoriDari = (n: SimpulRab): SimpulRab | null => {
    let cur: SimpulRab | undefined = n;
    // Batas iterasi = jumlah simpul: data pohon yang rusak (parent melingkar)
    // tidak boleh menggantungkan permintaan unduh.
    for (let i = 0; cur && i <= nodes.length; i++) {
      if (cur.kind === "kategori") return cur;
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return null;
  };

  return nodes.map((n) => {
    const kat = kategoriDari(n);
    const segments = kat ? (segByKategori.get(kat.lineageKey) ?? []) : [];
    return {
      level: LEVEL[n.kind],
      kind: n.kind,
      code: n.code,
      name: n.name,
      volume: n.volume,
      unit: n.unit,
      unitPrice: n.unitPrice,
      amount: n.amount,
      // Formula bobot dari calculation layer, bukan diketik ulang di sini
      // (audit 2026-08-28, I-2).
      bobotPct: bobotPct(n.amount, grandTotal),
      kategori: kat?.name ?? "–",
      kategoriKey: kat?.lineageKey ?? null,
      segments,
      jadwal: labelJadwal(segments),
    };
  });
}

/**
 * Angka penutup untuk baris TOTAL sekaligus penjaga: Σ bobot KATEGORI harus
 * 100%. Baris sub/grup/item sengaja tidak ikut dijumlah — mereka anak dari
 * kategori, menjumlahkan semuanya akan menghasilkan 200%+.
 */
export function totalBobotKategori(rows: BarisRincian[]): number {
  return rows.filter((r) => r.kind === "kategori").reduce((s, r) => s + r.bobotPct, 0);
}

/** Nilai total dari baris kategori — pasangan `totalBobotKategori` untuk kolom Jumlah. */
export function totalNilaiKategori(rows: BarisRincian[]): number {
  return rows.filter((r) => r.kind === "kategori").reduce((s, r) => s + r.amount, 0);
}

/** Desimal sel mingguan — sama dengan kolom bobot pada berkas acuan. */
export const DESIMAL_MINGGU = 4;

/**
 * Sebarkan bobot tiap ITEM ke kolom minggu, mengikuti profil mingguan KATEGORI
 * induknya dan sebanding nilainya.
 *
 * ### Yang dijamin, dan kenapa itu yang membuat sebaran ini boleh ada
 *
 * Σ seluruh item dalam satu kategori pada minggu w = **persis** profil mingguan
 * kategori itu — dijaga `allocateRounded`, bukan sekadar dibulatkan
 * sendiri-sendiri. Akibatnya baris RENCANA di kaki berkas, yang di Excel berupa
 * `=SUM(kolom item)`, menghasilkan kurva-S RESMI yang sama persis dengan
 * baseline MARLIN. Rinciannya baru; angka yang dipertanggungjawabkan tidak
 * berubah sedikit pun.
 *
 * ### Yang TIDAK dijamin — dan wajib disebut di berkasnya
 *
 * Sebaran DI DALAM satu kategori adalah TURUNAN, bukan rencana yang disusun
 * orang: tiap item dianggap bergerak sebanding nilainya sepanjang jendela
 * kategorinya. Kenyataannya galian selesai duluan dan finishing belakangan.
 * Sistem tidak menyimpan jadwal per item (baseline berkunci kategori), jadi
 * ini satu-satunya sebaran yang bisa diturunkan tanpa mengarang urutan kerja.
 * DECISIONS 316.
 *
 * Pembaginya = Σ item DI BAWAH kategori itu, bukan nilai kategorinya: keduanya
 * biasanya sama, tapi kalau RAB punya selisih pembulatan, memakai nilai
 * kategori membuat kolomnya tidak pas.
 */
export function sebarMingguan(
  rows: BarisRincian[],
  weeklyKategori: Map<string, number[]>,
  totalWeeks: number,
): number[][] {
  const n = Math.max(0, Math.floor(totalWeeks));
  const kosong = (): number[] => new Array<number>(n).fill(0);
  const hasil: number[][] = rows.map(() => kosong());
  if (n === 0) return hasil;

  const perKategori = new Map<string, number[]>();
  rows.forEach((r, i) => {
    if (r.kind !== "item" || !r.kategoriKey) return;
    const arr = perKategori.get(r.kategoriKey) ?? [];
    arr.push(i);
    perKategori.set(r.kategoriKey, arr);
  });

  const skala = 10 ** DESIMAL_MINGGU;
  for (const [key, idxs] of perKategori) {
    const profil = weeklyKategori.get(key);
    if (!profil) continue;
    const nilai = idxs.map((i) => rows[i].amount);
    const jumlahNilai = nilai.reduce((s, v) => s + v, 0);
    if (jumlahNilai <= 0) continue;

    for (let w = 0; w < n; w++) {
      const target = profil[w] ?? 0;
      if (target <= 0) continue; // jeda tetap kosong
      const mentah = nilai.map((v) => (target * v) / jumlahNilai);
      const dibagi = allocateRounded(mentah, target, skala);
      idxs.forEach((rowIdx, k) => {
        hasil[rowIdx][w] = dibagi[k];
      });
    }
  }
  return hasil;
}
