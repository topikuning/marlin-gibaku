import type { Metadata } from "next";
import Link from "next/link";
import { Banner, Card, CardBody, CardHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { getActiveAiConfig } from "@/lib/ai/config";
import { getAiGuardConfig } from "@/lib/ai-hub/guard";
import { resolveAiScope } from "@/lib/ai-hub/source";
import { formatTanggalWaktu } from "@/lib/format";
import { AskClient } from "./ask-client";

export const metadata: Metadata = { title: "AI Intelligence – Ask MARLIN" };
export const dynamic = "force-dynamic";

/**
 * Ask MARLIN — tanya-jawab grounded, read-only: satu pertanyaan = satu resolusi
 * sumber deterministik + satu panggilan terstruktur. Scope & periode terkunci
 * per percakapan; jawaban selalu membawa sitasi sumber. DECISIONS 133.
 */
export default async function AiAskPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const user = await requireUser();
  requireCapabilityPage(user.role, "ai.ask");
  const sp = await searchParams;

  const [scope, aiCfg, guard, conversations] = await Promise.all([
    resolveAiScope(user, []),
    getActiveAiConfig(),
    getAiGuardConfig(),
    db.aiConversation.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: { id: true, title: true, updatedAt: true, _count: { select: { messages: true } } },
    }),
  ]);

  const active = sp.c
    ? await db.aiConversation.findFirst({
        where: { id: sp.c, userId: user.id },
        select: {
          id: true,
          title: true,
          scopeIds: true,
          periodStart: true,
          periodEnd: true,
          messages: {
            orderBy: { createdAt: "asc" },
            select: { id: true, role: true, content: true, citations: true, confidence: true, runId: true },
          },
        },
      })
    : null;

  const locations = await db.location.findMany({
    where: { id: { in: scope.ids } },
    // Nama paket ikut: pemilih lokasi mengelompokkan per paket dan mencarinya
    // juga — tanpa ini 83 lokasi menumpuk jadi satu grup "Tanpa paket".
    select: { id: true, name: true, package: { select: { name: true } } },
    orderBy: { name: "asc" },
  });
  const aiReady = guard.enabled && !!aiCfg && can(user.role, "ai.ask");

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
      <Card className="self-start">
        <CardHeader title="Percakapan" subtitle="Scope & periode terkunci saat percakapan dibuat." />
        <CardBody className="space-y-1">
          <Link href="/ai/ask" className="block rounded-md border border-dashed border-border px-2 py-1.5 text-sm text-primary hover:border-primary">
            + Percakapan baru
          </Link>
          {conversations.map((c) => (
            <Link
              key={c.id}
              href={`/ai/ask?c=${c.id}`}
              aria-current={active?.id === c.id ? "page" : undefined}
              className={`block rounded-md px-2 py-1.5 text-sm ${active?.id === c.id ? "bg-info-soft text-primary" : "hover:bg-surface-muted"}`}
            >
              <span className="block truncate">{c.title ?? "Tanpa judul"}</span>
              <span className="block text-[11px] text-ink-faint">
                {formatTanggalWaktu(c.updatedAt)} · {c._count.messages} pesan
              </span>
            </Link>
          ))}
        </CardBody>
      </Card>

      <div className="space-y-3">
        {!aiReady ? (
          <Banner
            tone="warning"
            title={guard.enabled ? "Provider AI belum dikonfigurasi (Sistem → AI)." : "Fitur AI dinonaktifkan admin."}
          />
        ) : null}
        <AskClient
          conversation={
            active
              ? {
                  id: active.id,
                  scopeIds: active.scopeIds as string[],
                  scopeCount: (active.scopeIds as string[]).length,
                  periodStart: active.periodStart.toISOString().slice(0, 10),
                  periodEnd: active.periodEnd.toISOString().slice(0, 10),
                  messages: active.messages.map((m) => ({
                    id: m.id,
                    role: m.role,
                    content: m.content,
                    citations:
                      (m.citations as
                        | {
                            sourceRefId: string;
                            note: string | null;
                            label?: string | null;
                            value?: string | null;
                            href?: string | null;
                          }[]
                        | null) ?? [],
                    confidence: m.confidence,
                    runId: m.runId,
                  })),
                }
              : null
          }
          locations={locations.map((l) => ({ id: l.id, name: l.name, packageName: l.package?.name ?? null }))}
          aiReady={aiReady}
        />
      </div>
    </div>
  );
}
