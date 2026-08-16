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
import {
  kalimatTindakan,
  perluTindakan,
  ringkasKepatuhan,
  urutkanLokasi,
} from "@/lib/daily-report/hari-ini-ringkas";
import { KeteranganStatus, Matriks7Hari, Strip7Hari } from "@/components/knmp/strip-7-hari";

export const metadata: Metadata = { title: "Hari Ini" };
export const dynamic = "force-dynamic";

/**
 * Landing lapangan — DUA BENTUK dari satu halaman (DECISIONS 336).
 *
 * Halaman ini dipakai dua orang yang kebutuhannya berlawanan: mandor satu
 * lokasi yang butuh SATU tombol besar, dan Site Manager belasan lokasi yang
 * butuh menjawab "siapa yang tertinggal" tanpa membuka satu per satu.
 *
 * Bentuknya ditentukan **lingkup lokasi**, bukan peran: peran bisa sama
 * sementara lingkupnya berbeda. Satu lokasi → tombol besar tetap menang.
 * Banyak lokasi → strip 7 hari, ringkasan berpenyebut, dan matriks.
 *
 * Yang SENGAJA tidak diambil dari konsep: navigasi bawah lima tombol —
 * `AppShell` sudah punya nav yang disaring per capability, dan nav kedua adalah
 * duplikasi yang baru saja dibersihkan (DECISIONS 335).
 */
export default async function HariIniPage({
  searchParams,
}: {
  searchParams: Promise<{ tampil?: string }>;
}) {
  const sp = await searchParams;
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

  const banyakLokasi = semua.length > 1;
  const ringkas = ringkasKepatuhan(semua);
  const tindakan = kalimatTindakan(semua);

  const tampil = sp.tampil === "matriks" ? "matriks" : sp.tampil === "masalah" ? "masalah" : "kartu";
  const urut = urutkanLokasi(semua);
  const terlihat = tampil === "masalah" ? urut.filter(perluTindakan) : urut;

  return (
    <div className={banyakLokasi ? "space-y-4" : "mx-auto max-w-xl space-y-5"}>
      <PageHeader
        title="Hari Ini"
        description={
          banyakLokasi
            ? `${semua.length} lokasi dalam penugasan Anda · ${formatTanggal(new Date(`${todayKey}T00:00:00Z`))}`
            : formatTanggal(new Date(`${todayKey}T00:00:00Z`))
        }
      />

      {semua.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="Belum ada penugasan lokasi"
          description="Hubungi Site Manager untuk mendapat penugasan lokasi."
        />
      ) : null}

      {/* ── Ringkasan 7 hari — HANYA untuk yang lingkupnya banyak lokasi.
             Untuk satu lokasi, angka-angka ini cuma menunda tombolnya. ── */}
      {banyakLokasi ? (
        <>
          <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <KotakAngka
              label="Perlu koreksi"
              nilai={ringkas.perluKoreksi}
              dari={ringkas.totalSel}
              nada="danger"
            />
            <KotakAngka
              label="Belum ada laporan"
              nilai={ringkas.belumAda}
              dari={ringkas.totalSel}
              nada="warning"
            />
            <KotakAngka
              label="Masih draft"
              nilai={ringkas.draft}
              dari={ringkas.totalSel}
              nada="warning"
            />
            <KotakAngka
              label="Dikirim / selesai"
              nilai={ringkas.dikirim + ringkas.selesai}
              dari={ringkas.totalSel}
              nada="success"
            />
          </section>

          {tindakan ? (
            <Banner
              tone="warning"
              title={`${ringkas.lokasiPerluTindakan} dari ${ringkas.lokasi} lokasi perlu tindakan hari ini`}
              description={tindakan}
            />
          ) : (
            <Banner
              tone="success"
              title="Tidak ada yang perlu dikerjakan hari ini"
              description={
                ringkas.belumAda > 0
                  ? `Semua lokasi sudah melapor hari ini. Catatan: masih ada ${ringkas.belumAda} hari kosong pada 7 hari terakhir — hari yang sudah lewat tidak bisa diisi mandor lagi.`
                  : "Seluruh 7 hari terakhir terisi di semua lokasi."
              }
            />
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Tab href="/hari-ini" aktif={tampil === "kartu"} label={`Per Lokasi (${semua.length})`} />
            <Tab
              href="/hari-ini?tampil=masalah"
              aktif={tampil === "masalah"}
              label={`Perlu Tindakan (${ringkas.lokasiPerluTindakan})`}
            />
            <Tab href="/hari-ini?tampil=matriks" aktif={tampil === "matriks"} label="Matriks 7 Hari" />
          </div>

          <KeteranganStatus />
        </>
      ) : null}

      {banyakLokasi && tampil === "matriks" ? (
        <Matriks7Hari lokasi={urut} todayKey={todayKey} />
      ) : (
        <div className={banyakLokasi ? "grid gap-3 lg:grid-cols-2" : "space-y-5"}>
          {terlihat.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="Tidak ada lokasi yang perlu tindakan"
              description="Semua lokasi sudah melapor hari ini dan tidak ada koreksi tertunda."
            />
          ) : null}

          {terlihat.map((s) => (
            <Card key={s.id}>
              <CardHeader
                title={s.name}
                subtitle={`${s.village}, ${s.regency}${s.weekNumber ? ` · minggu ke-${s.weekNumber}` : ""}`}
              />
              <CardBody className="space-y-3">
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

                {/* Tombol utama. Untuk satu lokasi ia SENGAJA besar dan penuh
                    lebar — mandor memakainya di luar ruangan, dan mengecilkannya
                    demi kerapian memperburuk pekerjaan yang sebenarnya. */}
                <Link
                  href={`/lokasi/${s.slug}/harian/${todayKey}`}
                  className={
                    banyakLokasi
                      ? "block rounded-lg bg-primary px-3 py-2.5 text-center text-sm font-semibold text-white hover:bg-primary-800"
                      : "block rounded-lg bg-primary px-4 py-4 text-center text-base font-semibold text-white hover:bg-primary-800"
                  }
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

                {/* Target minggu ini DIPERTAHANKAN. Ini satu-satunya bagian
                    halaman yang melihat KE DEPAN — yang memberi tahu mandor apa
                    yang harus dikerjakan, bukan cuma apakah ia sudah melapor. */}
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
                            {formatNumber(t.realizedVolume)}/{formatNumber(t.targetVolume)}{" "}
                            {t.unit ?? ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div>
                  <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-ink">
                    <CalendarDays className="h-4 w-4" aria-hidden /> 7 hari terakhir
                  </h3>
                  <Strip7Hari slug={s.slug} hari={s.last7Days} todayKey={todayKey} />
                </div>

                {!banyakLokasi ? <KeteranganStatus /> : null}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Angka ringkasan yang SELALU membawa penyebutnya.
 *
 * "51" sendirian tidak bisa ditindaklanjuti — 51 dari 84 dan 51 dari 51 adalah
 * dua kabar yang sangat berbeda. Aturan yang sama dipakai RAPL (DECISIONS 327).
 */
function KotakAngka({
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

function Tab({ href, aktif, label }: { href: string; aktif: boolean; label: string }) {
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
