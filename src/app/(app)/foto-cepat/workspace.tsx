"use client";

import { useActionState, useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { Camera, Images, MapPin, MapPinOff, Trash2 } from "lucide-react";
import { Banner, Button, Card, Combobox, EmptyState, HelpText, Label } from "@/components/ui";
import { PhotoSourceInput } from "@/components/knmp/photo-source-input";
import { labelJarak, urutkanTerdekat, type LokasiBerjarak } from "@/lib/foto-cepat/jarak";
import type { FotoKantong, PilihanLokasi, TujuanKegiatan, TujuanLaporan } from "@/lib/foto-cepat/queries";
import {
  hapusFotoCepatAction,
  muatTujuanAction,
  pakaiFotoAction,
  simpanFotoCepatAction,
  type FotoCepatState,
} from "@/lib/foto-cepat/actions";

/**
 * Workspace Foto Cepat: jepret → kantong → pakai (DECISIONS 253).
 *
 * URUTAN LAYARNYA MENGIKUTI URUTAN PEKERJAAN LAPANGAN, bukan urutan data:
 * memotret di atas (yang dilakukan sambil berdiri di lokasi, sering satu tangan,
 * sering di bawah matahari), mengolah di bawah (yang dilakukan sambil duduk).
 * Membalik keduanya berarti pelapor harus menggulung melewati daftar kerja
 * sebelum bisa menekan rana.
 */

const KOSONG: FotoCepatState = {};

export function FotoCepatWorkspace({
  lokasi,
  kantong,
  wajibGps,
}: {
  lokasi: PilihanLokasi[];
  kantong: FotoKantong[];
  wajibGps: boolean;
}) {
  const [posisi, setPosisi] = useState<{ lat: number; lng: number } | null>(null);

  /**
   * Posisi dibaca SEKALI untuk mengurutkan lokasi terdekat. Ini TIDAK dipakai
   * sebagai koordinat foto — koordinat foto datang dari `PhotoSourceInput` pada
   * detik rana ditekan. Dua pembacaan berbeda untuk dua keperluan berbeda;
   * memakai yang ini sebagai koordinat foto akan menandai foto dengan posisi
   * saat halaman dibuka, bukan saat memotret.
   */
  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    let batal = false;
    navigator.geolocation.getCurrentPosition(
      (p) => {
        if (!batal) setPosisi({ lat: p.coords.latitude, lng: p.coords.longitude });
      },
      () => {},
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
    return () => {
      batal = true;
    };
  }, []);

  const terurut: LokasiBerjarak[] = useMemo(() => urutkanTerdekat(lokasi, posisi), [lokasi, posisi]);
  const [locationId, setLocationId] = useState(lokasi.length === 1 ? lokasi[0].id : "");

  // Lokasi terdekat diusulkan begitu posisi terbaca — hanya bila pelapor belum
  // memilih sendiri. Menimpa pilihan manusia dengan tebakan mesin adalah cara
  // tercepat membuat foto masuk ke lokasi yang salah.
  const [posisiTerpakai, setPosisiTerpakai] = useState(false);
  if (posisi && !posisiTerpakai) {
    setPosisiTerpakai(true);
    if (!locationId && terurut[0]?.jarakMeter != null) setLocationId(terurut[0].id);
  }

  const opsiLokasi = terurut.map((l) => ({
    value: l.id,
    label: l.jarakMeter != null ? `${l.name} · ${labelJarak(l.jarakMeter)}` : l.name,
  }));
  const dipilih = terurut.find((l) => l.id === locationId) ?? null;

  return (
    <div className="space-y-4">
      <JepretCard
        opsiLokasi={opsiLokasi}
        locationId={locationId}
        setLocationId={setLocationId}
        dipilih={dipilih}
        wajibGps={wajibGps}
        adaPosisi={posisi != null}
      />
      <KantongCard kantong={kantong} />
    </div>
  );
}

/* ── 1. Jepret ───────────────────────────────────────────────────────────── */

