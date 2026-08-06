import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Card, EmptyState, KpiCard, PageHeader } from "@/components/ui";
import { accessibleLocationIds, requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { getStatusHarian } from "@/lib/daily-report/status-harian";
import { formatTanggal, jakartaDateKey, parseDateKey } from "@/lib/format";
import { BarisStatus } from "./baris-status";

export const metadata: Metadata = { title: "Status Laporan Harian" };
export const dynamic = "force-dynamic";

/**
 * PAPAN STATUS LAPORAN HARIAN (DECISIONS 262).
 *
 * Permintaan user 2026-08-05: *"satu halaman khusus untuk melihat status
 * laporan harian (final/draft/pengajuan) dan apakah sudah diupload ke google
 * drive (beserta tombol google drive)."*
 *
 * Satu tanggal, semua lokasi yang boleh dilihat pengguna, dengan tindakannya
 * menempel di barisnya sendiri — bukan daftar yang cuma bisa dibaca lalu
 * memaksa pindah halaman untuk bertindak.
 */
export default async function StatusHarianPage({
  searchParams,
}: {
  searchParams: Promise<{ tanggal?: string }>;
}) {
  const user = await requireUser();
  requireCapabilityPage(user.role, "report.export");
  const scoped = await accessibleLocationIds(user);

  const { tanggal } = await searchParams;
  // Tanggal yang tidak dikenal TIDAK diam-diam diganti hari ini tanpa jejak —
  // ia jatuh ke hari ini DAN alamatnya ikut menunjukkan tanggal itu, sehingga
  // apa yang dibaca selalu cocok dengan apa yang tertulis di kolom tanggal.
  const dateKey = tanggal && parseDateKey(tanggal) ? tanggal : jakartaDateKey(new Date());
  const data = await getStatusHarian(user, scoped, dateKey);
  const hari = parseDateKey(dateKey)!;

  const geser = (n: number) => {
    const d = new Date(`${dateKey}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return `/laporan/status-harian?tanggal=${d.toISOString().slice(0, 10)}`;
  };

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={[{ label: "Laporan", href: "/laporan" }, { label: "Status Harian" }]}
        title="Status Laporan Harian"
        description="Satu tanggal, semua lokasi: sudah melapor atau belum, sampai tahap apa, dan apakah berkasnya sudah naik ke Google Drive."
      />

      <Card className="p-3">
        <form method="get" className="flex flex-wrap items-center gap-2">
          <Link
            href={geser(-1)}
            aria-label="Hari sebelumnya"
            className="inline-flex size-8 items-center justify-center rounded-md border border-border text-ink-muted transition-colors hover:bg-surface-muted"
          >
            <ChevronLeft aria-hidden className="size-4" />
          </Link>
          <div className="flex items-center gap-2">
            <CalendarDays aria-hidden className="size-4 text-ink-faint" />
            <input
              type="date"
              name="tanggal"
              defaultValue={dateKey}
              className="h-8 rounded-md border border-border bg-surface px-2 text-[13px] text-ink"
            />
          </div>
          <Link
            href={geser(1)}
            aria-label="Hari berikutnya"
            className="inline-flex size-8 items-center justify-center rounded-md border border-border text-ink-muted transition-colors hover:bg-surface-muted"
          >
            <ChevronRight aria-hidden className="size-4" />
          </Link>
          <button
            type="submit"
            className="h-8 rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-ink transition-colors hover:bg-surface-muted"
          >
            Tampilkan
          </button>
          <span className="text-[13px] text-ink-muted">{formatTanggal(hari, "EEEE, d MMMM yyyy")}</span>
        </form>
      </Card>

      {!data || data.total === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="Tidak ada lokasi aktif"
          description="Belum ada lokasi aktif yang bisa ditampilkan untuk tanggal ini."
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <KpiCard label="Lokasi aktif" value={String(data.total)} />
            {/* "Belum ada laporan" TIDAK diberi nada bahaya: hari libur dan
                kelalaian menghasilkan angka yang sama, dan hanya satu yang
                perlu ditindak. Angkanya disajikan, penilaiannya tidak. */}
            <KpiCard label="Belum ada laporan" value={String(data.belumAda)} />
            <KpiCard label="Masih draf" value={String(data.masihDraft)} />
            <KpiCard label="Sudah final" value={String(data.sudahFinal)} />
            <KpiCard label="Sudah di Drive" value={`${data.sudahDrive} / ${data.total}`} />
          </div>

          <Card className="divide-y divide-border p-0">
            {data.rows.map((r) => (
              <BarisStatus key={r.locationId} row={r} dateKey={dateKey} />
            ))}
          </Card>
        </>
      )}
    </div>
  );
}
