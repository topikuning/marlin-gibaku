"use client";

import { useActionState, useState } from "react";
import { Banner, Button, Card, CardBody, CardHeader, Combobox } from "@/components/ui";
import { generateAiReportAction, type AiHubState } from "@/lib/ai-hub/actions";
import { AI_REPORT_TEMPLATES } from "@/lib/ai-hub/report-templates";

/** Form Report Studio: template + scope lokasi + periode → generate draf AI. */
export function ReportStudioClient({
  locations,
  aiReady,
}: {
  locations: { id: string; name: string; packageName: string }[];
  aiReady: boolean;
}) {
  const [template, setTemplate] = useState(AI_REPORT_TEMPLATES[0].key);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [state, formAction, pending] = useActionState<AiHubState, FormData>(generateAiReportAction, undefined);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <Card className="self-start">
        <CardHeader title="Template" subtitle="Satu structured report utk pratinjau, cetak/PDF, Excel, dan WhatsApp — angka identik." />
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
        <CardHeader title="Scope & periode" subtitle="Pilih lokasi (kosong = seluruh lokasi yang Anda pegang, dibatasi limit) lalu generate." />
        <CardBody>
          <form action={formAction} className="space-y-3">
            <input type="hidden" name="templateKey" value={template} />
            {[...selected].map((id) => (
              <input key={id} type="hidden" name="locationId" value={id} />
            ))}
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border p-2">
              {locations.map((l) => (
                <label key={l.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} />
                  <span className="truncate">
                    {l.name} <span className="text-xs text-ink-muted">· {l.packageName}</span>
                  </span>
                </label>
              ))}
              {locations.length === 0 ? <p className="text-sm text-ink-muted">Tidak ada lokasi dalam izin Anda.</p> : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-sm text-ink-muted" htmlFor="ai-report-period">
                Periode
              </label>
              <Combobox id="ai-report-period" name="period" defaultValue="7hari" className="w-44">
                <option value="7hari">7 hari terakhir</option>
                <option value="14hari">14 hari terakhir</option>
                <option value="30hari">30 hari terakhir</option>
              </Combobox>
              <Button type="submit" disabled={!aiReady || pending}>
                {pending ? "Menyusun draf…" : "Generate Draft"}
              </Button>
            </div>
            {state?.error ? <Banner tone="error" title={state.error} /> : null}
            <p className="text-xs text-ink-faint">
              Draf disusun AI dari angka resmi MARLIN dan selalu berstatus <strong>Draft</strong> — wajib review →
              approve → bekukan sebelum distribusi.
            </p>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
