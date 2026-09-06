"use client";

import { useState } from "react";
import { Banner, Button, Combobox, Input, Label, StatusPill } from "@/components/ui";
import { useAksi } from "@/lib/aksi-klien";
import {
  ajukanLingkupLokasiAction,
  batalkanLingkupLokasiAction,
  setujuiLingkupLokasiAction,
  type PackageActionState,
} from "@/lib/package/actions";

/**
 * LINGKUP LOKASI — adendum yang MENAMBAH atau MENCABUT lokasi.
 *
 * Kebutuhan user 2026-09-05: *"ada kebutuhan dimana, adendum mengurangi lokasi
 * atau bahkan menambah lokasi. saat ini di kamu belum ada."*
 *
 * Panel ini sengaja menyebut akibatnya di layar, bukan cuma menyediakan
 * tombolnya: lokasi yang dicabut tetap ada beserta laporan dan fotonya, dan
 * angka lampaunya tidak diubah — yang berhenti hanyalah keikutsertaannya dalam
 * angka paket sejak tanggal berlaku CCO (ketetapan user hari yang sama).
 */

export type BarisLingkup = {
  id: string;
  locationName: string;
  kind: "tambah" | "cabut";
  effectiveDate: string;
  status: "draft" | "aktif" | "dibatalkan";
  reason: string;
  ccoNumber: string;
  setuju: { lengkap: boolean; kurang: string[] };
  suaraGugur: number;
};

export function LingkupPanel({
  packageId,
  lokasi,
  adendum,
  perubahan,
  bolehUbah,
}: {
  packageId: string;
  lokasi: { id: string; name: string }[];
  adendum: { id: string; label: string }[];
  perubahan: BarisLingkup[];
  bolehUbah: boolean;
}) {
  const [buka, setBuka] = useState(false);
  const [ajukan, ajukanAction, mengajukan] = useAksi<PackageActionState>(
    ajukanLingkupLokasiAction,
    undefined,
  );

  const draft = perubahan.filter((p) => p.status === "draft");
  const berlaku = perubahan.filter((p) => p.status === "aktif");

  return (
    <div className="space-y-3">
      {ajukan?.error ? <Banner tone="error" title={ajukan.error} /> : null}
      {ajukan?.success ? <Banner tone="success" title={ajukan.success} /> : null}

      {berlaku.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-[13px] font-medium text-ink">Sudah berlaku</p>
          <ul className="space-y-1 text-[13px] text-ink-muted">
            {berlaku.map((p) => (
              <li key={p.id}>
                <span className="font-medium text-ink">{p.locationName}</span>{" "}
                {p.kind === "cabut" ? "dicabut" : "masuk"} per {p.ccoNumber} · berlaku{" "}
                {p.effectiveDate}
                <span className="block text-xs text-ink-faint">{p.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {draft.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-[13px] font-medium text-ink">Menunggu persetujuan</p>
          <ul className="space-y-2">
            {draft.map((p) => (
              <li key={p.id} className="rounded-md border border-border bg-surface-muted px-2.5 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[13px]">
                    <span className="font-medium text-ink">{p.locationName}</span>{" "}
                    {p.kind === "cabut" ? "akan DICABUT" : "akan MASUK"} per {p.ccoNumber} · berlaku{" "}
                    {p.effectiveDate}
                  </span>
                  <StatusPill
                    tone={p.setuju.lengkap ? "success" : "info"}
                    label={p.setuju.lengkap ? "Siap berlaku" : "Menunggu persetujuan"}
                  />
                </div>
                <p className="mt-0.5 text-xs text-ink-faint">{p.reason}</p>
                {!p.setuju.lengkap ? (
                  <p className="text-xs text-ink-faint">Kurang: {p.setuju.kurang.join(" · ")}</p>
                ) : null}
                {p.suaraGugur > 0 ? (
                  <p className="text-xs text-warning-700">
                    {p.suaraGugur} persetujuan gugur karena usulannya diubah lagi
                  </p>
                ) : null}
                {bolehUbah ? (
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    <TombolAksi
                      aksi={setujuiLingkupLokasiAction}
                      packageId={packageId}
                      changeId={p.id}
                      label="Setujui"
                    />
                    <TombolAksi
                      aksi={batalkanLingkupLokasiAction}
                      packageId={packageId}
                      changeId={p.id}
                      label="Batalkan usulan"
                      variant="ghost"
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {bolehUbah ? (
        buka ? (
          <form action={ajukanAction} className="space-y-2 rounded-md border border-border p-3">
            <input type="hidden" name="packageId" value={packageId} />
            <div className="grid gap-2 sm:grid-cols-3">
              <div>
                <Label htmlFor="lingkup-lokasi" required>
                  Lokasi
                </Label>
                <Combobox id="lingkup-lokasi" name="locationId" required>
                  {lokasi.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Combobox>
              </div>
              <div>
                <Label htmlFor="lingkup-jenis" required>
                  Perubahan
                </Label>
                <Combobox id="lingkup-jenis" name="kind" required>
                  <option value="cabut">Dicabut dari kontrak</option>
                  <option value="tambah">Masuk lewat adendum</option>
                </Combobox>
              </div>
              <div>
                <Label htmlFor="lingkup-cco" required>
                  Adendum (CCO)
                </Label>
                <Combobox id="lingkup-cco" name="amendmentId" required>
                  {adendum.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </Combobox>
              </div>
            </div>
            <div>
              <Label htmlFor="lingkup-alasan" required>
                Alasan
              </Label>
              <Input id="lingkup-alasan" name="reason" required maxLength={300} />
            </div>
            <p className="text-xs text-ink-muted">
              Tanggal berlaku mengikuti adendum yang dipilih. Lokasi yang dicabut TIDAK dihapus –
              laporan, foto, dan realisasinya tetap; yang berhenti hanya keikutsertaannya dalam
              angka paket sejak tanggal itu.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" loading={mengajukan}>
                Ajukan perubahan
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setBuka(false)}>
                Batal
              </Button>
            </div>
          </form>
        ) : (
          <Button type="button" size="sm" variant="secondary" onClick={() => setBuka(true)}>
            Ajukan perubahan lingkup lokasi
          </Button>
        )
      ) : null}

      {adendum.length === 0 && bolehUbah ? (
        <p className="text-[13px] text-ink-muted">
          Belum ada adendum (CCO) tercatat di kontrak paket ini – catat CCO-nya dulu di tab Kontrak,
          karena perubahan lingkup wajib bernomor.
        </p>
      ) : null}
    </div>
  );
}

/** Tombol satu aksi kecil (setujui / batalkan) dengan pesannya sendiri. */
function TombolAksi({
  aksi,
  packageId,
  changeId,
  label,
  variant = "secondary",
}: {
  aksi: (prev: PackageActionState, fd: FormData) => Promise<PackageActionState>;
  packageId: string;
  changeId: string;
  label: string;
  variant?: "secondary" | "ghost";
}) {
  const [state, action, pending] = useAksi<PackageActionState>(aksi, undefined);
  return (
    <form action={action} className="inline-flex flex-col gap-1">
      <input type="hidden" name="packageId" value={packageId} />
      <input type="hidden" name="changeId" value={changeId} />
      <Button type="submit" size="sm" variant={variant} loading={pending}>
        {label}
      </Button>
      {state?.error ? <span className="text-xs text-danger-700">{state.error}</span> : null}
      {state?.success ? <span className="text-xs text-success-700">{state.success}</span> : null}
    </form>
  );
}
