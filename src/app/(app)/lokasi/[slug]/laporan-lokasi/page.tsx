import { peringatanPelaksana, pilihPelaksana } from "@/lib/laporan/penandatangan";
import { notFound } from "next/navigation";
import { CalendarClock, FileText, ListTree, Printer, Sheet } from "lucide-react";
import { Banner, Card, CardBody, CardHeader, EmptyState, KpiCard } from "@/components/ui";
import { KkpPeriodReport } from "@/components/knmp/kkp-period-report";
import { ScurveKkpSheet } from "@/components/knmp/scurve-kkp-sheet";
import { PeriodFilter } from "./period-filter";
import { MenuBerkas } from "@/components/ui";
import { MenuLaporanPeriodik } from "./menu-laporan";
import { BarisLaporanHarian } from "./baris-harian";
import { requireUser, requireLocationAccess } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { db } from "@/lib/db";
import { getPeriodBounds, getPeriodReport, type PeriodKind } from "@/lib/periodic-report";
import { isWahaConfigured } from "@/lib/waha/client";
import { getGDriveConfigDisplay } from "@/lib/gdrive/config";
import { ambilRiwayatHarian } from "@/lib/laporan/riwayat-queries";
import { withBackTo } from "@/lib/print-back";

export const dynamic = "force-dynamic";

