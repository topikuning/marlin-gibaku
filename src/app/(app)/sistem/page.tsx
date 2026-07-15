import type { Metadata } from "next";
import { PageHeader, Card, CardHeader, CardBody, StatusPill } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { env } from "@/lib/env";
import { isR2Configured } from "@/lib/r2";
import { db } from "@/lib/db";
import { formatTanggalWaktu } from "@/lib/format";
import { getBranding, BRAND_DEFAULTS } from "@/lib/branding";
import { R2TestPanel, ResetPanel, BrandingPanel } from "./sistem-client";

export const metadata: Metadata = { title: "Sistem" };
export const dynamic = "force-dynamic";

export default async function SistemPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "system.manage");
  const [auditLogs, sessionCount, branding] = await Promise.all([
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
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Sistem" description="Diagnostik, audit trail, dan zona berbahaya (khusus development)." />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Status" />
          <CardBody>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-muted">Environment</dt>
                <dd><StatusPill tone={env.APP_ENV === "production" ? "success" : "warning"} label={env.APP_ENV} /></dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-muted">Cloudflare R2</dt>
                <dd><StatusPill tone={isR2Configured() ? "success" : "neutral"} label={isR2Configured() ? "Terkonfigurasi" : "Belum dikonfigurasi"} /></dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-muted">Sesi aktif</dt>
                <dd className="tabular">{sessionCount}</dd>
              </div>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Diagnostik R2 & foto" subtitle="Round-trip R2 (PUT→GET→presign→DELETE) + tes pemrosesan gambar (SHARP)" />
          <CardBody>
            <R2TestPanel configured={isR2Configured()} />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Branding" subtitle="Identitas produk (global) + konteks proyek (tambahan)" />
        <CardBody>
          <BrandingPanel initial={branding} defaults={BRAND_DEFAULTS} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Audit trail" subtitle="100 mutasi terakhir (append-only)" />
        <CardBody>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase text-ink-muted">
                  <th className="py-2 pr-3">Waktu</th>
                  <th className="py-2 pr-3">Pengguna</th>
                  <th className="py-2 pr-3">Aksi</th>
                  <th className="py-2">Resource</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {auditLogs.map((l) => (
                  <tr key={l.id}>
                    <td className="py-1.5 pr-3 whitespace-nowrap tabular">{formatTanggalWaktu(l.createdAt)}</td>
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

      {env.APP_ENV !== "production" && (
        <Card>
          <CardHeader title="Zona berbahaya (development)" subtitle="Tidak tersedia di production" />
          <CardBody>
            <ResetPanel />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
