import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { PACKAGE_STAGE_LABEL } from "@/lib/lifecycle";
import type { PackageStage } from "@/generated/prisma/enums";

/**
 * BILAH FUNNEL paket — prospek → tender → penetapan → kontrak → pelaksanaan
 * (DECISIONS 368).
 *
 * Diadopsi dari rancangan user 2026-08-19. Deskripsi halaman ini SUDAH berbunyi
 * "funnel paket pekerjaan: prospek → tender → …" sejak lama, tapi tidak ada
 * satu pun tempat di layar yang memperlihatkan sebaran itu — kalimatnya
 * menjanjikan sesuatu yang tidak ada.
 *
 * Tiap langkah adalah TAUTAN SARINGAN, bukan hiasan: melihat "tender 1" lalu
 * tidak bisa menekannya untuk tahu paket mana, memaksa orang menyaring sendiri
 * di bawah.
 *
 * Tahap akhir (serah terima, selesai, batal) sengaja TIDAK di bilah ini: funnel
 * menggambarkan pekerjaan yang sedang berjalan menuju pelaksanaan, dan
 * menambahkan tiga langkah yang sudah selesai membuat lima langkah pertama —
 * yang benar-benar dipantau — menyusut di layar sempit. Jumlahnya tetap bisa
 * dilihat lewat saringan.
 */
const LANGKAH: PackageStage[] = ["prospek", "tender", "penetapan", "kontrak", "pelaksanaan"];

export function FunnelPaket({
  perStage,
  aktif,
}: {
  perStage: Record<PackageStage, number>;
  /** Tahap yang sedang menyaring daftar — dipakai menandai langkahnya. */
  aktif?: PackageStage | "berkontrak";
}) {
  return (
    <nav aria-label="Tahapan paket" className="flex flex-wrap items-center gap-1.5">
      {LANGKAH.map((s, i) => {
        const dipilih = aktif === s;
        return (
          <span key={s} className="flex items-center gap-1.5">
            {i > 0 ? (
              <ChevronRight aria-hidden className="size-3.5 shrink-0 text-ink-faint" />
            ) : null}
            <Link
              href={dipilih ? "/paket" : `/paket?stage=${s}`}
              aria-current={dipilih ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                dipilih
                  ? "border-primary bg-primary text-white"
                  : "border-border bg-surface text-ink-muted hover:border-border-strong hover:bg-surface-muted",
              )}
            >
              <span className={cn("font-semibold", dipilih ? "text-white" : "text-ink")}>
                {PACKAGE_STAGE_LABEL[s]}
              </span>
              <span className="tabular">{perStage[s]}</span>
            </Link>
          </span>
        );
      })}
    </nav>
  );
}
