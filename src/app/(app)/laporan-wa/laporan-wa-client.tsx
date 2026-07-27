"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Banner, Button, Card, CardBody, CardHeader, Input, Label, Select, StatusPill, Textarea } from "@/components/ui";
import { cn } from "@/lib/cn";
import { EXEC_REPORTS, PERIOD_PRESETS, execReportMeta } from "@/lib/exec-report/catalog";
import {
  generateExecReportAction,
  sendExecReportAction,
  type ExecReportState,
  type ExecSendState,
} from "@/lib/exec-report/actions";

type Contact = { id: string; name: string; chatId: string; note: string | null };
type Dispatch = { id: string; reportKey: string; destName: string; at: string };

export function LaporanWaClient({
  contacts,
  dispatches,
  aiReady,
  waReady,
}: {
  contacts: Contact[];
  dispatches: Dispatch[];
  aiReady: boolean;
  waReady: boolean;
}) {
  const [genState, genAction, generating] = useActionState<ExecReportState, FormData>(
    generateExecReportAction,
    undefined,
  );
  const [sendState, sendAction, sending] = useActionState<ExecSendState, FormData>(sendExecReportAction, undefined);

  const [reportKey, setReportKey] = useState<string>(EXEC_REPORTS[0].key);
  const [period, setPeriod] = useState("hari_ini");
  const [text, setText] = useState("");
  const [lastDraft, setLastDraft] = useState<string | undefined>(undefined);
  const [destMode, setDestMode] = useState<"kontak" | "bebas">(contacts.length > 0 ? "kontak" : "bebas");

  // Draf baru dari AI mengisi teks yang bisa diedit — pola "adjust state during
  // render" (bukan useEffect) agar sinkron tanpa render ganda.
  if (genState?.draft !== undefined && genState.draft !== lastDraft) {
    setLastDraft(genState.draft);
    setText(genState.draft);
  }

  const canGenerate = aiReady && !generating;
  const hasDraft = text.trim().length > 0 && !!genState?.reportKey;

  return (
    <div className="space-y-6">
      {/* 1. Pilih laporan + periode + susun AI */}
      <Card>
        <CardHeader title="1. Pilih laporan & periode" subtitle="AI akan menyusun draf dari data lokasi dalam cakupanmu" />
        <CardBody>
          <form action={genAction} className="space-y-4">
            {genState?.error ? <Banner tone="error" title={genState.error} /> : null}

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Jenis laporan</legend>
              {EXEC_REPORTS.map((r) => (
                <label
                  key={r.key}
                  className={cn(
                    "flex cursor-pointer gap-3 rounded-lg border p-3",
                    reportKey === r.key ? "border-primary bg-primary-50" : "border-border",
                  )}
                >
                  <input
                    type="radio"
                    name="reportKey"
                    value={r.key}
                    checked={reportKey === r.key}
                    onChange={() => setReportKey(r.key)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{r.label}</span>
                    <span className="block text-[13px] text-ink-muted">{r.desc}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="period">Periode</Label>
                <Select id="period" name="period" value={period} onChange={(e) => setPeriod(e.target.value)}>
                  {PERIOD_PRESETS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            {period === "custom" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="startDate">Dari tanggal</Label>
                  <Input id="startDate" name="startDate" type="date" />
                </div>
                <div>
                  <Label htmlFor="endDate">Sampai tanggal</Label>
                  <Input id="endDate" name="endDate" type="date" />
                </div>
              </div>
            ) : null}

            <Button type="submit" loading={generating} disabled={!canGenerate}>
              Susun dengan AI
            </Button>
            {!aiReady ? (
              <p className="text-[13px] text-warning">Provider AI belum aktif — atur di Sistem → AI.</p>
            ) : null}
          </form>
        </CardBody>
      </Card>

      {/* 2. Pratinjau + edit + kirim */}
      <Card>
        <CardHeader
          title="2. Pratinjau, edit & kirim"
          subtitle={genState?.label ? `Periode: ${genState.label}` : "Susun dulu di langkah 1"}
        />
        <CardBody>
          <form action={sendAction} className="space-y-4">
            {sendState?.error ? <Banner tone="error" title={sendState.error} /> : null}
            {sendState?.success ? <Banner tone="success" title={sendState.success} /> : null}

            <input type="hidden" name="reportKey" value={genState?.reportKey ?? reportKey} />
            <input type="hidden" name="startKey" value={genState?.startKey ?? ""} />
            <input type="hidden" name="endKey" value={genState?.endKey ?? ""} />

            <div>
              <Label htmlFor="text">Teks laporan (bisa diedit sebelum kirim)</Label>
              <Textarea
                id="text"
                name="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={12}
                placeholder="Draf dari AI akan muncul di sini setelah kamu klik “Susun dengan AI”."
                className="font-mono text-[13px]"
              />
              <p className="mt-1 text-xs text-ink-muted">
                Format WhatsApp: *tebal*, _miring_. {text.length} karakter.
              </p>
            </div>

            {/* Tujuan */}
            <div className="space-y-2">
              <span className="text-sm font-medium">Tujuan</span>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={destMode === "kontak"}
                    onChange={() => setDestMode("kontak")}
                    disabled={contacts.length === 0}
                  />
                  Kontak tersimpan
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" checked={destMode === "bebas"} onChange={() => setDestMode("bebas")} />
                  Input bebas
                </label>
              </div>

              {destMode === "kontak" ? (
                <Select name="contactId" required>
                  <option value="">— pilih kontak —</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.chatId})
                    </option>
                  ))}
                </Select>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="destName">Nama tujuan (opsional)</Label>
                    <Input id="destName" name="destName" placeholder="mis. Pak Direktur" />
                  </div>
                  <div>
                    <Label htmlFor="destChatId">Nomor WA / ID grup</Label>
                    <Input id="destChatId" name="destChatId" placeholder="628123456789 atau 12036…@g.us" />
                  </div>
                </div>
              )}
            </div>

            <Button type="submit" loading={sending} disabled={!hasDraft || !waReady}>
              Kirim ke WhatsApp
            </Button>
            {!waReady ? (
              <p className="text-[13px] text-warning">WAHA belum dikonfigurasi — atur di Sistem → Integrasi.</p>
            ) : null}
          </form>
        </CardBody>
      </Card>

      {/* Kontak WA — dikelola terpusat di Master Data → Kontak (DECISIONS 150). */}
      <Card>
        <CardHeader
          title={`Kontak tujuan (${contacts.length})`}
          subtitle="Tujuan tersimpan milik Anda, dipakai di pemilih tujuan di atas."
        />
        <CardBody className="space-y-3">
          {contacts.length > 0 ? (
            <ul className="divide-y divide-border">
              {contacts.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{c.name}</p>
                    <p className="truncate font-mono text-xs text-ink-muted">{c.chatId}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-ink-muted">Belum ada kontak tersimpan.</p>
          )}
          <Link href="/master/kontak" className="inline-block text-sm text-primary hover:underline">
            Kelola kontak di Master Data → Kontak →
          </Link>
        </CardBody>
      </Card>

      {/* Riwayat */}
      {dispatches.length > 0 ? (
        <Card>
          <CardHeader title="Riwayat kirim" subtitle="10 pengiriman terakhir" />
          <CardBody>
            <ul className="divide-y divide-border">
              {dispatches.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{execReportMeta(d.reportKey)?.label ?? d.reportKey}</p>
                    <p className="text-[13px] text-ink-muted">→ {d.destName}</p>
                  </div>
                  <span className="tabular flex-none text-[13px] whitespace-nowrap text-ink-muted">{d.at}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

