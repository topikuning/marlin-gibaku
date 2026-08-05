"use client";

import { usePathname, useRouter } from "next/navigation";
import { useActionState, useMemo, useState } from "react";
import { Download, MessageCircle, Printer } from "lucide-react";
import { sendRencanaMingguanToWaAction, type WaActionState } from "@/lib/waha/actions";
import { Banner, Button, ButtonLink, HelpText, Input, Label, Combobox, Textarea } from "@/components/ui";
import { formatNumber, formatPct, formatRupiah } from "@/lib/format";
import { LABEL_STATUS, labelKejar, type Ppc, type StatusRencana } from "@/lib/plan/rencana-format";
import {
  addWeeklyPlanItem,
  applyWeeklySuggestions,
  getWeeklySuggestions,
  removeWeeklyPlanItem,
  type RabActionState,
  type SuggestState,
} from "./actions";

export type PlanItemRow = {
  id: string;
  code: string;
  name: string;
  unit: string | null;
  targetVolume: number;
  priority: number;
  picName: string | null;
  note: string | null;
  /** Σ volume laporan counted pada minggu terpilih. */
  realizedVolume: number;
};

export type LeafOption = {
  id: string;
  code: string;
  name: string;
  unit: string | null;
  volume: number | null;
};

const MAX_OPTIONS = 100;

function RemoveButton({ itemId }: { itemId: string }) {
  const [state, action, pending] = useActionState<RabActionState, FormData>(
    removeWeeklyPlanItem,
    undefined,
  );
  return (
    <form action={action} className="inline">
      <input type="hidden" name="itemId" value={itemId} />
      <Button size="sm" variant="ghost" type="submit" loading={pending} title="Hapus dari rencana">
        Hapus
      </Button>
      {state?.error ? <span className="ml-1 text-xs text-danger">{state.error}</span> : null}
    </form>
  );
}

function AddItemForm({
  locationId,
  weekNumber,
  options,
}: {
  locationId: string;
  weekNumber: number;
  options: LeafOption[];
}) {
  const [state, action, pending] = useActionState<RabActionState, FormData>(
    addWeeklyPlanItem,
    undefined,
  );
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hit = q
      ? options.filter((o) => o.name.toLowerCase().includes(q) || o.code.toLowerCase().includes(q))
      : options;
    return hit.slice(0, MAX_OPTIONS);
  }, [query, options]);

  return (
    <form action={action} className="space-y-3 rounded-md border border-border bg-surface-muted p-3">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <input type="hidden" name="locationId" value={locationId} />
      <input type="hidden" name="weekNumber" value={weekNumber} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="wp-search">Cari item pekerjaan (leaf RAB)</Label>
          <Input
            id="wp-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="mis. galian, bekisting, K3…"
            autoComplete="off"
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="wp-item" required>Item pekerjaan</Label>
          <Combobox id="wp-item" name="rabNodeId" required key={query /* reset pilihan saat filter berubah */}>
            <option value="">— pilih item ({filtered.length}{filtered.length === MAX_OPTIONS ? "+" : ""} tersedia) —</option>
            {filtered.map((o) => (
              <option key={o.id} value={o.id}>
                {o.code} — {o.name}
                {o.volume != null ? ` (vol RAB ${formatNumber(o.volume)} ${o.unit ?? ""})` : ""}
              </option>
            ))}
          </Combobox>
          {filtered.length === MAX_OPTIONS ? (
            <HelpText>Menampilkan {MAX_OPTIONS} pertama — persempit lewat pencarian.</HelpText>
          ) : null}
        </div>
        <div>
          <Label htmlFor="wp-target" required>Target volume</Label>
          <Input id="wp-target" name="targetVolume" type="number" step="0.001" min="0.001" required />
        </div>
        <div>
          <Label htmlFor="wp-priority">Prioritas (1 = tertinggi)</Label>
          <Combobox id="wp-priority" name="priority" defaultValue="5">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </Combobox>
        </div>
        <div>
          <Label htmlFor="wp-pic">PIC</Label>
          <Input id="wp-pic" name="picName" maxLength={120} placeholder="Nama penanggung jawab" />
        </div>
        <div>
          <Label htmlFor="wp-note">Catatan</Label>
          <Textarea id="wp-note" name="note" rows={1} maxLength={500} />
        </div>
      </div>
      <Button type="submit" loading={pending}>Tambah ke rencana</Button>
    </form>
  );
}

