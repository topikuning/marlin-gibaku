"use client";

import { useAksi } from "@/lib/aksi-klien";
import { Banner, Button, Combobox, Input, Label, PasswordInput, StatusPill } from "@/components/ui";
import {
  akunGsmapAction,
  bandingkanCuacaAction,
  cuacaSubuhAction,
  type AkunGsmapState,
  type BandingState,
  type BarisBanding,
  type SubuhState,
} from "@/lib/weather/actions";

type RingkasSubuh = {
  tanggal: string;
  pada: string;
  laporan: number;
  diperbarui: number;
  jamSatelit: number;
  jamModel: number;
  catatan: string[];
  manual?: boolean;
};

function waktuWib(iso: string): string {
  return new Date(iso).toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * CUACA OTOMATIS (DECISIONS 655, 657): tombol ambil cuaca di laporan harian
 * memakai Open-Meteo; pukul 04.00 WIB laporan kemarin diperbarui senyap dari
 * pengamatan satelit. Di sini: sakelarnya, jalankan sekarang, akun GSMaP, dan
 * pembanding kedua sumber.
 */
export function CuacaPanel({
  subuhAktif,
  subuhTerakhir,
  gsmapSiap,
  akunGsmap,
  lokasi,
  tanggalAwal,
  tanggalMaks,
}: {
  subuhAktif: boolean;
  subuhTerakhir: RingkasSubuh | null;
  gsmapSiap: boolean;
  akunGsmap: { user: string; adaSandi: boolean };
  lokasi: { value: string; label: string }[];
  tanggalAwal: string;
  tanggalMaks: string;
}) {
  const [state, aksi, menyimpan] = useAksi<SubuhState>(cuacaSubuhAction, undefined);
  const [banding, aksiBanding, membandingkan] = useAksi<BandingState>(bandingkanCuacaAction, undefined);
  const [akun, aksiAkun, mengurusAkun] = useAksi<AkunGsmapState>(akunGsmapAction, undefined);

  return (
    <div className="space-y-4">
      {subuhAktif && !gsmapSiap ? (
        <Banner
          tone="warning"
          title="Akun GSMaP belum diisi"
          description="Tanpa akun itu data hujan satelit tidak bisa diambil, jadi pembaruan pukul 04.00 hanya memakai data awan. Isi akunnya di bawah."
        />
      ) : null}
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}

      <div
        className={
          subuhAktif
            ? "space-y-2 rounded-lg border border-success-border bg-success-soft px-4 py-3"
            : "space-y-2 rounded-lg border border-warning-border bg-warning-soft px-4 py-3"
        }
      >
        <p className="text-sm font-medium text-ink">
          Pembaruan dari satelit tiap pukul 04.00 WIB: {subuhAktif ? "NYALA" : "MATI"}
        </p>
        <p className="text-[13px] text-ink-muted">
          Tombol ambil cuaca di laporan harian memakai Open-Meteo supaya langsung terisi. Pukul 04.00 WIB, cuaca laporan
          kemarin diperbarui per jam dengan pengamatan satelit (awan Himawari, hujan JAXA GSMaP) di jam yang datanya
          cukup; jam lain tetap dari Open-Meteo. Isian manual dan laporan yang sudah disetujui atau final tidak
          disentuh.
        </p>
        {subuhTerakhir ? (
          <p className="text-[13px] text-ink-muted">
            Terakhir: laporan {subuhTerakhir.tanggal}, {waktuWib(subuhTerakhir.pada)} WIB
            {subuhTerakhir.manual ? " (dijalankan dari tombol)" : ""} – {subuhTerakhir.diperbarui} dari{" "}
            {subuhTerakhir.laporan} laporan diperbarui, {subuhTerakhir.jamSatelit} jam dari satelit,{" "}
            {subuhTerakhir.jamModel} jam dari Open-Meteo.
            {subuhTerakhir.catatan.length ? ` ${subuhTerakhir.catatan.join(" ")}` : ""}
          </p>
        ) : (
          <p className="text-[13px] text-ink-muted">Belum pernah berjalan.</p>
        )}
        <form action={aksi} className="flex flex-wrap gap-2">
          <Button type="submit" name="aksi" value="jalankan" variant="secondary" size="sm" loading={menyimpan}>
            Perbarui laporan kemarin sekarang
          </Button>
          <Button
            type="submit"
            name="aksi"
            value={subuhAktif ? "matikan" : "nyalakan"}
            variant="secondary"
            size="sm"
            loading={menyimpan}
          >
            {subuhAktif ? "Matikan" : "Nyalakan"}
          </Button>
        </form>
      </div>

      <div className="space-y-3 border-t border-border pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-ink">Akun data hujan JAXA GSMaP</p>
          <StatusPill tone={gsmapSiap ? "success" : "neutral"} label={gsmapSiap ? "Terisi" : "Belum diisi"} />
        </div>
        <p className="text-[13px] text-ink-muted">
          Akun dari pendaftaran GSMaP di situs JAXA. Sandinya disimpan tersandi di basis data dan tidak pernah
          ditampilkan lagi. Kosongkan kolom sandi bila tidak ingin menggantinya.
        </p>
        {akun?.error ? <Banner tone="error" title={akun.error} /> : null}
        {akun?.success ? <Banner tone="success" title={akun.success} /> : null}
        <form action={aksiAkun} className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="gsmap-user">Nama akun</Label>
            <Input id="gsmap-user" name="user" defaultValue={akunGsmap.user} autoComplete="off" className="w-48" />
          </div>
          <div>
            <Label htmlFor="gsmap-pass">Sandi</Label>
            <PasswordInput
              id="gsmap-pass"
              name="pass"
              autoComplete="new-password"
              placeholder={akunGsmap.adaSandi ? "•••••• tersimpan" : ""}
              className="w-64"
            />
          </div>
          <Button type="submit" name="aksi" value="simpan" variant="primary" loading={mengurusAkun}>
            Simpan
          </Button>
          <Button type="submit" name="aksi" value="uji" variant="secondary" loading={mengurusAkun}>
            Uji sambungan
          </Button>
          {akunGsmap.user || akunGsmap.adaSandi ? (
            <Button type="submit" name="aksi" value="hapus" variant="secondary" loading={mengurusAkun}>
              Hapus akun
            </Button>
          ) : null}
        </form>
      </div>

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
