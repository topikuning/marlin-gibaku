import { CircleAlert, CircleCheck, CircleDashed, Download, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui";
import { formatTanggal, formatTanggalWaktu } from "@/lib/format";
import type { BarisHarian } from "@/lib/laporan/riwayat-queries";
import { AksiHarian } from "./aksi-harian";

/**
 * SATU BARIS LAPORAN HARIAN FINAL (DECISIONS 406).
 *
 * Urutan isinya mengikuti apa yang ditanyakan orang, bukan urutan kolom di
 * basis data. User 2026-08-21: *"pada laporan harian informasi yang diutamakan
 * adalah apakah sudah diupload ke drive atau ke whatsap."* Karena itu keadaan
 * Drive dan WhatsApp berdiri sendiri sebagai lencana yang terbaca sekali lirik,
 * bukan lagi keterangan kecil yang harus dibuka dari dalam menu satu per satu.
 *
 * "Belum" ditandai WARNING, bukan abu-abu netral. Laporan final yang tidak
 * pernah sampai ke Drive maupun grup adalah pekerjaan yang tidak terhitung oleh
 * yang memeriksa – itu keadaan yang perlu dikerjakan, bukan sekadar keterangan.
 * Di lokasi yang tertib, tidak ada satu pun lencana oranye yang muncul.
 */

function Keping({
  tone,
  icon,
  children,
}: {
  tone: "success" | "warning" | "danger";
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Badge tone={tone} className="gap-1">
      {icon}
      {children}
    </Badge>
  );
}

export function BarisLaporanHarian({
  r,
  slug,
  hasGroup,
  hasDrive,
  wahaOn,
  driveOn,
  bolehBukaDrive,
}: {
  r: BarisHarian;
  slug: string;
  hasGroup: boolean;
  hasDrive: boolean;
  wahaOn: boolean;
  driveOn: boolean;
  /** `gdrive.open_folder` – hanya super admin (lihat authz.ts). */
  bolehBukaDrive: boolean;
}) {
  return (
    /*
     * Lebar kolom TETAP, bukan `auto` (DECISIONS 406).
     *
     * Tiap baris adalah grid-nya SENDIRI, jadi kolom `minmax(11rem,auto)`
     * membuat tiap baris memilih lebarnya masing-masing: "Minggu, 26 Jul 2026"
     * lebih pendek daripada "Kamis, 20 Agt 2026", jadi kepingan status baris
     * kedua mulai di titik yang berbeda dari baris pertama. Dari kursi pembaca
     * itu terlihat seperti kolom yang bergoyang – keluhan user 2026-08-22:
     * *"tata letak teksmu amburadul di desktop"*.
     *
     * Kolom aksi dibiarkan `auto` DAN rata kanan: ujung kanannya sama untuk
     * semua baris, jadi yang terlihat tetap lurus meski isinya berbeda lebar.
     */
    <li className="grid gap-x-6 gap-y-2 py-3 xl:grid-cols-[11rem_minmax(0,1fr)_auto] xl:items-start">
      <p className="text-sm font-medium text-ink xl:pt-px">
        {formatTanggal(r.reportDate, "EEEE, d MMM yyyy")}
      </p>

      <div className="min-w-0 space-y-1.5">
        {/* Ringkasan dan riwayat SATU kolom (mengikuti rancangan): keterangan
            "N item · final …" milik laporannya, bukan milik tanggalnya. */}
        <p className="text-[12px] text-ink-muted">
          {r.jumlahItem} item
          {r.difinalkan ? (
            <>
              {" · final "}
              {formatTanggalWaktu(r.difinalkan.pada)}
              {r.difinalkan.oleh ? ` · ${r.difinalkan.oleh}` : ""}
            </>
          ) : null}
        </p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          {r.drive ? (
            <Keping tone="success" icon={<CircleCheck aria-hidden className="size-3.5" />}>
              Drive · {r.drive.berkas} berkas · {formatTanggalWaktu(r.drive.pada)}
            </Keping>
          ) : (
            <Keping tone="warning" icon={<CircleDashed aria-hidden className="size-3.5" />}>
              Belum ke Drive
            </Keping>
          )}
          {r.driveGagal ? (
            <Keping tone="danger" icon={<CircleAlert aria-hidden className="size-3.5" />}>
              Upload terakhir gagal {formatTanggalWaktu(r.driveGagal.pada)}
            </Keping>
          ) : null}
          {r.wa ? (
            <Keping tone="success" icon={<CircleCheck aria-hidden className="size-3.5" />}>
              WhatsApp · {formatTanggalWaktu(r.wa.pada)}
              {r.wa.oleh ? ` · ${r.wa.oleh}` : ""}
            </Keping>
          ) : (
            <Keping tone="warning" icon={<CircleDashed aria-hidden className="size-3.5" />}>
              Belum ke WhatsApp
            </Keping>
          )}
          {/* Hanya muncul kalau ADA catatannya – lihat catatan di riwayat-harian.ts:
              "0x" untuk yang tidak pernah dihitung adalah kebohongan yang rapi. */}
          {r.unduh ? (
            <span className="inline-flex items-center gap-1 text-[12px] text-ink-muted">
              <Download aria-hidden className="size-3.5" />
              PDF diunduh {r.unduh.jumlah}x · terakhir {formatTanggalWaktu(r.unduh.pada)}
            </span>
          ) : null}
          {/*
            "Lihat di Drive" HANYA untuk super admin (permintaan user 2026-08-22).

            Aturannya di `authz.ts` sebagai capability `gdrive.open_folder`, BUKAN
            `role === "super_admin"` yang diketik di komponen: perbandingan peran
            yang berserakan di layar persis yang membuat matriks izin tidak lagi
            bisa dipercaya sebagai jawaban tunggal "siapa boleh apa".

            Alasannya: tautan itu membuka folder Drive milik vendor, di luar
            MARLIN – di seberangnya tidak ada lagi pembatasan lokasi yang berlaku
            di aplikasi ini. Untuk orang lapangan ia juga tidak menambah apa pun:
            keadaan "sudah ke Drive" sudah terbaca dari lencana di sebelahnya.
          */}
          {bolehBukaDrive && r.drive?.tautan ? (
            <a
              href={r.drive.tautan}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline"
            >
              <ExternalLink aria-hidden className="size-3.5" />
              Lihat di Drive
            </a>
          ) : null}
        </div>
      </div>

      <div className="xl:justify-self-end">
        <AksiHarian
          slug={slug}
          dateKey={r.dateKey}
          hasGroup={hasGroup}
          hasDrive={hasDrive}
          wahaOn={wahaOn}
          driveOn={driveOn}
          sudahWa={!!r.wa}
          sudahDrive={!!r.drive}
        />
      </div>
    </li>
  );
}
