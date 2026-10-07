"use client";

import { useEffect, useRef } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Banner, Button, Input, Label } from "@/components/ui";
import { useAksi } from "@/lib/aksi-klien";
import { formatNumber } from "@/lib/format";
import { hapusBarisBackupAction, tambahBarisBackupAction, type IsianState } from "@/lib/rab/rincian/isian-actions";

/**
 * BACKUP VOLUME YANG DIISI DI MARLIN (DECISIONS baru 2026-10-07).
 *
 * Hasil tiap baris dan totalnya DIHITUNG SERVER (`ahsp/rapl-calc.ts`) dan
 * dikirim ke sini; komponen ini hanya menampilkan dan menambah/menghapus baris.
 */
export type BarisIsianView = {
  id: string;
  uraian: string;
  jumlah: number | null;
  panjang: number | null;
  lebar: number | null;
  tinggi: number | null;
  kurang: boolean;
  keterangan: string | null;
  hasil: number | null;
  oleh: string;
};

const angka = (v: number | null) => (v == null ? "" : v.toLocaleString("id-ID", { maximumFractionDigits: 4 }));

export function TabelIsian({
  baris,
  total,
  volume,
  selisih,
  satuan,
  bolehUbah,
}: {
  baris: BarisIsianView[];
  total: number;
  volume: number | null;
  selisih: number | null;
  satuan: string;
  bolehUbah: boolean;
}) {
  const [hapus, kirimHapus, menghapus] = useAksi<IsianState>(hapusBarisBackupAction, undefined);
  return (
    <div className="space-y-2">
      {hapus?.error ? <Banner tone="error" title={hapus.error} /> : null}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-muted text-left text-xs text-ink-muted">
              <th className="px-2 py-1.5">Uraian</th>
              <th className="px-2 py-1.5 text-right">Jumlah</th>
              <th className="px-2 py-1.5 text-right">Panjang</th>
              <th className="px-2 py-1.5 text-right">Lebar</th>
              <th className="px-2 py-1.5 text-right">Tinggi</th>
              <th className="px-2 py-1.5 text-right">Hasil</th>
              {bolehUbah ? <th className="px-2 py-1.5" /> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {baris.map((b) => (
              <tr key={b.id}>
                <td className="px-2 py-1.5">
                  {b.uraian}
                  {b.kurang ? <span className="ml-1 text-xs text-warning">(pengurang)</span> : null}
                  <span className="block text-[11px] text-ink-faint">
                    {b.keterangan ? `${b.keterangan} · ` : ""}diisi {b.oleh}
                  </span>
                </td>
                <td className="tabular px-2 py-1.5 text-right">{angka(b.jumlah)}</td>
                <td className="tabular px-2 py-1.5 text-right">{angka(b.panjang)}</td>
                <td className="tabular px-2 py-1.5 text-right">{angka(b.lebar)}</td>
                <td className="tabular px-2 py-1.5 text-right">{angka(b.tinggi)}</td>
                <td className="tabular px-2 py-1.5 text-right font-medium">{angka(b.hasil)}</td>
                {bolehUbah ? (
                  <td className="px-2 py-1.5 text-right">
                    <form action={kirimHapus}>
                      <input type="hidden" name="id" value={b.id} />
                      <Button type="submit" variant="secondary" size="sm" loading={menghapus} aria-label={`Hapus baris ${b.uraian}`}>
                        <Trash2 aria-hidden className="size-3.5" />
                      </Button>
                    </form>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border bg-surface-muted">
              <td className="px-2 py-1.5 font-medium" colSpan={5}>
                Total backup
              </td>
              <td className="tabular px-2 py-1.5 text-right font-semibold">
                {formatNumber(total)} {satuan}
              </td>
              {bolehUbah ? <td /> : null}
            </tr>
          </tfoot>
        </table>
      </div>
      {volume != null && selisih != null ? (
        selisih === 0 ? (
          <p className="text-sm text-success">Total backup sama dengan volume RAB ({formatNumber(volume)} {satuan}).</p>
        ) : (
          <Banner
            tone="warning"
            title={`Total backup ${selisih > 0 ? "lebih" : "kurang"} ${formatNumber(Math.abs(selisih))} ${satuan} dari volume RAB`}
            description={`Volume RAB ${formatNumber(volume)} ${satuan}. Volume resmi tetap angka di RAB; selisih ini hanya disebut supaya bisa diperiksa.`}
          />
        )
      ) : null}
    </div>
  );
}

export function FormIsian({ revisionId, lineageKey }: { revisionId: string; lineageKey: string }) {
  const [state, kirim, pending] = useAksi<IsianState>(tambahBarisBackupAction, undefined);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.success) form.current?.reset();
  }, [state]);
  return (
    <form ref={form} action={kirim} className="space-y-2 rounded-lg border border-line p-3">
      <input type="hidden" name="revisionId" value={revisionId} />
      <input type="hidden" name="lineageKey" value={lineageKey} />
      <h3 className="text-[13px] font-semibold text-ink">Tambah baris backup</h3>
      <p className="text-[12px] text-ink-muted">
        Isi angka yang dipakai menghitung volume, seperti di lembar backup Excel. Kolom yang tidak dipakai dikosongkan.
        Hasil baris = jumlah × panjang × lebar × tinggi.
      </p>
      <div className="grid gap-2 sm:grid-cols-6">
        <div className="sm:col-span-2">
          <Label htmlFor="bv-uraian">Uraian</Label>
          <Input id="bv-uraian" name="uraian" placeholder="mis. Sloof S1 as A–D" required />
        </div>
        <div>
          <Label htmlFor="bv-jumlah">Jumlah</Label>
          <Input id="bv-jumlah" name="jumlah" inputMode="decimal" placeholder="mis. 4" />
        </div>
        <div>
          <Label htmlFor="bv-panjang">Panjang</Label>
          <Input id="bv-panjang" name="panjang" inputMode="decimal" />
        </div>
        <div>
          <Label htmlFor="bv-lebar">Lebar</Label>
          <Input id="bv-lebar" name="lebar" inputMode="decimal" />
        </div>
        <div>
          <Label htmlFor="bv-tinggi">Tinggi</Label>
          <Input id="bv-tinggi" name="tinggi" inputMode="decimal" />
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-6">
        <div className="sm:col-span-4">
          <Label htmlFor="bv-ket">Keterangan (opsional)</Label>
          <Input id="bv-ket" name="keterangan" placeholder="mis. gambar kerja revisi 2" />
        </div>
        <label className="flex items-end gap-2 pb-2 text-sm sm:col-span-2">
          <input type="checkbox" name="kurang" value="1" className="size-4" />
          Pengurang (bukaan, dll.)
        </label>
      </div>
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      <Button type="submit" size="sm" loading={pending}>
        <Plus aria-hidden className="size-3.5" />
        Tambahkan baris
      </Button>
    </form>
  );
}
