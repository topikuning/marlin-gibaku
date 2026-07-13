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
} from "@/lib/prospek";
import { PageHeader } from "@/components/knmp/page-header";
import { updateProspekStage } from "../actions";
import { ConvertForm } from "./convert-form";

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

  return (
    <>
      <Link href="/pengadaan" className="mb-4 inline-block text-sm text-[#1e3a8a] hover:underline">
        ← Pengadaan
      </Link>
      <PageHeader
        eyebrow="Prospek / Calon Kontrak"
        title={prospek.name}
        subtitle={
          [prospek.province, prospek.packageNumber].filter(Boolean).join(" · ") ||
          "Paket tender"
        }
      />

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

      {/* Pipeline tahap */}
      {!isKontrak && (
        <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-3 text-sm font-semibold text-slate-900">Tahap pengadaan</div>
          <div className="flex flex-wrap gap-2">
            {PROSPEK_ACTIVE_STAGES.map((s) => {
              const active = prospek.stage === s;
              return (
                <form key={s} action={updateProspekStage.bind(null, prospek.id, s)}>
                  <button
                    type="submit"
                    className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                      active
                        ? "bg-[#1e3a8a] text-white"
                        : "border border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {PROSPEK_STAGE_LABEL[s]}
                  </button>
                </form>
              );
            })}
            <form action={updateProspekStage.bind(null, prospek.id, "batal")}>
              <button
                type="submit"
                className="rounded-full border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
              >
                Batalkan
              </button>
            </form>
          </div>
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
