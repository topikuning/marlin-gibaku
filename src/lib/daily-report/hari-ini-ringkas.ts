import type { DailyReportStatus } from "@/generated/prisma/enums";
import type { HariIniLocation } from "./queries";

/**
 * Ringkasan halaman /hari-ini — MURNI, tanpa I/O dan tanpa React, supaya bisa
 * diuji langsung (DECISIONS 336).
 *
 * ### Dua pengguna, satu halaman
 *
 * Halaman ini dipakai dua orang yang kebutuhannya berlawanan:
 *
 * - **Mandor**: satu lokasi, di luar ruangan, sering gaptek. Yang ia butuh satu
 *   tombol besar — "lapor hari ini". Apa pun yang mengecilkan tombol itu
 *   memperburuk pekerjaannya.
 * - **Site Manager**: belasan lokasi. Yang ia butuh menjawab "siapa yang
 *   tertinggal" tanpa membuka satu per satu.
 *
 * Karena itu bentuk halaman ditentukan `banyakLokasi`, bukan peran: orang yang
 * lingkupnya satu lokasi mendapat tombol besar, yang lingkupnya banyak mendapat
 * strip + matriks. Peran bisa sama sementara lingkupnya berbeda.
 *
 * ### Status TIDAK PERNAH hanya warna
 *
 * Aturan yang sudah tertulis di `kkp-weekly-plan.tsx`: *"Semua penanda status
 * ditulis DENGAN KATA, tidak pernah warna saja."* Alasannya sama di layar:
 * lapangan memakai HP murah di bawah matahari, dan buta warna merah-hijau ada
 * pada ±8% laki-laki. Karena itu tiap sel hari membawa `kata` DAN `huruf`.
 */

/** Sel satu hari pada strip 7 hari. */
export type SelHari = {
  dateKey: string;
  /** null = belum ada laporan sama sekali. */
  status: DailyReportStatus | null;
  /** Kata pendek untuk sel (≤7 huruf) — dibaca, bukan ditebak dari warna. */
  kata: string;
  /** Huruf tunggal untuk matriks, sengaja TIDAK ada yang kembar. */
  huruf: string;
  /** Kalimat lengkap untuk tooltip & pembaca layar. */
  judul: string;
  nada: "success" | "info" | "warning" | "danger" | "neutral";
  /** Perlu tindakan pengguna. */
  perluTindakan: boolean;
};

/**
 * Kata & huruf per status.
 *
 * Hurufnya tidak boleh kembar — konsep yang diusulkan memakai "F" untuk Final
 * DAN "S" untuk Setuju sambil mewarnai keduanya sama, sehingga di matriks
 * keduanya tak terbedakan. Di sini: F/S/K/D/! masing-masing satu status, dan
 * "belum ada" memakai "—" yang jelas bukan huruf.
 */
const TAMPIL: Record<DailyReportStatus, Pick<SelHari, "kata" | "huruf" | "nada" | "perluTindakan">> = {
  final: { kata: "Final", huruf: "F", nada: "success", perluTindakan: false },
  disetujui: { kata: "Setuju", huruf: "S", nada: "success", perluTindakan: false },
  dikirim: { kata: "Kirim", huruf: "K", nada: "info", perluTindakan: false },
  draft: { kata: "Draft", huruf: "D", nada: "warning", perluTindakan: true },
  perlu_koreksi: { kata: "Koreksi", huruf: "!", nada: "danger", perluTindakan: true },
};

const KOSONG: Pick<SelHari, "kata" | "huruf" | "nada" | "perluTindakan"> = {
  kata: "Belum",
  huruf: "—",
  nada: "neutral",
  perluTindakan: true,
};

export function selHari(dateKey: string, status: DailyReportStatus | null, tanggalPanjang: string): SelHari {
  const t = status ? TAMPIL[status] : KOSONG;
  return {
    dateKey,
    status,
    ...t,
    judul: `${tanggalPanjang} — ${status ? TAMPIL[status].kata : "belum ada laporan"}`,
  };
}

/** Semua huruf matriks berbeda — dijamin di sini, bukan diandalkan pada penulisnya. */
export function hurufUnik(): boolean {
  const semua = [...Object.values(TAMPIL).map((t) => t.huruf), KOSONG.huruf];
  return new Set(semua).size === semua.length;
}

/* ------------------------------------------------------------------ */
/* Ringkasan lintas lokasi                                             */
/* ------------------------------------------------------------------ */

