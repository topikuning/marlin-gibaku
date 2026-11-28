"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner, Button } from "@/components/ui";
import { estimasiHargaPaketAction } from "@/lib/harga-wilayah/actions";

/**
 * Estimasi harga SELURUH lokasi paket sekali klik (DECISIONS 806). Hasilnya
 * usulan di tiap lokasi; belum ada harga yang masuk hitungan sebelum dipakai.
 */
export function EstimasiHargaPaket({ packageId, jumlahLokasi }: { packageId: string; jumlahLokasi: number }) {
  const router = useRouter();
  const [pesan, setPesan] = useState<{ tone: "success" | "error"; teks: string } | null>(null);
  const [pending, mulai] = useTransition();
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        loading={pending}
        onClick={() => {
          const ok = window.confirm(
            `Harga semua sumber daya yang belum berharga di ${jumlahLokasi} lokasi akan diestimasi, satu lokasi demi satu lokasi.\n\n` +
              "Harga dicari di web untuk kabupaten masing-masing (bila provider AI-nya Claude) dan disimpan di katalog harga wilayah, jadi lokasi sekabupaten tidak dicari ulang. " +
              "Hasilnya usulan: belum masuk hitungan sampai Anda memakainya di tiap lokasi. Bisa makan waktu beberapa menit per kabupaten dan memakai kuota AI. Lanjutkan?",
          );
          if (!ok) return;
          setPesan(null);
          mulai(async () => {
            const r = await estimasiHargaPaketAction({ packageId });
            setPesan(
              r.ok
                ? { tone: "success", teks: `Estimasi harga ${r.lokasi} lokasi dimulai. Kemajuannya tampil di sini dan di tab RAPL tiap lokasi.` }
                : { tone: "error", teks: r.error },
            );
            if (r.ok) router.refresh();
          });
        }}
      >
        {/* Tanpa ikon: tetangganya di baris ini tautan tanpa ikon (DECISIONS 592/603). */}
        Estimasi harga semua lokasi
      </Button>
      {pesan ? (
        <div className="basis-full">
          <Banner tone={pesan.tone} title={pesan.teks} />
        </div>
      ) : null}
    </>
  );
}
