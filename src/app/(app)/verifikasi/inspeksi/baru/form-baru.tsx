"use client";

import { useAksi } from "@/lib/aksi-klien";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Banner, Button, Combobox, Input, Label, Textarea } from "@/components/ui";
import { createInspectionAction, type InspectionActionState } from "@/lib/inspections/actions";

export function FormInspeksiBaru({
  lokasi,
  todayKey,
}: {
  lokasi: { value: string; label: string }[];
  todayKey: string;
}) {
  const router = useRouter();
  const [state, action, pending] = useAksi<InspectionActionState>(createInspectionAction, undefined);

  useEffect(() => {
    if (state?.success && state.inspectionId) {
      const t = setTimeout(() => router.push(`/verifikasi/inspeksi/${state.inspectionId}`), 600);
      return () => clearTimeout(t);
    }
  }, [state, router]);

  return (
    <form action={action} className="space-y-3">
      <div>
        <Label htmlFor="i-lokasi" required>Lokasi</Label>
        <Combobox id="i-lokasi" name="locationId" defaultValue={lokasi.length === 1 ? lokasi[0].value : ""} options={lokasi} placeholder="Pilih lokasi" required />
      </div>
      <div>
        <Label htmlFor="i-tanggal" required>Tanggal inspeksi</Label>
        <Input id="i-tanggal" name="inspectionDateKey" type="date" defaultValue={todayKey} required />
      </div>
      <div>
        <Label htmlFor="i-judul" required>Judul</Label>
        <Input id="i-judul" name="title" required maxLength={200} placeholder="mis. Inspeksi pekerjaan pondasi minggu ke-12" />
      </div>
      <div>
        <Label htmlFor="i-catatan">Catatan pemeriksaan</Label>
        <Textarea id="i-catatan" name="notes" rows={5} maxLength={8000} placeholder="Apa yang diperiksa dan apa yang ditemukan" />
      </div>
      <div>
        <Label htmlFor="i-rekomendasi">Rekomendasi</Label>
        <Textarea id="i-rekomendasi" name="recommendation" rows={3} maxLength={4000} />
      </div>

      <Button type="submit" loading={pending} className="w-full py-3">
        Simpan draft inspeksi
      </Button>

      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} description="Membuka detail inspeksi…" /> : null}
    </form>
  );
}
