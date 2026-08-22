import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Banner, Card, CardBody, CardHeader } from "@/components/ui";
import { accessibleLocationIds, requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { scopeCoveredBy } from "@/lib/ai-hub/read-scope";
import { getActiveAiConfig } from "@/lib/ai/config";
import { mingguKontrak, mingguSelesaiTerakhir } from "@/lib/mingguan/kirim";
import { AI_ARTIFACT_STATUS_LABEL, AI_ARTIFACT_STATUS_TONE } from "@/lib/lifecycle";
import { formatTanggalWaktu } from "@/lib/format";
import { PaparanGenerateClient } from "./generate-client";

export const metadata: Metadata = { title: "AI Intelligence – Paparan KKP" };
export const dynamic = "force-dynamic";

/**
 * PAPARAN MINGGUAN KKP (DECISIONS 416): pilih SATU paket berkontrak + SATU
 * minggu kontrak → draft deck 16:9 ber-lifecycle. Hanya paket yang SELURUH
 * lokasi aktifnya dalam akses user yang ditawarkan — paparan kontrak parsial
 * tidak boleh menyamar sebagai paparan lengkap.
 */
export default async function PaparanPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const user = await requireUser();
  requireCapabilityPage(user.role, "ai.view");
  const initialPackageId = typeof sp.paket === "string" ? sp.paket : undefined;

  const now = new Date();
  const boleh = await accessibleLocationIds(user);
  const semuaPaket = await db.package.findMany({
    where: { orgId: user.orgId, contract: { isNot: null } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      contract: { select: { startDate: true } },
      locations: { where: { isActive: true }, select: { id: true } },
    },
  });
  const tercakup = (ids: string[]) =>
    boleh === null ? true : ids.every((id) => new Set(boleh).has(id));
  // Jumlah paket yang DISEMBUNYIKAN ikut disebut — "tidak muncul" tidak boleh
  // terbaca "tidak ada" (CLAUDE.md).
  const bersyarat = semuaPaket.filter((p) => p.contract?.startDate && p.locations.length > 0);
  const tersembunyi = bersyarat.filter((p) => !tercakup(p.locations.map((l) => l.id))).length;
  const paket = bersyarat
    .filter((p) => tercakup(p.locations.map((l) => l.id)))
    .map((p) => ({
      id: p.id,
      name: p.name,
      lokasi: p.locations.length,
      mingguBerjalan: mingguKontrak(p.contract!.startDate!, now),
      mingguSelesai: mingguSelesaiTerakhir(p.contract!.startDate!, now),
    }));

  const bolehGenerate = can(user.role, "ai.generate");
  const aiCfg = await getActiveAiConfig();

  // Artefak paparan terbaru — organisasi disaring lewat relasi paket (kolom
  // packageId nyata), lalu scope per-artefak lewat scopeIds run-nya.
  const accessible = boleh;
  const artefakSemua = await db.aiArtifact.findMany({
    where: { kind: "paparan", package: { orgId: user.orgId } },
    orderBy: { updatedAt: "desc" },
    take: 30,
    select: {
      id: true,
      title: true,
      version: true,
      status: true,
      updatedAt: true,
      structuredContent: true,
      createdById: true,
      package: { select: { name: true } },
      run: { select: { scopeIds: true } },
    },
  });
  const artefak = artefakSemua.filter((a) => scopeCoveredBy(accessible, a.run?.scopeIds ?? null));
  const pembuat = new Map(
    (
      await db.user.findMany({
        where: { id: { in: [...new Set(artefak.map((a) => a.createdById))] } },
        select: { id: true, fullName: true },
      })
    ).map((u) => [u.id, u.fullName]),
  );

  return (
    <div className="space-y-4">
      {!aiCfg ? (
        <Banner
          tone="info"
          title="Provider AI belum aktif – paparan tetap bisa dibuat"
          description="Narasinya disusun deterministik dari data terstruktur MARLIN, dan itu disebut di slide lampiran."
        />
      ) : null}
      {tersembunyi > 0 ? (
        <Banner
          tone="info"
          title={`${tersembunyi} paket disembunyikan`}
          description="Paparan kontrak menuntut akses ke SELURUH lokasi aktif paket. Paket yang sebagian lokasinya di luar akses Anda tidak ditawarkan."
        />
      ) : null}

      {bolehGenerate ? (
        <PaparanGenerateClient paket={paket} initialPackageId={initialPackageId} />
      ) : (
        <Banner tone="info" title="Anda bisa melihat paparan, tetapi tidak membuat baru (butuh ai.generate)." />
      )}

      <Card>
        <CardHeader
          title="Paparan terbaru"
          subtitle="Satu paparan = satu paket + satu minggu kontrak + satu versi. Regenerate selalu membuat versi baru."
        />
        <CardBody className="px-0 py-0">
          {artefak.length === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-muted">Belum ada paparan. Buat dari formulir di atas.</p>
          ) : (
            <ul className="divide-y divide-border">
              {artefak.map((a) => {
                const c = a.structuredContent as { weekNumber?: number } | null;
                return (
                  <li key={a.id}>
                    <Link
                      href={`/ai/paparan/${a.id}`}
                      className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 hover:bg-surface-muted"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">{a.title}</span>
                        <span className="block text-xs text-ink-muted">
                          {a.package?.name} · Minggu ke-{c?.weekNumber ?? "?"} · v{a.version} ·{" "}
                          {pembuat.get(a.createdById) ?? "–"} · {formatTanggalWaktu(a.updatedAt)}
                        </span>
                      </span>
                      <Badge tone={AI_ARTIFACT_STATUS_TONE[a.status]}>{AI_ARTIFACT_STATUS_LABEL[a.status]}</Badge>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
