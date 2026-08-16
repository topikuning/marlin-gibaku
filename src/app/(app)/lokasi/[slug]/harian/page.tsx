import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardBody, CardHeader, EmptyState, StatusPill } from "@/components/ui";
import { CalendarDays } from "lucide-react";
import { requireUser, requireLocationAccess } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { getRecentDays } from "@/lib/daily-report/queries";
import { jakartaDateKey, formatTanggal } from "@/lib/format";
import { REPORT_STATUS_LABEL, REPORT_STATUS_TONE } from "@/lib/lifecycle";
import {
  bacaSaringHarian,
  lolosSaringHarian,
  ringkasHari,
  type SaringHarian,
} from "@/lib/daily-report/hari-ini-ringkas";

export const dynamic = "force-dynamic";

/** Berapa hari ke belakang yang ditampilkan halaman ini. */
const RENTANG_HARI = 14;

/**
 * PELAKSANAAN HARIAN satu lokasi: riwayat + ringkasan kepatuhan + saringan
 * (DECISIONS 337).
 *
 * Di sinilah pemantauan satu lokasi tinggal — dipindahkan dari `/hari-ini`
 * atas koreksi user 2026-08-17: *"filter ini dan lain2 lebih baik di halaman
 * lokasi → pelaksanaan harian… hari ini fokus pelaksana."*
 *
 * Pembagiannya: `/hari-ini` untuk MENGERJAKAN, halaman ini untuk MEMERIKSA satu
 * lokasi, `/laporan/status-harian` untuk memeriksa LINTAS lokasi (DECISIONS
 * 262). Tiga tempat, tiga tugas, tanpa tumpang tindih.
 *
 * Saringan hidup di ALAMAT halaman, bukan di state komponen — hasil saringan
 * jadi punya URL sendiri dan bisa dikirim ke orang lain lewat WhatsApp, cara
 * kerja tim ini sehari-hari (alasan yang sama dengan DECISIONS 279).
 */
