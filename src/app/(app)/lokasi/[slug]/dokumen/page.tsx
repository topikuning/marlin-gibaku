import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { isCrossLocation } from "@/lib/roles";
import { hasLocationAccess } from "@/lib/access";
import {
  canManageDocuments,
  STAGE_ORDER,
  STAGE_LABEL,
  TYPE_LABEL,
} from "@/lib/documents";
import { UploadForm } from "./upload-form";

const dateFmt = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" });

function fmtBytes(b: number): string {
  if (b >= 1_000_000) return `${(b / 1_000_000).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(b / 1000))} KB`;
}

export default async function DokumenPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/masuk");
  const { id: userId, role } = session.user;
  const { slug } = await params;

  const location = await db.location.findUnique({
    where: { slug },
    select: { id: true, name: true },
  });
  if (!location) notFound();
  if (!isCrossLocation(role) && !(await hasLocationAccess(userId, role, location.id))) {
    notFound();
  }

  const docs = await db.document.findMany({
    where: { locationId: location.id },
    orderBy: [{ docDate: "desc" }, { uploadedAt: "desc" }],
    include: { uploadedBy: { select: { fullName: true } } },
  });

  const byStage = new Map<string, typeof docs>();
  for (const s of STAGE_ORDER) byStage.set(s, []);
  for (const doc of docs) byStage.get(doc.stage)?.push(doc);

  const stagesWithDocs = STAGE_ORDER.filter((s) => (byStage.get(s)?.length ?? 0) > 0).length;
  const canManage = canManageDocuments(role);

  return (
    <>
      <h1 className="mb-1 text-3xl font-semibold text-slate-900">
        Arsip Dokumen — {location.name}
      </h1>
      <p className="mb-6 text-sm text-slate-500">
        {docs.length} dokumen · {stagesWithDocs}/{STAGE_ORDER.length} tahap PBJ terisi.
      </p>

      {/* kelengkapan per tahap */}
      <div className="mb-8 flex flex-wrap gap-1.5">
        {STAGE_ORDER.map((s) => {
          const n = byStage.get(s)?.length ?? 0;
          return (
            <span
              key={s}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                n > 0 ? "bg-[#DCFCE7] text-[#16A34A]" : "bg-slate-100 text-slate-400"
              }`}
              title={`${n} dokumen`}
            >
              {STAGE_LABEL[s]} {n > 0 ? `· ${n}` : ""}
            </span>
          );
        })}
      </div>

      {canManage && (
        <section className="mb-10 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 text-[10px] font-semibold uppercase tracking-widest text-[#1e3a8a]">
            Unggah dokumen
          </div>
          <UploadForm locationId={location.id} slug={slug} />
        </section>
      )}

      <div className="space-y-6">
        {STAGE_ORDER.map((s) => {
          const list = byStage.get(s) ?? [];
          if (list.length === 0) return null;
          return (
            <section key={s}>
              <h2 className="mb-2 text-sm font-bold text-slate-900">{STAGE_LABEL[s]}</h2>
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                {list.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 last:border-0"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900">{doc.title}</div>
                      <div className="text-xs text-slate-500">
                        {TYPE_LABEL[doc.type]}
                        {doc.docNumber ? ` · No. ${doc.docNumber}` : ""}
                        {doc.docDate ? ` · ${dateFmt.format(doc.docDate)}` : ""}
                        {" · "}
                        {fmtBytes(doc.bytes)} · {doc.uploadedBy.fullName}
                      </div>
                    </div>
                    <a
                      href={`/api/documents/${doc.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#1e3a8a] transition hover:bg-slate-50"
                    >
                      Unduh
                    </a>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {docs.length === 0 && (
        <p className="text-sm text-slate-400">Belum ada dokumen untuk lokasi ini.</p>
      )}
    </>
  );
}
