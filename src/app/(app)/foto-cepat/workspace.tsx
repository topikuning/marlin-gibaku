"use client";

import { useActionState, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Images, MapPin, MapPinOff, Trash2 } from "lucide-react";
import { Banner, Button, Card, Combobox, EmptyState, HelpText, Label } from "@/components/ui";
import { PhotoSourceInput } from "@/components/knmp/photo-source-input";
import { KameraLangsung, type PosisiJepret } from "@/components/knmp/kamera-langsung";
import { labelJarak, urutkanTerdekat, type LokasiBerjarak } from "@/lib/foto-cepat/jarak";
import type { FotoKantong, PilihanLokasi, TujuanKegiatan, TujuanLaporan } from "@/lib/foto-cepat/queries";
import {
  hapusFotoCepatAction,
  muatTujuanAction,
  pakaiFotoAction,
  simpanFotoCepatAction,
  tetapkanLokasiAction,
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
   * Posisi dibaca sekali, HANYA untuk memberi tahu pelapor lokasi terdekat
   * sebelum memotret. Yang menentukan lokasi foto BUKAN ini, melainkan koordinat
   * foto itu sendiri, dideteksi di server per berkas (DECISIONS 254) — posisi di
   * sini adalah saat halaman dibuka, dan itu bukan tempat memotret.
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
  const terdekat = posisi ? (terurut.find((l) => l.jarakMeter != null) ?? null) : null;

  const opsiLokasi = terurut.map((l) => ({
    value: l.id,
    label: l.jarakMeter != null ? `${l.name} · ${labelJarak(l.jarakMeter)}` : l.name,
  }));

  return (
    <div className="space-y-4">
      <JepretCard wajibGps={wajibGps} terdekat={terdekat} adaPosisi={posisi != null} />
      <KantongCard kantong={kantong} opsiLokasi={opsiLokasi} />
    </div>
  );
}

/* ── 1. Jepret ───────────────────────────────────────────────────────────── */

