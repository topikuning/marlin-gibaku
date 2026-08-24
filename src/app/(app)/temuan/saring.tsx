"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Combobox, Input, Label } from "@/components/ui";

/** Saringan papan temuan — di URL supaya bisa dibagikan (pola papan kendala). */
export function SaringTemuan({
  nilai,
}: {
  nilai: { status?: string; tingkat?: string; kategori?: string; cari?: string };
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [cari, setCari] = useState(nilai.cari ?? "");
  const [menyaring, mulai] = useTransition();

  const ubah = (kunci: string, v: string) => {
    const q = new URLSearchParams(sp.toString());
    if (v) q.set(kunci, v);
    else q.delete(kunci);
    mulai(() => router.push(`/temuan?${q.toString()}`));
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
            { value: "", label: "Semua" },
            { value: "terbuka", label: "Semua yang terbuka" },
            { value: "baru", label: "Baru" },
            { value: "menunggu_klarifikasi", label: "Menunggu klarifikasi" },
            { value: "ditindaklanjuti", label: "Ditindaklanjuti" },
            { value: "menunggu_verifikasi", label: "Menunggu verifikasi" },
            { value: "lewat_tenggat", label: "Lewat tenggat" },
            { value: "dibuka_kembali", label: "Dibuka kembali" },
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
        <Label htmlFor="f-kategori">Kategori</Label>
        <Combobox
          id="f-kategori"
          name="kategori"
          value={nilai.kategori ?? ""}
          onChange={(v) => ubah("kategori", v)}
          options={[
            { value: "", label: "Semua" },
            { value: "mutu", label: "Mutu" },
            { value: "volume", label: "Volume" },
            { value: "k3", label: "K3" },
            { value: "administrasi", label: "Administrasi" },
            { value: "jadwal", label: "Jadwal" },
            { value: "lingkungan", label: "Lingkungan" },
            { value: "lainnya", label: "Lainnya" },
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
          <Input id="f-cari" name="cari" value={cari} onChange={(e) => setCari(e.target.value)} placeholder="judul" className="w-40" />
        </div>
        <Button type="submit" size="sm" variant="secondary" loading={menyaring}>
          {menyaring ? "Menyaring…" : "Cari"}
        </Button>
      </form>
    </div>
  );
}
