"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Combobox, Input, Label } from "@/components/ui";

/**
 * Saringan papan kendala (DECISIONS 392).
 *
 * Disimpan di URL, bukan di state komponen: satu baris "kendala lewat tenggat
 * di Banyuwangi" harus bisa dikirim ke orang lain lewat WhatsApp dan membuka
 * layar yang sama. Saringan yang hanya hidup di memori tidak bisa dibagikan,
 * dan tidak bertahan saat halaman disegarkan sesudah menetapkan PIC.
 */
export function SaringKendala({
  nilai,
}: {
  nilai: { status?: string; tingkat?: string; sumber?: string; cari?: string };
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [cari, setCari] = useState(nilai.cari ?? "");
  /*
   * Perpindahannya di dalam Transition supaya ada yang bisa DITANDAI
   * (DECISIONS 401). Papan kendala membaca seluruh lokasi yang boleh dilihat
   * pemakai; tanpa penanda, menyaring terasa seperti klik yang tidak diterima
   * dan orang menekan berkali-kali.
   */
  const [menyaring, mulai] = useTransition();

  const ubah = (kunci: string, v: string) => {
    const q = new URLSearchParams(sp.toString());
    if (v) q.set(kunci, v);
    else q.delete(kunci);
    mulai(() => router.push(`/kendala?${q.toString()}`));
  };

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <Label htmlFor="f-status">Status</Label>
        <Combobox
          id="f-status"
          name="status"
          value={nilai.status ?? ""}
          onChange={(v) => ubah("status", v)}
          options={[
            { value: "", label: "Belum selesai" },
            { value: "terbuka", label: "Terbuka" },
            { value: "ditangani", label: "Ditangani" },
            { value: "lewat_tenggat", label: "Lewat tenggat" },
            { value: "terbengkalai", label: "Belum ada pemilik" },
            { value: "selesai", label: "Selesai" },
          ]}
        />
      </div>
      <div>
        <Label htmlFor="f-tingkat">Tingkat</Label>
        <Combobox
          id="f-tingkat"
          name="tingkat"
          value={nilai.tingkat ?? ""}
          onChange={(v) => ubah("tingkat", v)}
          options={[
            { value: "", label: "Semua" },
            { value: "kritis", label: "Kritis" },
            { value: "tinggi", label: "Tinggi" },
            { value: "sedang", label: "Sedang" },
            { value: "rendah", label: "Rendah" },
          ]}
        />
      </div>
      <div>
        <Label htmlFor="f-sumber">Sumber</Label>
        <Combobox
          id="f-sumber"
          name="sumber"
          value={nilai.sumber ?? ""}
          onChange={(v) => ubah("sumber", v)}
          options={[
            { value: "", label: "Semua" },
            { value: "manual", label: "Dicatat langsung" },
            { value: "laporan_harian", label: "Laporan harian" },
            { value: "kegiatan_lapangan", label: "Kegiatan lapangan" },
            { value: "ai", label: "Ask MARLIN" },
          ]}
        />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ubah("cari", cari.trim());
        }}
        className="flex items-end gap-2"
      >
        <div>
          <Label htmlFor="f-cari">Cari</Label>
          <Input
            id="f-cari"
            name="cari"
            value={cari}
            onChange={(e) => setCari(e.target.value)}
            placeholder="judul / uraian"
            className="w-44"
          />
        </div>
        <Button type="submit" size="sm" variant="secondary" loading={menyaring}>
          {menyaring ? "Menyaring…" : "Cari"}
        </Button>
      </form>
    </div>
  );
}
