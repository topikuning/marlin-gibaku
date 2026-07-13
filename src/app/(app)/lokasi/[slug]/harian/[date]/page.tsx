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

  // Data header format KKP
  const hari = new Intl.DateTimeFormat("id-ID", { weekday: "long", timeZone: "Asia/Jakarta" }).format(logDate);
  const startDate = location.contract?.startDate ?? null;
  const weekNo = startDate
    ? Math.max(1, Math.floor((logDate.getTime() - startDate.getTime()) / (7 * 86_400_000)) + 1)
    : null;
  const tahunAnggaran = startDate?.getFullYear() ?? logDate.getUTCFullYear();
  const HOURS = ["07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21"];
  const WEATHER_CAT: Partial<Record<NonNullable<typeof log>["weather"] & string, "Cerah" | "Mendung" | "Hujan">> = {
    cerah: "Cerah",
    berawan: "Mendung",
    hujan_ringan: "Hujan",
    hujan_deras: "Hujan",
    angin_kencang: "Hujan",
    banjir: "Hujan",
  };
  const activeWeather = log?.weather ? WEATHER_CAT[log.weather] : null;

  return (
    <>
      <style>{`@media print {
        @page { size: A4; margin: 12mm; }
        .no-print { display: none !important; }
        .print-card {
          border: none !important; box-shadow: none !important;
          max-width: none !important; margin: 0 !important; padding: 0 !important;
          -webkit-print-color-adjust: exact; print-color-adjust: exact;
        }
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
      {/* ── FORMAT LAPORAN HARIAN KKP (persis, siap cetak A4) ── */}
      <section className="print-card mx-auto max-w-[900px] rounded-xl border border-slate-300 bg-white p-5 text-[11px] leading-tight text-slate-900">
        {/* Header: judul + 2 kolom TTD */}
        <div className="grid grid-cols-4 border border-slate-500">
          <div className="col-span-2 flex flex-col justify-center border-r border-slate-500 px-3 py-2">
            <div className="text-sm font-bold uppercase tracking-wide">Laporan Harian</div>
            <div className="text-[10px] text-slate-500">Pembangunan Kampung Nelayan Merah Putih (KNMP)</div>
          </div>
          <div className="flex items-center justify-center border-r border-slate-500 px-2 py-3 text-center text-[10px] font-semibold uppercase text-slate-600">
            Konsultan Pengawas
          </div>
          <div className="flex items-center justify-center px-2 py-3 text-center text-[10px] font-semibold uppercase text-slate-600">
            Kontraktor Pelaksana
          </div>
        </div>

        {/* Info paket */}
        <table className="w-full border-x border-b border-slate-500">
          <tbody>
            <tr>
              <Cell w>Minggu Ke</Cell>
              <Cell>{weekNo ?? "…"}</Cell>
              <Cell w>Pekerjaan</Cell>
              <Cell>Konstruksi KNMP</Cell>
            </tr>
            <tr>
              <Cell w>Hari</Cell>
              <Cell>{hari}</Cell>
              <Cell w>Lokasi</Cell>
              <Cell>{`${location.name}, ${location.regency}, ${location.province}`}</Cell>
            </tr>
            <tr>
              <Cell w>Tanggal</Cell>
              <Cell>{jkDate.format(logDate)}</Cell>
              <Cell w>Th. Anggaran</Cell>
              <Cell>{tahunAnggaran}</Cell>
            </tr>
          </tbody>
        </table>

        {/* Tenaga kerja + material/peralatan */}
        <div className="grid grid-cols-2">
          {/* TENAGA KERJA */}
          <table className="w-full border-x border-b border-slate-500">
            <thead>
              <tr>
                <Cell head w>No</Cell>
                <Cell head>Tenaga Kerja (Keahlian)</Cell>
                <Cell head w>Jmh</Cell>
              </tr>
            </thead>
            <tbody>
              {WORKER_ROLE_ORDER.map((r, i) => (
                <tr key={r}>
                  <Cell center>{i + 1}</Cell>
                  <Cell>{WORKER_ROLE_LABEL[r]}</Cell>
                  <Cell center>{workerMap[r] ?? 0}</Cell>
                </tr>
              ))}
              <tr className="font-semibold">
                <Cell center colSpan={2} right>Jumlah</Cell>
                <Cell center>{totalWorkers}</Cell>
              </tr>
            </tbody>
          </table>

          {/* MATERIAL + PERALATAN */}
          <div>
            <table className="w-full border-r border-b border-slate-500">
              <thead>
                <tr>
                  <Cell head w>No</Cell>
                  <Cell head>Rekap Pemasukan Bahan / Material</Cell>
                  <Cell head w>Sat</Cell>
                  <Cell head w>Diterima</Cell>
                </tr>
              </thead>
              <tbody>
                {(log?.materials ?? []).map((m, i) => (
                  <tr key={m.id}>
                    <Cell center>{i + 1}</Cell>
                    <Cell>{m.name}</Cell>
                    <Cell center>{m.unit ?? ""}</Cell>
                    <Cell center>{m.qtyReceived != null ? volFmt.format(m.qtyReceived.toNumber()) : ""}</Cell>
                  </tr>
                ))}
                {Array.from({ length: Math.max(0, 4 - (log?.materials?.length ?? 0)) }).map((_, i) => (
                  <tr key={`me${i}`}>
                    <Cell center>{(log?.materials?.length ?? 0) + i + 1}</Cell>
                    <Cell>&nbsp;</Cell>
                    <Cell></Cell>
                    <Cell></Cell>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="w-full border-r border-b border-slate-500">
              <thead>
                <tr>
                  <Cell head w>No</Cell>
                  <Cell head colSpan={3}>Peralatan</Cell>
                </tr>
              </thead>
              <tbody>
                {(log?.equipment ?? []).map((e, i) => (
                  <tr key={e.id}>
                    <Cell center>{i + 1}</Cell>
                    <Cell colSpan={3}>
                      {e.name}
                      {e.count > 1 ? ` (${e.count})` : ""}
                    </Cell>
                  </tr>
                ))}
                {Array.from({ length: Math.max(0, 3 - (log?.equipment?.length ?? 0)) }).map((_, i) => (
                  <tr key={`ee${i}`}>
                    <Cell center>{(log?.equipment?.length ?? 0) + i + 1}</Cell>
                    <Cell colSpan={3}>&nbsp;</Cell>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Kondisi cuaca per jam */}
        <table className="w-full border-x border-b border-slate-500 text-center">
          <thead>
            <tr>
              <Cell head>Kondisi / Jam</Cell>
              {HOURS.map((h) => (
                <Cell head center key={h}>{h}</Cell>
              ))}
            </tr>
          </thead>
          <tbody>
            {(["Cerah", "Mendung", "Hujan"] as const).map((cat) => (
              <tr key={cat}>
                <Cell>{cat}</Cell>
                {HOURS.map((h) => (
                  <Cell center key={h}>{activeWeather === cat ? "✓" : ""}</Cell>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <table className="w-full border-x border-b border-slate-500">
          <tbody>
            <tr>
              <Cell w>Jam Kerja</Cell>
              <Cell>
                mulai {log?.workStart ?? "……"} — selesai {log?.workEnd ?? "……"}
              </Cell>
            </tr>
          </tbody>
        </table>

        {/* Rencana vs realisasi pekerjaan */}
        <div className="grid grid-cols-2">
          <table className="w-full border-x border-b border-slate-500">
            <thead>
              <tr>
                <Cell head>Rencana Pekerjaan</Cell>
              </tr>
            </thead>
            <tbody>
              {log?.notes ? (
                <tr>
                  <Cell>{log.notes}</Cell>
                </tr>
              ) : (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <Cell>
                      {i + 1}.&nbsp;
                    </Cell>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <table className="w-full border-r border-b border-slate-500">
            <thead>
              <tr>
                <Cell head>Realisasi Pekerjaan (dari laporan lapangan)</Cell>
              </tr>
            </thead>
            <tbody>
              {dayItems.length ? (
                dayItems.map((it, i) => {
                  const meta = itemMeta.get(it.rabItemId);
                  return (
                    <tr key={i}>
                      <Cell>
                        {i + 1}. {meta?.name ?? it.rabItemId} —{" "}
                        {volFmt.format(it.volumeDone.toNumber())} {meta?.unit ?? ""}
                      </Cell>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <Cell>Tidak ada realisasi tercatat pada tanggal ini.</Cell>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Tanda tangan */}
        <div className="grid grid-cols-2 border-x border-b border-slate-500">
          <div className="border-r border-slate-500 px-3 py-2 text-center">
            <div className="text-[10px] font-semibold uppercase text-slate-600">Konsultan Pengawas</div>
            <div className="mt-12 border-t border-slate-400 pt-1 text-slate-500">( …………………… )</div>
          </div>
          <div className="px-3 py-2 text-center">
            <div className="text-[10px] font-semibold uppercase text-slate-600">Kontraktor Pelaksana</div>
            <div className="mt-12 border-t border-slate-400 pt-1 text-slate-500">( …………………… )</div>
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

/** Sel tabel bergaris untuk form KKP (cetak A4). */
function Cell({
  children,
  head,
  w,
  center,
  right,
  colSpan,
}: {
  children?: React.ReactNode;
  head?: boolean;
  w?: boolean;
  center?: boolean;
  right?: boolean;
  colSpan?: number;
}) {
  const Tag = head ? "th" : "td";
  return (
    <Tag
      colSpan={colSpan}
      className={[
        "border border-slate-500 px-1.5 py-0.5 align-top",
        head ? "bg-slate-50 text-[10px] font-semibold uppercase text-slate-600" : "",
        w ? "w-px whitespace-nowrap" : "",
        center ? "text-center" : right ? "text-right" : "text-left",
      ].join(" ")}
    >
      {children}
    </Tag>
  );
}