function JepretCard({
  wajibGps,
  terdekat,
  adaPosisi,
}: {
  wajibGps: boolean;
  terdekat: LokasiBerjarak | null;
  adaPosisi: boolean;
}) {
  const router = useRouter();
  const [kameraBuka, setKameraBuka] = useState(false);
  /** Riwayat jepretan sesi ini — urutan terbaru di depan. */
  const [antrean, setAntrean] = useState<Jepretan[]>([]);
  const [state, action, pending] = useActionState(simpanFotoCepatAction, KOSONG);
  const nomor = useRef(0);
  const berjalan = antrean.some((j) => j.status === "kirim");

  /**
   * Satu jepretan = satu unggahan, langsung, tanpa menunggu yang lain.
   *
   * SENGAJA tidak diantre berurutan: di lapangan orang memotret beruntun, dan
   * memaksa yang kedua menunggu yang pertama selesai membuat rana terasa macet
   * persis saat jaringannya paling lambat. Yang penting bukan urutannya,
   * melainkan tidak ada jepretan yang hilang.
   */
  const kirim = useCallback(
    (file: File, posisi: PosisiJepret) => {
      const id = ++nomor.current;
      const url = URL.createObjectURL(file);
      setAntrean((a) => [{ id, url, status: "kirim" as const }, ...a].slice(0, 12));

      const fd = new FormData();
      fd.append("photos", file);
      fd.set("photoTakenAt", new Date().toISOString());
      if (posisi) {
        fd.set("gpsLat", String(posisi.lat));
        fd.set("gpsLng", String(posisi.lng));
      }
      void simpanFotoCepatAction({}, fd)
        .then((r) => {
          setAntrean((a) =>
            a.map((j) =>
              j.id === id
                ? {
                    ...j,
                    status: r.error ? ("gagal" as const) : ("simpan" as const),
                    pesan: r.error ?? r.ok ?? r.warning,
                  }
                : j,
            ),
          );
        })
        .catch(() => {
          setAntrean((a) =>
            a.map((j) =>
              j.id === id ? { ...j, status: "gagal" as const, pesan: "Gagal mengirim." } : j,
            ),
          );
        });
    },
    [],
  );

  /**
   * Kantong di bawah baru disegarkan saat kamera DITUTUP, bukan tiap jepretan.
   *
   * Sekali `router.refresh()` berarti sekali muat ulang seluruh payload RSC
   * halaman. Melakukannya per jepretan akan menyaingi unggahan foto berikutnya
   * di pipa yang sama — dan di 400 kbps itu terasa persis seperti aplikasi
   * tersendat (DECISIONS 245).
   */
  const tutupKamera = useCallback(() => {
    setKameraBuka(false);
    for (const j of antrean) URL.revokeObjectURL(j.url);
    setAntrean([]);
    router.refresh();
  }, [antrean, router]);

  return (
    <Card>
      <div className="space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-ink">Jepret sekarang</h2>
          <HelpText>
            Ketuk rana — foto langsung tersimpan, tanpa layar konfirmasi. Koordinat & jamnya
            terekam saat itu juga; lokasinya dikenali sendiri, itemnya menyusul.
          </HelpText>
        </div>

        <p className="text-[13px] text-ink-muted">
          {adaPosisi
            ? terdekat?.jarakMeter != null
              ? `Kamu ada di dekat ${terdekat.name} (${labelJarak(terdekat.jarakMeter)}). Foto yang dijepret di sini akan dikenali ke lokasi itu.`
              : "Posisi terbaca, tapi belum ada lokasi yang punya titik proyek untuk dibandingkan."
            : "Posisi belum terbaca. Izinkan akses lokasi — tanpa koordinat, lokasi fotonya harus dipilih manual belakangan."}
        </p>

        {wajibGps ? (
          <Banner
            tone="info"
            title="Setelan wajib-GPS menyala"
            description="Foto tanpa koordinat akan ditolak. Pastikan izin lokasi aktif sebelum memotret."
          />
        ) : null}

        {kameraBuka ? (
          <>
            <KameraLangsung onFoto={kirim} onTutup={tutupKamera} sibuk={berjalan} />
            {antrean.length > 0 ? <StripJepretan antrean={antrean} /> : null}
          </>
        ) : (
          <>
            <Button type="button" onClick={() => setKameraBuka(true)} className="w-full sm:w-auto">
              <Camera aria-hidden className="size-4" />
              Buka kamera
            </Button>

            {/*
              CADANGAN, bukan jalur utama. Dipakai kalau kamera dalam aplikasi
              tidak bisa dinyalakan (izin ditolak, peramban lawas). Di sini
              layar "Use Photo" dari aplikasi kamera HP memang muncul — itu
              milik sistem operasi dan tidak bisa dimatikan halaman web.
            */}
            <details className="rounded-md border border-border bg-surface-muted p-3">
              <summary className="cursor-pointer text-[13px] font-medium text-ink">
                Kamera dalam aplikasi tidak jalan?
              </summary>
              <div className="mt-2 space-y-3">
                {state.error ? <Banner tone="error" title={state.error} /> : null}
                {state.warning ? <Banner tone="warning" title={state.warning} /> : null}
                {state.ok ? <Banner tone="success" title={state.ok} /> : null}
                <HelpText>
                  Pakai aplikasi kamera HP. Hasilnya sama; bedanya ada satu layar konfirmasi
                  bawaan HP sebelum fotonya kembali ke MARLIN.
                </HelpText>
                <form action={action} className="space-y-3">
                  <PhotoSourceInput hanyaKamera />
                  <Button type="submit" disabled={pending}>
                    {pending ? "Menyimpan…" : "Simpan ke kantong"}
                  </Button>
                </form>
              </div>
            </details>
          </>
        )}
      </div>
    </Card>
  );
}

type Jepretan = {
  id: number;
  url: string;
  status: "kirim" | "simpan" | "gagal";
  pesan?: string;
};

/**
 * Strip hasil jepretan — bukti bahwa tiap ketukan benar-benar masuk.
 *
 * Tanpa ini, memotret beruntun berarti menekan rana ke ruang hampa: tidak ada
 * yang menunjukkan foto keberapa yang sudah aman dan mana yang gagal, dan
 * kegagalan satu foto akan lolos tanpa pernah terlihat.
 */
