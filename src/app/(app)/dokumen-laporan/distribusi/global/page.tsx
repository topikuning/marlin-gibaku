import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Banner, Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { MessageSquareText } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { db } from "@/lib/db";
import { listSendableContacts } from "@/lib/contacts/queries";
import { listGlobalSummaryDates, listSummariesForDate } from "@/lib/waha/chat-summary";
import { SUMMARY_STATUS_LABEL, SUMMARY_STATUS_TONE, canSend } from "@/lib/waha/summary-lifecycle";
import { formatTanggal, formatTanggalWaktu, jakartaToday } from "@/lib/format";
import { SendGlobalForm } from "./send-global-form";

export const metadata: Metadata = { title: "Chat Grup — Ringkasan Global" };
export const dynamic = "force-dynamic";

/**
 * Ringkasan GLOBAL: semua ringkasan grup pada satu tanggal, siap dikirim ke
 * pimpinan lewat satu pesan WhatsApp (dengan pengantar AI bila > 1 paket).
 * DECISIONS 137.
 */
export default async function ChatGrupGlobalPage({
  searchParams,
}: {
  searchParams: Promise<{ d?: string }>;
}) {
  const user = await requireUser();
  requireCapabilityPage(user.role, "wa.chat");
  const sp = await searchParams;

  const [dates, contacts] = await Promise.all([
    listGlobalSummaryDates(user),
    listSendableContacts(user.id),
  ]);
  const todayKey = jakartaToday().toISOString().slice(0, 10);
  const dateKey = sp.d && /^\d{4}-\d{2}-\d{2}$/.test(sp.d) ? sp.d : (dates[0]?.dateKey ?? todayKey);
  const rows = await listSummariesForDate(user, dateKey);
  const sendable = rows.filter((r) => canSend(r.status));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Ringkasan Global Chat Grup"
        description="Gabungan ringkasan seluruh grup WhatsApp pada satu tanggal — kirim sekali jalan ke pimpinan."
        actions={
          <Link
            href="/dokumen-laporan/distribusi"
            className="inline-flex h-9 items-center rounded-md border border-border bg-surface px-3 text-sm font-medium text-primary hover:bg-surface-muted"
          >
            Per grup
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <Card className="self-start">
          <CardHeader title="Tanggal" subtitle="Hari yang sudah punya ringkasan." />
          <CardBody className="space-y-1">
            {dates.length === 0 ? (
              <p className="text-sm text-ink-muted">Belum ada ringkasan tersimpan.</p>
            ) : (
              dates.map((d) => (
                <Link
                  key={d.dateKey}
                  href={`/dokumen-laporan/distribusi/global?d=${d.dateKey}`}
                  aria-current={d.dateKey === dateKey ? "page" : undefined}
                  className={`flex items-center justify-between rounded-md px-2 py-1.5 text-sm ${
                    d.dateKey === dateKey ? "bg-info-soft text-primary" : "hover:bg-surface-muted"
                  }`}
                >
                  <span>{formatTanggal(new Date(`${d.dateKey}T00:00:00.000Z`))}</span>
                  <span className="text-xs text-ink-faint">{d.packages} grup</span>
                </Link>
              ))
            )}
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader
              title={`Kirim ke pimpinan — ${formatTanggal(new Date(`${dateKey}T00:00:00.000Z`))}`}
              subtitle={
                sendable.length > 1
                  ? `${sendable.length} ringkasan final digabung jadi satu pesan; AI menambahkan pengantar singkat.`
                  : `${sendable.length} ringkasan final pada tanggal ini.`
              }
            />
            <CardBody className="space-y-2">
              {rows.length === 0 ? (
                <p className="text-sm text-ink-muted">
                  Belum ada ringkasan pada tanggal ini — buat dulu di halaman per grup.
                </p>
              ) : (
                <>
                  {sendable.length < rows.length ? (
                    <Banner
                      tone="warning"
                      title={`${rows.length - sendable.length} ringkasan belum final`}
                      description="Hanya ringkasan berstatus final/terkirim yang ikut dikirim ke pimpinan. Finalkan dulu di halaman per grup."
                    />
                  ) : null}
                  <SendGlobalForm dateKey={dateKey} contacts={contacts} />
                </>
              )}
            </CardBody>
          </Card>

          {rows.length === 0 ? (
            <EmptyState icon={MessageSquareText} title="Belum ada ringkasan" className="py-8" />
          ) : (
            rows.map((r) => (
              <Card key={r.packageId}>
                <CardHeader
                  title={r.title}
                  subtitle={`${r.messageCount} pesan · diperbarui ${formatTanggalWaktu(r.updatedAt)}`}
                  action={
                    <span className="flex items-center gap-2">
                      <Badge tone={SUMMARY_STATUS_TONE[r.status]} label={SUMMARY_STATUS_LABEL[r.status]} />
                      <Link
                        href={`/dokumen-laporan/distribusi?p=${r.packageId}&d=${dateKey}`}
                        className="text-xs text-primary hover:underline"
                      >
                        Buka grup →
                      </Link>
                    </span>
                  }
                />
                <CardBody>
                  <p className="text-sm whitespace-pre-wrap text-ink">{r.summaryText}</p>
                </CardBody>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