/** Tab Laporan lokasi: harian final + mingguan/bulanan KKP + export. */
export default async function LaporanLokasiPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ kind?: string; n?: string; show?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  requireCapabilityPage(user.role, "report.export");
  const location = await db.location.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      pelaksanaName: true,
      pelaksanaTitle: true,
      pelaksanaTtdKey: true,
      pelaksanaStempelKey: true,
      package: {
        select: {
          id: true,
          waGroupId: true,
          driveFolderId: true,
          pelaksanaName: true,
          pelaksanaTitle: true,
          pelaksanaTtdKey: true,
          pelaksanaStempelKey: true,
        },
      },
    },
  });
  if (!location) notFound();
  await requireLocationAccess(user, location.id);

  const wahaOn = await isWahaConfigured();
  const hasGroup = !!location.package?.waGroupId;
  const hasDrive = !!location.package?.driveFolderId;
  const driveOn = (await getGDriveConfigDisplay()).connected;

  /*
   * Peringatan Pelaksana Lapangan (DECISIONS 402) – DI SINI, di layar tempat
   * orang menekan cetak/kirim, bukan hanya di halaman pengaturan yang mungkin
   * tidak pernah dibuka. Yang kosong tetap bisa dicetak: blok TTD-nya keluar
   * tanpa nama untuk ditandatangani tangan. Yang TIDAK dilakukan adalah
   * memakai nama Direktur sebagai pengganti.
   */
  const peringatanTtd = peringatanPelaksana(
    pilihPelaksana(location, location.package ?? null),
  );

  // scheduleBounds: real bila SPMK ada, else asumsi mulai hari ini — utk tombol Jadwal
  // (kurva-S rencana tetap bisa dilihat sebelum SPMK). bounds REAL: hanya utk laporan
  // periodik (butuh SPMK sungguhan).
  const scheduleBounds = await getPeriodBounds(location.id, { assume: true });
  const bounds = scheduleBounds && !scheduleBounds.assumed ? scheduleBounds : null;
  const kind: PeriodKind = sp.kind === "bulanan" ? "bulanan" : "mingguan";
  const maxN = bounds ? (kind === "mingguan" ? bounds.totalWeeks : bounds.totalMonths) : 0;
  const currentN = bounds ? (kind === "mingguan" ? bounds.currentWeek : bounds.currentMonth) : 1;
  const n = Math.min(Math.max(Number.parseInt(sp.n ?? String(currentN), 10) || currentN, 1), Math.max(maxN, 1));
  // Generate eksplisit (audit UX #7): laporan hanya dihitung setelah "Tampilkan".
  const shown = sp.show === "1" && !!bounds;

  const [report, riwayat] = await Promise.all([
    shown ? getPeriodReport(location.id, kind, n) : Promise.resolve(null),
    ambilRiwayatHarian({ locationId: location.id, slug }),
  ]);
  const { baris, ringkas, tersembunyi } = riwayat;

  /*
   * Syarat yang belum terpenuhi dikatakan SEKALI di kepala kartu, bukan
   * diulang pada tiga puluh baris. Faktanya milik PAKET (grup WA / folder Drive
   * belum diatur), jadi mengulangnya per hari hanya menutupi daftar dengan
   * kalimat yang sama persis.
   */
  const alasanMati = [
    !wahaOn ? "WhatsApp belum dikonfigurasi" : !hasGroup ? "Paket ini belum punya grup WhatsApp" : null,
    !driveOn ? "Google Drive belum terhubung" : !hasDrive ? "Paket ini belum punya folder Drive" : null,
  ].filter((v): v is string => !!v);

  return (
    <div className="space-y-6">
      {peringatanTtd ? (
        <Banner tone="warning" title="Pelaksana Lapangan belum diisi" description={peringatanTtd} />
      ) : null}

      <Card>
        <CardHeader
          title="Laporan Periodik KKP"
          subtitle="Mingguan / bulanan – dihitung dari laporan harian terkirim (satu calculation layer)."
          action={
            scheduleBounds ? (
              // Satu tombol untuk JADWAL, isinya bentuk-bentuknya (DECISIONS 334).
              // Sebelumnya tiga tombol sejajar, salah satunya berlabel "Unduh
              // Excel" — persis sama dengan tombol Excel LAPORAN di bawahnya,
              // padahal isinya jadwal. Label yang sama untuk dua berkas berbeda
              // adalah cara tercepat orang mengirim yang salah ke PPK.
              <MenuBerkas
                label="Jadwal / Time Schedule"
                icon={<CalendarClock aria-hidden className="size-4" />}
                pilihan={[
                  {
                    label: "Buka untuk dicetak",
                    icon: <Printer aria-hidden className="size-3.5" />,
                    href: withBackTo(`/cetak/jadwal/${slug}`, `/lokasi/${slug}/laporan-lokasi`),
                    jenis: "tab",
                    hint: "Kurva-S seluruh masa kontrak",
                  },
                  {
                    label: "Unduh Excel",
                    icon: <Sheet aria-hidden className="size-3.5" />,
                    href: `/lokasi/${slug}/jadwal/export`,
                    jenis: "berkas",
                    labelSibuk: "Menyiapkan Excel jadwal…",
                    hint: "Bobot per kategori × minggu",
                  },
                  {
                    label: "Unduh Excel – rincian item",
                    icon: <ListTree aria-hidden className="size-3.5" />,
                    href: `/lokasi/${slug}/jadwal/rincian`,
                    jenis: "berkas",
                    labelSibuk: "Menyiapkan Excel rincian…",
                    hint: "Sampai uraian item: volume, harga satuan, bobot. Kolom jadwalnya tetap jadwal KATEGORI induk – sistem tidak menyimpan jadwal per item.",
                  },
                ]}
              />
            ) : undefined
          }
        />
        <CardBody className="space-y-4">
          {!bounds ? (
            <EmptyState icon={FileText} title="Kontrak belum ada" description="Laporan periodik butuh periode kontrak." />
          ) : (
            <>
              <PeriodFilter slug={slug} kind={kind} n={n} maxN={maxN} />
              {!shown ? (
                <EmptyState
                  icon={FileText}
                  title="Laporan belum ditampilkan"
                  description="Pilih jenis laporan dan periode di atas, lalu klik Tampilkan untuk membuat laporan."
                />
              ) : report ? (
                <div className="space-y-4">
                  {/* Satu tombol per BERKAS, tujuannya di dalam menu — DECISIONS 334. */}
                  <MenuLaporanPeriodik
                    slug={slug}
                    locationId={location.id}
                    kind={kind}
                    n={n}
                    hasGroup={hasGroup}
                    hasDrive={hasDrive}
                    wahaOn={wahaOn}
                    driveOn={driveOn}
                  />
                  {/* Hal-1: KURVA S (grafik) */}
                  <div className="overflow-x-auto rounded-md border border-border bg-white p-4">
                    <ScurveKkpSheet r={report} jenis={report.kind} />
                  </div>
                  {/* Hal-2+: tabel detail item */}
                  <div className="overflow-x-auto rounded-md border border-border bg-white p-4">
                    <KkpPeriodReport r={report} />
                  </div>
                </div>
              ) : (
                <EmptyState icon={FileText} title="Periode tidak valid" description="Periode di luar rentang kontrak." />
              )}
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Laporan harian final"
          subtitle="Snapshot beku – siap cetak KKP. Yang diutamakan di sini: sudah sampai ke Drive dan grup WhatsApp atau belum."
        />
        <CardBody className="space-y-4">
          {ringkas.total === 0 ? (
            <EmptyState icon={FileText} title="Belum ada laporan final" description="Finalisasi dilakukan dari workspace harian setelah disetujui." />
          ) : (
            <>
              {/* Dihitung dari SELURUH laporan final lokasi ini, bukan dari yang
                  kebetulan tampil di daftar – lihat riwayat-queries.ts. */}
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <KpiCard label="Laporan final" value={ringkas.total} sub="Seluruh masa kontrak" />
                <KpiCard
                  label="Sudah ke Drive"
                  value={`${ringkas.drive}/${ringkas.total}`}
                  tone={ringkas.drive === ringkas.total ? "success" : "default"}
                  sub="Arsip yang diperiksa KKP"
                />
                <KpiCard
                  label="Sudah ke WhatsApp"
                  value={`${ringkas.wa}/${ringkas.total}`}
                  tone={ringkas.wa === ringkas.total ? "success" : "default"}
                  sub="Kabar ke grup paket"
                />
                <KpiCard
                  label="Belum dikirim"
                  value={ringkas.belum}
                  tone={ringkas.belum > 0 ? "warning" : "success"}
                  sub="Belum ke Drive maupun WhatsApp"
                />
              </div>

              {alasanMati.length > 0 ? (
                <Banner
                  tone="info"
                  title="Sebagian tombol kiriman dimatikan"
                  description={`${alasanMati.join(". ")}. Unduh dan cetak tetap bisa dipakai.`}
                />
              ) : null}

              <ul className="divide-y divide-border">
                {baris.map((r) => (
                  <BarisLaporanHarian
                    key={r.id}
                    r={r}
                    slug={slug}
                    hasGroup={hasGroup}
                    hasDrive={hasDrive}
                    wahaOn={wahaOn}
                    driveOn={driveOn}
                  />
                ))}
              </ul>

              {/* Yang tidak ditampilkan DISEBUT jumlahnya: daftar yang diam-diam
                  dipotong terbaca sebagai "cuma segini laporannya". */}
              {tersembunyi > 0 ? (
                <p className="text-[12px] text-ink-muted">
                  {tersembunyi} laporan final lebih lama tidak ditampilkan di daftar ini. Angka
                  ringkas di atas tetap menghitung semuanya.
                </p>
              ) : null}
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
