import type { Metadata } from "next";
import { CalendarDays } from "lucide-react";
import { EmptyState, KpiCard, PageHeader } from "@/components/ui";
import { accessibleLocationIds, requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { getStatusHarian } from "@/lib/daily-report/status-harian";
import { bacaFilter, saringBaris } from "@/lib/daily-report/status-harian-filter";
import { formatTanggal, jakartaDateKey, parseDateKey } from "@/lib/format";
import { BilahSaring } from "./bilah-saring";
import { TabelStatus } from "./tabel-status";

export const metadata: Metadata = { title: "Status Laporan Harian" };
export const dynamic = "force-dynamic";

/**
 * PAPAN STATUS LAPORAN HARIAN (DECISIONS 262; grid — 277; saringan kembali — 279).
 *
 * Satu tanggal, semua lokasi yang boleh dilihat pengguna: **bilah saring** di
 * atas (tanggal, lokasi, laporan, Drive, WA) dan **grid** di bawah (satu baris
 * per lokasi, tombol aksi di kolomnya sendiri).
 *
 * Pembagian tugasnya sengaja: MENYARING terjadi di alamat halaman — hasilnya
 * punya URL sendiri dan bisa dikirim ke orang lain lewat WhatsApp, cara kerja
 * tim ini sehari-hari. MENYORTIR terjadi di grid, karena itu memang urusan
 * tampilan. Sempat kubuang bilahnya demi grid; itu keliru — yang diminta adalah
 * tabelnya dirapikan, bukan saringannya dihapus (teguran user 2026-08-06).
 */
export default async function StatusHarianPage({
  searchParams,
}: {
  searchParams: Promise<{ tanggal?: string; lokasi?: string; laporan?: string; drive?: string; wa?: string }>;
}) {
  const user = await requireUser();
  requireCapabilityPage(user.role, "report.export");
  const scoped = await accessibleLocationIds(user);

  const sp = await searchParams;
  // Tanggal yang tidak dikenal TIDAK diam-diam diganti hari ini tanpa jejak —
  // ia jatuh ke hari ini DAN alamatnya ikut menunjukkan tanggal itu, sehingga
  // apa yang dibaca selalu cocok dengan apa yang tertulis di kolom tanggal.
  const dateKey = sp.tanggal && parseDateKey(sp.tanggal) ? sp.tanggal : jakartaDateKey(new Date());
  const data = await getStatusHarian(user, scoped, dateKey);
  const hari = parseDateKey(dateKey)!;
  const filter = bacaFilter(sp);

  const rows = data ? saringBaris(data.rows, filter) : [];
  // Nama desa berulang antar kabupaten, jadi label pemilih menyebut keduanya.
  const opsiLokasi = (data?.rows ?? []).map((r) => ({
    value: r.slug,
    label: `${r.locationName} — ${r.regency}`,
  }));

  const geser = (n: number) => {
    const d = new Date(`${dateKey}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + n);
    const q = new URLSearchParams({ tanggal: d.toISOString().slice(0, 10) });
    if (filter.lokasi) q.set("lokasi", filter.lokasi);
    if (filter.laporan !== "semua") q.set("laporan", filter.laporan);
    if (filter.drive !== "semua") q.set("drive", filter.drive);
    if (filter.wa !== "semua") q.set("wa", filter.wa);
    return `/laporan/status-harian?${q.toString()}`;
  };

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={[{ label: "Laporan", href: "/laporan" }, { label: "Status Harian" }]}
        title="Status Laporan Harian"
        description="Saring di atas, sortir dengan mengetuk kepala kolom. Tombol Unggah & Kirim ada di kolomnya masing-masing."
      />

      <BilahSaring
        dateKey={dateKey}
        filter={filter}
        opsiLokasi={opsiLokasi}
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
          {/* Dua kolom sejak layar tersempit: lima kartu satu-per-baris
              mendorong gridnya — isi sebenarnya halaman ini — jauh ke bawah.
              Angkanya SELALU untuk seluruh hari, tidak ikut menyusut saat
              disaring: gunanya menjawab "sejauh mana hari ini". */}
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

          <p className="text-[13px] text-ink-muted">
            Menampilkan {rows.length} dari {data.total} lokasi
          </p>

          <TabelStatus rows={rows} dateKey={dateKey} />
        </>
      )}
    </div>
  );
}
