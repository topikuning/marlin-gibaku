"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner, Button } from "@/components/ui";
import { risetUlangWilayahAction } from "@/lib/harga-wilayah/actions";

/** Buang katalog satu kabupaten supaya estimasi berikutnya mencari ulang (DECISIONS 806). */
export function RisetUlang({ provinsi, kabupaten, jumlah }: { provinsi: string; kabupaten: string; jumlah: number }) {
  const router = useRouter();
  const [pesan, setPesan] = useState<{ tone: "success" | "error"; teks: string } | null>(null);
  const [pending, mulai] = useTransition();
  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        loading={pending}
        onClick={() => {
          if (
            !window.confirm(
              `${jumlah} harga katalog ${kabupaten} akan dihapus. Estimasi harga berikutnya di lokasi kabupaten ini akan mencari ulang. Usulan dan harga lokasi yang sudah ada tidak berubah. Lanjutkan?`,
            )
          )
            return;
          mulai(async () => {
            const r = await risetUlangWilayahAction({ provinsi, kabupaten });
            setPesan(r.ok ? { tone: "success", teks: `${r.dihapus} harga katalog ${kabupaten} dihapus.` } : { tone: "error", teks: r.error });
            if (r.ok) router.refresh();
          });
        }}
      >
        Riset ulang {kabupaten}
      </Button>
      {pesan ? <Banner tone={pesan.tone} title={pesan.teks} /> : null}
    </div>
  );
}
