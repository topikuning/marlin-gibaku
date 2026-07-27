import type { Metadata } from "next";
import { Fragment, type ReactNode } from "react";
import { headers } from "next/headers";
import { Card, CardHeader, CardBody, KpiCard, StatusPill } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { env } from "@/lib/env";
import { isR2Configured } from "@/lib/r2";
import { getWahaConfigDisplay, getWahaHits } from "@/lib/waha/config";
import { getGDriveConfigDisplay } from "@/lib/gdrive/config";
import { driveRedirectUriFrom } from "@/lib/gdrive/origin";
import { GDrivePanel } from "./gdrive-panel";
import { db } from "@/lib/db";
import { formatTanggalWaktu, jakartaToday } from "@/lib/format";
import { getBranding, BRAND_DEFAULTS } from "@/lib/branding";
import { getPhotoStampConfig } from "@/lib/photo-stamp/config";
import { getActivityKinds } from "@/lib/field-activity/kinds";
import { aiSecretStorageStatus, getAiConfigDisplay } from "@/lib/ai/config";
import { getAiGuardConfig, getAiPricing } from "@/lib/ai-hub/guard";
import { AiGuardPanel } from "./ai-guard-panel";
import { CAPABILITIES, ROLE_CAPABILITIES, ROLE_LABEL, ALL_ROLES, type Capability } from "@/lib/authz";
import type { UserRole } from "@/generated/prisma/enums";
import {
  R2TestPanel,
  ResetPanel,
  RebuildSnapshotPanel,
  BrandingPanel,
  WahaConfigPanel,
  WahaWebhookPanel,
  PhotoStampPanel,
  ActivityKindsPanel,
  AiProvidersPanel,
  SettingsTabs,
} from "./sistem-client";

export const metadata: Metadata = { title: "Pengaturan Sistem" };
export const dynamic = "force-dynamic";

/* ── helper presentasional (server) ─────────────────────────────────────── */

