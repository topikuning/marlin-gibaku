"use client";

import { useState } from "react";
import { formatRupiah } from "@/lib/format";
import { Button } from "@/components/ui";
import type { ImportPreview } from "./actions";

type Baris = NonNullable<ImportPreview["banding"]>[number];

/**
 * ITEM | JUMLAH KONTRAK | JUMLAH DRAFT ADENDUM — berdampingan.
 *
 * **Permintaan user 2026-09-21**: *"saat impor adendum harusnya kamu
 * memunculkan perbandingan kanan kiri -> Item | jumlah kontrak | jumlah draft
 * adendum. ini akan mudah untuk mengecek perubahannya."*
 *
 * `PanelBeda` di atasnya memilah perubahan menurut JENISNYA (volume, harga,
 * item baru, item hilang) — itu menjawab "apa yang berubah". Tabel ini menjawab
 * pertanyaan lain: "berapa di kiri, berapa di kanan", dengan mata turun satu
 * kolom. Keduanya dipertahankan karena keduanya dipakai pada saat yang berbeda.
 *
 * Dipisah dari `import-form.tsx` supaya bisa diuji sendirian: berkas form
 * mengimpor server action, dan ikut menyeret `db` + validasi env ke proses uji.
 * Di sini yang diimpor cuma TIPE-nya, yang hilang saat kompilasi.
 */
export function TabelBanding({ baris }: { baris: Baris[] }) {
  /*
   * Bawaan: HANYA YANG BERUBAH.
   *
   * RAB nyata berisi ribuan item, dan tabel seribu baris yang 990-nya identik
   * bukan alat periksa — ia gulungan yang membuat yang tiga baris penting ikut
   * terlewat. Yang tidak berubah tetap ADA datanya dan selalu satu ketukan
   * jauhnya, dengan jumlahnya disebut di tombolnya (pola yang sama dengan
   * DaftarBeda, keluhan user 2026-09-03 soal "+31 lainnya").
   */
  const [semua, setSemua] = useState(false);
  const berubah = baris.filter((b) => b.status !== "tetap");
  const tetap = baris.length - berubah.length;
  const tampil = semua ? baris : berubah;

  if (baris.length === 0) return null;

  return (
    <section className="rounded-md border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-ink">Kontrak vs draft adendum – per item</h3>
          <p className="mt-0.5 text-[11px] text-ink-muted">
            {berubah.length === 0
              ? `Tidak ada satu pun item yang berubah nilainya – ${tetap} item identik dengan kontrak.`
              : `${berubah.length} item berubah · ${tetap} item tidak tersentuh.`}
          </p>
        </div>
        {tetap > 0 ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => setSemua((v) => !v)}>
            {semua ? "Tampilkan yang berubah saja" : `Tampilkan semua (${baris.length} item)`}
          </Button>
        ) : null}
      </div>

      {tampil.length === 0 ? null : (
        <div className="mt-2 max-h-96 overflow-auto overscroll-contain rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-border text-left text-xs uppercase text-ink-muted">
                <th className="px-2 py-1.5">Item</th>
                <th className="px-2 py-1.5 text-right">Jumlah kontrak</th>
                <th className="px-2 py-1.5 text-right">Jumlah draft adendum</th>
                <th className="px-2 py-1.5 text-right">Selisih</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {tampil.map((b) => (
                <tr key={`${b.jalur}-${b.code}-${b.name}`}>
                  <td className="px-2 py-1.5">
                    <span className="text-ink">{b.name}</span>
                    <span className="block text-[11px] text-ink-faint">{b.jalur}</span>
                  </td>
                  {/*
                    KOSONG ditulis "–", bukan "Rp 0". Nol berarti "ada, bernilai
                    nol"; kosong berarti "tidak ada di sisi itu". Menyamakan
                    keduanya membuat item baru terbaca sebagai item yang
                    dinolkan – dua keadaan yang tindak lanjutnya berbeda.
                  */}
                  <td className="tabular px-2 py-1.5 text-right text-ink-muted">
                    {b.kontrak == null ? (
                      <span title="Belum ada di kontrak">–</span>
                    ) : (
                      formatRupiah(Number(b.kontrak))
                    )}
                  </td>
                  <td className="tabular px-2 py-1.5 text-right">
                    {b.adendum == null ? (
                      <span title="Hilang dari berkas adendum">–</span>
                    ) : (
                      formatRupiah(Number(b.adendum))
                    )}
                  </td>
                  <td
                    className={`tabular px-2 py-1.5 text-right ${
                      b.status === "hilang"
                        ? "font-medium text-danger"
                        : b.status === "baru"
                          ? "text-success"
                          : Number(b.selisih) < 0
                            ? "text-danger"
                            : Number(b.selisih) > 0
                              ? "text-success"
                              : "text-ink-faint"
                    }`}
                  >
                    {b.status === "tetap"
                      ? "–"
                      : `${Number(b.selisih) > 0 ? "+" : ""}${formatRupiah(Number(b.selisih))}`}
                    <span className="block text-[11px] font-normal text-ink-faint">
                      {b.status === "baru"
                        ? "item baru"
                        : b.status === "hilang"
                          ? "hilang dari berkas"
                          : b.status === "berubah"
                            ? "berubah"
                            : ""}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
