import Link from "next/link";
import { redirect } from "next/navigation";
import type { UserRole } from "@prisma/client";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  isCrossLocation,
  canManageUsers,
  canViewDashboard,
  ROLE_LABEL,
} from "@/lib/roles";
import { canReport, canApprove } from "@/lib/report";

type Feature = {
  emoji: string;
  title: string;
  desc: string;
  href: string;
  cta: string;
  show: (role: UserRole) => boolean;
};

/**
 * Katalog fitur yang tampil di Beranda sebagai kartu — biar semua kemampuan
 * sistem kelihatan langsung setelah login, tidak "terkubur" di dalam halaman.
 */
const FEATURES: Feature[] = [
  {
    emoji: "📍",
    title: "Lokasi & RAB",
    desc: "Daftar lokasi, rincian RAB per lokasi sampai sub-item, plus import HPS Excel & adendum (histori revisi tersimpan).",
    href: "/lokasi",
    cta: "Buka daftar lokasi",
    show: () => true,
  },
  {
    emoji: "📝",
    title: "Lapor Harian + Foto",
    desc: "Input volume pekerjaan harian dengan foto bukti dari kamera. Draft mandor → disetujui Site Manager sebelum masuk laporan resmi.",
    href: "/laporan",
    cta: "Buka laporan",
    show: (r) => canReport(r) || canApprove(r),
  },
  {
    emoji: "📈",
    title: "Dashboard & Kurva-S",
    desc: "Progress realisasi vs rencana (kurva-S) per lokasi, deviasi, dan ringkasan nilai proyek se-program.",
    href: "/dashboard",
    cta: "Buka dashboard",
    show: canViewDashboard,
  },
  {
    emoji: "🗂️",
    title: "Arsip Dokumen",
    desc: "Dokumen resmi per lokasi mengikuti tahapan PBJ (undangan, SPPBJ, SPMK, MC0, adendum, BAST, penagihan). Buka lewat detail lokasi.",
    href: "/lokasi",
    cta: "Pilih lokasi → Arsip Dokumen",
    show: () => true,
  },
  {
    emoji: "📄",
    title: "Kontrak & Kontraktor",
    desc: "Master data kontrak dan kontraktor. Satu kontraktor bisa banyak kontrak, satu kontrak bisa banyak lokasi.",
    href: "/kontrak",
    cta: "Buka kontrak",
    show: canManageUsers,
  },
  {
    emoji: "👥",
    title: "Pengguna",
    desc: "Kelola akun & role (Super Admin, PD, PM, Site Manager, Mandor, Exec) serta penugasan lokasi.",
    href: "/pengguna",
    cta: "Buka pengguna",
    show: canManageUsers,
  },
];

export default async function BerandaPage() {
  const session = await auth();
  if (!session?.user) redirect("/masuk");

  const { id, name, role } = session.user;
  const crossLocation = isCrossLocation(role);

  const totalLocations = crossLocation ? await db.location.count() : 0;
  const assignments = crossLocation
    ? []
    : await db.userLocationAssignment.findMany({
        where: { userId: id, unassignedAt: null },
        include: { location: { select: { slug: true, name: true, province: true } } },
        orderBy: { assignedAt: "asc" },
      });

  const features = FEATURES.filter((f) => f.show(role));

  return (
    <>
      <h1 className="mb-1 text-4xl font-semibold text-[#0F172A]">
        Halo, {name}.
      </h1>
      <p className="mb-8 text-[#0F766E]">
        Anda masuk sebagai{" "}
        <span className="font-semibold">{ROLE_LABEL[role]}</span>.
      </p>

      {crossLocation ? (
        <section className="mb-8 rounded-lg border border-[#E2E8F0] bg-[#FFFFFF] p-5">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[#0F766E]">
            Cakupan akses
          </div>
          <p className="text-[#0F172A]">
            Akses <span className="font-semibold">semua lokasi</span> —{" "}
            {totalLocations.toLocaleString("id-ID")} lokasi di sistem.
          </p>
        </section>
      ) : (
        <section className="mb-8 rounded-lg border border-[#E2E8F0] bg-[#FFFFFF] p-5">
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-[#0F766E]">
            Lokasi yang ditugaskan ({assignments.length})
          </div>
          {assignments.length === 0 ? (
            <p className="text-sm text-[#64748B]">
              Belum ada lokasi yang ditugaskan. Hubungi admin untuk penugasan.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {assignments.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/lokasi/${a.location.slug}`}
                    className="flex items-center justify-between rounded px-2 py-1.5 text-sm transition hover:bg-[#F1F5F9]"
                  >
                    <span className="font-medium text-[#0F172A]">
                      {a.location.name}
                    </span>
                    <span className="text-xs text-[#64748B]">
                      {a.location.province}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-[#0F766E]">
        Semua fitur
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((f) => (
          <Link
            key={f.title}
            href={f.href}
            className="group flex flex-col rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] p-5 transition hover:border-[#0F766E] hover:shadow-sm"
          >
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-[#F0FDFA] text-xl">
              {f.emoji}
            </div>
            <div className="mb-1 font-semibold text-[#0F172A]">{f.title}</div>
            <p className="mb-4 flex-1 text-sm text-[#64748B]">{f.desc}</p>
            <span className="text-sm font-semibold text-[#0F766E] group-hover:underline">
              {f.cta} →
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}