function JepretCard({
  opsiLokasi,
  locationId,
  setLocationId,
  dipilih,
  wajibGps,
  adaPosisi,
}: {
  opsiLokasi: { value: string; label: string }[];
  locationId: string;
  setLocationId: (v: string) => void;
  dipilih: LokasiBerjarak | null;
  wajibGps: boolean;
  adaPosisi: boolean;
}) {
  const [state, action, pending] = useActionState(simpanFotoCepatAction, KOSONG);

  return (
    <Card>
      <div className="space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-ink">Jepret sekarang</h2>
          <HelpText>
            Koordinat & jam direkam pada detik foto diambil. Item pekerjaannya dipilih belakangan —
            tidak perlu buka laporan dulu.
          </HelpText>
        </div>

        {state.error ? <Banner tone="error" title={state.error} /> : null}
        {state.warning ? <Banner tone="warning" title={state.warning} /> : null}
        {state.ok ? <Banner tone="success" title={state.ok} /> : null}

        <form action={action} className="space-y-3">
          <div>
            <Label htmlFor="fc-lokasi">Lokasi</Label>
            <Combobox
              id="fc-lokasi"
              name="locationId"
              value={locationId}
              onChange={setLocationId}
              options={opsiLokasi}
              placeholder="Pilih lokasi…"
              required
            />
            <HelpText>
              {adaPosisi
                ? dipilih?.jarakMeter != null
                  ? `Urut dari yang terdekat. "${dipilih.name}" berjarak ${labelJarak(dipilih.jarakMeter)} dari posisimu — pastikan itu memang lokasi yang benar.`
                  : "Urut dari yang terdekat. Lokasi ini belum punya titik proyek, jadi jaraknya tidak bisa dihitung."
                : "Posisi belum terbaca — daftar masih urut nama. Izinkan akses lokasi supaya yang terdekat naik ke atas."}
            </HelpText>
          </div>

          {/*
            Satu komponen yang sama dengan unggah foto laporan: izin GPS diurus
            di depan, sumber Kamera/Galeri dibedakan, dan koordinat perangkat
            dikirim lewat hidden field. Menyalinnya ulang di sini berarti aturan
            penandaan foto punya dua tempat yang cepat atau lambat berbeda.
          */}
          <PhotoSourceInput />

          {wajibGps ? (
            <Banner
              tone="info"
              title="Setelan wajib-GPS menyala"
              description="Foto tanpa koordinat akan ditolak. Pastikan izin lokasi aktif sebelum memotret."
            />
          ) : (
            <HelpText>
              Foto tanpa koordinat tetap disimpan, tapi ditandai jelas — dan TIDAK diberi titik
              proyek sebagai pengganti.
            </HelpText>
          )}

          <Button type="submit" disabled={pending || !locationId} className="w-full sm:w-auto">
            <Camera aria-hidden className="size-4" />
            {pending ? "Menyimpan…" : "Simpan ke kantong"}
          </Button>
        </form>
      </div>
    </Card>
  );
}

/* ── 2. Kantong + pakai ──────────────────────────────────────────────────── */

