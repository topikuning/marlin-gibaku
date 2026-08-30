import type {
  FieldActivityStatus,
  IssueSeverity,
  IssueSource,
  IssueStatus,
} from "@/generated/prisma/enums";

/**
 * KRONOLOGI LOKASI — garis waktu kendala + kegiatan lapangan, plus kondisi
 * terkininya. Permintaan user 2026-08-31.
 *
 * Berkas ini MURNI: ia tidak menyentuh basis data dan tidak tahu apa pun
 * tentang WhatsApp maupun layar. Pengambilan datanya di `queries.ts`,
 * penulisan kalimatnya di pemanggil. Yang di sini cuma aturan — dan justru
 * aturannya yang mudah salah.
 *
 * ### Jendela waktu, dan yang TIDAK boleh dipotong olehnya
 *
 * Kronologi selalu dibatasi jendela (bawaan 90 hari), kalau tidak ia tumbuh
 * tanpa batas dan tidak terbaca di WhatsApp. Tapi ada satu golongan yang
 * jendela TIDAK boleh sentuh: **kendala yang masih terbuka**. Kendala yang
 * dibuka empat bulan lalu dan sampai hari ini belum selesai adalah kondisi
 * terkini yang paling menentukan; membuangnya karena "sudah lama" menghasilkan
 * kronologi yang tampak bersih justru saat lokasinya paling bermasalah.
 *
 * Aturan yang sama berlaku untuk PEMOTONGAN jumlah: yang dipotong hanya
 * peristiwa yang sudah lewat. Yang masih berjalan tidak pernah antre.
 *
 * ### Kenapa terbaru dulu
 *
 * Kronologi memang lazim dibaca maju dari yang tertua. Tapi kedua tempatnya
 * MEMOTONG dari bawah — WhatsApp memotong pesan panjang, layar dan kertas
 * memotong daftar panjang — jadi urutan tertua-dulu membuat yang pertama
 * hilang justru HARI INI. Yang dibaca lebih dulu haruslah yang paling
 * menentukan keputusan sekarang.
 */

export type KendalaMentah = {
  id: string;
  judul: string;
  rincian: string | null;
  tingkat: IssueSeverity;
  status: IssueStatus;
  /** Tanggal kendala dibuka, `YYYY-MM-DD`. */
  dibuka: string;
  /** Tanggal ditutup bila sudah, `YYYY-MM-DD`. */
  ditutup: string | null;
  catatanPenutup: string | null;
  sumber: IssueSource;
  pic: string | null;
  tenggat: string | null;
};

export type KegiatanMentah = {
  id: string;
  /** `YYYY-MM-DD`. */
  tanggal: string;
  /** Label jenis kegiatan — sudah diterjemahkan pemanggil dari master. */
  jenis: string;
  judul: string;
  catatan: string | null;
  kendala: string | null;
  solusi: string | null;
  peserta: string | null;
  status: FieldActivityStatus;
  jumlahFoto: number;
};

export type JenisPeristiwa = "kendala_dibuka" | "kendala_ditutup" | "kegiatan";

export type Peristiwa = {
  /** Stabil dan unik — dipakai sebagai kunci render dan penanda uji. */
  kunci: string;
  tanggal: string;
  jenis: JenisPeristiwa;
  judul: string;
  /** Keterangan tambahan, sudah dibersihkan dari yang kosong. */
  rincian: string[];
  /** Hanya untuk peristiwa kendala. */
  tingkat: IssueSeverity | null;
  /** Kendala: status kendalanya. Kegiatan: draft/final. */
  status: IssueStatus | FieldActivityStatus;
  /** Peristiwa ini masih berjalan — tidak boleh dipotong jendela maupun batas. */
  berjalan: boolean;
  lewatTenggat: boolean;
};

export type KondisiTerkini = {
  kendalaTerbuka: number;
  kendalaKritis: number;
  kendalaLewatTenggat: number;
  /** Umur kendala terbuka TERTUA dalam hari; null bila tidak ada yang terbuka. */
  kendalaTertuaHari: number | null;
  kendalaSelesaiDalamJendela: number;
  kegiatanDalamJendela: number;
  drafKegiatan: number;
  /** Tanggal kegiatan lapangan terakhir; null bila belum pernah ada. */
  kegiatanTerakhir: string | null;
  hariTanpaKegiatan: number | null;
};

export type Kronologi = {
  sampai: string;
  sejak: string;
  peristiwa: Peristiwa[];
  kondisi: KondisiTerkini;
  /** Berapa peristiwa lampau yang tidak ikut ditampilkan. */
  dipotong: number;
};

export type BahanKronologi = {
  sampai: string;
  /** Lebar jendela dalam hari (bawaan 90). */
  hari?: number;
  /** Cacah peristiwa maksimum yang ditampilkan (bawaan 60). */
  batas?: number;
  kendala: KendalaMentah[];
  kegiatan: KegiatanMentah[];
};

const HARI_MS = 86_400_000;

const keTanggal = (key: string): number => Date.parse(`${key}T00:00:00.000Z`);

