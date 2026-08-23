"use client";

import { useActionState, useMemo, useState } from "react";
import { Banner, Button, Card, CardBody, CardHeader, Combobox } from "@/components/ui";
import { buatPaparanAction, type PaparanState } from "@/lib/paparan/actions";

/**
 * Form generate Paparan Mingguan KKP (DECISIONS 416).
 *
 * Default minggu = minggu kontrak TERAKHIR YANG SELESAI — itu yang dipaparkan
 * ke KKP. Minggu berjalan boleh dipilih tetapi selalu berlabel "belum genap".
 */
export function PaparanGenerateClient({
  paket,
  initialPackageId,
}: {
  paket: { id: string; name: string; lokasi: number; mingguBerjalan: number; mingguSelesai: number }[];
  initialPackageId?: string;
}) {
  const awal = paket.some((p) => p.id === initialPackageId) ? initialPackageId! : (paket[0]?.id ?? "");
  const [paketId, setPaketId] = useState(awal);
  const dipilih = useMemo(() => paket.find((p) => p.id === paketId) ?? null, [paket, paketId]);
  const [state, formAction, pending] = useActionState<PaparanState, FormData>(buatPaparanAction, undefined);

  const opsiMinggu = useMemo(() => {
    if (!dipilih) return [];
    const daftar: { nilai: number; label: string }[] = [];
    for (let n = dipilih.mingguBerjalan; n >= 1; n--) {
      daftar.push({
        nilai: n,
        label:
          n >= dipilih.mingguBerjalan
            ? `Minggu ke-${n} (berjalan – belum genap)`
            : `Minggu ke-${n}`,
      });
    }
    return daftar;
  }, [dipilih]);
  const defaultMinggu = dipilih && dipilih.mingguSelesai >= 1 ? dipilih.mingguSelesai : dipilih?.mingguBerjalan;

  if (paket.length === 0) {
    return (
      <Banner
        tone="info"
        title="Belum ada paket yang siap dipaparkan"
        description="Paparan butuh paket berkontrak dengan SPMK dan lokasi aktif, dan seluruh lokasinya dalam akses Anda."
      />
    );
  }

  return (
    <Card>
      <CardHeader
        title="Buat Paparan Mingguan KKP"
        subtitle="Deck PDF lanskap 16:9 – angka dihitung MARLIN pada akhir minggu terpilih; AI hanya merapikan narasi dan selalu direview sebelum final."
      />
      <CardBody>
        {state?.error ? <Banner tone="error" title={state.error} className="mb-3" /> : null}
        <form action={formAction} className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <label htmlFor="pp-paket" className="mb-1 block text-sm font-medium text-ink">
              Paket / kontrak
            </label>
            <Combobox id="pp-paket" name="packageId" value={paketId} onChange={setPaketId}>
              {paket.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.lokasi} lokasi)
                </option>
              ))}
            </Combobox>
          </div>
          <div className="w-64">
            <label htmlFor="pp-minggu" className="mb-1 block text-sm font-medium text-ink">
              Minggu kontrak
            </label>
            {/* key= supaya default ikut berganti saat paketnya berganti */}
            <Combobox id="pp-minggu" name="weekNumber" key={paketId} defaultValue={String(defaultMinggu ?? 1)}>
              {opsiMinggu.map((o) => (
                <option key={o.nilai} value={o.nilai}>
                  {o.label}
                </option>
              ))}
            </Combobox>
          </div>
          <div className="w-44">
            <label htmlFor="pp-fokus" className="mb-1 block text-sm font-medium text-ink">
              Fokus
            </label>
            <Combobox id="pp-fokus" name="focus" defaultValue="lengkap">
              <option value="lengkap">Lengkap</option>
              <option value="progres">Progres</option>
              <option value="kendala">Kendala</option>
            </Combobox>
          </div>
          <Button type="submit" loading={pending} className="h-10">
            Buat Paparan
          </Button>
        </form>
        <p className="mt-2 text-xs text-ink-muted">
          Hasilnya selalu DRAF ber-watermark – melewati review dan persetujuan dulu sebelum jadi PDF final.
        </p>
      </CardBody>
    </Card>
  );
}
