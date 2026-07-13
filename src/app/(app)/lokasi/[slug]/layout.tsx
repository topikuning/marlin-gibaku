import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { canReport, canApprove } from "@/lib/report";
import { LOCATION_STATUS_LABEL, LOCATION_STATUS_CLASS } from "@/lib/roles";
import { LokasiTabs, type LokasiTab } from "@/components/knmp/lokasi-tabs";

export default async function LokasiLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/masuk");
  const { role } = session.user;
  const { slug } = await params;

  const location = await db.location.findUnique({
    where: { slug },
    select: { name: true, regency: true, province: true, status: true },
  });
  // Kalau tak ada, biarkan halaman anak yang notFound().
  if (!location) return <>{children}</>;

  const base = `/lokasi/${slug}`;
  const tabs: LokasiTab[] = [
    { href: base, label: "Ringkasan", exact: true },
    { href: `${base}/rab`, label: "RAB" },
    { href: `${base}/kurva-s`, label: "Kurva-S" },
  ];
  if (canReport(role)) tabs.push({ href: `${base}/lapor`, label: "Lapor Harian" });
  if (canApprove(role)) tabs.push({ href: `${base}/harian`, label: "Laporan Harian KKP" });
  tabs.push({ href: `${base}/periodik`, label: "Mingguan/Bulanan" });
  tabs.push({ href: `${base}/dokumen`, label: "Dokumen" });
  tabs.push({ href: `${base}/administrasi`, label: "Administrasi" });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/lokasi" className="text-xs text-slate-400 hover:text-slate-600">
            ← Semua lokasi
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900">{location.name}</h1>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${LOCATION_STATUS_CLASS[location.status]}`}>
              {LOCATION_STATUS_LABEL[location.status]}
            </span>
          </div>
          <div className="text-sm text-slate-500">
            {[location.regency, location.province].filter(Boolean).join(", ")}
          </div>
        </div>
      </div>

      <LokasiTabs tabs={tabs} />

      {children}
    </div>
  );
}
