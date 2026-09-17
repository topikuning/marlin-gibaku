"use client";

import { useAksi } from "@/lib/aksi-klien";

import { useMemo, useState, useTransition } from "react";
import { Banner, Button, Combobox, Input, Label } from "@/components/ui";
import type { CatalogItem } from "@/lib/master-location/queries";
import {
  addTargetLocation,
  addTargetLocationsFromCatalog,
  correctAddLocationAction,
  pindahkanLokasiAction,
  correctRemoveLocationAction,
  removeTargetLocation,
  type PackageActionState,
} from "@/lib/package/actions";

/**
 * Pilih lokasi target dari KATALOG master (impor) — alur normal. Cari + centang
 * beberapa lalu tambahkan sekaligus. Manual tetap tersedia (AddLocationForm).
 */
export function CatalogLocationPicker({
  packageId,
  catalog,
}: {
  packageId: string;
  catalog: CatalogItem[];
}) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [state, setState] = useState<PackageActionState>(undefined);
  const [pending, start] = useTransition();

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return catalog;
    return catalog.filter((c) =>
      `${c.village} ${c.regency} ${c.province} ${c.district ?? ""} ${c.candidateVendor ?? ""}`
        .toLowerCase()
        .includes(s),
    );
  }, [q, catalog]);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const submit = () => {
    if (selected.length === 0) return;
    start(async () => {
      const r = await addTargetLocationsFromCatalog(packageId, selected);
      setState(r);
      if (r?.success) setSelected([]);
    });
  };

  return (
    <div className="space-y-3">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}

      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`Cari desa/kabupaten/vendor… (${catalog.length} tersedia)`}
      />

      <div className="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border">
        {filtered.length === 0 ? (
          <p className="px-3 py-4 text-sm text-ink-muted">Tidak ada yang cocok.</p>
        ) : (
          filtered.map((c) => (
            <label key={c.id} className="flex cursor-pointer items-start gap-2 px-3 py-2 hover:bg-surface-muted">
              <input
                type="checkbox"
                checked={selected.includes(c.id)}
                onChange={() => toggle(c.id)}
                className="mt-0.5 size-4 accent-(--color-primary)"
              />
              <span className="min-w-0 text-sm">
                <span className="font-medium text-ink">{c.village}</span>
                <span className="text-ink-muted">
                  {" "}
                  · {[c.district, c.regency, c.province].filter(Boolean).join(", ")}
                </span>
                {c.candidateVendor ? (
                  <span className="block text-[12px] text-ink-faint">Calon penyedia: {c.candidateVendor}</span>
                ) : null}
              </span>
            </label>
          ))
        )}
      </div>

      <Button type="button" onClick={submit} loading={pending} disabled={selected.length === 0}>
        Tambah {selected.length > 0 ? `${selected.length} ` : ""}lokasi terpilih
      </Button>
    </div>
  );
}

/** Form tambah lokasi target (pra-kontrak). */
export function AddLocationForm({
  packageId,
  defaultProvince,
}: {
  packageId: string;
  defaultProvince: string;
}) {
  const [state, action, pending] = useAksi<PackageActionState>(
    addTargetLocation,
    undefined,
  );

  return (
    <form action={action} className="space-y-4">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      {/* Lokasi MIRIP tidak menghalangi, tapi harus terbaca – lihat guard di
          addTargetLocation. Yang kembar persis sudah ditolak sebagai error. */}
      {state?.warning ? <Banner tone="warning" title={state.warning} /> : null}
      <input type="hidden" name="packageId" value={packageId} />

      <div>
        <Label htmlFor="lk-name" required>
          Nama lokasi
        </Label>
        <Input id="lk-name" name="name" required minLength={3} placeholder="mis. Kedungmutih" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="lk-village" required>
            Desa/Kelurahan
          </Label>
          <Input id="lk-village" name="village" required />
        </div>
        <div>
          <Label htmlFor="lk-district">Kecamatan</Label>
          <Input id="lk-district" name="district" placeholder="mis. Wedung" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="lk-regency" required>
            Kabupaten/Kota
          </Label>
          <Input id="lk-regency" name="regency" required />
        </div>
        <div>
          <Label htmlFor="lk-province" required>
            Provinsi
          </Label>
          <Input id="lk-province" name="province" required defaultValue={defaultProvince} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="lk-lat">GPS Latitude</Label>
          <Input id="lk-lat" name="gpsLat" type="number" step="any" placeholder="-3.6543210" />
        </div>
        <div>
          <Label htmlFor="lk-lng">GPS Longitude</Label>
          <Input id="lk-lng" name="gpsLng" type="number" step="any" placeholder="128.1234567" />
        </div>
      </div>

      <Button type="submit" loading={pending}>
        Tambah Lokasi
      </Button>
    </form>
  );
}

