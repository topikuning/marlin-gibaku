import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { isCrossLocation } from "@/lib/roles";
import { canApprove } from "@/lib/report";
import { hasLocationAccess } from "@/lib/access";
import { getReportableItems } from "@/lib/rab";
import { PageHeader } from "@/components/knmp/page-header";
import {
  WORKER_ROLE_ORDER,
  WORKER_ROLE_LABEL,
  WEATHER_LABEL,
  parseLogDate,
} from "@/lib/daily-log";
import type { WorkerRole } from "@prisma/client";
import { DailyLogEditor } from "./editor";
import { PrintClient } from "./print-client";

const volFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 });
const jkDate = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "full",
  timeZone: "Asia/Jakarta",
});
const jkDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }); // YYYY-MM-DD

export default async function LaporanHarianKkpPage({
  params,
}: {
  params: Promise<{ slug: string; date: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/masuk");
  const { id: userId, role } = session.user;
  const { slug, date } = await params;

  const logDate = parseLogDate(date);
  if (!logDate) notFound();

  const location = await db.location.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      regency: true,
      province: true,
      contract: { select: { contractNumber: true, startDate: true } },
    },
  });
  if (!location) notFound();
  if (!isCrossLocation(role) && !(await hasLocationAccess(userId, role, location.id))) {
    notFound();
  }

  const [log, reportable] = await Promise.all([
    db.dailyLog.findUnique({
      where: { locationId_logDate: { locationId: location.id, logDate } },
      include: {
        workers: true,
        materials: true,
        equipment: { orderBy: { name: "asc" } },
      },
    }),
    getReportableItems(location.id),
  ]);

  // Realisasi item yang dilaporkan pada tanggal ini (Asia/Jakarta), best-effort.
  const rabIds = reportable.map((r) => r.id);
  const itemMeta = new Map(reportable.map((r) => [r.id, r]));
  const dayItems = rabIds.length
    ? (
        await db.dailyReportItem.findMany({
          where: {
            rabItemId: { in: rabIds },
            state: { in: ["approved", "sent"] },
          },
          select: { rabItemId: true, volumeDone: true, createdAt: true, notes: true },
          orderBy: { createdAt: "asc" },
        })
      ).filter((it) => jkDay.format(it.createdAt) === date)
    : [];

  const workerMap: Partial<Record<WorkerRole, number>> = {};
  for (const w of log?.workers ?? []) workerMap[w.role] = w.count;
  const totalWorkers = (log?.workers ?? []).reduce((n, w) => n + w.count, 0);

  const canEdit = canApprove(role);

  return (
    <>
      <style>{`@media print {
        .no-print { display: none !important; }
        .print-card { border: none !important; box-shadow: none !important; }
        body { background: #fff !important; }
      }`}</style>

      <div className="no-print">
        <Link href={`/lokasi/${slug}`} className="mb-4 inline-block text-sm text-[#1e3a8a] hover:underline">
          ← Detail Lokasi
        </Link>
        <PageHeader
          eyebrow="Laporan Harian KKP"
          title={`Laporan Harian — ${location.name}`}
          subtitle="Format resmi FORMAT LAPORAN HARIAN KKP. Mandor input ringkas; Site Manager melengkapi tenaga per keahlian, material, peralatan, dan cuaca di sini."
        />

        {/* Navigasi tanggal */}
        <form className="mb-5 flex flex-wrap items-center gap-2" action={`/lokasi/${slug}/harian`}>
          <label className="text-sm text-slate-500">Tanggal:</label>
          <input
            type="date"
            name="d"
            defaultValue={date}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-[#1e3a8a]"
          />
          <button className="rounded-md border border-[#1e3a8a] px-3 py-1.5 text-sm font-medium text-[#1e3a8a] hover:bg-[#F1F5F9]">
            Buka
          </button>
          <span className="ml-auto text-sm text-slate-500">{jkDate.format(logDate)}</span>
        </form>
      </div>

      {/* ── KKP-format card (print-friendly) ── */}
      <section className="print-card rounded-xl border border-slate-200 bg-white p-6">
        <div className="mb-4 text-center">
          <div className="text-base font-bold uppercase text-slate-900">Laporan Harian</div>
          <div className="text-sm text-slate-600">
            Pembangunan Kampung Nelayan Merah Putih (KNMP)
          </div>
        </div>
        <div className="mb-5 grid grid-cols-1 gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
          <Field k="Pekerjaan" v="Konstruksi KNMP" />
          <Field k="Hari / Tanggal" v={jkDate.format(logDate)} />
          <Field k="Lokasi" v={`${location.name}, ${location.regency}, ${location.province}`} />
          <Field k="Tahun Anggaran" v={String(location.contract?.startDate?.getFullYear() ?? "-")} />
          <Field k="Cuaca" v={log?.weather ? WEATHER_LABEL[log.weather] : "—"} />
          <Field
            k="Jam Kerja"
            v={log?.workStart || log?.workEnd ? `${log?.workStart ?? "…"} – ${log?.workEnd ?? "…"}` : "—"}
          />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Tenaga kerja */}
          <div>
            <SectionTitle>Tenaga Kerja</SectionTitle>
            <table className="w-full text-sm">
              <tbody>
                {WORKER_ROLE_ORDER.filter((r) => (workerMap[r] ?? 0) > 0).map((r) => (
                  <tr key={r} className="border-b border-slate-100">
                    <td className="py-1 text-slate-700">{WORKER_ROLE_LABEL[r]}</td>
                    <td className="py-1 text-right tabular-nums text-slate-900">{workerMap[r]} org</td>
                  </tr>
                ))}
                {totalWorkers === 0 && (
                  <tr>
                    <td className="py-1 text-slate-400">Belum diisi</td>
                  </tr>
                )}
                {totalWorkers > 0 && (
                  <tr className="font-semibold">
                    <td className="py-1 text-slate-900">Jumlah</td>
                    <td className="py-1 text-right tabular-nums text-slate-900">{totalWorkers} org</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Material + peralatan */}
          <div className="space-y-4">
            <div>
              <SectionTitle>Rekap Pemasukan Bahan / Material</SectionTitle>
              {(log?.materials ?? []).length ? (
                <table className="w-full text-sm">
                  <tbody>
                    {log!.materials.map((m) => (
                      <tr key={m.id} className="border-b border-slate-100">
                        <td className="py-1 text-slate-700">{m.name}</td>
                        <td className="py-1 text-right tabular-nums text-slate-900">
                          {m.qtyReceived != null ? volFmt.format(m.qtyReceived.toNumber()) : ""} {m.unit ?? ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="text-sm text-slate-400">Belum diisi</div>
              )}
            </div>
            <div>
              <SectionTitle>Peralatan</SectionTitle>
              {(log?.equipment ?? []).length ? (
                <table className="w-full text-sm">
                  <tbody>
                    {log!.equipment.map((e) => (
                      <tr key={e.id} className="border-b border-slate-100">
                        <td className="py-1 text-slate-700">{e.name}</td>
                        <td className="py-1 text-right tabular-nums text-slate-900">{e.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="text-sm text-slate-400">Belum diisi</div>
              )}
            </div>
          </div>
        </div>

        {/* Realisasi pekerjaan (dari laporan hari itu) */}
        <div className="mt-6">
          <SectionTitle>Realisasi Pekerjaan (dari laporan lapangan)</SectionTitle>
          {dayItems.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                  <th className="py-1 font-medium">Uraian</th>
                  <th className="py-1 text-right font-medium">Volume</th>
                </tr>
              </thead>
              <tbody>
                {dayItems.map((it, i) => {
                  const meta = itemMeta.get(it.rabItemId);
                  return (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="py-1 text-slate-700">{meta?.name ?? it.rabItemId}</td>
                      <td className="py-1 text-right tabular-nums text-slate-900">
                        {volFmt.format(it.volumeDone.toNumber())} {meta?.unit ?? ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="text-sm text-slate-400">Tidak ada realisasi tercatat pada tanggal ini.</div>
          )}
        </div>

        {log?.notes && (
          <div className="mt-6">
            <SectionTitle>Catatan Lapangan</SectionTitle>
            <p className="text-sm text-slate-700">{log.notes}</p>
          </div>
        )}

        {/* Tanda tangan */}
        <div className="mt-10 grid grid-cols-2 gap-8 text-center text-sm">
          <div>
            <div className="text-slate-600">Konsultan Pengawas</div>
            <div className="mt-16 border-t border-slate-300 pt-1 text-slate-500">( …………………… )</div>
          </div>
          <div>
            <div className="text-slate-600">Kontraktor Pelaksana</div>
            <div className="mt-16 border-t border-slate-300 pt-1 text-slate-500">( …………………… )</div>
          </div>
        </div>
      </section>

      {/* Aksi cetak */}
      <div className="no-print mt-4">
        <PrintClient />
      </div>

      {/* Editor SM */}
      {canEdit ? (
        <section className="no-print mt-8 rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-sm font-semibold text-slate-900">
            Lengkapi Laporan Harian (Site Manager)
          </h2>
          <DailyLogEditor
            slug={slug}
            date={date}
            initial={{
              weather: log?.weather ?? null,
              workStart: log?.workStart ?? null,
              workEnd: log?.workEnd ?? null,
              notes: log?.notes ?? null,
              workers: workerMap,
              materials: (log?.materials ?? []).map((m) => ({
                name: m.name,
                unit: m.unit ?? "",
                qty: m.qtyReceived != null ? String(m.qtyReceived.toNumber()) : "",
              })),
              equipment: (log?.equipment ?? []).map((e) => ({
                name: e.name,
                count: String(e.count),
              })),
            }}
          />
        </section>
      ) : (
        <p className="no-print mt-6 text-sm text-slate-500">
          Detail dilengkapi oleh Site Manager. Anda dapat mencetak laporan di atas.
        </p>
      )}
    </>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-32 shrink-0 text-slate-500">{k}</span>
      <span className="text-slate-500">:</span>
      <span className="font-medium text-slate-900">{v}</span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
      {children}
    </div>
  );
}

