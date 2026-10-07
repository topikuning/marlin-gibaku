"use client";

import { useAksi } from "@/lib/aksi-klien";
import { Banner, Button, Combobox, Input, Label, StatusPill } from "@/components/ui";
import {
  bandingkanCuacaAction,
  setSumberCuacaAction,
  type BandingState,
  type BarisBanding,
  type SumberCuacaState,
} from "@/lib/weather/actions";

type Sumber = "open-meteo" | "satelit";

const PILIHAN: { nilai: Sumber; judul: string; isi: string }[] = [
  {
    nilai: "open-meteo",
    judul: "Open-Meteo (model cuaca)",
    isi: "Hitungan model cuaca, bukan pengamatan. Lima belas jam selalu terisi, termasuk jam yang belum lewat (berupa prakiraan).",
  },
  {
    nilai: "satelit",
    judul: "Satelit: awan Himawari + hujan JAXA GSMaP",
    isi: "Pengamatan satelit atas jam yang sudah lewat. Hujan baru ada ±4 jam sesudahnya; jam yang datanya belum cukup dibiarkan kosong, tidak ditebak.",
  },
];

/**
 * SUMBER CUACA OTOMATIS (DECISIONS baru 2026-10-07): pilih sumber, dan
 * bandingkan kedua sumber untuk satu lokasi & tanggal tanpa menyimpan apa pun.
 */
export function CuacaPanel({
  sumber,
  gsmapSiap,
  lokasi,
  tanggalAwal,
  tanggalMaks,
}: {
  sumber: Sumber;
  gsmapSiap: boolean;
  lokasi: { value: string; label: string }[];
  tanggalAwal: string;
  tanggalMaks: string;
}) {
  const [state, aksi, menyimpan] = useAksi<SumberCuacaState>(setSumberCuacaAction, undefined);
  const [banding, aksiBanding, membandingkan] = useAksi<BandingState>(bandingkanCuacaAction, undefined);

  return (
    <div className="space-y-4">
      {sumber === "satelit" && !gsmapSiap ? (
        <Banner
          tone="warning"
          title="Akun GSMaP belum dipasang di server"
          description="Tanpa akun itu data hujan tidak bisa diambil, jadi hanya jam yang langitnya nyaris bersih yang terisi. Pasang GSMAP_FTP_USER dan GSMAP_FTP_PASS di variabel lingkungan server."
        />
      ) : null}
      {state?.error ? <Banner tone="error" title="Gagal menyimpan" description={state.error} /> : null}
      {state?.success ? <Banner tone="success" title="Tersimpan" description={state.success} /> : null}

      <div className="grid gap-3 md:grid-cols-2">
        {PILIHAN.map((p) => {
          const aktif = p.nilai === sumber;
          return (
            <form
              key={p.nilai}
              action={aksi}
              className={
                aktif
                  ? "flex flex-col gap-2 rounded-lg border border-success-border bg-success-soft px-4 py-3"
                  : "flex flex-col gap-2 rounded-lg border border-border px-4 py-3"
              }
            >
              <input type="hidden" name="sumber" value={p.nilai} />
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-ink">{p.judul}</p>
                {aktif ? <StatusPill tone="success" label="Dipakai" /> : null}
              </div>
              <p className="text-[13px] text-ink-muted">{p.isi}</p>
              {aktif ? null : (
                <div>
                  <Button type="submit" variant="secondary" size="sm" loading={menyimpan}>
                    Pakai sumber ini
                  </Button>
                </div>
              )}
            </form>
          );
        })}
      </div>
      <p className="text-[13px] text-ink-muted">
        Isian cuaca manual dari lapangan selalu menang atas sumber otomatis. Status akun GSMaP:{" "}
        <span className="font-medium text-ink">{gsmapSiap ? "terpasang" : "belum dipasang"}</span>.
      </p>

      <div className="space-y-3 border-t border-border pt-4">
        <div>
          <p className="text-sm font-medium text-ink">Bandingkan kedua sumber</p>
          <p className="text-[13px] text-ink-muted">
            Pilih lokasi dan tanggal yang kondisi lapangannya Anda tahu. Tidak ada yang disimpan.
          </p>
        </div>
        <form action={aksiBanding} className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <Label htmlFor="cuaca-lokasi">Lokasi</Label>
            <Combobox id="cuaca-lokasi" name="locationId" options={lokasi} placeholder="Pilih lokasi…" required />
          </div>
          <div>
            <Label htmlFor="cuaca-tanggal">Tanggal</Label>
            <Input id="cuaca-tanggal" name="tanggal" type="date" defaultValue={tanggalAwal} max={tanggalMaks} required />
          </div>
          <Button type="submit" variant="secondary" loading={membandingkan}>
            Bandingkan
          </Button>
        </form>
        {lokasi.length === 0 ? (
          <p className="text-[13px] text-ink-muted">Belum ada lokasi yang punya koordinat GPS.</p>
        ) : null}
        {banding?.error ? <Banner tone="error" title={banding.error} /> : null}
        {banding?.baris ? <TabelBanding hasil={banding} /> : null}
      </div>
    </div>
  );
}

