"use client";

import { useAksi } from "@/lib/aksi-klien";

import { useState } from "react";
import { Banner, Button, Card, CardBody, CardHeader, Combobox } from "@/components/ui";
import { PemilihLokasi } from "@/components/knmp/pemilih-lokasi";
import { generateAiReportAction, type AiHubState } from "@/lib/ai-hub/actions";
import { AI_REPORT_TEMPLATES } from "@/lib/ai-hub/report-templates";

/**
 * Form Report Studio: template + scope lokasi + periode → generate draf AI.
 * `initialTemplate`/`initialScopeIds` datang dari URL — jembatan dari halaman
 * run ("Jadikan laporan"), Ask MARLIN, dan pengalihan /laporan-wa
 * (DECISIONS 193/194).
 */
export function ReportStudioClient({
  locations,
  aiReady,
  initialTemplate,
  initialScopeIds = [],
  originRunId,
  originConversationId,
}: {
  locations: { id: string; name: string; packageName: string }[];
  aiReady: boolean;
  initialTemplate?: string;
  initialScopeIds?: string[];
  originRunId?: string;
  originConversationId?: string;
}) {
  const [template, setTemplate] = useState(
    AI_REPORT_TEMPLATES.some((t) => t.key === initialTemplate)
      ? (initialTemplate as (typeof AI_REPORT_TEMPLATES)[number]["key"])
      : AI_REPORT_TEMPLATES[0].key,
  );
  const [selected, setSelected] = useState<Set<string>>(
    // hanya lokasi yang memang ada dalam izin user (daftar `locations`)
    new Set(initialScopeIds.filter((id) => locations.some((l) => l.id === id))),
  );
  const [state, formAction, pending] = useAksi<AiHubState>(generateAiReportAction, undefined);

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <Card className="self-start">
        <CardHeader title="Pilih bentuk laporan" subtitle="Satu isi yang sama untuk pratinjau, PDF, Excel, dan WhatsApp." />
        <CardBody className="space-y-1.5">
          {AI_REPORT_TEMPLATES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTemplate(t.key)}
              aria-pressed={template === t.key}
              className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                template === t.key ? "border-primary bg-info-soft" : "border-border hover:border-border-strong"
              }`}
            >
              <span className="block font-medium text-ink">{t.label}</span>
              <span className="block text-xs text-ink-muted">{t.desc}</span>
            </button>
          ))}
        </CardBody>
      </Card>

      <Card className="self-start">
        <CardHeader title="Pilih lokasi dan periode" subtitle="Kosong berarti seluruh lokasi yang Anda pegang, tetap dibatasi pagar sistem." />
        <CardBody>
          <form action={formAction} className="space-y-3">
            <input type="hidden" name="templateKey" value={template} />
            {originRunId ? <input type="hidden" name="originRunId" value={originRunId} /> : null}
            {originConversationId ? (
              <input type="hidden" name="originConversationId" value={originConversationId} />
            ) : null}
            {[...selected].map((id) => (
              <input key={id} type="hidden" name="locationId" value={id} />
            ))}
            <PemilihLokasi
              locations={locations}
              selected={selected}
              onChange={setSelected}
              petunjukKosong="Belum ada lokasi dipilih – seluruh lokasi yang Anda pegang akan dipakai."
            />
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-sm text-ink-muted" htmlFor="ai-report-period">
                Periode
              </label>
              <Combobox id="ai-report-period" name="period" defaultValue="7hari" className="w-44">
                <option value="hari_ini">Hari ini</option>
                <option value="kemarin">Kemarin</option>
                <option value="7hari">7 hari terakhir</option>
                <option value="14hari">14 hari terakhir</option>
                <option value="30hari">30 hari terakhir</option>
              </Combobox>
              <Button type="submit" disabled={!aiReady || pending}>
                {pending ? "Menyusun draf…" : "Susun draf laporan"}
              </Button>
            </div>
            {state?.error ? <Banner tone="error" title={state.error} /> : null}
            {originRunId || originConversationId ? (
              <Banner
                tone="info"
                title="Konteks asal akan dibawa ke laporan"
                description="Temuan dan maksud sebelumnya dipertahankan; angka tetap dihitung ulang dari data resmi terbaru."
              />
            ) : null}
            <p className="text-xs text-ink-faint">
              Draf disusun AI dari angka resmi MARLIN dan selalu berstatus <strong>Draft</strong> – wajib review →
              approve → bekukan sebelum distribusi.
            </p>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
