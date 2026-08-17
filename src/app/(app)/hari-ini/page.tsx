import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, ClipboardList } from "lucide-react";
import { Banner, Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { requireUser, accessibleLocationIds } from "@/lib/auth/session";
import { locationScopeWhere } from "@/lib/auth/scope";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { db } from "@/lib/db";
import { getHariIniLocation } from "@/lib/daily-report/queries";
import { jakartaDateKey, formatTanggal, formatNumber } from "@/lib/format";
import { REPORT_STATUS_LABEL } from "@/lib/lifecycle";
import { urutkanLokasi } from "@/lib/daily-report/hari-ini-ringkas";
import { KeteranganStatus, Strip7Hari } from "@/components/knmp/strip-7-hari";

export const metadata: Metadata = { title: "Hari Ini" };
export const dynamic = "force-dynamic";

/**
 * Landing PELAKSANA — satu tugas: buka tanggal yang mau dilaporkan
 * (DECISIONS 337).
 *
 * Koreksi user 2026-08-17: *"fokus halaman hari ini tetap adalah langsung klik
 * hari ini atau tanggal yang mau dilaporkan… fokus site manager dan pelaksana
 * beda, hari ini fokus pelaksana."*
 *
 * DECISIONS 336 sempat menaruh ringkasan angka, saringan, dan matriks di sini,
 * dipagari `banyakLokasi`. Pagar itu tidak menolong — Site Manager dengan DUA
 * lokasi tetap disambut dinding angka sebelum sampai ke tombolnya. Semuanya
 * dipindahkan:
 *
 * - pemantauan SATU lokasi → `/lokasi/{slug}/harian`
 * - pemantauan LINTAS lokasi → `/laporan/status-harian` (sudah ada, DECISIONS 262)
 *
 * Yang tersisa di sini hanya yang dipakai MENGERJAKAN: tombol hari ini, strip 7
 * hari untuk menekan tanggal lain, koreksi yang menunggu, dan target minggu ini.
 *
 * Lokasi tetap diurutkan menurut yang perlu dikerjakan (`urutkanLokasi`) — itu
 * bukan pemantauan, itu meletakkan pekerjaan di depan.
 */
export default async function HariIniPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "daily_report.create");
  const locIds = await accessibleLocationIds(user);
  const todayKey = jakartaDateKey(new Date());

  const locations = await db.location.findMany({
    where: { ...locationScopeWhere(user, locIds), isActive: true },
    select: { id: true },
    orderBy: { name: "asc" },
  });
  const semua = (
    await Promise.all(locations.map((l) => getHariIniLocation(l.id)))
  ).filter((s): s is NonNullable<typeof s> => s !== null);

  const terlihat = urutkanLokasi(semua);

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <PageHeader
        title="Hari Ini"
        description={formatTanggal(new Date(`${todayKey}T00:00:00Z`))}
      />

      {semua.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="Belum ada penugasan lokasi"
          description="Hubungi Site Manager untuk mendapat penugasan lokasi."
        />
      ) : null}

      {terlihat.map((s) => (
        <Card key={s.id}>
          <CardHeader
            title={s.name}
            subtitle={`${s.village}, ${s.regency}${s.weekNumber ? ` · minggu ke-${s.weekNumber}` : ""}`}
          />
          <CardBody className="space-y-4">
            {s.corrections.length > 0 && (
              <Banner
                tone="warning"
                title={`${s.corrections.length} laporan dikembalikan — perlu koreksi`}
                description={s.corrections
                  .map(
                    (c) =>
                      `${formatTanggal(new Date(`${c.dateKey}T00:00:00Z`))}: ${c.reason ?? "tanpa alasan"}`,
                  )
                  .join(" · ")}
              />
            )}

            {/* Tombol utama, SELALU besar dan penuh lebar — berapa pun jumlah
                lokasinya. Halaman ini dipakai di luar ruangan; mengecilkannya
                demi kerapian memperburuk pekerjaan yang sebenarnya. */}
            <Link
              href={`/lokasi/${s.slug}/harian/${todayKey}`}
              className="block rounded-lg bg-primary px-4 py-4 text-center text-base font-semibold text-white hover:bg-primary-800"
            >
              {s.todayStatus === null
                ? "Lapor Hari Ini"
                : s.todayStatus === "draft"
                  ? `Lanjutkan Draft (${s.todayDraftItemCount ?? 0} item)`
                  : `Laporan hari ini: ${REPORT_STATUS_LABEL[s.todayStatus]}`}
            </Link>

            {s.corrections.map((c) => (
              <Link
                key={c.dateKey}
                href={`/lokasi/${s.slug}/harian/${c.dateKey}`}
                className="block rounded-lg border border-warning bg-warning-soft px-4 py-3 text-center text-sm font-medium text-ink transition-colors hover:bg-warning/15 active:bg-warning/25"
              >
                Perbaiki laporan {formatTanggal(new Date(`${c.dateKey}T00:00:00Z`))}
              </Link>
            ))}

            {/* Target minggu ini DIPERTAHANKAN: satu-satunya bagian halaman
                yang melihat KE DEPAN — apa yang harus dikerjakan, bukan cuma
                apakah sudah melapor. */}
            {s.weeklyTargets.length > 0 && (
              <div>
                <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-ink">
                  <ClipboardList className="h-4 w-4" aria-hidden /> Target minggu ini
                </h3>
                <ul className="divide-y divide-border text-sm">
                  {s.weeklyTargets.map((t, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 py-1.5">
                      <span className="min-w-0 truncate">{t.name}</span>
                      <span className="tabular shrink-0 text-ink-muted">
                        {formatNumber(t.realizedVolume)}/{formatNumber(t.targetVolume)} {t.unit ?? ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Strip 7 hari = cara menekan TANGGAL LAIN yang mau dilaporkan.
                Ia tinggal di sini bukan sebagai pemantauan, melainkan sebagai
                pemilih tanggal. */}
            <div>
              <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-ink">
                <CalendarDays className="h-4 w-4" aria-hidden /> Laporkan tanggal lain
              </h3>
              <Strip7Hari slug={s.slug} hari={s.last7Days} todayKey={todayKey} />
              <p className="mt-1.5 text-[12px] text-ink-muted">
                Butuh tanggal lebih lama atau ringkasan kepatuhan?{" "}
                <Link href={`/lokasi/${s.slug}/harian`} className="font-medium text-primary hover:underline">
                  Buka Pelaksanaan Harian
                </Link>
                .
              </p>
            </div>

            <KeteranganStatus />
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
