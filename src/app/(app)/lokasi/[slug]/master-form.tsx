"use client";

import { useAksi } from "@/lib/aksi-klien";

import { useEffect, useRef, useState } from "react";
import { LocateFixed, Pencil } from "lucide-react";
import { Banner, Button, Input, Label } from "@/components/ui";
import { TautanGoogleMaps } from "@/components/knmp/tautan-google-maps";
import { jarakMeter, mutuAkurasi } from "@/lib/geo";
import { updateLocationMaster, type StatusActionState } from "./actions";

/** Berhenti mencari begitu akurasi sebaik ini, atau sesudah batas waktu. */
const CUKUP_M = 10;
const BATAS_CARI_MS = 20_000;

type TitikHp =
  | { status: "diam" }
  | { status: "mencari"; akurasi: number | null }
  | { status: "dipakai"; akurasi: number }
  | { status: "gagal"; pesan: string };

const teksJarak = (m: number) =>
  m >= 1000 ? `${(m / 1000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} km` : `${Math.round(m)} m`;

/**
 * Form master data lokasi (alamat administratif + koordinat) — hanya tampil
 * utk pemegang location.manage. Koordinat dipakai peta, cap foto, dan rule
 * GPS audit kualitas — perubahan tercatat di audit log. DECISIONS 134.
 */
