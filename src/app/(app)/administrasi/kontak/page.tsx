import type { Metadata } from "next";
import { Banner, Card, CardBody, CardHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { db } from "@/lib/db";
import { getContactsView } from "@/lib/contacts/queries";
import { isWahaConfigured } from "@/lib/waha/config";
import { formatTanggalWaktu } from "@/lib/format";
import { KontakClient } from "./kontak-client";

export const metadata: Metadata = { title: "Manajemen Kontak" };
export const dynamic = "force-dynamic";

/**
 * Manajemen Kontak — satu rumah untuk semua kontak WhatsApp (DECISIONS 150).
 * Menggantikan pengelolaan kontak yang sebelumnya tersebar di /laporan-wa,
 * /master/kontak-wa, dan (untuk nama pengirim) tidak ada sama sekali.
 */
export default async function KontakPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "wa.chat");

  const [view, wahaOn, dispatches] = await Promise.all([
    getContactsView(user),
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

      <KontakClient
        mine={view.mine.map(toItem)}
        others={view.others.map(toItem)}
        aliases={view.aliases.map((a) => ({
          id: a.id,
          senderKey: a.senderKey,
          displayName: a.displayName,
          role: a.role,
          note: a.note,
          createdByName: a.createdByName,
        }))}
        canViewAll={view.canViewAll}
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

function toItem(c: {
  id: string;
  name: string;
  chatId: string;
  note: string | null;
  ownerName: string;
  ownerRole: string;
  mine: boolean;
}) {
  return {
    id: c.id,
    name: c.name,
    chatId: c.chatId,
    note: c.note,
    ownerName: c.ownerName,
    ownerRole: c.ownerRole,
    mine: c.mine,
  };
}
