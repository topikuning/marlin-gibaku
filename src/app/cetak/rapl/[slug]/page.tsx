import { notFound } from "next/navigation";
import { PrintToolbar } from "@/components/print/print-toolbar";
import { requireUser, requireLocationAccess } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { keadaanHarga } from "@/lib/ahsp/hsd";
import { simulasiRapl } from "@/lib/ahsp/rapl";
import { ringkasAhsp } from "@/lib/ahsp/import";
import { PRINT_BACK_PARAM, safeBackPath } from "@/lib/print-back";
import { RaplLembar } from "@/components/knmp/rapl-lembar";

export const dynamic = "force-dynamic";

/**
 * Cetak RAPL (A4 potret) — DECISIONS 327.
 *
 * Ada karena RAPL yang cuma hidup di layar tidak bisa dipakai: dibawa ke rapat,
 * ditandatangani, dilampirkan. Yang dicetak SELALU membawa cakupannya sendiri —
 * lembar yang menyebut biaya Rp x tanpa menyebut bahwa itu baru menutup 72%
 * nilai RAB akan dibaca sebagai biaya seluruh proyek.
 */
export default async function CetakRaplPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;

  const user = await requireUser();
  if (!can(user.role, "rab.view")) notFound();

  const location = await db.location.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      regency: true,
      province: true,
      package: {
        select: {
          name: true,
          contract: {
            select: { contractNumber: true, vendor: { select: { name: true } } },
          },
        },
      },
    },
  });
  if (!location) notFound();
  await requireLocationAccess(user, location.id);

  const [rapl, harga, basis] = await Promise.all([
    simulasiRapl(location.id),
    keadaanHarga(location.id),
    ringkasAhsp(),
  ]);

  return (
    <>
      <PrintToolbar
        backHref={safeBackPath(
          typeof sp[PRINT_BACK_PARAM] === "string" ? sp[PRINT_BACK_PARAM] : undefined,
          `/lokasi/${slug}/rapl`,
        )}
      />
      <style>{`@media print { @page { size: A4 portrait; margin: 12mm; } }`}</style>
      <main className="bg-white">
        <section className="mx-auto w-full max-w-[860px] overflow-x-auto p-6 print:overflow-visible print:p-0">
          <RaplLembar
            lokasi={location.name}
            paket={location.package.name}
            wilayah={`${location.regency}, ${location.province}`}
            kontrak={location.package.contract?.contractNumber ?? null}
            penyedia={location.package.contract?.vendor.name ?? null}
            sumberAhsp={basis?.name ?? "belum dimuat"}
            shaAhsp={basis?.fileSha256 ?? "—"}
            dicetakOleh={user.fullName}
            rapl={rapl}
            harga={harga}
          />
        </section>
      </main>
    </>
  );
}
