import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui";
import { formatTanggal } from "@/lib/format";
import { selHari } from "@/lib/daily-report/hari-ini-ringkas";
import { geserHari, tetanggaHari } from "@/lib/daily-report/hari-sekitar";
import type { RecentDay } from "@/lib/daily-report/queries";

const tgl = (k: string) => new Date(`${k}T00:00:00Z`);

/**
 * Nama hari disembunyikan di layar sempit: dua tombol berbagi ±170px, dan yang
 * tidak boleh terpotong adalah tanggalnya.
 */
function Tanggal({ k }: { k: string }) {
  return (
    <span className="truncate">
      <span className="hidden sm:inline">{formatTanggal(tgl(k), "EEE")}, </span>
      {formatTanggal(tgl(k), "d MMM")}
    </span>
  );
}

/**
 * Tombol ke hari sebelum dan sesudah, sekali klik, di kepala laporan harian.
 *
 * Keluhan user 2026-10-08: *"tidak ada kontrol navigasi hari ke hari, terlalu
 * banyak klik, harus kembali ke list kalender, buka lagi satu-satu. saya butuh
 * untuk lihat hari selanjutnya … dalam sekali klik"*.
 *
 * Tiap tombol menyebut STATUS hari tujuannya dengan kata (Final, Draft,
 * Belum, …), bukan hanya warna – supaya orang tahu apa yang akan dibuka
 * sebelum menekannya. Hari yang belum terjadi tidak bisa dibuka: tombolnya
 * tetap ada tapi mati, supaya letak tombol tidak melompat-lompat.
 */
export function PindahHari({
  slug,
  dateKey,
  todayKey,
  hari,
}: {
  slug: string;
  dateKey: string;
  todayKey: string;
  /** Hari sekitar tanggal ini, berikut status laporannya. */
  hari: RecentDay[];
}) {
  const { sebelum, sesudah } = tetanggaHari(dateKey, todayKey);
  const label = (k: string) => formatTanggal(tgl(k), "EEEE, d MMMM");
  const kata = (k: string) => selHari(k, hari.find((h) => h.dateKey === k)?.status ?? null, "").kata;

  return (
    <nav aria-label="Pindah ke hari lain" className="grid grid-cols-2 gap-2">
      <ButtonLink
        href={`/lokasi/${slug}/harian/${sebelum}`}
        variant="secondary"
        size="sm"
        className="justify-start"
        title={`Buka laporan ${label(sebelum)}`}
      >
        <ChevronLeft aria-hidden className="size-4 shrink-0" />
        <Tanggal k={sebelum} />
        <span className="font-normal text-ink-muted">· {kata(sebelum)}</span>
      </ButtonLink>
      {sesudah ? (
        <ButtonLink
          href={`/lokasi/${slug}/harian/${sesudah}`}
          variant="secondary"
          size="sm"
          className="justify-end"
          title={`Buka laporan ${label(sesudah)}`}
        >
          <Tanggal k={sesudah} />
          <span className="font-normal text-ink-muted">· {kata(sesudah)}</span>
          <ChevronRight aria-hidden className="size-4 shrink-0" />
        </ButtonLink>
      ) : (
        <Button type="button" variant="secondary" size="sm" disabled className="justify-end">
          <Tanggal k={geserHari(dateKey, 1)} />
          <span className="font-normal">· belum terjadi</span>
          <ChevronRight aria-hidden className="size-4 shrink-0" />
        </Button>
      )}
    </nav>
  );
}
