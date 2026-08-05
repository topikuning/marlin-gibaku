import { MessageSquareWarning } from "lucide-react";
import type { CorrectionArea } from "@/generated/prisma/enums";
import { LABEL_AREA_KOREKSI } from "@/lib/daily-report/area-koreksi";

/**
 * Catatan reviewer DI SEBELAH bagian yang dimaksudnya (DECISIONS 256).
 *
 * Sebelum ini alasan pengembalian hanya muncul sebagai spanduk di puncak
 * halaman. Mandor lalu menggulir seluruh editor sambil menebak bagian mana yang
 * dimaksud "cek ulang zona B" — dan yang paling sering terjadi bukan salah
 * memperbaiki, melainkan mengirim ulang tanpa memperbaiki apa pun.
 *
 * Komponen ini me-render diri HANYA kalau bagiannya memang disebut reviewer.
 * Menampilkannya di semua bagian akan mengulang kalimat yang sama enam kali,
 * dan pengulangan itu justru membuat orang berhenti membacanya.
 */
export function CatatanKoreksi({
  area,
  areas,
  reason,
}: {
  area: CorrectionArea;
  areas: readonly CorrectionArea[];
  reason: string | null;
}) {
  if (!areas.includes(area)) return null;
  return (
    <div className="mb-2 flex items-start gap-2 rounded-md border border-warning-border bg-warning-soft px-2.5 py-2 text-[13px] text-warning">
      <MessageSquareWarning aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        <p className="font-medium">Perlu diperbaiki: {LABEL_AREA_KOREKSI[area]}</p>
        {reason ? <p className="mt-0.5 opacity-90">“{reason}”</p> : null}
      </div>
    </div>
  );
}
