import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { canApprove } from "@/lib/report";
import { getDailyReportView } from "@/lib/daily-report-view";
import { DailyLogEditor } from "./editor";

const volFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 });

export default async function LaporanHarianKkpPage({
  params,
}: {
  params: Promise<{ slug: string; date: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/masuk");
  const { id: userId, role } = session.user;
  const { slug, date } = await params;

  const view = await getDailyReportView(slug, date, userId, role);
  if (view === "notfound" || view === "forbidden") notFound();

  const canEdit = canApprove(role);
  const dilaporkan = view.activities.filter((a) => a.doneVolume > 0);
  const selesai = dilaporkan.filter((a) => a.pct != null && a.pct >= 99.5).length;

  return (
    <>
      {/* Toolbar: judul section + tanggal + cetak */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">Laporan Harian (format KKP)</div>
          <div className="text-xs text-slate-500">Isi datanya di bawah; klik Cetak untuk PDF resmi.</div>
        </div>
        <form className="flex items-center gap-2" action={`/lokasi/${slug}/harian`}>
          <input
            type="date"
            name="d"
            defaultValue={date}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-[#1e3a8a]"
          />
          <button className="rounded-md border border-[#1e3a8a] px-3 py-1.5 text-sm font-medium text-[#1e3a8a] hover:bg-[#F1F5F9]">
            Buka
          </button>
        </form>
        <Link
          href={`/cetak/harian/${slug}/${date}`}
          target="_blank"
          className="ml-auto rounded-md bg-[#1e3a8a] px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-[#172554]"
        >
          Cetak / PDF →
        </Link>
      </div>

      {/* Input (utama) */}
      {canEdit ? (
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <DailyLogEditor slug={slug} date={date} initial={view.editor} />
        </section>
      ) : (
        <p className="text-sm text-slate-500">
          Detail dilengkapi oleh Site Manager. Klik “Cetak / PDF” untuk laporan resmi.
        </p>
      )}

      {/* Kegiatan yang SUDAH dilaporkan (bukan semua RAB) */}
      <section className="mt-8 rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-1 flex items-baseline justify-between">
          <div className="text-sm font-semibold text-slate-900">Kegiatan yang Sudah Dilaporkan</div>
          <div className="text-xs text-slate-500">{dilaporkan.length} kegiatan · {selesai} selesai</div>
        </div>
        <p className="mb-3 text-xs text-slate-500">
          Hanya kegiatan yang sudah ada input laporan. Kalau kosong berarti belum ada yang dilaporkan.
        </p>
        {dilaporkan.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">
            Belum ada kegiatan yang dilaporkan pada lokasi ini.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                  <th className="py-1.5 pr-2 font-medium">Kegiatan</th>
                  <th className="py-1.5 px-2 text-right font-medium">Rencana</th>
                  <th className="py-1.5 px-2 text-right font-medium">Realisasi</th>
                  <th className="py-1.5 pl-2 text-right font-medium">%</th>
                </tr>
              </thead>
              <tbody>
                {dilaporkan.map((a, i) => {
                  const full = a.pct != null && a.pct >= 99.5;
                  return (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="py-1.5 pr-2 text-slate-800">{a.name}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-slate-500">
                        {a.planVolume != null ? volFmt.format(a.planVolume) : "—"} {a.unit}
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-slate-900">
                        {volFmt.format(a.doneVolume)} {a.unit}
                      </td>
                      <td className={`py-1.5 pl-2 text-right tabular-nums font-medium ${full ? "text-[#15803D]" : "text-amber-600"}`}>
                        {a.pct != null ? `${a.pct.toFixed(0)}%` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