/** Hapus lokasi target nonaktif (tanpa RAB/riwayat). */
export function RemoveLocationButton({
  locationId,
  name,
}: {
  locationId: string;
  name: string;
}) {
  const [state, action, pending] = useAksi<PackageActionState>(
    async () => removeTargetLocation(locationId),
    undefined,
  );

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(`Hapus lokasi target "${name}"?`)) e.preventDefault();
      }}
      className="flex items-center gap-2"
    >
      {state?.error ? <span className="text-xs text-danger">{state.error}</span> : null}
      <Button type="submit" size="sm" variant="ghost" loading={pending}>
        Hapus
      </Button>
    </form>
  );
}

/**
 * KOREKSI susunan lokasi paket berkontrak (super_admin) — DECISIONS 187.
 * Sengaja dibuat berbeda rupa dari "tambah lokasi target" biasa: judul, warna
 * peringatan, dan alasan wajib, supaya tidak dipakai sebagai jalan pintas
 * menghindari adendum yang sah.
 */
export function CorrectAddLocationForm({
  packageId,
  catalog,
  hiddenExistingCount = 0,
}: {
  packageId: string;
  catalog: CatalogItem[];
  /** Baris katalog yang disembunyikan karena lokasinya sudah ada di sistem. */
  hiddenExistingCount?: number;
}) {
  const [state, action, pending] = useAksi<PackageActionState>(
    correctAddLocationAction,
    undefined,
  );
  const [pakaiKatalog, setPakaiKatalog] = useState(catalog.length > 0);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="packageId" value={packageId} />
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      {state?.warning ? <Banner tone="warning" title={state.warning} /> : null}

      <Banner
        tone="warning"
        title="Ini jalur koreksi kesalahan input – bukan adendum"
        description="Pakai hanya bila lokasi memang ketinggalan saat data paket diinput, sementara nilai kontraknya sudah benar. Bila lingkup kontrak benar-benar bertambah, yang sah adalah adendum, bukan koreksi ini. Setiap koreksi tercatat di audit & histori paket."
      />

      {/*
        Tombol, BUKAN radio: React mereset form setelah action selesai, dan reset
        itu mengembalikan radio ke default sementara state React tidak ikut
        berubah — pilihan yang tampak dan panel yang tampil jadi berbeda.
      */}
      {catalog.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 text-[13px]">
          {[
            { katalog: true, label: "Dari katalog master" },
            { katalog: false, label: "Isi manual" },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              onClick={() => setPakaiKatalog(o.katalog)}
              aria-pressed={pakaiKatalog === o.katalog}
              className={`rounded-md border px-2.5 py-1 ${
                pakaiKatalog === o.katalog
                  ? "border-primary bg-info-soft font-medium text-ink"
                  : "border-border text-ink-muted hover:border-border-strong"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      ) : null}

      {pakaiKatalog && catalog.length > 0 ? (
        <div>
          <Label htmlFor="koreksi-master" required>
            Lokasi dari katalog
          </Label>
          {/* Combobox, BUKAN <select> native — katalog puluhan/ratusan lokasi
              harus bisa diketik-cari (DECISIONS 094/115/174). */}
          <Combobox
            id="koreksi-master"
            name="masterLocationId"
            required
            placeholder="ketik nama desa/kabupaten…"
            options={catalog.map((c) => ({
              value: c.id,
              label: `${c.village} · ${c.regency} · ${c.province}`,
            }))}
          />
          <p className="mt-1 text-xs text-ink-muted">
            Hanya lokasi yang BELUM terpakai yang tampil
            {hiddenExistingCount > 0
              ? ` – ${hiddenExistingCount} baris katalog disembunyikan karena lokasinya sudah ada di sistem`
              : ""}
            . Tidak ketemu? Berarti lokasi itu sudah dipakai; pakai isian manual bila memang beda
            lokasi.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="masterLocationId" value="" />
          <div>
            <Label htmlFor="koreksi-name" required>
              Nama lokasi
            </Label>
            <Input id="koreksi-name" name="name" required />
          </div>
          <div>
            <Label htmlFor="koreksi-village" required>
              Desa
            </Label>
            <Input id="koreksi-village" name="village" required />
          </div>
          <div>
            <Label htmlFor="koreksi-district">Kecamatan</Label>
            <Input id="koreksi-district" name="district" />
          </div>
          <div>
            <Label htmlFor="koreksi-regency" required>
              Kabupaten/Kota
            </Label>
            <Input id="koreksi-regency" name="regency" required />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="koreksi-province" required>
              Provinsi
            </Label>
            <Input id="koreksi-province" name="province" required />
          </div>
          {/* Tanpa koordinat, lokasi tak muncul di peta, cuaca otomatis mati,
              dan cap foto kehilangan titik proyek. Boleh dikosongkan lalu
              diisi belakangan di halaman lokasi. */}
          <div>
            <Label htmlFor="koreksi-lat">Latitude</Label>
            <Input id="koreksi-lat" name="gpsLat" inputMode="decimal" placeholder="-6.8710100" />
          </div>
          <div>
            <Label htmlFor="koreksi-lng">Longitude</Label>
            <Input id="koreksi-lng" name="gpsLng" inputMode="decimal" placeholder="109.2531230" />
          </div>
          <p className="text-xs text-ink-muted sm:col-span-2">
            Koordinat boleh dikosongkan sekarang, tapi tanpa itu lokasi tidak muncul di Peta,
            cuaca otomatis mati, dan cap foto kehilangan titik proyek. Salin dari Google Maps:
            klik kanan titiknya → salin.
          </p>
        </div>
      )}

      <div>
        <Label htmlFor="koreksi-reason" required>
          Alasan koreksi (tercatat permanen)
        </Label>
        <Input
          id="koreksi-reason"
          name="reason"
          required
          minLength={10}
          placeholder="mis. lokasi ke-3 terlewat saat input kontrak 12 Mei; nilai kontrak sudah mencakup 3 lokasi"
        />
      </div>

      <Button type="submit" size="sm" variant="danger" loading={pending}>
        Tambahkan sebagai koreksi data
      </Button>
    </form>
  );
}

/**
 * PINDAHKAN LOKASI KE PAKET LAIN — super admin saja (`location.correct`).
 *
 * Dua jalur, dan perbedaannya bukan kosmetik (ketetapan user 2026-09-15):
 * `paksa` untuk lokasi yang sejak awal salah paket, `cco` untuk perpindahan
 * yang memang kontraktual dan punya nomor adendumnya. Server menolak jalur
 * `paksa` bila lokasinya ternyata punya riwayat lingkup kontraktual.
 */
export function PindahLokasiForm({
  locationId,
  name,
  paketTujuan,
}: {
  locationId: string;
  name: string;
  paketTujuan: { id: string; label: string }[];
}) {
  const [state, action, pending] = useAksi<PackageActionState>(pindahkanLokasiAction, undefined);
  const [buka, setBuka] = useState(false);
  const [mode, setMode] = useState<"paksa" | "cco">("paksa");

  if (!buka) {
    return (
      <Button type="button" size="sm" variant="ghost" onClick={() => setBuka(true)}>
        Pindahkan…
      </Button>
    );
  }

  return (
    <form action={action} className="w-full space-y-3 rounded-md border border-border bg-surface-muted/40 p-3">
      <input type="hidden" name="locationId" value={locationId} />
      <input type="hidden" name="mode" value={mode} />
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}

      <Banner
        tone="warning"
        title={`Pindahkan "${name}" ke paket lain`}
        description="Seluruh RAB, kurva-S, rencana mingguan, laporan, dan fotonya ikut pindah. Kalender proyek (SPMK, durasi, mode minggu) milik PAKET, jadi rentang rencana dan grid kurva-S dihitung ulang ke kalender paket tujuan. Tercatat di audit & histori KEDUA paket."
      />

      {/* Tombol, BUKAN radio – React mereset form sesudah action selesai dan
          reset itu memisahkan tampilan dari state (sama dengan CorrectAdd). */}
      <div className="flex flex-wrap gap-1.5 text-[13px]">
        {[
          { v: "paksa" as const, label: "Koreksi salah input" },
          { v: "cco" as const, label: "Lewat adendum (CCO)" },
        ].map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => setMode(o.v)}
            aria-pressed={mode === o.v}
            className={`rounded-md border px-2.5 py-1 ${
              mode === o.v
                ? "border-primary bg-info-soft font-medium text-ink"
                : "border-border text-ink-muted hover:border-border-strong"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      <div>
        <Label htmlFor={`pindah-tujuan-${locationId}`} required>
          Paket tujuan
        </Label>
        <Combobox
          id={`pindah-tujuan-${locationId}`}
          name="tujuanPackageId"
          required
          placeholder="ketik nama atau nomor paket…"
          options={paketTujuan.map((p) => ({ value: p.id, label: p.label }))}
        />
      </div>

      {mode === "cco" ? (
        <div>
          <Label htmlFor={`pindah-cco-${locationId}`} required>
            Nomor CCO / adendum
          </Label>
          <Input id={`pindah-cco-${locationId}`} name="ccoNumber" required placeholder="mis. CCO-02/2026" />
        </div>
      ) : null}

      <div>
        <Label htmlFor={`pindah-alasan-${locationId}`} required>
          Alasan pemindahan
        </Label>
        <Input
          id={`pindah-alasan-${locationId}`}
          name="alasan"
          required
          minLength={10}
          maxLength={500}
          placeholder="mis. lokasi ini terinput di paket yang salah saat pendataan awal"
        />
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={pending}>
          Pindahkan
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setBuka(false)}>
          Batal
        </Button>
      </div>
    </form>
  );
}

/**
 * CABUT LOKASI DARI PAKET BERKONTRAK — super admin saja (`location.correct`).
 *
 * Pasangan `CorrectAddLocationForm`, dan sengaja serupa rupanya: judul
 * peringatan, alasan wajib, tidak menyamar sebagai tombol "Hapus" biasa. Yang
 * dibedakan cuma arahnya.
 *
 * Server menolak lokasi yang masih punya RAB, laporan, foto, atau data lain –
 * jadi tombol ini tidak pernah bisa jadi jalan pintas menghindari adendum.
 */
export function CabutLokasiForm({ locationId, name }: { locationId: string; name: string }) {
  const [state, action, pending] = useAksi<PackageActionState>(
    correctRemoveLocationAction,
    undefined,
  );
  const [buka, setBuka] = useState(false);

  if (!buka) {
    return (
      <Button type="button" size="sm" variant="ghost" onClick={() => setBuka(true)}>
        Cabut…
      </Button>
    );
  }

  return (
    <form action={action} className="w-full space-y-3 rounded-md border border-border bg-surface-muted/40 p-3">
      <input type="hidden" name="locationId" value={locationId} />
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}

      <Banner
        tone="warning"
        title={`Cabut "${name}" dari paket ini`}
        description="Koreksi data, BUKAN adendum – nilai kontrak tidak disentuh. Hanya untuk lokasi yang salah masuk dan masih benar-benar kosong; yang sudah punya RAB, laporan, atau foto ditolak dan memang harus dipindahkan atau dikeluarkan lewat adendum. Tercatat di audit & histori paket."
      />

      <div>
        <Label htmlFor={`cabut-alasan-${locationId}`} required>
          Alasan pencabutan
        </Label>
        <Input
          id={`cabut-alasan-${locationId}`}
          name="reason"
          required
          minLength={10}
          maxLength={500}
          placeholder="mis. desa ini sudah berjalan di paket lain – salah pilih saat paket dibuat"
        />
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={pending}>
          Cabut lokasi
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setBuka(false)}>
          Batal
        </Button>
      </div>
    </form>
  );
}
