"use client";

import { useActionState, useMemo, useState } from "react";
import { Banner, Button, Input } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatNumber, formatPct, formatRupiah, formatRupiahShort } from "@/lib/format";
import { simpanHargaAction, type HargaActionState } from "@/lib/ahsp/hsd-actions";

/**
 * Pengisian HARGA SATUAN DASAR + biaya RAPL (DECISIONS 327).
 *
 * Diurut dari KEBUTUHAN TERBESAR yang belum berharga: mengisi 20 harga teratas
 * biasanya sudah menutup sebagian besar nilai, dan daftar 300 baris tanpa urutan
 * membuat orang berhenti di baris kesepuluh.
 */

export type BarisHargaRow = {
  kategori: string;
  nama: string;
  satuan: string;
  jumlah: number;
  /** BigInt diserialisasi. */
  harga: string | null;
  biaya: string | null;
  sumber: string | null;
  rekomendasi: { harga: string; lokasi: string; kabupaten: string; seKabupaten: boolean }[];
};

const LABEL: Record<string, string> = {
  bahan: "Bahan",
  upah: "Upah",
  alat: "Alat",
  fasilitas: "Fasilitas",
};

export function HargaPanel({
  locationId,
  slug,
  rows,
  canInput,
}: {
  locationId: string;
  slug: string;
  rows: BarisHargaRow[];
  canInput: boolean;
}) {
  const [state, action, pending] = useActionState<HargaActionState, FormData>(
    simpanHargaAction,
    undefined,
  );
  const [cari, setCari] = useState("");
  const [hanyaKosong, setHanyaKosong] = useState(true);

  const tampil = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return rows
      .filter((r) => (hanyaKosong ? r.harga === null : true))
      .filter((r) => q === "" || r.nama.toLowerCase().includes(q))
      .slice(0, 300);
  }, [rows, cari, hanyaKosong]);

  const kosong = rows.filter((r) => r.harga === null).length;

  return (
    <div className="space-y-3">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setHanyaKosong(true)}
          className={cn(
            "rounded-full border px-3 py-1 text-[13px]",
            hanyaKosong
              ? "border-brand bg-brand-soft font-medium text-brand"
              : "border-line text-ink-muted hover:bg-surface-inset",
          )}
        >
          Belum berharga <span className="tabular">({kosong})</span>
        </button>
        <button
          type="button"
          onClick={() => setHanyaKosong(false)}
          className={cn(
            "rounded-full border px-3 py-1 text-[13px]",
            !hanyaKosong
              ? "border-brand bg-brand-soft font-medium text-brand"
              : "border-line text-ink-muted hover:bg-surface-inset",
          )}
        >
          Semua <span className="tabular">({rows.length})</span>
        </button>
        <Input
          value={cari}
          onChange={(e) => setCari(e.target.value)}
          placeholder="Cari sumber daya…"
          className="ms-auto w-56"
        />
      </div>

      {tampil.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-muted">
          {kosong === 0 && hanyaKosong
            ? "Semua sumber daya sudah berharga."
            : "Tidak ada baris pada saringan ini."}
        </p>
      ) : (
        <div className="divide-y divide-line rounded-lg border border-line">
          {tampil.map((r) => (
            <BarisHarga
              key={`${r.kategori}|${r.nama}|${r.satuan}`}
              r={r}
              locationId={locationId}
              slug={slug}
              canInput={canInput}
              action={action}
              pending={pending}
            />
          ))}
        </div>
      )}

      <p className="text-[12px] text-ink-muted">
        Diurut dari kebutuhan terbesar. Harga dari lokasi lain hanya ditawarkan sebagai bahan
        pertimbangan — tidak pernah dipakai sendiri.
      </p>
    </div>
  );
}