export function LocationMasterForm({
  locationId,
  village,
  district,
  regency,
  province,
  gpsLat,
  gpsLng,
}: {
  locationId: string;
  village: string;
  district: string | null;
  regency: string;
  province: string;
  gpsLat: string | null;
  gpsLng: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, saving] = useAksi<StatusActionState>(updateLocationMaster, undefined);
  const [lat, setLat] = useState(gpsLat ?? "");
  const [lng, setLng] = useState(gpsLng ?? "");
  const [hp, setHp] = useState<TitikHp>({ status: "diam" });
  const pantau = useRef<{ watch: number | null; timer: ReturnType<typeof setTimeout> | null }>({ watch: null, timer: null });

  const adaKoordinat = !!(gpsLat && gpsLng);

  const berhenti = () => {
    if (pantau.current.watch !== null) navigator.geolocation.clearWatch(pantau.current.watch);
    if (pantau.current.timer !== null) clearTimeout(pantau.current.timer);
    pantau.current = { watch: null, timer: null };
  };
  useEffect(() => () => {
    if (typeof navigator !== "undefined" && navigator.geolocation) berhenti();
  }, []);

  /*
   * TITIK DARI GPS HP (DECISIONS 772). Bacaan pertama GPS sering masih kasar
   * (dari menara seluler), jadi posisi diikuti sampai 20 detik dan yang
   * terbaik yang dipakai. Lebih lemah dari ±100 m tidak dipakai sama sekali.
   * Titik hanya mengisi kolom – tersimpan setelah Simpan ditekan.
   */
  const ambilTitikHp = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setHp({ status: "gagal", pesan: "Peramban ini tidak bisa membaca lokasi HP." });
      return;
    }
    berhenti();
    let terbaik: GeolocationPosition | null = null;
    setHp({ status: "mencari", akurasi: null });
    const selesai = (galat?: string) => {
      berhenti();
      if (!terbaik) {
        setHp({ status: "gagal", pesan: galat ?? "Lokasi HP belum terbaca. Nyalakan Lokasi/GPS di HP, lalu coba lagi." });
        return;
      }
      const akurasi = terbaik.coords.accuracy;
      if (mutuAkurasi(akurasi) === "lemah") {
        setHp({
          status: "gagal",
          pesan: `Sinyal GPS lemah (±${Math.round(akurasi)} m), titik tidak dipakai. Pindah ke tempat terbuka, tunggu sebentar, lalu ambil ulang.`,
        });
        return;
      }
      setLat(terbaik.coords.latitude.toFixed(7));
      setLng(terbaik.coords.longitude.toFixed(7));
      setHp({ status: "dipakai", akurasi });
    };
    pantau.current.watch = navigator.geolocation.watchPosition(
      (p) => {
        if (!terbaik || p.coords.accuracy < terbaik.coords.accuracy) terbaik = p;
        setHp({ status: "mencari", akurasi: terbaik.coords.accuracy });
        if (terbaik.coords.accuracy <= CUKUP_M) selesai();
      },
      (e) => {
        if (e.code === e.PERMISSION_DENIED)
          selesai("Izin lokasi ditolak. Izinkan Lokasi untuk situs ini di pengaturan peramban, lalu coba lagi.");
        else if (!terbaik && e.code !== e.TIMEOUT) selesai();
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: BATAS_CARI_MS },
    );
    pantau.current.timer = setTimeout(() => selesai(), BATAS_CARI_MS);
  };

  const bukaDanAmbil = () => {
    setOpen(true);
    ambilTitikHp();
  };
  const dariHp = hp.status === "dipakai";
  const lamaAda = gpsLat && gpsLng && lat && lng;
  const geser =
    dariHp && lamaAda
      ? jarakMeter({ lat: Number(gpsLat), lng: Number(gpsLng) }, { lat: Number(lat), lng: Number(lng) })
      : null;

  if (!open) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 text-sm">
            <p className="text-ink-muted">
              {village}
              {district ? `, ${district}` : ""}, {regency}, {province}
            </p>
            <p className="mt-0.5">
              <span className="text-ink-muted">Koordinat: </span>
              {adaKoordinat ? (
                <span className="tabular text-ink">
                  {gpsLat}, {gpsLng}
                </span>
              ) : (
                <span className="text-warning">belum diisi</span>
              )}
            </p>
          </div>
          {/* Satu baris aksi, dua tombol sekunder berukuran sama (DECISIONS 592/603).
              Tombol Maps hilang sendiri selama koordinat belum diisi (DECISIONS 749). */}
          <div className="flex flex-wrap gap-2">
            <TautanGoogleMaps rupa="tombol" lat={gpsLat} lng={gpsLng} />
            <Button type="button" size="sm" variant="secondary" onClick={bukaDanAmbil}>
              <LocateFixed aria-hidden className="size-3.5" />
              Ambil titik dari HP
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
              <Pencil aria-hidden className="size-3.5" />
              Ubah alamat &amp; koordinat
            </Button>
          </div>
        </div>
        {!adaKoordinat ? (
          <Banner
            tone="warning"
            title="Lokasi ini belum punya koordinat"
            description="Selama koordinat kosong, lokasi ini tidak muncul di Peta, cuaca otomatis tidak berjalan, dan cap foto hanya memakai titik dari HP tanpa dibandingkan dengan titik proyek."
          />
        ) : null}
      </div>
    );
  }

  return (
    <form action={action} className="space-y-2 rounded-md border border-border bg-surface-muted p-3">
      <input type="hidden" name="locationId" value={locationId} />
      {dariHp ? (
        <>
          <input type="hidden" name="gpsSumber" value="hp" />
          <input type="hidden" name="gpsAkurasi" value={Math.round(hp.akurasi)} />
        </>
      ) : null}
      <div className="space-y-1.5 rounded-md border border-border bg-surface p-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={ambilTitikHp} loading={hp.status === "mencari"}>
            <LocateFixed aria-hidden className="size-3.5" />
            {dariHp ? "Ambil ulang titik HP" : "Ambil titik dari HP"}
          </Button>
          <span className="text-xs text-ink-muted">Berdiri di tengah area proyek, di tempat terbuka.</span>
        </div>
        {hp.status === "mencari" ? (
          <p className="text-[13px] text-ink-muted">
            Mencari sinyal GPS…{hp.akurasi !== null ? ` sekarang ±${Math.round(hp.akurasi)} m` : ""}
          </p>
        ) : hp.status === "gagal" ? (
          <p className="text-[13px] text-danger">{hp.pesan}</p>
        ) : dariHp ? (
          <p className={`text-[13px] ${mutuAkurasi(hp.akurasi) === "baik" ? "text-success" : "text-warning"}`}>
            Titik HP terisi di bawah, akurasi ±{Math.round(hp.akurasi)} m
            {mutuAkurasi(hp.akurasi) === "baik" ? "" : " (kurang tepat, sebaiknya ambil ulang)"}
            {geser === null ? "" : geser < 1 ? ", sama dengan titik lama" : `, ${teksJarak(geser)} dari titik lama`}. Tekan
            Simpan untuk memakainya.
          </p>
        ) : null}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <Label htmlFor="lm-village">Desa/Kelurahan</Label>
          <Input id="lm-village" name="village" defaultValue={village} />
        </div>
        <div>
          <Label htmlFor="lm-district">Kecamatan</Label>
          <Input id="lm-district" name="district" defaultValue={district ?? ""} />
        </div>
        <div>
          <Label htmlFor="lm-regency">Kabupaten/Kota</Label>
          <Input id="lm-regency" name="regency" defaultValue={regency} />
        </div>
        <div>
          <Label htmlFor="lm-province">Provinsi</Label>
          <Input id="lm-province" name="province" defaultValue={province} />
        </div>
        <div>
          <Label htmlFor="lm-lat">Latitude</Label>
          <Input
            id="lm-lat"
            name="gpsLat"
            value={lat}
            onChange={(e) => {
              setLat(e.target.value);
              setHp({ status: "diam" });
            }}
            placeholder="-6.8710100"
            inputMode="decimal"
          />
        </div>
        <div>
          <Label htmlFor="lm-lng">Longitude</Label>
          <Input
            id="lm-lng"
            name="gpsLng"
            value={lng}
            onChange={(e) => {
              setLng(e.target.value);
              setHp({ status: "diam" });
            }}
            placeholder="109.2531230"
            inputMode="decimal"
          />
        </div>
      </div>
      {/* Kabar di dekat tombol Simpan: di HP, banner di puncak form tak terlihat. */}
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" loading={saving}>
          Simpan
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            if (typeof navigator !== "undefined" && navigator.geolocation) berhenti();
            if (hp.status === "mencari") setHp({ status: "diam" });
            setOpen(false);
          }}
        >
          Tutup
        </Button>
        <span className="text-xs text-ink-faint">Salin koordinat dari Google Maps (klik kanan titik → salin).</span>
      </div>
    </form>
  );
}
