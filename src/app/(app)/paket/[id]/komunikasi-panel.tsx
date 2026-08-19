import type { ReactNode } from "react";
import { Badge, type BadgeTone } from "@/components/ui";

/**
 * Satu baris integrasi pada panel "Komunikasi paket".
 *
 * Bentuknya sengaja seragam untuk ketiganya (grup WhatsApp, laporan mingguan,
 * folder Drive): nama, satu kalimat keadaan, satu lencana status, dan aksinya.
 *
 * Yang penting di sini lencana statusnya. Sebelum rombak ini, keadaan tiap
 * integrasi hanya bisa diketahui dengan MEMBUKA formnya dan melihat isian di
 * dalamnya – jadi pertanyaan "grup paket ini sudah tertaut belum?" menuntut
 * tiga klik dan sedikit menebak. Sekarang jawabannya terbaca tanpa membuka apa
 * pun, dan formnya tinggal di belakang tombol untuk yang benar-benar mau
 * mengubah.
 */
export function BarisIntegrasi({
  nama,
  keterangan,
  status,
  statusTone = "neutral",
  aksi,
}: {
  nama: string;
  keterangan: ReactNode;
  status?: string;
  statusTone?: BadgeTone;
  aksi: ReactNode;
}) {
  return (
    <div className="rounded-md border border-border px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-[10rem] flex-1">
          <p className="text-[13px] font-medium text-ink">{nama}</p>
          <p className="mt-0.5 text-[12px] leading-snug text-ink-muted">{keterangan}</p>
        </div>
        {status ? <Badge tone={statusTone} label={status} /> : null}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">{aksi}</div>
    </div>
  );
}