function sel(k: { kategori: string; mm: number } | null, awan?: number | null) {
  if (!k) return <span className="text-ink-faint">–</span>;
  const mm = k.mm > 0 ? ` · ${k.mm.toLocaleString("id-ID", { maximumFractionDigits: 1 })} mm` : "";
  const a = awan != null ? ` · awan ${awan}%` : "";
  return (
    <span className={k.kategori === "Hujan" ? "font-medium text-info" : "text-ink"}>
      {k.kategori}
      <span className="text-ink-muted">
        {mm}
        {a}
      </span>
    </span>
  );
}

function TabelBanding({ hasil }: { hasil: NonNullable<BandingState> }) {
  const baris = hasil.baris as BarisBanding[];
  const sama2 = baris.filter((b) => b.openMeteo && b.satelit);
  const beda = sama2.filter((b) => b.openMeteo!.kategori !== b.satelit!.kategori).length;
  return (
    <div className="space-y-2">
      <p className="text-sm text-ink">
        {hasil.lokasi} – {hasil.tanggal}.{" "}
        {sama2.length > 0
          ? `Dari ${sama2.length} jam yang terisi di kedua sumber, ${beda} jam berbeda kategori.`
          : "Belum ada jam yang terisi di kedua sumber, jadi belum bisa dibandingkan."}
      </p>
      {hasil.galatOpenMeteo ? <Banner tone="warning" title="Open-Meteo gagal" description={hasil.galatOpenMeteo} /> : null}
      {hasil.galatSatelit ? <Banner tone="warning" title="Satelit gagal" description={hasil.galatSatelit} /> : null}
      {hasil.catatanSatelit?.length ? (
        <Banner tone="info" title="Catatan data satelit" description={hasil.catatanSatelit.join(" ")} />
      ) : null}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-[13px]">
          <thead className="bg-surface-muted text-left text-ink-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Jam</th>
              <th className="px-3 py-2 font-medium">Open-Meteo</th>
              <th className="px-3 py-2 font-medium">Satelit</th>
            </tr>
          </thead>
          <tbody>
            {baris.map((b) => {
              const berbeda = b.openMeteo && b.satelit && b.openMeteo.kategori !== b.satelit.kategori;
              return (
                <tr key={b.jam} className={berbeda ? "border-t border-border bg-warning-soft" : "border-t border-border"}>
                  <td className="px-3 py-1.5 tabular-nums text-ink">
                    {String(b.jam).padStart(2, "0")}.00
                    {b.belumTerjadi ? <span className="ml-1 text-ink-faint">(belum terjadi)</span> : null}
                  </td>
                  <td className="px-3 py-1.5">{sel(b.openMeteo)}</td>
                  <td className="px-3 py-1.5">{sel(b.satelit, b.satelit?.awan)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
