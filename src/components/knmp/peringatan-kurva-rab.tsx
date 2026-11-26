import { Banner, ButtonLink } from "@/components/ui";
import type { KurvaTakSesuai } from "@/lib/scurve/kurva-vs-rab";
import { hrefBagianProgress } from "@/lib/progress-bagian";

const persen = (v: number) => `${v.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

/**
 * Kurva-S (jadwal tersimpan) tidak cocok dengan RAB aktif – disebut di layar,
 * tidak di lembar cetak (DECISIONS 794). Adendum sengaja tidak mengubah bobot
 * jadwal (698), jadi sesudah CCO jadwalnya harus diperbarui; peringatan ini
 * memastikan langkah itu tidak terlupa.
 */
export function PeringatanKurvaRab({
  takSesuai,
  slug,
  bolehUbah,
}: {
  takSesuai: KurvaTakSesuai | null | undefined;
  slug: string;
  bolehUbah: boolean;
}) {
  if (!takSesuai) return null;
  const { tanpaRab, tanpaJadwal } = takSesuai;
  return (
    <Banner
      tone="warning"
      title="Kurva-S belum mengikuti RAB aktif"
      description={
        <>
          {tanpaRab.length > 0 ? (
            <span className="block">
              Masih berbobot di kurva-S, padahal tidak ada atau bernilai 0 di RAB aktif:{" "}
              {tanpaRab.map((x) => `${x.name} (${persen(x.bobot)})`).join(", ")}.
            </span>
          ) : null}
          {tanpaJadwal.length > 0 ? (
            <span className="mt-1 block">
              Ada di RAB aktif tetapi belum dijadwalkan:{" "}
              {tanpaJadwal.map((x) => `${[x.code, x.name].filter(Boolean).join(" ")} (${persen(x.bobotRab)} dari RAB)`).join(", ")}.
            </span>
          ) : null}
          <span className="mt-1 block">
            Rencana dan deviasi di laporan ini masih memakai jadwal itu. Biasanya ini jadwal sebelum CCO atau
            adendum: kurva-S tidak ikut berubah saat adendum diaktifkan. Perbarui dengan Time Schedule terbaru,
            misalnya lembar Time Schedule di berkas RAB aktif.
          </span>
        </>
      }
      action={
        bolehUbah ? (
          <ButtonLink href={`${hrefBagianProgress(slug, "baseline")}#perbarui-kurva-s`} size="sm" variant="secondary">
            Perbarui kurva-S
          </ButtonLink>
        ) : undefined
      }
    />
  );
}
