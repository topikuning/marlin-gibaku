import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import {
  Badge,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  KpiCard,
  PageHeader,
  StatusPill,
} from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { can } from "@/lib/authz";
import { formatTanggal } from "@/lib/format";
import { papanKendala, HARI_SELESAI_TAMPIL, type BarisKendala } from "@/lib/kendala/queries";
import type { IssueSeverity, IssueSource, IssueStatus } from "@/generated/prisma/enums";
import { SaringKendala } from "./saring";
import { PemilikForm } from "./pemilik-form";
import { GabungForm, type KandidatInduk } from "./gabung-form";

export const metadata: Metadata = { title: "Kendala" };
export const dynamic = "force-dynamic";

/**
 * PAPAN KENDALA TERPUSAT (DECISIONS 392).
 *
 * Keberatan user 2026-08-20: *"pencatatan kendala … setelah dicatat tidak ada
 * tindak lanjut, lalu akan rancu dengan kendala di laporan harian atau
 * kegiatan lapangan."*
 *
 * Sebelum halaman ini, kendala hanya terlihat di dalam tab Progress SATU
 * lokasi. Tidak ada tempat untuk menjawab "kendala apa saja yang terbuka di 83
 * lokasi, siapa pemiliknya, mana yang lewat tenggat" — padahal itu satu-satunya
 * pertanyaan yang membuat pencatatan kendala ada gunanya.
 *
 * Yang membedakannya dari daftar biasa: dua keadaan yang paling sering
 * terlewat diberi angkanya sendiri di kepala halaman — **lewat tenggat** dan
 * **terbengkalai** (dicatat, lalu tidak pernah diberi pemilik maupun tenggat).
 * Keadaan kedua itulah yang terlihat di tangkapan layar user: empat kendala,
 * keempatnya tanpa aksi pemulihan.
 */

const TINGKAT_TONE: Record<IssueSeverity, "neutral" | "info" | "warning" | "danger"> = {
  rendah: "neutral",
  sedang: "info",
  tinggi: "warning",
  kritis: "danger",
};

const STATUS_LABEL: Record<IssueStatus, string> = {
  terbuka: "Terbuka",
  ditangani: "Ditangani",
  selesai: "Selesai",
};

const SUMBER_LABEL: Record<IssueSource, string> = {
  manual: "Dicatat langsung",
  laporan_harian: "Laporan harian",
  kegiatan_lapangan: "Kegiatan lapangan",
  ai: "Ask MARLIN",
};

function BarisKendalaKartu({
  k,
  bolehKelola,
  penggunaOpsi,
  kandidatInduk,
}: {
  k: BarisKendala;
  bolehKelola: boolean;
  penggunaOpsi: { id: string; nama: string }[];
  kandidatInduk: KandidatInduk[];
}) {
  return (
    <li className="rounded-md border border-border px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-[14rem] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/lokasi/${k.locationSlug}/progress?bagian=kendala`}
              className="text-sm font-medium text-primary hover:underline"
            >
              {k.title}
            </Link>
            <Badge tone={TINGKAT_TONE[k.severity]} label={k.severity} />
            <StatusPill tone={k.status === "selesai" ? "success" : "neutral"} label={STATUS_LABEL[k.status]} />
            {k.lewatTenggat ? <Badge tone="danger" label="Lewat tenggat" /> : null}
            {/*
              "Terbengkalai" sengaja diberi lencana sendiri, bukan dilebur ke
              "terbuka". Kendala terbuka yang punya pemilik sedang berjalan;
              yang tanpa pemilik TIDAK sedang berjalan – dan bedanya tidak
              terlihat sama sekali di daftar sebelumnya.
            */}
            {k.terbengkalai ? <Badge tone="warning" label="Belum ada pemilik" /> : null}
          </div>
          <p className="mt-0.5 text-[12px] text-ink-muted">
            {k.locationName}
            {k.packageName ? ` · ${k.packageName}` : ""} · {SUMBER_LABEL[k.source]} · dibuka{" "}
            {formatTanggal(k.createdAt)} ({k.umurHari} hari)
          </p>
          {k.description ? (
            <p className="mt-1 text-[13px] leading-snug text-ink">{k.description}</p>
          ) : null}
        </div>
        <div className="min-w-0 text-right text-[12px] text-ink-muted">
          <p>
            PIC:{" "}
            <span className="font-medium text-ink">
              {k.picUserName ?? k.picName ?? "–"}
            </span>
            {k.picName && !k.picUserId ? (
              // Nama bebas tidak bisa dikirimi pengingat, dan itu dikatakan —
              // bukan dibiarkan terlihat sama dengan PIC yang bisa ditagih.
              <span className="block text-[11px] text-warning">di luar MARLIN – tanpa pengingat</span>
            ) : null}
          </p>
          <p className="mt-0.5">
            Tenggat:{" "}
            <span className={k.lewatTenggat ? "font-medium text-danger" : "font-medium text-ink"}>
              {k.dueDate ? formatTanggal(k.dueDate) : "–"}
            </span>
          </p>
          <p className="mt-0.5">
            {k.jumlahAksi === 0 ? "Belum ada aksi pemulihan" : `${k.jumlahAksi} aksi pemulihan`}
          </p>
        </div>
      </div>
      {bolehKelola && k.status !== "selesai" ? (
        <div className="mt-2 border-t border-border pt-2">
          <PemilikForm
            issueId={k.id}
            picUserId={k.picUserId}
            picName={k.picName}
            dueDate={k.dueDate ? k.dueDate.toISOString().slice(0, 10) : ""}
            pengguna={penggunaOpsi}
          />
          <div className="mt-2">
            <GabungForm issueId={k.id} judul={k.title} kandidat={kandidatInduk} />
          </div>
        </div>
      ) : null}
    </li>
  );
}

