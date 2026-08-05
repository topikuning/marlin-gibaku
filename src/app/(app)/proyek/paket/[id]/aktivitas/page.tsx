import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { History } from "lucide-react";
import { Card, CardBody, CardHeader, EmptyState, StatusPill } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { PACKAGE_STAGE_LABEL, PACKAGE_STAGE_TONE } from "@/lib/lifecycle";
import { formatTanggalWaktu } from "@/lib/format";
import {
  getPackageAuditLogs,
  getPackageWorkspace,
  getStageHistory,
} from "@/lib/package/queries";

export const metadata: Metadata = { title: "Aktivitas Paket" };
export const dynamic = "force-dynamic";

const ACTION_LABEL: Record<string, string> = {
  "package.create": "Paket dibuat",
  "package.update": "Data paket diubah",
  "package.stage": "Stage diubah",
  "package.cancel": "Paket dibatalkan",
  "package.location_add": "Lokasi target ditambahkan",
  "package.location_remove": "Lokasi target dihapus",
  "package.start_pelaksanaan": "Pelaksanaan dimulai",
  "contract.convert": "Konversi ke kontrak",
  "amendment.add": "Adendum dicatat",
};

type Entry = {
  key: string;
  at: Date;
  who: string;
  title: string;
  detail?: string;
  pill?: { tone: (typeof PACKAGE_STAGE_TONE)[keyof typeof PACKAGE_STAGE_TONE]; label: string };
};

function payloadSummary(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const p = payload as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof p.name === "string") parts.push(p.name);
  if (typeof p.contractNumber === "string") parts.push(`Kontrak ${p.contractNumber}`);
  if (typeof p.ccoNumber === "string") parts.push(`CCO ${p.ccoNumber}`);
  if (typeof p.slug === "string") parts.push(p.slug);
  if (typeof p.note === "string") parts.push(p.note);
  return parts.length ? parts.join(" · ") : undefined;
}

export default async function AktivitasPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  requireCapabilityPage(user.role, "package.view");
  const { id } = await params;

  const pkg = await getPackageWorkspace(id);
  if (!pkg) notFound();

  const [history, logs] = await Promise.all([
    getStageHistory(pkg.id),
    getPackageAuditLogs(pkg.id),
  ]);

  const entries: Entry[] = [
    ...history.map((h) => ({
      key: `stage-${h.id}`,
      at: h.changedAt,
      who: h.changedByName,
      title: h.fromStage
        ? `Stage ${PACKAGE_STAGE_LABEL[h.fromStage]} → ${PACKAGE_STAGE_LABEL[h.toStage]}`
        : `Stage awal ${PACKAGE_STAGE_LABEL[h.toStage]}`,
      detail: h.note ?? undefined,
      pill: {
        tone: PACKAGE_STAGE_TONE[h.toStage],
        label: PACKAGE_STAGE_LABEL[h.toStage],
      },
    })),
    ...logs.map((l) => ({
      key: `audit-${l.id}`,
      at: l.createdAt,
      who: l.user?.fullName ?? "Sistem",
      title: ACTION_LABEL[l.action] ?? l.action,
      detail: payloadSummary(l.payload),
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <Card>
      <CardHeader
        title="Aktivitas paket"
        subtitle="Gabungan histori stage (append-only) dan audit log mutasi"
      />
      <CardBody>
        {entries.length === 0 ? (
          <EmptyState icon={History} title="Belum ada aktivitas" />
        ) : (
          <ol className="relative space-y-4 border-l border-border pl-5">
            {entries.map((e) => (
              <li key={e.key} className="relative">
                <span
                  aria-hidden
                  className="absolute top-1.5 -left-[26.5px] size-3 rounded-full border-2 border-surface bg-primary"
                />
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium text-ink">{e.title}</span>
                  {e.pill ? <StatusPill tone={e.pill.tone} label={e.pill.label} /> : null}
                </div>
                {e.detail ? <p className="mt-0.5 text-[13px] text-ink-muted">{e.detail}</p> : null}
                <p className="mt-0.5 text-xs text-ink-faint">
                  {e.who} · {formatTanggalWaktu(e.at)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </CardBody>
    </Card>
  );
}
