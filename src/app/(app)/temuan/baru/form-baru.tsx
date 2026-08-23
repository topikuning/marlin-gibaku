"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { Banner, Button, Combobox, Input, Label, Textarea } from "@/components/ui";
import { createFindingAction, type FindingActionState } from "@/lib/findings/actions";

export function FormTemuanBaru({
  lokasi,
  picByLocation,
  todayKey,
}: {
  lokasi: { value: string; label: string }[];
  picByLocation: Record<string, { id: string; fullName: string }[]>;
  todayKey: string;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState<FindingActionState, FormData>(createFindingAction, undefined);
  const [locationId, setLocationId] = useState(lokasi.length === 1 ? lokasi[0].value : "");

  useEffect(() => {
    if (state?.success) {
      const t = setTimeout(() => router.push("/temuan"), 800);
      return () => clearTimeout(t);
    }
  }, [state?.success, router]);

  const picOptions = [
    { value: "", label: "– belum ditetapkan –" },
    ...(picByLocation[locationId] ?? []).map((u) => ({ value: u.id, label: u.fullName })),
  ];

  return (
    <form action={action} className="space-y-3">
      <div>
        <Label htmlFor="t-lokasi" required>Lokasi</Label>
        <Combobox id="t-lokasi" name="locationId" value={locationId} onChange={setLocationId} options={lokasi} placeholder="Pilih lokasi" required />
      </div>
      <div>
        <Label htmlFor="t-judul" required>Judul temuan</Label>
        <Input id="t-judul" name="title" required maxLength={200} placeholder="mis. Mutu beton kolom tidak sesuai spesifikasi" />
      </div>
      <div>
        <Label htmlFor="t-uraian">Uraian</Label>
        <Textarea id="t-uraian" name="description" rows={4} maxLength={4000} placeholder="Apa yang ditemukan, di bagian mana, dan apa dasar penilaiannya" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="t-kategori" required>Kategori</Label>
          <Combobox
            id="t-kategori"
            name="category"
            defaultValue="mutu"
            options={[
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
        <div>
          <Label htmlFor="t-tingkat" required>Tingkat</Label>
          <Combobox
            id="t-tingkat"
            name="severity"
            defaultValue="sedang"
            options={[
              { value: "rendah", label: "Rendah" },
              { value: "sedang", label: "Sedang" },
              { value: "tinggi", label: "Tinggi" },
              { value: "kritis", label: "Kritis" },
            ]}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="t-tanggal" required>Tanggal temuan</Label>
          <Input id="t-tanggal" name="findingDateKey" type="date" defaultValue={todayKey} required />
        </div>
        <div>
          <Label htmlFor="t-tenggat">Tenggat tindak lanjut</Label>
          <Input id="t-tenggat" name="dueDateKey" type="date" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="t-pic">PIC tindak lanjut</Label>
          <Combobox id="t-pic" name="assignedToId" key={locationId} defaultValue="" options={picOptions} />
        </div>
        <div>
          <Label htmlFor="t-pic-nama">PIC di luar MARLIN</Label>
          <Input id="t-pic-nama" name="assignedName" maxLength={120} placeholder="nama, bila bukan pengguna" />
        </div>
      </div>

      <Button type="submit" loading={pending} className="w-full py-3">
        Catat temuan
      </Button>

      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} description="Kembali ke papan temuan…" /> : null}
    </form>
  );
}
