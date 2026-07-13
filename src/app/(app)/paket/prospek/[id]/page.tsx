import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { formatRupiah } from "@/lib/format";
import {
  canManageProspek,
  PROSPEK_ACTIVE_STAGES,
  PROSPEK_STAGE_LABEL,
  PROSPEK_STAGE_CLASS,
  STAGE_DOC_HINT,
} from "@/lib/prospek";
import { KKP_ADMIN_FLOW, FLOW_TOTAL, PIC_LABEL, type FlowItem } from "@/lib/kkp-admin-flow";
import { TYPE_LABEL } from "@/lib/documents";
import { PageHeader } from "@/components/knmp/page-header";
import { cancelProspek } from "../actions";
import { ConvertForm } from "./convert-form";
import { ProspekEdit, ProspekDocUpload } from "./prospek-tools";

const docDateFmt = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" });

export default async function ProspekDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/masuk");
  if (!canManageProspek(session.user.role)) notFound();
  const { id } = await params;

  const prospek = await db.prospek.findUnique({
    where: { id },
    include: { lokasi: { orderBy: { name: "asc" } } },
  });
  if (!prospek) notFound();

  const isKontrak = prospek.stage === "jadi_kontrak";
  const contract = prospek.contractId
    ? await db.contract.findUnique({
        where: { id: prospek.contractId },
        select: { contractNumber: true, contractValue: true },
      })
    : null;

  // Dokumen tender yang sudah diunggah ke prospek ini.
  const docs = await db.document.findMany({
    where: { prospekId: id },
    orderBy: { uploadedAt: "desc" },
    select: { id: true, title: true, type: true, docNumber: true, docDate: true },
  });
  const presentTypes = new Set(docs.map((d) => d.type));
  const isDone = (it: FlowItem) => !!it.docType && presentTypes.has(it.docType);
  const doneTotal = KKP_ADMIN_FLOW.reduce((n, p) => n + p.items.filter(isDone).length, 0);
  const adminPct = Math.round((doneTotal / FLOW_TOTAL) * 100);

  return (
    <>
      <Link href="/paket" className="mb-4 inline-block text-sm text-[#1e3a8a] hover:underline">
        ← Paket
      </Link>
      <PageHeader
        eyebrow="Prospek / Calon Kontrak"
        title={prospek.name}
        subtitle={
          [prospek.province, prospek.packageNumber].filter(Boolean).join(" · ") ||
          "Paket tender"
        }
      />

      {!isKontrak && (
        <div className="mb-6">
          <ProspekEdit
            prospek={{
              id: prospek.id,
              name: prospek.name,
              packageNumber: prospek.packageNumber,
              hpsValue: prospek.hpsValue.toString(),
              province: prospek.province,
              contractorName: prospek.contractorName,
              note: prospek.note,
            }}
          />
        </div>
      )}

      {/* Ringkasan nilai */}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card label="Nilai HPS">{formatRupiah(prospek.hpsValue)}</Card>
        <Card label="Calon penyedia">{prospek.contractorName ?? "—"}</Card>
        <Card label="Status">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PROSPEK_STAGE_CLASS[prospek.stage]}`}>
            {PROSPEK_STAGE_LABEL[prospek.stage]}
          </span>
        </Card>
      </div>

      {/* Tahap tender — OTOMATIS dari dokumen (bukan pilihan manual) */}
      {!isKontrak && (
        <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-1 flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-900">Tahap tender (otomatis dari dokumen)</div>
            <form action={cancelProspek.bind(null, prospek.id)}>
              <button type="submit" className="text-xs font-medium text-red-600 hover:underline">Batalkan prospek</button>
            </form>
          </div>
          <p className="mb-3 text-xs text-slate-500">
            Tahap naik sendiri saat dokumen penanda diunggah — {STAGE_DOC_HINT[prospek.stage]}.
          </p>
          <ol className="flex flex-wrap items-center gap-1.5">
            {PROSPEK_ACTIVE_STAGES.map((s, i) => {
              const reachedIdx = PROSPEK_ACTIVE_STAGES.indexOf(prospek.stage);
              const done = reachedIdx >= i;
              const current = prospek.stage === s;
              return (
                <li key={s} className="flex items-center gap-1.5">
                  <span className={`rounded-full px-3 py-1 text-sm font-medium ${current ? "bg-[#1e3a8a] text-white" : done ? "bg-[#eff6ff] text-[#1e3a8a]" : "bg-slate-100 text-slate-400"}`}>
                    {PROSPEK_STAGE_LABEL[s]}
                  </span>
                  {i < PROSPEK_ACTIVE_STAGES.length - 1 && <span className="text-slate-300">→</span>}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {/* Lokasi target */}
      <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-3 text-sm font-semibold text-slate-900">
          Desa / lokasi target ({prospek.lokasi.length})
        </div>
        {prospek.lokasi.length === 0 ? (
          <p className="text-sm text-slate-400">Belum ada lokasi.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {prospek.lokasi.map((l) => (
              <li key={l.id} className="flex items-center justify-between py-2">
                <span className="text-slate-800">
                  {l.name}
                  <span className="ml-2 text-xs text-slate-400">
                    {[l.village, l.regency, l.province].filter(Boolean).join(", ")}
                  </span>
                </span>
                {l.createdLocationId && (
                  <span className="rounded-full bg-green-50 px-2 py-0.5 text-[11px] text-green-700">
                    lokasi dibuat
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 1) UPLOAD DULU — dokumen menaikkan tahap otomatis */}
      {!isKontrak && (
        <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-1 text-sm font-semibold text-slate-900">Unggah dokumen (sejak tender)</div>
          <p className="mb-4 text-xs text-slate-500">
            Undangan, BA Penjelasan/aanwijzing (isi HPS di sini), penawaran, negosiasi, SPPBJ.
            Tahap & progres di bawah naik <b>otomatis</b> dari dokumen ini.
          </p>
          <ProspekDocUpload prospekId={prospek.id} />
        </section>
      )}

      {/* 2) PROGRES ALUR ADMINISTRASI (hasil dari dokumen) */}
      <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-1 flex items-baseline justify-between">
          <div className="text-sm font-semibold text-slate-900">Progres alur administrasi</div>
          <div className="text-xs tabular-nums text-slate-500">{doneTotal}/{FLOW_TOTAL} · {adminPct}%</div>
        </div>
        <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-[#1e3a8a]" style={{ width: `${adminPct}%` }} />
        </div>

        <div className="mb-5 space-y-4">
          {KKP_ADMIN_FLOW.slice(0, 5).map((phase) => (
            <div key={phase.key}>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{phase.title}</div>
              <ul className="space-y-1">
                {phase.items.map((it) => {
                  const done = isDone(it);
                  return (
                    <li key={it.no} className="flex items-center gap-2 text-sm">
                      <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-full text-[9px] text-white ${done ? "bg-[#16A34A]" : "bg-slate-300"}`}>
                        {done ? "✓" : ""}
                      </span>
                      <span className={done ? "text-slate-800" : "text-slate-500"}>{it.label}</span>
                      <span className="ml-auto shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">{PIC_LABEL[it.pic]}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        <div>
          <div className="mb-2 text-sm font-semibold text-slate-900">Dokumen terunggah ({docs.length})</div>
          {docs.length === 0 ? (
            <p className="text-sm text-slate-400">Belum ada dokumen.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {docs.map((doc) => (
                <li key={doc.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0 truncate text-slate-800">
                    {doc.title}
                    <span className="ml-2 text-xs text-slate-400">{TYPE_LABEL[doc.type]}</span>
                  </span>
                  <span className="shrink-0 text-xs text-slate-400">
                    {doc.docNumber ? `${doc.docNumber} · ` : ""}
                    {doc.docDate ? docDateFmt.format(doc.docDate) : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Konversi / hasil kontrak */}
      {isKontrak ? (
        <section className="rounded-xl border border-green-200 bg-green-50 p-5">
          <div className="mb-1 text-sm font-semibold text-green-800">Sudah jadi kontrak</div>
          {contract && (
            <p className="text-sm text-green-800">
              {contract.contractNumber} · nilai final {formatRupiah(contract.contractValue)}.{" "}
              <Link href="/lokasi" className="font-semibold underline">
                Lihat lokasi →
              </Link>
            </p>
          )}
        </section>
      ) : prospek.stage === "batal" ? (
        <section className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
          Prospek dibatalkan.
        </section>
      ) : (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-3 text-sm font-semibold text-slate-900">Jadikan Kontrak</div>
          <ConvertForm
            prospekId={prospek.id}
            defaultContractor={prospek.contractorName ?? ""}
            hpsLabel={formatRupiah(prospek.hpsValue)}
          />
        </section>
      )}
    </>
  );
}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{children}</div>
    </div>
  );
}