function HealthRow({
  label,
  detail,
  tone,
  status,
}: {
  label: string;
  detail: string;
  tone: "success" | "warning" | "neutral" | "danger";
  status: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-0.5 text-[13px] text-ink-muted">{detail}</p>
      </div>
      <StatusPill tone={tone} label={status} />
    </div>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-2 last:border-0">
      <span className="text-[13px] text-ink-muted">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

function IntegrationHeader({
  code,
  title,
  desc,
  tone,
  status,
}: {
  code: string;
  title: string;
  desc: string;
  tone: "success" | "warning" | "neutral";
  status: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="grid size-10 flex-none place-items-center rounded-lg bg-primary-50 text-sm font-bold text-primary">
        {code}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">{title}</h3>
          <StatusPill tone={tone} label={status} />
        </div>
        <p className="mt-1 text-[13px] text-ink-muted">{desc}</p>
      </div>
    </div>
  );
}

/** Kelompok kapabilitas untuk matriks hak akses (read-only). */
const CAPABILITY_GROUPS: { title: string; match: (c: Capability) => boolean }[] = [
  { title: "Portofolio & Paket", match: (c) => /^(portfolio|package|prospect|contract|amendment)\./.test(c) },
  {
    title: "Lokasi & Pelaksanaan",
    match: (c) => /^(location|rab|baseline|weekly_plan|daily_report|field_activity|progress|issue)\./.test(c),
  },
  { title: "Keuangan & Dokumen", match: (c) => /^(finance|document|compliance|report)\./.test(c) },
  { title: "Sistem & Akses", match: (c) => /^(wa|user|system|audit)\./.test(c) },
];

/* ── halaman ─────────────────────────────────────────────────────────────── */

export default async function SistemPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "system.manage");

  const todayStart = jakartaToday();
  const [auditLogs, sessionCount, branding, wahaDisplay, photoStamp, activeUsers, auditToday, roleCounts] =
    await Promise.all([
      db.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          action: true,
          resourceType: true,
          resourceId: true,
          createdAt: true,
          user: { select: { username: true, fullName: true } },
        },
      }),
      db.session.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }),
      getBranding(),
      getWahaConfigDisplay(),
      getPhotoStampConfig(),
      db.user.count({ where: { isActive: true } }),
      db.auditLog.count({ where: { createdAt: { gte: todayStart } } }),
      db.user.groupBy({ by: ["role"], _count: { _all: true } }),
    ]);
  const activityKinds = await getActivityKinds();
  const maintenanceLocations = await db.location.findMany({
    where: { package: { orgId: user.orgId } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const gdriveDisplay = await getGDriveConfigDisplay();
  const aiConfig = await getAiConfigDisplay();
  const aiGuard = await getAiGuardConfig();
  const aiPricing = await getAiPricing();
  const aiSecretStatus = aiSecretStorageStatus();

  const r2On = isR2Configured();
  const wahaConfigured = wahaDisplay.hasApiKey && wahaDisplay.baseUrl.length > 0;
  // Integrasi terhubung: R2, WAHA, Database (selalu terhubung — query barusan sukses).
  const activeIntegrations = (r2On ? 1 : 0) + (wahaConfigured ? 1 : 0) + 1;

  // Webhook inbound WAHA: URL (origin dari header) + token secret + statistik tangkapan.
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host") ?? ""}`;
  const webhookUrl = wahaDisplay.webhookSecret
    ? `${origin}/api/waha/webhook?token=${encodeURIComponent(wahaDisplay.webhookSecret)}`
    : null;
  const [waCapturedCount, waLast, waHits] = await Promise.all([
    db.waMessage.count(),
    db.waMessage.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    getWahaHits(),
  ]);
  const waHitsFmt = waHits.map((hit) => ({ ...hit, at: formatTanggalWaktu(new Date(hit.at)) }));

  const roleCountMap = new Map<UserRole, number>(roleCounts.map((r) => [r.role, r._count._all]));
  const securityLogs = auditLogs
    .filter((l) => /^(user|auth|session|system)\./.test(l.action) || /password|login|masuk/i.test(l.action))
    .slice(0, 12);

  /* ── PANEL: Ringkasan ─────────────────────────────────────────────────── */
  const overviewPanel: ReactNode = (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader title="Kesehatan Layanan" subtitle="Status komponen inti sistem" />
        <CardBody>
          <HealthRow
            label="Environment"
            detail="Mode aplikasi berjalan"
            tone={env.APP_ENV === "production" ? "success" : "warning"}
            status={env.APP_ENV}
          />
          <HealthRow label="Database PostgreSQL" detail="Koneksi & query aktif" tone="success" status="Terhubung" />
          <HealthRow
            label="Cloudflare R2"
            detail="Penyimpanan dokumen & foto"
            tone={r2On ? "success" : "neutral"}
            status={r2On ? "Terkonfigurasi" : "Belum diatur"}
          />
          <HealthRow
            label="WhatsApp (WAHA)"
            detail="Gateway kirim & tangkap pesan"
            tone={wahaConfigured ? "success" : "neutral"}
            status={wahaConfigured ? "Terkonfigurasi" : "Belum diatur"}
          />
          <HealthRow label="Sesi aktif" detail="Login pengguna berjalan" tone="neutral" status={String(sessionCount)} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Konfigurasi Penting" subtitle="Parameter global (read-only)" />
        <CardBody>
          <ConfigRow label="Zona waktu" value="Asia/Jakarta (WIB/WITA/WIT)" />
          <ConfigRow label="Locale" value="id-ID (Bahasa Indonesia)" />
          <ConfigRow label="Mata uang" value="IDR — Rupiah (BigInt)" />
          <ConfigRow label="Retensi audit" value="Append-only (permanen)" />
          <ConfigRow label="Owner agency" value="KKP" />
        </CardBody>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader title="Perubahan Terbaru" subtitle="6 mutasi terakhir" />
        <CardBody>
          {auditLogs.slice(0, 6).map((l) => (
            <div
              key={l.id}
              className="flex items-center justify-between gap-3 border-b border-border py-2 last:border-0"
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-[13px]">{l.action}</p>
                <p className="mt-0.5 text-[13px] text-ink-muted">
                  {l.user ? l.user.fullName : "—"} · {l.resourceType}
                </p>
              </div>
              <span className="tabular flex-none text-[13px] whitespace-nowrap text-ink-muted">
                {formatTanggalWaktu(l.createdAt)}
              </span>
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );

  /* ── PANEL: Integrasi ─────────────────────────────────────────────────── */
  const integrationsPanel: ReactNode = (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Diagnostik R2 & Foto" subtitle="Round-trip R2 (PUT→GET→presign→DELETE) + tes SHARP" />
        <CardBody className="space-y-4">
          <IntegrationHeader
            code="R2"
            title="Cloudflare R2 Storage"
            desc="Penyimpanan objek untuk dokumen, foto, dan lampiran."
            tone={r2On ? "success" : "neutral"}
            status={r2On ? "Terkonfigurasi" : "Belum diatur"}
          />
          <R2TestPanel configured={r2On} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="WhatsApp (WAHA)" subtitle="Server WAHA (URL + API key + sesi) & cek status login" />
        <CardBody className="space-y-4">
          <IntegrationHeader
            code="WA"
            title="WhatsApp Gateway"
            desc="Kirim laporan/kegiatan & tangkap percakapan grup. Panduan: docs/WAHA_SETUP.md."
            tone={wahaConfigured ? "success" : "neutral"}
            status={wahaConfigured ? "Terkonfigurasi" : "Belum diatur"}
          />
          <WahaConfigPanel initial={wahaDisplay} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Tangkap Percakapan WhatsApp (webhook)"
          subtitle="Arsipkan pesan grup tertaut paket — fondasi ringkasan/telusur berbasis AI"
        />
        <CardBody>
          <WahaWebhookPanel
            webhookUrl={webhookUrl}
            hasSecret={!!wahaDisplay.webhookSecret}
            capturedCount={waCapturedCount}
            lastCapturedAt={waLast ? formatTanggalWaktu(waLast.createdAt) : null}
            hits={waHitsFmt}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Google Drive"
          subtitle="Upload PDF/Excel laporan harian & mingguan ke folder Drive per paket (pemberian KKP)"
        />
        <CardBody className="space-y-4">
          <IntegrationHeader
            code="GD"
            title="Google Drive"
            desc="OAuth akun Gmail yang jadi editor folder KKP. Folder per paket diatur di halaman paket."
            tone={gdriveDisplay.connected ? "success" : "neutral"}
            status={gdriveDisplay.connected ? "Terhubung" : "Belum terhubung"}
          />
          <GDrivePanel initial={gdriveDisplay} redirectUri={driveRedirectUriFrom(h)} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="PostgreSQL Database" subtitle="Dikelola di Railway" />
        <CardBody>
          <IntegrationHeader
            code="DB"
            title="PostgreSQL 16"
            desc="Sumber data utama. Migrasi via Prisma; backup & skala dikelola di dashboard Railway."
            tone="success"
            status="Terhubung"
          />
        </CardBody>
      </Card>
    </div>
  );

  /* ── PANEL: Akses & Keamanan ──────────────────────────────────────────── */
  const accessPanel: ReactNode = (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Ringkasan Pengguna" subtitle="Jumlah akun per peran" />
          <CardBody>
            {ALL_ROLES.map((role) => (
              <ConfigRow key={role} label={ROLE_LABEL[role]} value={String(roleCountMap.get(role) ?? 0)} />
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Aktivitas Keamanan" subtitle="Mutasi terkait akun, sesi & sistem" />
          <CardBody>
            {securityLogs.length === 0 ? (
              <p className="text-sm text-ink-muted">Belum ada aktivitas keamanan tercatat.</p>
            ) : (
              securityLogs.map((l) => (
                <div
                  key={l.id}
                  className="flex items-center justify-between gap-3 border-b border-border py-2 last:border-0"
                >
                  <div className="min-w-0">
                    <p className="truncate font-mono text-[13px]">{l.action}</p>
                    <p className="mt-0.5 text-[13px] text-ink-muted">{l.user ? l.user.fullName : "—"}</p>
                  </div>
                  <span className="tabular flex-none text-[13px] whitespace-nowrap text-ink-muted">
                    {formatTanggalWaktu(l.createdAt)}
                  </span>
                </div>
              ))
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Hak Akses per Peran"
          subtitle="Matriks kapabilitas (read-only) — sumber: src/lib/authz.ts"
        />
        <CardBody>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-ink-muted">
                  <th className="py-2 pr-3 font-medium">Kapabilitas</th>
                  {ALL_ROLES.map((role) => (
                    <th key={role} className="px-2 py-2 text-center font-medium whitespace-nowrap">
                      {ROLE_LABEL[role]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CAPABILITY_GROUPS.map((group) => {
                  const caps = CAPABILITIES.filter(group.match);
                  return (
                    <Fragment key={group.title}>
                      <tr className="bg-surface-inset">
                        <td
                          colSpan={ALL_ROLES.length + 1}
                          className="px-2 py-1.5 text-xs font-semibold text-ink-muted"
                        >
                          {group.title}
                        </td>
                      </tr>
                      {caps.map((cap) => (
                        <tr key={cap} className="border-b border-border">
                          <td className="py-1.5 pr-3 font-mono text-[13px]">{cap}</td>
                          {ALL_ROLES.map((role) => (
                            <td key={role} className="px-2 py-1.5 text-center">
                              {ROLE_CAPABILITIES[role].has(cap) ? (
                                <span className="text-success" aria-label="ya">
                                  ●
                                </span>
                              ) : (
                                <span className="text-border-strong" aria-label="tidak">
                                  ·
                                </span>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[13px] text-ink-muted">
            Matriks ini didefinisikan di kode (single source of truth) dan belum dapat diedit dari UI.
          </p>
        </CardBody>
      </Card>
    </div>
  );

  /* ── PANEL: AI ────────────────────────────────────────────────────────── */
  const aiPanel: ReactNode = (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Provider AI"
          subtitle="Atur Claude, ChatGPT (OpenAI), Mistral, Grok — pilih satu yang aktif untuk fitur AI"
        />
        <CardBody>
          <AiProvidersPanel activeProvider={aiConfig.activeProvider} providers={aiConfig.providers} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="Kontrol AI Hub"
          subtitle="Kill switch, rate limit, batas ukuran, dan pricing token — mengatur seluruh fitur AI Intelligence (DECISIONS 133)"
        />
        <CardBody>
          <AiGuardPanel
            enabled={aiGuard.enabled}
            maxRunsPerUserPerHour={aiGuard.maxRunsPerUserPerHour}
            maxRunsPerOrgPerDay={aiGuard.maxRunsPerOrgPerDay}
            maxLocationsPerRun={aiGuard.maxLocationsPerRun}
            maxOutputTokens={aiGuard.maxOutputTokens}
            pricing={aiPricing}
            secretStatus={aiSecretStatus}
          />
        </CardBody>
      </Card>
    </div>
  );

  /* ── PANEL: Branding & Photo Stamp ────────────────────────────────────── */
  const brandingPanel: ReactNode = (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Identitas Merek" subtitle="Identitas produk (global) + konteks proyek (tambahan)" />
        <CardBody>
          <BrandingPanel initial={branding} defaults={BRAND_DEFAULTS} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Cap Foto — Warna Aksen & Tata Letak"
          subtitle="Warna aksen photo stamp, kekuatan overlay, ukuran, dan elemen yang ditampilkan"
        />
        <CardBody>
          <PhotoStampPanel initial={photoStamp} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Jenis Kegiatan Lapangan"
          subtitle="Master data pilihan dropdown saat mencatat kegiatan lapangan (survei awal, PCM, dst.)"
        />
        <CardBody>
          <ActivityKindsPanel kinds={activityKinds} />
        </CardBody>
      </Card>
    </div>
  );

  /* ── PANEL: Audit Trail ───────────────────────────────────────────────── */
  const auditPanel: ReactNode = (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Log Aktivitas" subtitle="100 mutasi terakhir (append-only)" />
        <CardBody>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-ink-muted uppercase">
                  <th className="py-2 pr-3 font-medium">Waktu</th>
                  <th className="py-2 pr-3 font-medium">Pengguna</th>
                  <th className="py-2 pr-3 font-medium">Aksi</th>
                  <th className="py-2 font-medium">Resource</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {auditLogs.map((l) => (
                  <tr key={l.id}>
                    <td className="tabular py-1.5 pr-3 whitespace-nowrap">{formatTanggalWaktu(l.createdAt)}</td>
                    <td className="py-1.5 pr-3">{l.user ? `${l.user.fullName} (@${l.user.username})` : "—"}</td>
                    <td className="py-1.5 pr-3 font-mono text-xs">{l.action}</td>
                    <td className="py-1.5 text-xs text-ink-muted">
                      {l.resourceType}
                      {l.resourceId ? ` · ${l.resourceId.slice(0, 8)}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Pemeliharaan data"
          subtitle="Koreksi angka cetakan laporan final tanpa mengubah status atau data input"
        />
        <CardBody>
          <RebuildSnapshotPanel locations={maintenanceLocations} />
        </CardBody>
      </Card>

      {env.APP_ENV !== "production" && (
        <Card className="border-danger/40">
          <CardHeader title="Zona Berbahaya (development)" subtitle="Tidak tersedia di production" />
          <CardBody>
            <ResetPanel />
          </CardBody>
        </Card>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pengaturan Sistem</h1>
          <p className="mt-1 text-sm text-ink-muted">Integrasi, akses &amp; keamanan, branding, dan audit trail.</p>
        </div>
        <div className="text-right">
          <div className="flex items-center justify-end gap-2">
            <span className="text-[13px] text-ink-muted">Environment</span>
            <StatusPill tone={env.APP_ENV === "production" ? "success" : "warning"} label={env.APP_ENV} />
          </div>
          <p className="mt-1 text-[13px] text-ink-muted">Asia/Jakarta · id-ID · IDR</p>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Layanan Aktif" value={`${activeIntegrations}/3`} sub="Integrasi terhubung" />
        <KpiCard label="Pengguna Aktif" value={activeUsers} sub="Akun bisa login" />
        <KpiCard label="Sesi Aktif" value={sessionCount} sub="Login berjalan" />
        <KpiCard label="Audit Hari Ini" value={auditToday} sub="Mutasi tercatat" />
      </div>

      <SettingsTabs
        tabs={[
          { key: "overview", label: "Ringkasan" },
          { key: "integrations", label: "Integrasi" },
          { key: "ai", label: "AI" },
          { key: "access", label: "Akses & Keamanan" },
          { key: "branding", label: "Branding & Photo Stamp" },
          { key: "audit", label: "Audit Trail" },
        ]}
        panels={{
          overview: overviewPanel,
          integrations: integrationsPanel,
          ai: aiPanel,
          access: accessPanel,
          branding: brandingPanel,
          audit: auditPanel,
        }}
      />
    </div>
  );
}
