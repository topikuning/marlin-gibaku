"use client";

import { useAksi } from "@/lib/aksi-klien";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Download, MessageCircle, Printer, Sparkles } from "lucide-react";
import { sendRencanaMingguanToWaAction, type WaActionState } from "@/lib/waha/actions";
import { Banner, Button, ButtonLink, HelpText, Input, Label, Combobox, Textarea } from "@/components/ui";
import { formatNumber, formatPct, formatRupiah, formatTanggalWaktu } from "@/lib/format";
import { LABEL_STATUS, labelKejar, type Ppc, type StatusRencana } from "@/lib/plan/rencana-format";
import {
  addWeeklyPlanItem,
  analisaUlangJadwalAi,
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

/** Keadaan analisa AI urutan RAB aktif (DECISIONS 667). */
export type AnalisaAiView = {
  status: "antre" | "jalan" | "selesai" | "sebagian" | "gagal";
  model: string | null;
  galat: string | null;
  selesaiAt: string | null;
  bangunan: { total: number; selesai: number; gagal: number };
  pekerjaan: number;
  catatan: { nama: string; catatan: string }[];
};

function kalimatAnalisaAi(a: AnalisaAiView | null): { tone: "info" | "warning" | "success"; teks: string } {
  if (!a) return { tone: "info", teks: "RAB ini belum dianalisa AI. Saran memakai urutan bawaan sistem." };
  const b = a.bangunan;
  const kapan = a.selesaiAt ? `, ${formatTanggalWaktu(new Date(a.selesaiAt))}` : "";
  const model = a.model ? ` (${a.model}${kapan})` : "";
  switch (a.status) {
    case "antre":
      return { tone: "info", teks: "AI segera menganalisa urutan pekerjaan RAB ini. Halaman ini memperbarui sendiri." };
    case "jalan":
      return {
        tone: "info",
        teks: `AI sedang menganalisa urutan pekerjaan: ${b.selesai} dari ${b.total} bangunan selesai. Yang sudah selesai langsung dipakai.`,
      };
    case "selesai":
      return {
        tone: "success",
        teks: `Urutan ${a.pekerjaan} pekerjaan di ${b.total} bangunan sudah dianalisa AI${model}. Saran di bawah memakai urutan itu.`,
      };
    case "sebagian":
      return {
        tone: "warning",
        teks: `AI selesai menganalisa ${b.selesai} dari ${b.total} bangunan${model}. Bangunan lain memakai urutan bawaan.${a.galat ? ` Sebabnya: ${a.galat}` : ""}`,
      };
    case "gagal":
      return {
        tone: "warning",
        teks: `Analisa AI gagal${a.galat ? `: ${a.galat}` : "."} Saran memakai urutan bawaan sistem.`,
      };
  }
}

/**
 * Baris keadaan analisa AI di atas saran. Selama AI masih bekerja halaman
 * dimuat ulang berkala, jadi bangunan yang selesai langsung terlihat.
 */
function AnalisaAiBar({
  locationId,
  analisa,
  bolehAnalisa,
}: {
  locationId: string;
  analisa: AnalisaAiView | null;
  bolehAnalisa: boolean;
}) {
  const router = useRouter();
  const [state, action, pending] = useAksi<RabActionState>(analisaUlangJadwalAi, undefined);
  const berjalan = analisa?.status === "antre" || analisa?.status === "jalan";
  useEffect(() => {
    if (!berjalan) return;
    const t = setInterval(() => router.refresh(), 15_000);
    return () => clearInterval(t);
  }, [berjalan, router]);
  const k = kalimatAnalisaAi(analisa);
  const nada = k.tone === "success" ? "text-success" : k.tone === "warning" ? "text-warning" : "text-ink-muted";

  return (
    <div className="space-y-2 rounded border border-border bg-surface p-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className={`flex min-w-0 flex-1 items-start gap-1.5 text-xs ${nada}`}>
          <Sparkles className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{k.teks}</span>
        </p>
        {bolehAnalisa && !berjalan ? (
          <form action={action}>
            <input type="hidden" name="locationId" value={locationId} />
            <Button type="submit" variant="secondary" size="sm" loading={pending}>
              {analisa ? "Analisa ulang dengan AI" : "Analisa dengan AI"}
            </Button>
          </form>
        ) : null}
      </div>
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      {analisa && analisa.catatan.length > 0 ? (
        <details className="text-xs text-ink-muted">
          <summary className="cursor-pointer select-none text-ink">
            Strategi pelaksanaan per bangunan dari AI ({analisa.catatan.length})
          </summary>
          <ul className="mt-1.5 space-y-1.5">
            {analisa.catatan.map((c) => (
              <li key={c.nama}>
                <span className="font-semibold text-ink">{c.nama}</span> – {c.catatan}
              </li>
            ))}
          </ul>
          <p className="mt-1.5">Ini pendapat AI, bukan angka resmi. Volume target tetap dihitung sistem dari RAB dan realisasi.</p>
        </details>
      ) : null}
    </div>
  );
}

function RemoveButton({ itemId }: { itemId: string }) {
  const [state, action, pending] = useAksi<RabActionState>(
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
  const [state, action, pending] = useAksi<RabActionState>(
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
          <Label htmlFor="wp-search">Cari item pekerjaan RAB</Label>
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
            <option value="">– pilih item ({filtered.length}{filtered.length === MAX_OPTIONS ? "+" : ""} tersedia) –</option>
            {filtered.map((o) => (
              <option key={o.id} value={o.id}>
                {o.code} – {o.name}
                {o.volume != null ? ` (vol RAB ${formatNumber(o.volume)} ${o.unit ?? ""})` : ""}
              </option>
            ))}
          </Combobox>
          {filtered.length === MAX_OPTIONS ? (
            <HelpText>Hanya {MAX_OPTIONS} item pertama yang ditampilkan. Persempit lewat pencarian.</HelpText>
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

function SuggestPanel({
  locationId,
  weekNumber,
  analisaAi,
  canAnalisaAi,
}: {
  locationId: string;
  weekNumber: number;
  analisaAi: AnalisaAiView | null;
  canAnalisaAi: boolean;
}) {
  const [sugState, suggest, suggesting] = useAksi<SuggestState>(
    getWeeklySuggestions,
    undefined,
  );
  const [applyState, apply, applying] = useAksi<RabActionState>(
    applyWeeklySuggestions,
    undefined,
  );
  const result = sugState?.result;
  // Baris yang TIDAK dicentang; saran baru = semua tercentang lagi.
  const [lepas, setLepas] = useState<Set<string>>(new Set());
  const [hasilTerakhir, setHasilTerakhir] = useState(result);
  if (hasilTerakhir !== result) {
    setHasilTerakhir(result);
    setLepas(new Set());
  }
  const terpilih = result ? result.suggestions.filter((s) => !lepas.has(s.rabNodeId)).length : 0;
  const formTerapkan = `wp-terapkan-${weekNumber}`;

  return (
    <div className="space-y-3 rounded-md border border-primary/30 bg-primary-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-ink">Saran otomatis minggu {weekNumber}</p>
          <p className="text-xs text-ink-muted">
            Disusun dari urutan pekerjaan dan realisasi. Kalau tertinggal, sarannya ikut mengejar deviasi.
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

      <AnalisaAiBar locationId={locationId} analisa={analisaAi} bolehAnalisa={canAnalisaAi} />

      {sugState?.error ? <Banner tone="info" title={sugState.error} /> : null}
      {applyState?.error ? <Banner tone="error" title={applyState.error} /> : null}
      {applyState?.success ? <Banner tone="success" title={applyState.success} /> : null}

      {result ? (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="text-ink-muted">
              {result.currentWeek > 0 ? (
                <>
                  Rencana s/d minggu berjalan ({result.currentWeek}):{" "}
                  <span className="font-semibold text-ink">{formatPct(result.planPct)}</span>
                </>
              ) : (
                "Proyek belum mulai (belum SPMK)"
              )}
            </span>
            {result.weekNumber !== result.currentWeek ? (
              <span className="text-ink-muted">
                Target akhir minggu {result.weekNumber}:{" "}
                <span className="font-semibold text-ink">{formatPct(result.targetPct)}</span>
              </span>
            ) : null}
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
                  <th className="w-8 py-1.5 pl-2">
                    <input
                      type="checkbox"
                      aria-label="Pilih semua saran"
                      className="size-4 accent-primary"
                      checked={lepas.size === 0}
                      onChange={(e) =>
                        setLepas(e.target.checked ? new Set() : new Set(result.suggestions.map((s) => s.rabNodeId)))
                      }
                    />
                  </th>
                  <th className="py-1.5 pr-3">Uraian</th>
                  <th className="py-1.5 pr-3">Tahap</th>
                  <th className="py-1.5 pr-3 text-right">Sisa</th>
                  <th className="py-1.5 pr-3 text-right">Target mgg ini</th>
                  <th className="py-1.5 pr-3 text-right">Nilai</th>
                  <th className="py-1.5 pr-3">Prioritas</th>
                  <th className="py-1.5 pr-3">Alasan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {result.suggestions.map((s) => (
                  <tr key={s.rabNodeId} className={lepas.has(s.rabNodeId) ? "opacity-50" : undefined}>
                    <td className="py-1.5 pl-2 align-top">
                      <input
                        type="checkbox"
                        name="pilih"
                        value={s.rabNodeId}
                        form={formTerapkan}
                        aria-label={`Pilih ${s.name}`}
                        className="mt-0.5 size-4 accent-primary"
                        checked={!lepas.has(s.rabNodeId)}
                        onChange={(e) => {
                          const n = new Set(lepas);
                          if (e.target.checked) n.delete(s.rabNodeId);
                          else n.add(s.rabNodeId);
                          setLepas(n);
                        }}
                      />
                    </td>
                    <td className="max-w-64 truncate py-1.5 pr-3" title={s.name}>
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
                    <td className="max-w-72 py-1.5 pr-3 text-xs text-ink-muted">
                      {s.reason}
                      {s.kritis ? <span className="ml-1.5 font-semibold text-danger">· kritis</span> : null}
                      {s.pekaCuaca ? <span className="ml-1.5 font-semibold text-warning">· peka cuaca</span> : null}
                      {s.alasanAi ? (
                        <span className="mt-0.5 line-clamp-2 text-[11px]" title={s.alasanAi}>
                          AI: {s.alasanAi}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <form id={formTerapkan} action={apply}>
            <input type="hidden" name="locationId" value={locationId} />
            <input type="hidden" name="weekNumber" value={weekNumber} />
            <input type="hidden" name="pilihDikirim" value="1" />
            <Button type="submit" loading={applying} disabled={terpilih === 0}>
              Terapkan {terpilih} saran ke rencana minggu {weekNumber}
            </Button>
            <HelpText>Item dimasukkan ke rencana. Anda tetap bisa mengubah target, PIC, atau menghapusnya.</HelpText>
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
  const [state, action, pending] = useAksi<WaActionState>(
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
            Angkanya sama persis dengan formulir cetak dan berkas Excel.
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
        <b className="tabular">{formatPct(r.targetPct, 2)}</b>.{" "}
        {r.masihTertinggal ? (
          <span className="font-semibold text-danger">
            Masih tertinggal {formatPct(Math.abs(r.selisihPct), 2)}. Rencana ini belum cukup untuk
            kembali ke jadwal.
          </span>
        ) : (
          <span className="font-semibold text-success">
            Ketertinggalan tertutup, dengan selisih {signed(r.selisihPct)}.
          </span>
        )}
      </p>

      {r.ppc.pct != null ? (
        <p className="text-xs text-ink-muted">
          <b className="text-ink">PPC minggu {weekNumber - 1}: {formatPct(r.ppc.pct, 0)}</b>.{" "}
          {r.ppc.tuntas} dari {r.ppc.jumlah} komitmen tuntas. Tiap komitmen hanya dihitung tuntas
          atau belum: pekerjaan yang baru 80% selesai belum bisa disusul pekerjaan berikutnya, jadi
          dihitung belum tuntas. Angka sehat di lapangan ≥ 70%.
        </p>
      ) : weekNumber > 1 ? (
        <p className="text-xs text-ink-muted">
          Tidak ada rencana tercatat untuk minggu {weekNumber - 1}, jadi tidak ada komitmen yang
          bisa dinilai. Ini bukan berarti 0%.
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
  analisaAi = null,
  canAnalisaAi = false,
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
  analisaAi?: AnalisaAiView | null;
  canAnalisaAi?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const weeks = Array.from({ length: Math.max(totalWeeks, currentWeek, weekNumber) }, (_, i) => i + 1);

  /*
   * Ganti minggu tanpa MEMBUANG query lain (DECISIONS 362).
   *
   * Sebelumnya tujuannya ditulis ulang dari nol (`?minggu=N`), yang aman selama
   * `minggu` satu-satunya parameter. Sejak halaman ini punya sub-tab
   * (`?bagian=rencana`), menulis ulang berarti memilih minggu MELEMPAR orang
   * kembali ke tab RAB — persis pada saat ia sedang bekerja di rencana.
   */
  function pindahMinggu(nilai: string) {
    const q = new URLSearchParams(searchParams.toString());
    q.set("minggu", nilai);
    router.push(`${pathname}?${q.toString()}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="wp-week">Minggu</Label>
          <Combobox
            id="wp-week"
            value={String(weekNumber)}
            onChange={pindahMinggu}
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
          <SuggestPanel
            locationId={locationId}
            weekNumber={weekNumber}
            analisaAi={analisaAi}
            canAnalisaAi={canAnalisaAi}
          />
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
                    <td className="py-2 pr-3 text-ink-muted">{it.picName ?? "–"}</td>
                    <td className="max-w-52 truncate py-2 pr-3 text-ink-muted" title={it.note ?? undefined}>
                      {it.note ?? "–"}
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
