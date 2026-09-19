"use client";

import { Send } from "lucide-react";
import { Banner, Button } from "@/components/ui";
import { useAksi } from "@/lib/aksi-klien";
import {
  kirimLaporanLokasiWaAction,
  type WaLaporanLokasiState,
} from "@/lib/lokasi-lengkap/actions";

/**
 * Tombol kirim laporan lengkap ke grup WhatsApp paket.
 *
 * Tanpa pilihan tujuan bebas — lihat alasannya di `lib/lokasi-lengkap/actions.ts`.
 * Kalau paketnya belum punya grup, tombolnya tetap tampil tetapi mati dan
 * alasannya ditulis di sebelahnya: tombol yang hilang tanpa keterangan membuat
 * orang mengira fiturnya tidak ada.
 */
export function KirimWaLaporanLengkap({
  locationId,
  hasGroup,
  groupName,
}: {
  locationId: string;
  hasGroup: boolean;
  groupName: string | null;
}) {
  const [state, action, pending] = useAksi<WaLaporanLokasiState>(kirimLaporanLokasiWaAction, undefined);

  return (
    <div className="space-y-2">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <form action={action} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="locationId" value={locationId} />
        <Button type="submit" size="sm" variant="secondary" loading={pending} disabled={!hasGroup}>
          <Send aria-hidden className="size-3.5" />
          Kirim ke grup WhatsApp
        </Button>
        <span className="text-[12px] text-ink-muted">
          {hasGroup
            ? groupName
              ? `Grup: ${groupName}`
              : "Grup WhatsApp paket"
            : "Paket ini belum ditautkan ke grup WhatsApp."}
        </span>
      </form>
    </div>
  );
}
