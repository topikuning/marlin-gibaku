import type { Metadata } from "next";
import { PageHeader, Banner } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { db } from "@/lib/db";
import { formatTanggalWaktu } from "@/lib/format";
import { isWahaConfigured } from "@/lib/waha/config";
import { getActiveAiConfig } from "@/lib/ai/config";
import { LaporanWaClient } from "./laporan-wa-client";

export const metadata: Metadata = { title: "Laporan Eksekutif → WA" };
export const dynamic = "force-dynamic";

export default async function LaporanWaPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "exec_report.send");

  const [contacts, dispatches, wahaOn, aiCfg] = await Promise.all([
    db.waContact.findMany({
      where: { ownerId: user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, chatId: true, note: true },
    }),
    db.reportDispatch.findMany({
      where: { senderId: user.id },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, reportKey: true, destName: true, createdAt: true },
    }),
    isWahaConfigured(),
    getActiveAiConfig(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Laporan Eksekutif → WA"
        description="Susun rangkuman dengan AI lalu kirim ke direksi/manajemen via WhatsApp."
      />
      {!aiCfg ? (
        <Banner
          tone="warning"
          title="Provider AI belum aktif"
          description="Buka Sistem → AI, isi API key & jadikan satu provider aktif agar laporan bisa disusun."
        />
      ) : null}
      {!wahaOn ? (
        <Banner
          tone="warning"
          title="WhatsApp (WAHA) belum dikonfigurasi"
          description="Buka Sistem → Integrasi untuk mengatur WAHA agar laporan bisa dikirim."
        />
      ) : null}
      <LaporanWaClient
        contacts={contacts}
        dispatches={dispatches.map((d) => ({
          id: d.id,
          reportKey: d.reportKey,
          destName: d.destName,
          at: formatTanggalWaktu(d.createdAt),
        }))}
        aiReady={!!aiCfg}
        waReady={wahaOn}
      />
    </div>
  );
}
