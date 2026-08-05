import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowRight, Check, CircleAlert } from "lucide-react";
import { Banner, Card, CardBody, CardHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { getPackageWorkspace } from "@/lib/package/queries";
import { getPackageReadiness, type Syarat } from "@/lib/package/readiness";
import { PACKAGE_STAGE_LABEL } from "@/lib/lifecycle";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Kesiapan Paket" };
export const dynamic = "force-dynamic";

/**
 * KESIAPAN PAKET — checklist terurut & resumable (PRD §5.2, gap P0).
 *
 * Menggantikan kebiasaan "buka tiap tab satu per satu untuk menebak apa yang
 * kurang" dengan satu daftar yang menyebutkan kekurangannya, ALASANNYA, dan
 * tautan langsung ke tempat memperbaikinya.
 *
 * Halaman ini TIDAK memindahkan stage dan tidak menyembunyikan tombol apa pun
 * — aksinya tetap di tab masing-masing. Yang diberikannya adalah jawaban atas
 * "apakah paket ini sudah layak naik tahap", yang selama ini hanya ada di
 * kepala orang yang mengerjakannya.
 */
export default async function SetupPaketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  requireCapabilityPage(user.role, "package.view");
  const { id } = await params;

  const [pkg, r] = await Promise.all([getPackageWorkspace(id), getPackageReadiness(id)]);
  if (!pkg || !r) notFound();

  const total = r.langkah.flatMap((l) => l.syarat).length;
  const beres = r.langkah.flatMap((l) => l.syarat).filter((s) => s.ok).length;

  return (
    <div className="space-y-4">
      {r.blockers.length === 0 ? (
        <Banner
          tone="success"
          title="Seluruh syarat pokok terpenuhi"
          description={
            r.warnings.length > 0
              ? `Masih ada ${r.warnings.length} hal yang sebaiknya dilengkapi, tetapi tidak menghalangi pelaksanaan.`
              : "Tidak ada yang tertunda."
          }
        />
      ) : (
        <Banner
          tone="warning"
          title={`${r.blockers.length} syarat pokok belum terpenuhi`}
          description="Paket tetap bisa dinaikkan tahapnya, tetapi angka progres, kurva-S, atau penagihan akan pincang sampai hal-hal di bawah ini ditutup."
        />
      )}

      <Card>
        <CardHeader
          title="Kesiapan paket"
          subtitle={`${beres} dari ${total} syarat terpenuhi · tahap sekarang ${PACKAGE_STAGE_LABEL[r.stage]}${
            r.stageBerikutnya ? ` · berikutnya ${PACKAGE_STAGE_LABEL[r.stageBerikutnya]}` : ""
          }`}
        />
        <CardBody className="space-y-5">
          {r.langkah.map((l, i) => (
            <section key={l.key}>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                    l.siap ? "bg-success-soft text-success" : "bg-warning-soft text-warning",
                  )}
                >
                  {l.siap ? <Check aria-hidden className="size-3.5" /> : i + 1}
                </span>
                <h3 className="text-sm font-semibold text-ink">{l.judul}</h3>
                <span className="text-[11.5px] text-ink-muted">{l.ringkas}</span>
              </div>
              <ul className="mt-2 ml-8 space-y-1.5">
                {l.syarat.map((s) => (
                  <BarisSyarat key={s.label} s={s} />
                ))}
              </ul>
            </section>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}

function BarisSyarat({ s }: { s: Syarat }) {
  const Ikon = s.ok ? Check : s.tingkat === "blocker" ? CircleAlert : AlertTriangle;
  return (
    <li className="flex items-start gap-2">
      {/* Status TIDAK lewat warna saja — ikonnya berbeda bentuk, dan
          tingkatannya ditulis sebagai teks pada yang belum terpenuhi. */}
      <Ikon
        aria-hidden
        className={cn(
          "mt-0.5 size-4 shrink-0",
          s.ok ? "text-success" : s.tingkat === "blocker" ? "text-danger" : "text-warning",
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2">
          <span className={cn("text-[13px]", s.ok ? "text-ink-muted line-through" : "font-medium text-ink")}>
            {s.label}
          </span>
          {!s.ok ? (
            <span
              className={cn(
                "rounded-full border px-1.5 text-[10px] font-bold uppercase",
                s.tingkat === "blocker"
                  ? "border-danger-border bg-danger-soft text-danger"
                  : "border-warning-border bg-warning-soft text-warning",
              )}
            >
              {s.tingkat === "blocker" ? "pokok" : "sebaiknya"}
            </span>
          ) : null}
        </span>
        {!s.ok ? (
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-ink-muted">
            {s.alasan}
            <Link
              href={s.href}
              className="inline-flex items-center gap-0.5 font-semibold text-primary hover:underline"
            >
              Perbaiki <ArrowRight aria-hidden className="size-3" />
            </Link>
          </span>
        ) : null}
      </span>
    </li>
  );
}