/** Selisih hari `sampai - key`; negatif berarti key ada di masa depan. */
export function selisihHari(key: string, sampai: string): number {
  return Math.round((keTanggal(sampai) - keTanggal(key)) / HARI_MS);
}

export function geserHari(key: string, hari: number): string {
  return new Date(keTanggal(key) + hari * HARI_MS).toISOString().slice(0, 10);
}

const isi = (...baris: (string | null | undefined)[]): string[] =>
  baris.map((b) => (b ?? "").trim()).filter((b) => b.length > 0);

export function susunKronologi({
  sampai,
  hari = 90,
  batas = 60,
  kendala,
  kegiatan,
}: BahanKronologi): Kronologi {
  const sejak = geserHari(sampai, -hari);
  const dalamJendela = (key: string) => key >= sejak && key <= sampai;

  const semua: Peristiwa[] = [];

  for (const k of kendala) {
    const terbuka = k.status !== "selesai";
    const lewatTenggat = terbuka && k.tenggat !== null && k.tenggat < sampai;
    semua.push({
      kunci: `kendala:${k.id}:dibuka`,
      tanggal: k.dibuka,
      jenis: "kendala_dibuka",
      judul: k.judul,
      rincian: isi(
        k.rincian,
        k.pic ? `PIC ${k.pic}` : null,
        k.tenggat ? `tenggat ${k.tenggat}` : null,
      ),
      tingkat: k.tingkat,
      status: k.status,
      // Kendala yang belum selesai tetap berjalan HARI INI, berapa pun umurnya.
      berjalan: terbuka,
      lewatTenggat,
    });
    if (k.ditutup) {
      semua.push({
        kunci: `kendala:${k.id}:ditutup`,
        tanggal: k.ditutup,
        jenis: "kendala_ditutup",
        judul: k.judul,
        rincian: isi(k.catatanPenutup),
        tingkat: k.tingkat,
        status: k.status,
        berjalan: false,
        lewatTenggat: false,
      });
    }
  }

  for (const g of kegiatan) {
    semua.push({
      kunci: `kegiatan:${g.id}`,
      tanggal: g.tanggal,
      jenis: "kegiatan",
      judul: `${g.jenis}: ${g.judul}`,
      rincian: isi(
        g.catatan,
        g.kendala ? `Kendala: ${g.kendala}` : null,
        g.solusi ? `Solusi: ${g.solusi}` : null,
        g.peserta ? `Peserta: ${g.peserta}` : null,
        g.jumlahFoto > 0 ? `${g.jumlahFoto} foto` : null,
      ),
      tingkat: null,
      status: g.status,
      berjalan: false,
      lewatTenggat: false,
    });
  }

  /*
   * Urutan: terbaru dulu; pada tanggal yang sama, yang MASIH BERJALAN lebih
   * dulu. Kuncinya jadi pemutus terakhir supaya urutannya tidak pernah
   * bergantung pada urutan baris dari basis data.
   */
  semua.sort(
    (a, b) =>
      b.tanggal.localeCompare(a.tanggal) ||
      Number(b.berjalan) - Number(a.berjalan) ||
      a.kunci.localeCompare(b.kunci),
  );

  const layak = semua.filter((p) => p.berjalan || dalamJendela(p.tanggal));
  const tampil = layak.filter((p) => p.berjalan).length >= batas
    ? layak.filter((p) => p.berjalan)
    : [
        ...layak.slice(0, batas),
        // Yang berjalan tapi terlempar ke luar batas ditarik kembali masuk.
        ...layak.slice(batas).filter((p) => p.berjalan),
      ].sort(
        (a, b) =>
          b.tanggal.localeCompare(a.tanggal) ||
          Number(b.berjalan) - Number(a.berjalan) ||
          a.kunci.localeCompare(b.kunci),
      );

  const terbuka = kendala.filter((k) => k.status !== "selesai");
  const umur = terbuka.map((k) => selisihHari(k.dibuka, sampai));
  const kegiatanTerakhir =
    kegiatan.length === 0
      ? null
      : kegiatan.reduce((a, b) => (b.tanggal > a ? b.tanggal : a), kegiatan[0]!.tanggal);

  const kondisi: KondisiTerkini = {
    kendalaTerbuka: terbuka.length,
    kendalaKritis: terbuka.filter((k) => k.tingkat === "kritis").length,
    kendalaLewatTenggat: terbuka.filter((k) => k.tenggat !== null && k.tenggat < sampai).length,
    kendalaTertuaHari: umur.length === 0 ? null : Math.max(...umur),
    kendalaSelesaiDalamJendela: kendala.filter(
      (k) => k.ditutup !== null && dalamJendela(k.ditutup),
    ).length,
    kegiatanDalamJendela: kegiatan.filter((g) => dalamJendela(g.tanggal)).length,
    drafKegiatan: kegiatan.filter((g) => g.status === "draft" && dalamJendela(g.tanggal)).length,
    kegiatanTerakhir,
    hariTanpaKegiatan: kegiatanTerakhir === null ? null : selisihHari(kegiatanTerakhir, sampai),
  };

  return { sampai, sejak, peristiwa: tampil, kondisi, dipotong: semua.length - tampil.length };
}