function StripJepretan({ antrean }: { antrean: Jepretan[] }) {
  const gagal = antrean.filter((j) => j.status === "gagal");
  return (
    <div className="space-y-1.5">
      <ul className="flex gap-2 overflow-x-auto pb-1">
        {antrean.map((j) => (
          <li key={j.id} className="relative shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={j.url}
              alt=""
              className={`size-14 rounded-md border object-cover ${
                j.status === "gagal" ? "border-danger opacity-60" : "border-border"
              }`}
            />
            <span
              className={`absolute inset-x-0 bottom-0 rounded-b-md text-center text-[10px] font-medium text-white ${
                j.status === "kirim"
                  ? "bg-ink/70"
                  : j.status === "gagal"
                    ? "bg-danger"
                    : "bg-success"
              }`}
            >
              {j.status === "kirim" ? "kirim…" : j.status === "gagal" ? "gagal" : "aman"}
            </span>
          </li>
        ))}
      </ul>
      {gagal.length > 0 ? (
        <Banner
          tone="error"
          title={`${gagal.length} foto gagal tersimpan`}
          description={gagal[0].pesan ?? "Coba jepret ulang."}
        />
      ) : null}
    </div>
  );
}

/* ── 2. Kantong + pakai ──────────────────────────────────────────────────── */

function KantongCard({
  kantong,
  opsiLokasi,
}: {
  kantong: FotoKantong[];
  opsiLokasi: { value: string; label: string }[];
}) {
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

  // Foto yang lokasinya belum ketahuan dipisah ke atas, bukan dicampur ke
  // daftar biasa: itu satu-satunya kelompok yang MENUNGGU tindakan, dan
  // menyembunyikannya di tengah daftar berarti ia tidak akan pernah dikerjakan.
  const belum = useMemo(() => kantong.filter((f) => f.locationId == null), [kantong]);
  const perLokasi = useMemo(() => {
    const m = new Map<string, FotoKantong[]>();
    for (const f of kantong) {
      if (f.locationId == null) continue;
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

        {belum.length > 0 ? (
          <PanelTetapkanLokasi fotos={belum} opsiLokasi={opsiLokasi} />
        ) : null}

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

/**
 * Foto yang geotag-nya tidak cukup untuk memutuskan lokasinya.
 *
 * Sengaja ditempatkan PALING ATAS di kantong dan diberi nada peringatan: ini
 * satu-satunya kelompok yang menghalangi foto dipakai, dan selama lokasinya
 * kosong foto itu tidak terlihat oleh siapa pun selain yang memotret.
 */
function PanelTetapkanLokasi({
  fotos,
  opsiLokasi,
}: {
  fotos: FotoKantong[];
  opsiLokasi: { value: string; label: string }[];
}) {
  const [state, action, pending] = useActionState(tetapkanLokasiAction, KOSONG);
  const [locationId, setLocationId] = useState("");

  return (
    <div className="rounded-md border border-warning-border bg-warning-soft p-3">
      <p className="text-sm font-semibold text-ink">
        {fotos.length} foto belum ketahuan lokasinya
      </p>
      <HelpText>
        Koordinatnya tidak ada, terlalu jauh dari semua titik proyek, atau berada di antara dua
        lokasi yang berdekatan — sistem sengaja tidak menebak. Pilih lokasinya di sini.
      </HelpText>

      {state.error ? <Banner tone="error" title={state.error} className="mt-2" /> : null}
      {state.warning ? <Banner tone="warning" title={state.warning} className="mt-2" /> : null}
      {state.ok ? <Banner tone="success" title={state.ok} className="mt-2" /> : null}

      <ul className="my-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {fotos.map((f) => (
          <li key={f.id} className="overflow-hidden rounded-md border border-border">
            <span className="block aspect-square bg-surface-inset">
              {f.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={f.thumbUrl} alt="" className="size-full object-cover" loading="lazy" />
              ) : null}
            </span>
            <span className="block px-1.5 py-1 text-[11px] text-ink-muted">{f.waktuLabel}</span>
          </li>
        ))}
      </ul>

      <form action={action} className="space-y-2">
        {fotos.map((f) => (
          <input key={f.id} type="hidden" name="photoIds" value={f.id} />
        ))}
        <div>
          <Label htmlFor="fc-tetapkan">Lokasi untuk semua foto di atas</Label>
          <Combobox
            id="fc-tetapkan"
            name="locationId"
            value={locationId}
            onChange={setLocationId}
            options={opsiLokasi}
            placeholder="Pilih lokasi…"
          />
        </div>
        <Button type="submit" disabled={pending || !locationId}>
          {pending ? "Menetapkan…" : "Tetapkan lokasi"}
        </Button>
      </form>
    </div>
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