export default async function KendalaPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; tingkat?: string; sumber?: string; cari?: string }>;
}) {
  const user = await requireUser();
  requireCapabilityPage(user.role, "location.view");
  const sp = await searchParams;
  const bolehKelola = can(user.role, "issue.manage");

  const status = (sp.status ?? null) as never;
  const { baris, ringkas } = await papanKendala(user, {
    status,
    severity: (sp.tingkat ?? null) as never,
    source: (sp.sumber ?? null) as never,
    cari: sp.cari ?? null,
  });

  const { db } = await import("@/lib/db");
  const pengguna = bolehKelola
    ? (
        await db.user.findMany({
          where: { isActive: true },
          select: { id: true, fullName: true },
          orderBy: { fullName: "asc" },
        })
      ).map((u) => ({ id: u.id, nama: u.fullName }))
    : [];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Kendala"
        description="Seluruh kendala lapangan dalam satu tempat – lintas lokasi dan paket, diurut dari yang paling perlu ditagih."
      />

      <section className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <KpiCard label="Terbuka" value={ringkas.terbuka} href="/kendala?status=terbuka" />
        <KpiCard label="Ditangani" value={ringkas.ditangani} href="/kendala?status=ditangani" />
        <KpiCard
          label="Lewat tenggat"
          value={ringkas.lewatTenggat}
          tone={ringkas.lewatTenggat > 0 ? "danger" : "default"}
          href="/kendala?status=lewat_tenggat"
        />
        <KpiCard
          label="Belum ada pemilik"
          value={ringkas.terbengkalai}
          tone={ringkas.terbengkalai > 0 ? "warning" : "default"}
          sub="dicatat, tapi tidak ada yang ditagih"
          href="/kendala?status=terbengkalai"
        />
        <KpiCard
          label={`Selesai ${HARI_SELESAI_TAMPIL} hari`}
          value={ringkas.selesai30Hari}
          href="/kendala?status=selesai"
        />
      </section>

      <Card>
        <CardHeader
          title={`${baris.length} kendala`}
          subtitle="Urutan: lewat tenggat → belum ada pemilik → tingkat → tenggat terdekat."
          action={<SaringKendala nilai={{ status: sp.status, tingkat: sp.tingkat, sumber: sp.sumber, cari: sp.cari }} />}
        />
        <CardBody>
          {baris.length === 0 ? (
            <EmptyState
              icon={AlertTriangle}
              title="Tidak ada kendala yang cocok"
              description={
                sp.status || sp.tingkat || sp.sumber || sp.cari
                  ? "Coba longgarkan saringannya."
                  : "Belum ada kendala terbuka pada lokasi yang boleh Anda lihat."
              }
            />
          ) : (
            <ul className="space-y-2">
              {baris.map((k) => (
                <BarisKendalaKartu
                  key={k.id}
                  k={k}
                  bolehKelola={bolehKelola}
                  penggunaOpsi={pengguna}
                  /*
                   * Calon induk = kendala LAIN di lokasi yang sama yang belum
                   * selesai. Lintas lokasi sengaja tidak ditawarkan sama
                   * sekali: aksinya memang menolaknya, tapi menawarkan lalu
                   * menolak mengajari orang bahwa pesan galat itu wajar.
                   */
                  kandidatInduk={baris
                    .filter(
                      (c) =>
                        c.id !== k.id &&
                        c.locationId === k.locationId &&
                        c.status !== "selesai",
                    )
                    .map((c) => ({
                      id: c.id,
                      title: c.title,
                      status: c.status,
                      createdAt: c.createdAt.toISOString(),
                    }))}
                />
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <p className="text-[12px] text-ink-muted">
        Kendala dicatat dari tab Progress lokasi, laporan harian, atau kegiatan lapangan – semuanya
        bermuara ke sini.{" "}
        <ButtonLink href="/lokasi" size="sm">
          Buka daftar lokasi
        </ButtonLink>
      </p>
    </div>
  );
}
