import { cn } from "@/lib/cn";
import { formatTanggal } from "@/lib/format";
import { PACKAGE_STAGE_LABEL, PACKAGE_STAGE_ORDER } from "@/lib/lifecycle";
import type { PackageStage } from "@/generated/prisma/enums";

/**
 * Panel siklus paket – tujuh tahap sekaligus, masing-masing BERTANGGAL.
 *
 * Versi lama hanya sebuah stepper: lingkaran bernomor dan nama tahap. Ia
 * menjawab "sekarang di mana", tapi tidak menjawab pertanyaan yang sebenarnya
 * ditanyakan orang saat membuka paket – *sejak kapan?* dan *tahap kemarin
 * berapa lama?*. Tanggalnya sudah ada di `PackageStageHistory`; yang kurang
 * cuma menampilkannya.
 *
 * Tahap yang belum dilalui ditulis "belum", bukan dikosongkan: kolom kosong
 * terbaca seperti data yang hilang, sedangkan "belum" adalah keadaan yang
 * memang benar.
 */
export function SiklusPanel({
  current,
  /** Tanggal MASUK per tahap – ambil yang paling awal bila tahapnya berulang. */
  masuk,
}: {
  current: PackageStage;
  masuk: Map<PackageStage, Date>;
}) {
  const idxSekarang = PACKAGE_STAGE_ORDER.indexOf(current);
  return (
    <ol
      /*
       * Di ponsel daftarnya digulir mendatar, bukan dipadatkan jadi tujuh
       * kolom selebar 40px – tujuh kolom di layar 390px membuat setiap nama
       * tahap terpotong, dan panel yang tak terbaca sama saja dengan panel
       * yang tidak ada.
       */
      className="-mx-1 flex snap-x gap-1.5 overflow-x-auto px-1 pb-1 sm:grid sm:grid-cols-4 sm:overflow-visible lg:grid-cols-7"
    >
      {PACKAGE_STAGE_ORDER.map((stage, i) => {
        const lewat = idxSekarang >= 0 && i < idxSekarang;
        const aktif = i === idxSekarang;
        const tgl = masuk.get(stage);
        return (
          <li
            key={stage}
            aria-current={aktif ? "step" : undefined}
            className={cn(
              "min-w-[7.5rem] shrink-0 snap-start rounded-md border px-2 py-1.5 sm:min-w-0",
              aktif
                ? "border-primary-300 bg-primary-50"
                : lewat
                  ? "border-primary-200 bg-surface"
                  : "border-border bg-surface",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "tabular inline-flex size-5 items-center justify-center rounded-full border text-[11px] font-semibold",
                aktif
                  ? "border-primary bg-primary text-white"
                  : lewat
                    ? "border-primary text-primary"
                    : "border-border text-ink-faint",
              )}
            >
              {i + 1}
            </span>
            <span
              className={cn(
                "mt-1 block truncate text-[12px] font-medium",
                aktif ? "text-primary" : lewat ? "text-ink" : "text-ink-faint",
              )}
            >
              {PACKAGE_STAGE_LABEL[stage]}
            </span>
            <span className="mt-0.5 block text-[11px] text-ink-muted">
              {tgl ? formatTanggal(tgl, "d MMM yyyy") : "belum"}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