function KantongCard({ kantong }: { kantong: FotoKantong[] }) {
  const [terpilih, setTerpilih] = useState<Set<string>>(new Set());
  const [hasil, setHasil] = useState<FotoCepatState | null>(null);

  const selesai = useCallback((s: FotoCepatState) => {
    setHasil(s);
    // Pilihan dikosongkan hanya bila memang ada yang berpindah; kegagalan total
    // membiarkan pilihannya utuh supaya bisa dicoba lagi tanpa memilih ulang.
    if (s.ok || s.warning) setTerpilih(new Set());
  }, []);

  const toggle = useCallback((id: string) => {
    setTerpilih((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  // Foto hanya boleh dipakai bersama bila berasal dari LOKASI YANG SAMA —
  // aturan yang sama dijaga ulang di server. Di sini gunanya supaya pelapor
  // melihat sebabnya sebelum menekan tombol, bukan sesudah ditolak.
  const lokasiTerpilih = useMemo(() => {
    const ids = new Set(kantong.filter((f) => terpilih.has(f.id)).map((f) => f.locationId));
    return [...ids];
  }, [kantong, terpilih]);
  const satuLokasi = lokasiTerpilih.length === 1 ? (lokasiTerpilih[0] as string | null) : null;

  const perLokasi = useMemo(() => {
    const m = new Map<string, FotoKantong[]>();
    for (const f of kantong) {
      const k = f.locationName;
      (m.get(k) ?? m.set(k, []).get(k)!).push(f);
    }
    return [...m.entries()];
  }, [kantong]);

  if (kantong.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={Images}
          title="Kantong masih kosong"
          description="Foto yang kamu simpan lewat tombol di atas muncul di sini, menunggu dipakai di laporan harian atau kegiatan lapangan."
        />
      </Card>
    );
  }

  return (
    <Card>
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">
            Kantong — {kantong.length} foto belum dipakai
          </h2>
          {terpilih.size > 0 ? (
            <button
              type="button"
              onClick={() => setTerpilih(new Set())}
              className="text-xs font-medium text-primary underline-offset-2 hover:underline"
            >
              Batal pilih ({terpilih.size})
            </button>
          ) : null}
        </div>

        {hasil?.error ? <Banner tone="error" title={hasil.error} /> : null}
        {hasil?.warning ? <Banner tone="warning" title={hasil.warning} /> : null}
        {hasil?.ok ? <Banner tone="success" title={hasil.ok} /> : null}

        {perLokasi.map(([nama, fotos]) => (
          <div key={nama} className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{nama}</p>
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {fotos.map((f) => (
                <FotoPetak key={f.id} foto={f} dipilih={terpilih.has(f.id)} onToggle={toggle} />
              ))}
            </ul>
          </div>
        ))}

        {terpilih.size > 0 ? (
          lokasiTerpilih.length > 1 ? (
            <Banner
              tone="warning"
              title="Foto dari lebih dari satu lokasi terpilih"
              description="Foto hanya bisa dipakai di lokasi tempat ia dipotret. Pilih foto dari satu lokasi saja."
            />
          ) : satuLokasi ? (
            <PanelPakai locationId={satuLokasi} photoIds={[...terpilih]} onHasil={selesai} />
          ) : null
        ) : null}
      </div>
    </Card>
  );
}

function FotoPetak({
  foto,
  dipilih,
  onToggle,
}: {
  foto: FotoKantong;
  dipilih: boolean;
  onToggle: (id: string) => void;
}) {
  const [state, action, pending] = useActionState(hapusFotoCepatAction, KOSONG);
  return (
    <li className="relative">
      <button
        type="button"
        onClick={() => onToggle(foto.id)}
        aria-pressed={dipilih}
        className={`block w-full overflow-hidden rounded-md border text-left transition ${
          dipilih ? "border-primary ring-2 ring-primary" : "border-border"
        }`}
      >
        <span className="block aspect-square bg-surface-inset">
          {foto.thumbUrl ? (
            // Foto R2 ber-presigned URL: next/image tidak dipakai di seluruh
            // aplikasi ini karena host-nya berganti tiap deploy & URL-nya
            // berumur pendek.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={foto.thumbUrl} alt="" className="size-full object-cover" loading="lazy" />
          ) : null}
        </span>
        <span className="flex items-center gap-1 px-1.5 py-1 text-[11px] text-ink-muted">
          {foto.gpsAsli ? (
            <MapPin aria-hidden className="size-3 shrink-0 text-success" />
          ) : (
            <MapPinOff aria-hidden className="size-3 shrink-0 text-warning" />
          )}
          <span className="truncate">{foto.waktuLabel}</span>
        </span>
      </button>
      <form action={action} className="absolute right-1 top-1">
        <input type="hidden" name="photoId" value={foto.id} />
        <button
          type="submit"
          disabled={pending}
          aria-label="Buang foto ini dari kantong"
          title={state.error ?? "Buang dari kantong"}
          className="rounded-full bg-surface/90 p-1 text-ink-muted shadow hover:text-danger"
        >
          <Trash2 aria-hidden className="size-3.5" />
        </button>
      </form>
    </li>
  );
}

function PanelPakai({
  locationId,
  photoIds,
  onHasil,
}: {
  locationId: string;
  photoIds: string[];
  onHasil: (s: FotoCepatState) => void;
}) {
  const [state, action, pending] = useActionState(pakaiFotoAction, KOSONG);
  const [tujuan, setTujuan] = useState<"kegiatan" | "laporan">("laporan");
  const [kegiatanId, setKegiatanId] = useState("");
  const [reportId, setReportId] = useState("");
  const [reportItemId, setReportItemId] = useState("");
  const [data, setData] = useState<{ kegiatan: TujuanKegiatan[]; laporan: TujuanLaporan[] } | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [memuat, mulaiMuat] = useTransition();

  // Ganti lokasi → buang tujuan lokasi lama. Disetel SAAT RENDER, bukan di
  // dalam effect: menyetel state di badan effect memicu render kaskade, dan
  // lint repo ini memang melarangnya (pola yang sama dipakai bottom-nav).
  const [prevLoc, setPrevLoc] = useState(locationId);
  if (prevLoc !== locationId) {
    setPrevLoc(locationId);
    setData(null);
    setGalat(null);
    setKegiatanId("");
    setReportId("");
    setReportItemId("");
  }

  useEffect(() => {
    let batal = false;
    mulaiMuat(async () => {
      const hasil = await muatTujuanAction(locationId);
      if (batal) return;
      if ("error" in hasil) setGalat(hasil.error);
      else setData(hasil);
    });
    return () => {
      batal = true;
    };
  }, [locationId]);

  // Hasilnya diangkat ke induk. Kalau bannernya dirender DI SINI, ia lenyap
  // seketika: foto yang berhasil dipakai hilang dari kantong sesudah
  // revalidasi, panel ini ikut tidak terpasang lagi, dan pelapor tidak pernah
  // sempat membaca konfirmasinya — termasuk peringatan "cap tetap dasar".
  useEffect(() => {
    if (state.ok || state.warning || state.error) onHasil(state);
  }, [state, onHasil]);

  const laporanTerpilih = data?.laporan.find((l) => l.id === reportId) ?? null;

  return (
    <div className="rounded-md border border-border bg-surface-muted p-3">
      <p className="mb-2 text-sm font-semibold text-ink">Pakai {photoIds.length} foto di…</p>

      {galat ? <Banner tone="error" title={galat} className="mb-2" /> : null}

      <form action={action} className="space-y-3">
        {photoIds.map((id) => (
          <input key={id} type="hidden" name="photoIds" value={id} />
        ))}
        <input type="hidden" name="tujuan" value={tujuan} />

        <div className="flex gap-2">
          {(["laporan", "kegiatan"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTujuan(t)}
              aria-pressed={tujuan === t}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                tujuan === t
                  ? "bg-primary text-white"
                  : "border border-border bg-surface text-ink-muted"
              }`}
            >
              {t === "laporan" ? "Laporan Harian" : "Kegiatan Lapangan"}
            </button>
          ))}
        </div>

        {memuat ? (
          <p className="text-sm text-ink-muted">Memuat tujuan…</p>
        ) : tujuan === "laporan" ? (
          data && data.laporan.length > 0 ? (
            <div className="space-y-2">
              <div>
                <Label htmlFor="fc-laporan">Tanggal laporan</Label>
                <Combobox
                  id="fc-laporan"
                  value={reportId}
                  onChange={(v) => {
                    setReportId(v);
                    setReportItemId("");
                  }}
                  options={data.laporan.map((l) => ({ value: l.id, label: l.label }))}
                  placeholder="Pilih laporan…"
                />
              </div>
              {laporanTerpilih ? (
                <div>
                  <Label htmlFor="fc-item">Item pekerjaan</Label>
                  <Combobox
                    id="fc-item"
                    name="reportItemId"
                    value={reportItemId}
                    onChange={setReportItemId}
                    options={laporanTerpilih.items.map((i) => ({ value: i.id, label: i.label }))}
                    placeholder="Pilih item…"
                  />
                  {laporanTerpilih.items.length === 0 ? (
                    <HelpText>
                      Laporan ini belum punya item pekerjaan. Isi itemnya dulu di Hari Ini, baru
                      fotonya bisa ditempelkan.
                    </HelpText>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <HelpText>
              Tidak ada laporan harian yang masih bisa disunting di lokasi ini. Laporan yang sudah
              dikirim atau disetujui sengaja tidak ditawarkan — menambah lampiran ke sana berarti
              mengubah berkas yang sudah disahkan orang lain.
            </HelpText>
          )
        ) : data && data.kegiatan.length > 0 ? (
          <div>
            <Label htmlFor="fc-kegiatan">Kegiatan</Label>
            <Combobox
              id="fc-kegiatan"
              name="kegiatanId"
              value={kegiatanId}
              onChange={setKegiatanId}
              options={data.kegiatan.map((k) => ({ value: k.id, label: k.label }))}
              placeholder="Pilih kegiatan…"
            />
          </div>
        ) : (
          <HelpText>
            Tidak ada kegiatan lapangan berstatus draft di lokasi ini. Buat kegiatannya dulu di
            workspace lokasi.
          </HelpText>
        )}

        <Button
          type="submit"
          disabled={pending || memuat || (tujuan === "laporan" ? !reportItemId : !kegiatanId)}
        >
          {pending ? "Memproses…" : "Pakai foto"}
        </Button>
        <HelpText>
          Waktu & koordinat foto TIDAK berubah — yang ditambahkan hanya nama lokasi, perusahaan,
          bangunan, dan item pekerjaannya ke capnya.
        </HelpText>
      </form>
    </div>
  );
}
