import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canManageUsers } from "@/lib/roles";
import { formatRupiah } from "@/lib/format";
import { ImportForm } from "./import-form";

const dateFmt = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" });

const SRC_LABEL: Record<string, string> = {
  initial_hps: "HPS awal",
  adendum: "Adendum",
};
const STATUS_CLASS: Record<string, string> = {
  active: "bg-[#DCFCE7] text-[#16A34A]",
  superseded: "bg-slate-100 text-slate-400",
  draft: "bg-[#FEF3C7] text-[#B45309]",
};

export default async function ImportRabPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/masuk");
  if (!canManageUsers(session.user.role)) notFound();
  const { slug } = await params;

  const location = await db.location.findUnique({
    where: { slug },
    select: { id: true, name: true },
  });
  if (!location) notFound();

  const revisions = await db.rabRevision.findMany({
    where: { locationId: location.id },
    orderBy: { revisionNo: "desc" },
    include: { createdBy: { select: { fullName: true } } },
  });

  return (
    <>
      <Link href={`/lokasi/${slug}/rab`} className="mb-4 inline-block text-sm text-[#1e3a8a] hover:underline">
        ← RAB
      </Link>
      <h1 className="mb-1 text-3xl font-semibold text-slate-900">Import RAB — {location.name}</h1>
      <p className="mb-8 text-sm text-slate-500">
        Upload HPS Excel. Jika lokasi sudah punya RAB aktif, import baru menjadi
        <b> adendum</b> (revisi) — RAB lama diarsipkan, tidak dihapus.
      </p>

      <section className="mb-10 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <ImportForm locationId={location.id} slug={slug} />
      </section>

      <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-[#1e3a8a]">
        Riwayat revisi ({revisions.length})
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {revisions.length === 0 ? (
          <p className="px-4 py-3 text-sm text-slate-400">Belum ada revisi.</p>
        ) : (
          revisions.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 last:border-0">
              <div>
                <span className="font-semibold text-slate-900">Revisi #{r.revisionNo}</span>{" "}
                <span className="text-xs text-slate-500">
                  {SRC_LABEL[r.source] ?? r.source} · {dateFmt.format(r.createdAt)}
                  {r.createdBy ? ` · ${r.createdBy.fullName}` : ""}
                </span>
                {r.note && <div className="text-xs text-slate-500">“{r.note}”</div>}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm tabular-nums text-slate-700">{formatRupiah(r.totalValue)}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_CLASS[r.status]}`}>
                  {r.status}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
