"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Banner, Button, Combobox } from "@/components/ui";
import { runAnalysisAction, type AiHubState } from "@/lib/ai-hub/actions";

/**
 * Pemilih lokasi + pemicu narasi AI untuk halaman Kronologi.
 *
 * Dua kontrol, dan pemisahannya disengaja: memilih lokasi hanya BERPINDAH
 * halaman — garis waktunya deterministik dan tidak memanggil provider sama
 * sekali. Tombol narasi baru membelanjakan kuota, dan hanya ketika ditekan.
 * Halaman ini karena itu tetap berguna penuh saat AI dimatikan admin.
 */
export function PemilihKronologi({
  lokasi,
  terpilih,
  bisaNarasi,
  aiSiap,
}: {
  lokasi: { id: string; nama: string }[];
  terpilih: string | null;
  bisaNarasi: boolean;
  aiSiap: boolean;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<AiHubState, FormData>(
    runAnalysisAction,
    undefined,
  );

  return (
    <div className="space-y-2">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[16rem] flex-1">
          <label htmlFor="lokasi-kronologi" className="mb-1 block text-[13px] text-ink-muted">
            Lokasi
          </label>
          <Combobox
            id="lokasi-kronologi"
            value={terpilih ?? ""}
            onChange={(v) => router.push(v ? `/ai/kronologi?lokasi=${v}` : "/ai/kronologi")}
            options={lokasi.map((l) => ({ value: l.id, label: l.nama }))}
            placeholder="Pilih satu lokasi…"
          />
        </div>
        {terpilih && bisaNarasi ? (
          <form action={formAction}>
            <input type="hidden" name="kind" value="kronologi" />
            <input type="hidden" name="locationId" value={terpilih} />
            {/*
              Preset periode hanya menentukan TANGGAL AKHIR ("sampai") dan
              periode snapshot resmi yang tersimpan bersama run. Lebar jendela
              kronologinya sendiri tetap 90 hari, ditentukan di
              `src/lib/kronologi` — satu tempat, bukan dua.
            */}
            <input type="hidden" name="period" value="30hari" />
            <Button type="submit" loading={pending} disabled={!aiSiap}>
              <Sparkles aria-hidden className="size-3.5" />
              Susun narasi
            </Button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