function SuggestPanel({ locationId, weekNumber }: { locationId: string; weekNumber: number }) {
  const [sugState, suggest, suggesting] = useActionState<SuggestState, FormData>(
    getWeeklySuggestions,
    undefined,
  );
  const [applyState, apply, applying] = useActionState<RabActionState, FormData>(
    applyWeeklySuggestions,
    undefined,
  );
  const result = sugState?.result;

  return (
    <div className="space-y-3 rounded-md border border-primary/30 bg-primary-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-ink">Saran otomatis minggu {weekNumber}</p>
          <p className="text-xs text-ink-muted">
            Berdasar urutan pekerjaan lapangan + realisasi. Bila tertinggal, saran mengejar deviasi.
          </p>
        </div>
        <form action={suggest}>
          <input type="hidden" name="locationId" value={locationId} />
          <input type="hidden" name="weekNumber" value={weekNumber} />
          <Button type="submit" variant="secondary" size="sm" loading={suggesting}>
            {result ? "Muat ulang saran" : "Sarankan otomatis"}
          </Button>
        </form>
      </div>

      {sugState?.error ? <Banner tone="info" title={sugState.error} /> : null}
      {applyState?.error ? <Banner tone="error" title={applyState.error} /> : null}
      {applyState?.success ? <Banner tone="success" title={applyState.success} /> : null}

      {result ? (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="text-ink-muted">
              Rencana s/d minggu berjalan: <span className="font-semibold text-ink">{formatPct(result.planPct)}</span>
            </span>
            <span className="text-ink-muted">
              Realisasi: <span className="font-semibold text-ink">{formatPct(result.actualPct)}</span>
            </span>
            <span className={result.behind ? "font-semibold text-danger" : "font-semibold text-success"}>
              Deviasi {result.deviationPct > 0 ? "+" : ""}
              {formatPct(result.deviationPct)} {result.behind ? "(tertinggal)" : "(aman)"}
            </span>
          </div>

          <div className="overflow-x-auto rounded border border-border bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase text-ink-muted">
                  <th className="py-1.5 pr-3 pl-2">Uraian</th>
                  <th className="py-1.5 pr-3">Trade</th>
                  <th className="py-1.5 pr-3 text-right">Sisa</th>
                  <th className="py-1.5 pr-3 text-right">Target mgg ini</th>
                  <th className="py-1.5 pr-3 text-right">Nilai</th>
                  <th className="py-1.5 pr-3">Prioritas</th>
                  <th className="py-1.5 pr-3">Alasan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {result.suggestions.map((s) => (
                  <tr key={s.rabNodeId}>
                    <td className="max-w-64 truncate py-1.5 pr-3 pl-2" title={s.name}>
                      <span className="text-xs text-ink-muted">{s.code}</span> {s.name}
                    </td>
                    <td className="py-1.5 pr-3 text-xs text-ink-muted">{s.stageLabel}</td>
                    <td className="tabular py-1.5 pr-3 text-right text-ink-muted">
                      {formatNumber(s.remainingVolume)} {s.unit ?? ""}
                    </td>
                    <td className="tabular py-1.5 pr-3 text-right font-semibold">
                      {formatNumber(s.targetVolume)} {s.unit ?? ""}
                      {/* Notasi lama "(+X kejar)" menyesatkan: tanda + mengajak
                          MENJUMLAHKAN, padahal bagian itu ada DI DALAM target.
                          Baris dengan target = ketertinggalan terbaca dua kali
                          lipat. Lihat labelKejar() di lib/plan/rencana-format.ts. */}
                      {(() => {
                        const l = labelKejar(s.targetVolume, s.catchUpVolume, formatNumber, s.unit);
                        return l ? (
                          <span className="mt-0.5 block text-[11px] font-normal text-warning">
                            {l}
                          </span>
                        ) : null;
                      })()}
                    </td>
                    <td className="tabular py-1.5 pr-3 text-right text-ink-muted">{formatRupiah(s.valueTarget)}</td>
                    <td className="tabular py-1.5 pr-3">{s.priority}</td>
                    <td className="py-1.5 pr-3 text-xs text-ink-muted">{s.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <form action={apply}>
            <input type="hidden" name="locationId" value={locationId} />
            <input type="hidden" name="weekNumber" value={weekNumber} />
            <Button type="submit" loading={applying}>
              Terapkan {result.suggestions.length} saran ke rencana minggu {weekNumber}
            </Button>
            <HelpText>Item dimasukkan ke rencana; kamu tetap bisa mengubah target, PIC, atau menghapusnya.</HelpText>
          </form>
        </>
      ) : null}
    </div>
  );
}

/**
 * Ringkasan rencana + jalan keluarnya (DECISIONS 258).
 *
 * Menjawab tiga keberatan sekaligus:
 *  - *"aku sudah buat rencana, lalu apa? mana outputnya?"* → tombol Cetak & Excel.
 *  - *"berapa persen pencapaiannya jika rencanamu diikuti"* → baris proyeksi.
 *  - *"apa maksud tulisan merah itu?"* → tiap angka bertanda punya keterangan
 *    berupa KATA, tidak pernah warna saja.
 *
 * Angkanya identik dengan berkas cetak: keduanya dari `getRencanaMingguan`.
 */
export type RingkasRencana = {
  actualPct: number;
  targetPct: number;
  deviationPct: number;
  status: StatusRencana;
  tambahanPct: number;
  proyeksiPct: number;
  selisihPct: number;
  masihTertinggal: boolean;
  totalNilai: number;
  totalBobot: number;
  jumlahKomitmen: number;
  ppc: Ppc;
  cetakHref: string;
  excelHref: string;
};

const TONE_STATUS: Record<StatusRencana, string> = {
  aman: "text-success",
  perhatian: "text-warning",
  kritis: "text-danger",
};

function Angka({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-surface p-2">
      <p className="text-[11px] leading-tight text-ink-muted">{label}</p>
      <p className={`tabular text-lg leading-tight font-semibold ${tone ?? "text-ink"}`}>{value}</p>
      {note ? <p className="text-[11px] leading-tight text-ink-muted">{note}</p> : null}
    </div>
  );
}

/**
 * Tombol kirim ke WhatsApp. Terpisah supaya punya `useActionState` sendiri —
 * hasilnya (termasuk kegagalan WAHA) muncul tepat di sebelah tombolnya.
 */
function KirimWaButton({ locationId, weekNumber }: { locationId: string; weekNumber: number }) {
  const [state, action, pending] = useActionState<WaActionState, FormData>(
    sendRencanaMingguanToWaAction,
    undefined,
  );
  return (
    <form action={action} className="contents">
      <input type="hidden" name="locationId" value={locationId} />
      <input type="hidden" name="weekNumber" value={weekNumber} />
      <Button type="submit" variant="secondary" size="sm" loading={pending}>
        <MessageCircle aria-hidden className="size-4" />
        Kirim ke WhatsApp
      </Button>
      {state?.error ? (
        <span className="basis-full text-xs text-danger">{state.error}</span>
      ) : state?.success ? (
        <span className="basis-full text-xs text-success">{state.success}</span>
      ) : null}
    </form>
  );
}

function RingkasanRencana({
  r,
  locationId,
  weekNumber,
}: {
  r: RingkasRencana;
  locationId: string;
  weekNumber: number;
}) {
  const signed = (n: number) => `${n >= 0 ? "+" : "−"}${formatPct(Math.abs(n), 2)}`;
  return (
    <div className="space-y-3 rounded-md border border-border bg-surface-muted p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-ink">Ringkasan rencana minggu {weekNumber}</p>
          <p className="text-xs text-ink-muted">
            Angka yang sama dengan formulir cetak — layar dan berkas tidak boleh berbeda.
          </p>
        </div>
        <span className="flex flex-wrap items-center gap-2">
          <ButtonLink href={r.cetakHref} variant="secondary" size="sm" target="_blank">
            <Printer aria-hidden className="size-4" />
            Cetak formulir A4
          </ButtonLink>
          <ButtonLink href={r.excelHref} variant="secondary" size="sm">
            <Download aria-hidden className="size-4" />
            Unduh Excel
          </ButtonLink>
          <KirimWaButton locationId={locationId} weekNumber={weekNumber} />
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Angka label="Realisasi s/d saat ini" value={formatPct(r.actualPct, 2)} />
        <Angka label={`Rencana kurva-S s/d minggu ${weekNumber}`} value={formatPct(r.targetPct, 2)} />
        <Angka
          label="Deviasi terhadap kurva-S"
          value={signed(r.deviationPct)}
          note={LABEL_STATUS[r.status]}
          tone={TONE_STATUS[r.status]}
        />
        <Angka
          label="Bobot rencana minggu ini"
          value={signed(r.tambahanPct)}
          note={`${r.jumlahKomitmen} komitmen · ${formatRupiah(r.totalNilai)}`}
        />
      </div>

      {/* Inilah angka yang membuat rencana bisa DINILAI sebelum dijalankan. */}
      <p className="rounded-md border border-border bg-surface p-2 text-[13px] leading-relaxed text-ink">
        <b>Kalau rencana ini dikerjakan penuh</b>, realisasi akhir minggu {weekNumber} menjadi{" "}
        <b className="tabular">{formatPct(r.proyeksiPct, 2)}</b>, sedangkan kurva-S menuntut{" "}
        <b className="tabular">{formatPct(r.targetPct, 2)}</b> —{" "}
        {r.masihTertinggal ? (
          <span className="font-semibold text-danger">
            masih tertinggal {formatPct(Math.abs(r.selisihPct), 2)}. Rencana ini belum cukup untuk
            kembali ke jadwal.
          </span>
        ) : (
          <span className="font-semibold text-success">
            menutup ketertinggalan dengan selisih {signed(r.selisihPct)}.
          </span>
        )}
      </p>

      {r.ppc.pct != null ? (
        <p className="text-xs text-ink-muted">
          <b className="text-ink">PPC minggu {weekNumber - 1}: {formatPct(r.ppc.pct, 0)}</b> —{" "}
          {r.ppc.tuntas} dari {r.ppc.jumlah} komitmen tuntas. Dihitung per komitmen dan biner:
          pekerjaan 80% selesai tidak melepaskan penerusnya, jadi dihitung belum tuntas. Ambang
          sehat lapangan ≥ 70%.
        </p>
      ) : weekNumber > 1 ? (
        <p className="text-xs text-ink-muted">
          Tidak ada rencana tercatat untuk minggu {weekNumber - 1} — tidak ada komitmen yang bisa
          dievaluasi. Ini bukan nilai 0%.
        </p>
      ) : null}
    </div>
  );
}

export function WeeklyPlanSection({
  locationId,
  weekNumber,
  currentWeek,
  totalWeeks,
  weekPeriod,
  items,
  options,
  ringkas,
  canManage,
}: {
  locationId: string;
  weekNumber: number;
  currentWeek: number;
  totalWeeks: number;
  weekPeriod: string | null;
  items: PlanItemRow[];
  options: LeafOption[];
  ringkas: RingkasRencana | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const weeks = Array.from({ length: Math.max(totalWeeks, currentWeek, weekNumber) }, (_, i) => i + 1);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="wp-week">Minggu</Label>
          <Combobox
            id="wp-week"
            value={String(weekNumber)}
            onChange={(value) => router.push(`${pathname}?minggu=${value}`)}
            className="w-44"
          >
            {weeks.map((w) => (
              <option key={w} value={w}>
                Minggu {w}
                {w === currentWeek ? " (berjalan)" : ""}
              </option>
            ))}
          </Combobox>
        </div>
        {weekPeriod ? <p className="pb-2 text-[13px] text-ink-muted">{weekPeriod}</p> : null}
      </div>

      {ringkas ? (
        <RingkasanRencana r={ringkas} locationId={locationId} weekNumber={weekNumber} />
      ) : null}

      {canManage ? (
        <>
          <SuggestPanel locationId={locationId} weekNumber={weekNumber} />
          <AddItemForm locationId={locationId} weekNumber={weekNumber} options={options} />
        </>
      ) : null}

      {items.length === 0 ? (
        <p className="text-sm text-ink-muted">Belum ada item rencana untuk minggu {weekNumber}.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase text-ink-muted">
                <th className="py-2 pr-3">Kode</th>
                <th className="py-2 pr-3">Uraian</th>
                <th className="py-2 pr-3 text-right">Target</th>
                <th className="py-2 pr-3 text-right">Realisasi mgg ini</th>
                <th className="py-2 pr-3 text-right">Capaian</th>
                <th className="py-2 pr-3">Prioritas</th>
                <th className="py-2 pr-3">PIC</th>
                <th className="py-2 pr-3">Catatan</th>
                {canManage ? <th className="py-2 text-right">Aksi</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((it) => {
                const achievedPct = it.targetVolume > 0 ? (it.realizedVolume / it.targetVolume) * 100 : 0;
                return (
                  <tr key={it.id}>
                    <td className="py-2 pr-3 text-xs text-ink-muted">{it.code}</td>
                    <td className="max-w-72 truncate py-2 pr-3" title={it.name}>{it.name}</td>
                    <td className="tabular py-2 pr-3 text-right">
                      {formatNumber(it.targetVolume)} {it.unit ?? ""}
                    </td>
                    <td className="tabular py-2 pr-3 text-right">
                      {formatNumber(it.realizedVolume)} {it.unit ?? ""}
                    </td>
                    <td
                      className={
                        "tabular py-2 pr-3 text-right " +
                        (achievedPct >= 100 ? "text-success" : achievedPct > 0 ? "text-warning" : "text-ink-muted")
                      }
                    >
                      {formatPct(achievedPct, 0)}
                    </td>
                    <td className="tabular py-2 pr-3">{it.priority}</td>
                    <td className="py-2 pr-3 text-ink-muted">{it.picName ?? "—"}</td>
                    <td className="max-w-52 truncate py-2 pr-3 text-ink-muted" title={it.note ?? undefined}>
                      {it.note ?? "—"}
                    </td>
                    {canManage ? (
                      <td className="py-2 text-right">
                        <RemoveButton itemId={it.id} />
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