export type RingkasKepatuhan = {
  /** Jumlah sel hari yang diperiksa = lokasi × 7. PENYEBUT setiap angka lain. */
  totalSel: number;
  lokasi: number;
  perluKoreksi: number;
  belumAda: number;
  draft: number;
  dikirim: number;
  selesai: number;
  /** Lokasi yang butuh tindakan hari ini (koreksi / draft / belum ada). */
  lokasiPerluTindakan: number;
};

/**
 * Hitung ringkasan 7 hari lintas lokasi.
 *
 * **Selalu membawa penyebutnya.** Konsep yang diusulkan menulis "Final/Setuju
 * 51" tanpa menyebut dari berapa — 51 dari 84 dan 51 dari 51 adalah dua kabar
 * yang sangat berbeda, dan yang membaca tidak punya cara membedakannya. Aturan
 * yang sama sudah dipakai di RAPL (DECISIONS 327).
 */
export function ringkasKepatuhan(lokasi: HariIniLocation[]): RingkasKepatuhan {
  const r: RingkasKepatuhan = {
    totalSel: 0,
    lokasi: lokasi.length,
    perluKoreksi: 0,
    belumAda: 0,
    draft: 0,
    dikirim: 0,
    selesai: 0,
    lokasiPerluTindakan: 0,
  };
  for (const l of lokasi) {
    for (const d of l.last7Days) {
      r.totalSel += 1;
      if (d.status === null) r.belumAda += 1;
      else if (d.status === "perlu_koreksi") r.perluKoreksi += 1;
      else if (d.status === "draft") r.draft += 1;
      else if (d.status === "dikirim") r.dikirim += 1;
      else r.selesai += 1;
    }
    if (perluTindakan(l)) r.lokasiPerluTindakan += 1;
  }
  return r;
}

/**
 * Lokasi ini butuh tindakan hari ini?
 *
 * Sengaja TIDAK melihat seluruh 7 hari: hari kemarin yang kosong memang tidak
 * bisa diperbaiki lagi oleh mandor, dan menandainya "perlu tindakan" setiap
 * hari membuat penandanya kehilangan arti. Yang dihitung: koreksi yang
 * tertunda, dan keadaan HARI INI.
 */
export function perluTindakan(l: HariIniLocation): boolean {
  if (l.corrections.length > 0) return true;
  return l.todayStatus === null || l.todayStatus === "draft" || l.todayStatus === "perlu_koreksi";
}

/**
 * Urutkan: yang butuh tindakan lebih dulu, koreksi paling atas.
 *
 * Halaman ini dibuka untuk MENGERJAKAN sesuatu. Mengurutkan menurut nama
 * membuat lokasi yang bermasalah bisa terkubur di bawah sepuluh lokasi yang
 * sudah beres.
 */
export function urutkanLokasi(lokasi: HariIniLocation[]): HariIniLocation[] {
  const bobot = (l: HariIniLocation): number => {
    if (l.corrections.length > 0) return 0;
    if (l.todayStatus === "perlu_koreksi") return 1;
    if (l.todayStatus === null) return 2;
    if (l.todayStatus === "draft") return 3;
    return 4;
  };
  return [...lokasi].sort((a, b) => bobot(a) - bobot(b) || a.name.localeCompare(b.name, "id"));
}

/**
 * Kalimat pembuka: apa yang perlu dikerjakan hari ini.
 *
 * Dirakit dari cacah, bukan dikarang. Kosong (null) berarti memang tidak ada
 * yang perlu dikerjakan — dan itu TIDAK sama dengan "semuanya sempurna",
 * karena hari-hari kosong yang sudah lewat tetap dilaporkan terpisah.
 */
export function kalimatTindakan(lokasi: HariIniLocation[]): string | null {
  const koreksi = lokasi.reduce((s, l) => s + l.corrections.length, 0);
  const belum = lokasi.filter((l) => l.todayStatus === null).length;
  const draft = lokasi.filter((l) => l.todayStatus === "draft").length;

  const bagian = [
    koreksi > 0 ? `${koreksi} laporan perlu koreksi` : null,
    belum > 0 ? `${belum} lokasi belum ada laporan hari ini` : null,
    draft > 0 ? `${draft} lokasi masih draft` : null,
  ].filter(Boolean) as string[];

  return bagian.length === 0 ? null : bagian.join(" · ");
}
