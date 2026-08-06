import type { Metadata } from "next";
import { CalendarDays, SearchX } from "lucide-react";
import { Card, EmptyState, KpiCard, PageHeader } from "@/components/ui";
import { accessibleLocationIds, requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { getStatusHarian } from "@/lib/daily-report/status-harian";
import {
  adaFilterAktif,
  bacaFilter,
  saringBaris,
} from "@/lib/daily-report/status-harian-filter";
import { formatTanggal, jakartaDateKey, parseDateKey } from "@/lib/format";
import { BarisStatus } from "./baris-status";
import { BilahSaring } from "./bilah-saring";

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
  searchParams: Promise<{ tanggal?: string; lokasi?: string; drive?: string; wa?: string }>;
}) {
  const user = await requireUser();
  requireCapabilityPage(user.role, "report.export");
  const scoped = await accessibleLocationIds(user);

  const sp = await searchParams;
  const { tanggal } = sp;
  const filter = bacaFilter(sp);
  // Tanggal yang tidak dikenal TIDAK diam-diam diganti hari ini tanpa jejak —
  // ia jatuh ke hari ini DAN alamatnya ikut menunjukkan tanggal itu, sehingga
  // apa yang dibaca selalu cocok dengan apa yang tertulis di kolom tanggal.
  const dateKey = tanggal && parseDateKey(tanggal) ? tanggal : jakartaDateKey(new Date());
  const data = await getStatusHarian(user, scoped, dateKey);
  const hari = parseDateKey(dateKey)!;

  const tersaring = saringBaris(data?.rows ?? [], filter);

  const geser = (n: number) => {
    const d = new Date(`${dateKey}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + n);
    const q = new URLSearchParams({ tanggal: d.toISOString().slice(0, 10) });
    if (filter.lokasi) q.set("lokasi", filter.lokasi);
    if (filter.drive !== "semua") q.set("drive", filter.drive);
    if (filter.wa !== "semua") q.set("wa", filter.wa);
    return `/laporan/status-harian?${q.toString()}`;
  };

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={[{ label: "Laporan", href: "/laporan" }, { label: "Status Harian" }]}
        title="Status Laporan Harian"
        description="Satu tanggal, semua lokasi: sudah melapor atau belum, sampai tahap apa, dan apakah berkasnya sudah naik ke Google Drive."
      />

      <BilahSaring
        dateKey={dateKey}
        filter={filter}
        opsiLokasi={(data?.rows ?? []).map((r) => ({
          value: r.slug,
          // Kabupaten ikut: nama desa berulang antar kabupaten di daftar KNMP,
          // jadi "Wonorejo" saja tidak cukup untuk memilih yang benar.
          label: `${r.locationName} · ${r.regency}`,
        }))}
        hariLabel={formatTanggal(hari, "EEEE, d MMMM yyyy")}
        hariSebelum={geser(-1)}
        hariSesudah={geser(1)}
      />

      {!data || data.total === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="Tidak ada lokasi aktif"
          description="Belum ada lokasi aktif yang bisa ditampilkan untuk tanggal ini."
        />
      ) : (
        <>
          {/* Dua kolom sejak layar paling sempit: lima kartu satu-per-baris
              mendorong daftar lokasinya — isi sebenarnya halaman ini — sampai
              lima layar ke bawah di ponsel. */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <KpiCard label="Lokasi aktif" value={String(data.total)} />
            {/* "Belum ada laporan" TIDAK diberi nada bahaya: hari libur dan
                kelalaian menghasilkan angka yang sama, dan hanya satu yang
                perlu ditindak. Angkanya disajikan, penilaiannya tidak. */}
            <KpiCard label="Belum ada laporan" value={String(data.belumAda)} />
            <KpiCard label="Masih draf" value={String(data.masihDraft)} />
            <KpiCard label="Sudah final" value={String(data.sudahFinal)} />
            <KpiCard label="Sudah di Drive" value={`${data.sudahDrive} / ${data.total}`} />
          </div>

          {/* Angka pita di atas SELALU untuk seluruh hari itu, bukan hasil
              saringan: gunanya menjawab "sejauh mana hari ini", dan angka yang
              ikut menyusut saat disaring justru menjawab pertanyaan lain.
              Karena itu jumlah yang sedang ditampilkan disebut terpisah. */}
          {adaFilterAktif(filter) ? (
            <p className="text-[13px] text-ink-muted">
              Menampilkan <span className="font-semibold text-ink">{tersaring.length}</span> dari{" "}
              {data.total} lokasi.
            </p>
          ) : null}

          {tersaring.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title="Tidak ada lokasi yang cocok"
              description="Saringan yang aktif tidak menyisakan satu lokasi pun. Longgarkan saringannya, atau bersihkan lewat tautan di atas."
            />
          ) : (
            <Card className="divide-y divide-border p-0">
              {tersaring.map((r) => (
                <BarisStatus key={r.locationId} row={r} dateKey={dateKey} />
              ))}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
