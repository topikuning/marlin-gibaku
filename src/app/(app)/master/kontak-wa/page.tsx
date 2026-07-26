import type { Metadata } from "next";
import { Card, CardBody, CardHeader, Banner } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { db } from "@/lib/db";
import { isWahaConfigured } from "@/lib/waha/config";
import { formatTanggalWaktu } from "@/lib/format";
import { KontakWaClient } from "./kontak-wa-client";

export const metadata: Metadata = { title: "Kontak WhatsApp" };
export const dynamic = "force-dynamic";

/**
 * Manajemen kontak WhatsApp MANDIRI (DECISIONS 134) — dipakai distribusi
 * laporan AI (Report Studio) & laporan eksekutif. Kontak per-pemilik
 * (ownerId): tiap user mengelola daftar tujuannya sendiri.
 */
export default async function KontakWaPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "exec_report.send");

  const [contacts, wahaOn, dispatches] = await Promise.all([
    db.waContact.findMany({
      where: { ownerId: user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, chatId: true, note: true, createdAt: true },
    }),
    isWahaConfigured(),
    db.reportDispatch.findMany({
      where: { senderId: user.id },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, destName: true, reportKey: true, createdAt: true },
    }),
  ]);

  return (
    <div className="space-y-4">
      {!wahaOn ? (
        <Banner
          tone="warning"
          title="WAHA (gateway WhatsApp) belum dikonfigurasi"
          description="Kontak tetap bisa dikelola, tetapi pengiriman baru berfungsi setelah admin mengatur WAHA di Sistem."
        />
      ) : null}

      <KontakWaClient
        contacts={contacts.map((c) => ({ id: c.id, name: c.name, chatId: c.chatId, note: c.note }))}
      />

      <Card>
        <CardHeader title="Pengiriman terakhir Anda" subtitle="Jejak kiriman WhatsApp (laporan eksekutif) terbaru." />
        <CardBody>
          {dispatches.length === 0 ? (
            <p className="text-sm text-ink-muted">Belum ada pengiriman.</p>
          ) : (
            <ul className="divide-y divide-border-muted text-sm">
              {dispatches.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="truncate">
                    {d.destName} <span className="text-xs text-ink-muted">· {d.reportKey}</span>
                  </span>
                  <span className="tabular shrink-0 text-xs text-ink-muted">{formatTanggalWaktu(d.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
