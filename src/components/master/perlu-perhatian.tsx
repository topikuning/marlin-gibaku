import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * BILAH "PERLU PERHATIAN" — masalah data yang bisa ditindak, di atas daftarnya
 * (DECISIONS 359).
 *
 * Diadopsi dari rancangan user 2026-08-18 untuk Master Data. Bedanya dengan
 * `Banner`: banner menyampaikan SATU kabar, bilah ini menyusun beberapa temuan
 * berdampingan dengan bobot yang berbeda — dan tiap temuan membawa jalan
 * keluarnya sendiri.
 *
 * ### Angka SELALU dengan penyebutnya
 *
 * "12 profil belum lengkap" tanpa "dari 19" tidak bisa dinilai: dua belas dari
 * tiga belas dan dua belas dari dua ratus menuntut tindakan yang sangat
 * berbeda. Karena itu `dari` wajib diisi setiap kali angkanya adalah bagian
 * dari sesuatu.
 *
 * ### Nada BUKAN satu-satunya pembawa arti
 *
 * Warna hanya menegaskan; yang membedakan tetap kata-katanya. Lapangan memakai
 * HP murah di bawah matahari, dan buta warna merah-hijau ada pada ±8% laki-laki
 * (aturan yang sama dengan `StatusPill` dan kalender harian).
 */

export type NadaPerhatian = "netral" | "peringatan" | "bahaya";

const NADA: Record<NadaPerhatian, string> = {
  netral: "border-border bg-surface",
  peringatan: "border-warning-border bg-warning-soft",
  bahaya: "border-danger-border bg-danger-soft",
};

export type TemuanMaster = {
  /** Kalimat masalahnya — apa yang salah, bukan nama metriknya. */
  judul: string;
  /** Akibatnya bagi pekerjaan, supaya bisa diprioritaskan. */
  keterangan: string;
  nada?: NadaPerhatian;
  /** Tindakan yang menyelesaikannya. Temuan tanpa jalan keluar hanya keluhan. */
  aksi?: ReactNode;
};

export function PerluPerhatian({
  temuan,
  judul = "Perlu perhatian",
  keterangan = "Prioritas data yang bisa menimbulkan masalah operasional.",
  aksi,
}: {
  temuan: TemuanMaster[];
  judul?: string;
  keterangan?: string;
  aksi?: ReactNode;
}) {
  // Tidak ada temuan = tidak ada bilah. Kotak kosong berbunyi "semuanya beres"
  // setiap hari, dan yang selalu hijau berhenti dibaca.
  if (temuan.length === 0) return null;

  return (
    <section
      aria-label={judul}
      className="rounded-lg border border-border bg-surface p-3 shadow-xs"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[13px] font-semibold text-ink">{judul}</p>
          <p className="mt-0.5 text-[11px] text-ink-muted">{keterangan}</p>
        </div>
        {aksi}
      </div>

      <ul className="mt-2.5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {temuan.map((t) => (
          <li
            key={t.judul}
            className={cn("rounded-md border p-2.5", NADA[t.nada ?? "netral"])}
          >
            <p className="text-[11px] font-semibold text-ink">{t.judul}</p>
            <p className="mt-0.5 text-[10px] leading-snug text-ink-muted">{t.keterangan}</p>
            {t.aksi ? <div className="mt-2">{t.aksi}</div> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