export default async function HarianIndexPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ saring?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  const location = await db.location.findUnique({
    where: { slug },
    select: { id: true, name: true },
  });
  if (!location) notFound();
  await requireLocationAccess(user, location.id);

  const todayKey = jakartaDateKey(new Date());
  const days = await getRecentDays(location.id, RENTANG_HARI, todayKey);

  const saring = bacaSaringHarian(sp.saring);
  const ringkas = ringkasHari(days);
  const terlihat = days.filter((d) => lolosSaringHarian(d.status, saring));
  const perluTindakan = ringkas.belumAda + ringkas.draft + ringkas.perluKoreksi;

  const tautan = (s: SaringHarian) =>
    s === "semua" ? `/lokasi/${slug}/harian` : `/lokasi/${slug}/harian?saring=${s}`;

  return (
    <Card>
      <CardHeader
        title="Pelaksanaan Harian"
        subtitle={`Satu laporan per tanggal: volume, tenaga, material, alat, cuaca, foto, kendala. Menampilkan ${RENTANG_HARI} hari terakhir.`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {can(user.role, "daily_report.create") && (
              <Link
                href={`/lokasi/${slug}/harian/import`}
                className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-muted"
              >
                Impor rekap Excel
              </Link>
            )}
            <Link
              href={`/lokasi/${slug}/harian/${todayKey}`}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-800"
            >
              Buka hari ini
            </Link>
          </div>
        }
      />
      <CardBody className="space-y-4">
        {/* Angka SELALU membawa penyebutnya: "8" sendirian tidak bisa
            ditindaklanjuti, 8 dari 14 dan 8 dari 8 dua kabar berbeda. */}
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Angka label="Perlu koreksi" nilai={ringkas.perluKoreksi} dari={ringkas.total} nada="danger" />
          <Angka label="Belum ada laporan" nilai={ringkas.belumAda} dari={ringkas.total} nada="warning" />
          <Angka label="Masih draft" nilai={ringkas.draft} dari={ringkas.total} nada="warning" />
          <Angka
            label="Dikirim / selesai"
            nilai={ringkas.dikirim + ringkas.selesai}
            dari={ringkas.total}
            nada="success"
          />
        </section>

        <nav className="flex flex-wrap items-center gap-1.5" aria-label="Saring status">
          <Saringan href={tautan("semua")} aktif={saring === "semua"} label={`Semua (${ringkas.total})`} />
          <Saringan
            href={tautan("perlu_tindakan")}
            aktif={saring === "perlu_tindakan"}
            label={`Perlu tindakan (${perluTindakan})`}
          />
          <Saringan href={tautan("belum")} aktif={saring === "belum"} label={`Belum ada (${ringkas.belumAda})`} />
          <Saringan href={tautan("draft")} aktif={saring === "draft"} label={`Draft (${ringkas.draft})`} />
          <Saringan
            href={tautan("koreksi")}
            aktif={saring === "koreksi"}
            label={`Koreksi (${ringkas.perluKoreksi})`}
          />
          <Saringan
            href={tautan("selesai")}
            aktif={saring === "selesai"}
            label={`Selesai (${ringkas.dikirim + ringkas.selesai})`}
          />
        </nav>

        {terlihat.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title="Tidak ada tanggal pada saringan ini"
            description={`Dari ${ringkas.total} hari terakhir, tidak ada yang cocok. Pilih "Semua" untuk melihat seluruhnya.`}
          />
        ) : (
          <ul className="divide-y divide-border text-sm">
            {terlihat.map((d) => (
              <li key={d.dateKey}>
                <Link
                  href={`/lokasi/${slug}/harian/${d.dateKey}`}
                  className="flex items-center justify-between gap-2 py-2 hover:bg-surface-muted"
                >
                  <span>
                    {formatTanggal(new Date(`${d.dateKey}T00:00:00Z`), "EEEE, d MMM yyyy")}
                    {d.dateKey === todayKey && (
                      <span className="ml-2 text-xs font-medium text-primary">hari ini</span>
                    )}
                  </span>
                  {d.status ? (
                    <StatusPill
                      tone={REPORT_STATUS_TONE[d.status]}
                      label={`${REPORT_STATUS_LABEL[d.status]} · ${d.itemCount} item`}
                    />
                  ) : (
                    <StatusPill tone="neutral" label="Tidak ada laporan" />
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}

        {/* Yang disaring TIDAK boleh terbaca "tidak ada". */}
        {saring !== "semua" ? (
          <p className="text-[12px] text-ink-muted">
            Menampilkan {terlihat.length} dari {ringkas.total} hari — {ringkas.total - terlihat.length}{" "}
            disembunyikan saringan.
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}

function Angka({
  label,
  nilai,
  dari,
  nada,
}: {
  label: string;
  nilai: number;
  dari: number;
  nada: "danger" | "warning" | "success";
}) {
  const warna =
    nilai === 0
      ? "text-ink-muted"
      : nada === "danger"
        ? "text-danger"
        : nada === "warning"
          ? "text-warning"
          : "text-success";
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <p className="text-[11px] font-semibold tracking-wide text-ink-muted uppercase">{label}</p>
      <p className={`tabular mt-0.5 text-xl font-bold ${warna}`}>
        {nilai}
        <span className="text-[13px] font-normal text-ink-muted"> / {dari} hari</span>
      </p>
    </div>
  );
}

function Saringan({ href, aktif, label }: { href: string; aktif: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={aktif ? "page" : undefined}
      className={
        aktif
          ? "rounded-full border border-primary bg-primary px-3 py-1.5 text-[13px] font-semibold text-white"
          : "rounded-full border border-border px-3 py-1.5 text-[13px] font-medium text-ink-muted hover:bg-surface-muted"
      }
    >
      {label}
    </Link>
  );
}