function BarisHarga({
  r,
  locationId,
  slug,
  canInput,
  action,
  pending,
}: {
  r: BarisHargaRow;
  locationId: string;
  slug: string;
  canInput: boolean;
  action: (formData: FormData) => void;
  pending: boolean;
}) {
  const [nilai, setNilai] = useState(r.harga ?? "");
  const [sumber, setSumber] = useState(r.sumber ?? "");

  return (
    <div className="px-3 py-2.5">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-[14rem] flex-1">
          <p className="text-sm font-medium text-ink">{r.nama}</p>
          <p className="tabular mt-0.5 text-[12px] text-ink-muted">
            {LABEL[r.kategori] ?? r.kategori} · butuh {formatNumber(r.jumlah)} {r.satuan || "—"}
            {r.biaya ? (
              <span className="ms-2 font-medium text-ink">= {formatRupiah(BigInt(r.biaya))}</span>
            ) : null}
          </p>
        </div>

        {canInput ? (
          <form action={action} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="locationId" value={locationId} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="kategori" value={r.kategori} />
            <input type="hidden" name="nama" value={r.nama} />
            <input type="hidden" name="satuan" value={r.satuan} />
            <Input
              name="harga"
              value={nilai}
              onChange={(e) => setNilai(e.target.value)}
              inputMode="numeric"
              placeholder="Rp / satuan"
              className="w-32 text-end"
              aria-label={`Harga ${r.nama}`}
            />
            <Input
              name="sumber"
              value={sumber}
              onChange={(e) => setSumber(e.target.value)}
              placeholder="asal harga"
              className="w-36"
              aria-label={`Asal harga ${r.nama}`}
            />
            <Button type="submit" size="sm" variant="secondary" loading={pending}>
              Simpan
            </Button>
          </form>
        ) : r.harga ? (
          <p className="tabular text-sm text-ink">{formatRupiah(BigInt(r.harga))}</p>
        ) : (
          <p className="text-[13px] text-ink-muted">belum berharga</p>
        )}
      </div>

      {r.rekomendasi.length > 0 && r.harga === null ? (
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-muted">
          <span>Di lokasi lain:</span>
          {r.rekomendasi.map((k) => (
            <button
              key={`${k.lokasi}|${k.harga}`}
              type="button"
              onClick={() => setNilai(k.harga)}
              className="rounded border border-line px-1.5 py-0.5 hover:border-brand hover:text-brand"
              title={`Pakai harga dari ${k.lokasi} (${k.kabupaten})`}
            >
              <span className="tabular">{formatRupiahShort(BigInt(k.harga))}</span> · {k.lokasi}
              {k.seKabupaten ? " (sekabupaten)" : ""}
            </button>
          ))}
        </p>
      ) : null}
    </div>
  );
}

/** Ringkasan biaya + perbandingan dengan kontrak. */
export function RingkasBiaya({
  totalBiaya,
  berharga,
  belumBerharga,
  perKategori,
  perbandingan,
}: {
  totalBiaya: string;
  berharga: number;
  belumBerharga: number;
  perKategori: { kategori: string; biaya: string; berharga: number; total: number }[];
  perbandingan: {
    nilaiKontrak: string;
    selisih: string;
    selisihPersen: number;
    cakupanNilai: number;
    cakupanHarga: number;
    utuh: boolean;
  } | null;
}) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {perKategori.map((k) => (
          <div key={k.kategori} className="rounded-lg border border-line px-3 py-2">
            <p className="text-[12px] tracking-wide text-ink-muted uppercase">
              {LABEL[k.kategori] ?? k.kategori}
            </p>
            <p className="tabular mt-0.5 text-lg font-semibold text-ink">
              {formatRupiahShort(BigInt(k.biaya))}
            </p>
            <p className="text-[12px] text-ink-muted">
              {k.berharga} dari {k.total} sudah berharga
            </p>
          </div>
        ))}
      </div>

      {perbandingan ? (
        <div
          className={cn(
            "rounded-lg border p-3",
            perbandingan.utuh ? "border-line bg-surface" : "border-warning-border bg-warning-soft",
          )}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <p className="text-[12px] tracking-wide text-ink-muted uppercase">Biaya RAPL</p>
              <p className="tabular text-lg font-semibold text-ink">
                {formatRupiah(BigInt(totalBiaya))}
              </p>
            </div>
            <div>
              <p className="text-[12px] tracking-wide text-ink-muted uppercase">Nilai kontrak</p>
              <p className="tabular text-lg font-semibold text-ink">
                {formatRupiah(BigInt(perbandingan.nilaiKontrak))}
              </p>
            </div>
            <div>
              <p className="text-[12px] tracking-wide text-ink-muted uppercase">Selisih</p>
              <p
                className={cn(
                  "tabular text-lg font-semibold",
                  BigInt(perbandingan.selisih) >= 0n ? "text-success" : "text-danger",
                )}
              >
                {formatRupiah(BigInt(perbandingan.selisih))}
                <span className="ms-1 text-[13px] font-normal">
                  ({formatPct(perbandingan.selisihPersen, 1)})
                </span>
              </p>
            </div>
          </div>

          {!perbandingan.utuh ? (
            <p className="mt-2.5 border-t border-warning-border pt-2 text-[13px] text-ink">
              <strong>Selisih ini BELUM bisa dibaca sebagai keuntungan.</strong> Ia dihitung dari{" "}
              {formatPct(perbandingan.cakupanNilai, 1)} nilai RAB yang masuk hitungan kebutuhan, dan
              baru {formatPct(perbandingan.cakupanHarga, 1)} sumber daya yang berharga
              {belumBerharga > 0 ? ` (${belumBerharga} masih kosong)` : ""}. Biaya yang belum masuk
              akan MENGECILKAN selisihnya, bukan membesarkan.
            </p>
          ) : (
            <p className="mt-2.5 border-t border-line pt-2 text-[13px] text-ink-muted">
              Seluruh nilai RAB masuk hitungan dan seluruh {berharga} sumber daya sudah berharga.
            </p>
          )}
        </div>
      ) : (
        <Banner
          tone="info"
          title="Lokasi ini belum punya kontrak"
          description="Biaya RAPL tetap dihitung, tapi belum ada nilai kontrak untuk dibandingkan."
        />
      )}
    </div>
  );
}
