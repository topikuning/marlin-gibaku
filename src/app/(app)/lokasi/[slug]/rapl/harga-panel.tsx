"use client";

import { useMemo, useState, useTransition } from "react";
import type {
  CellClassParams,
  CellValueChangedEvent,
  ColDef,
  ValueFormatterParams,
} from "ag-grid-community";
import { Banner } from "@/components/ui";
import { MarlinGrid, rupiahCol } from "@/components/grid/marlin-grid";
import { cn } from "@/lib/cn";
import { formatNumber, formatPct, formatRupiah, formatRupiahShort } from "@/lib/format";
import { simpanHargaSel } from "@/lib/ahsp/hsd-actions";

/**
 * Pengisian HARGA SATUAN DASAR memakai MarlinGrid (DECISIONS 328).
 *
 * Versi sebelumnya menyusun 300 formulir kecil dengan tangan — melanggar aturan
 * repo yang sudah tertulis ("Tabel data → MarlinGrid") dan, lebih buruk,
 * membuat pengisian 300 harga jadi 300 kali klik-simpan. Grid memberi yang
 * memang dibutuhkan orang yang mengisi harga: ketik → Enter → turun ke baris
 * berikutnya, seperti Excel, plus saring & urut bawaan.
 *
 * Kolom `harga` DIEDIT langsung; setiap sel yang berubah langsung disimpan.
 */

export type BarisHargaRow = {
  kategori: string;
  nama: string;
  satuan: string;
  jumlah: number;
  /** BigInt diserialisasi; null = belum berharga. */
  harga: string | null;
  biaya: string | null;
  sumber: string | null;
  /** Harga sumber daya yang sama di lokasi lain — bahan pertimbangan. */
  rekomendasi: { harga: string; lokasi: string; kabupaten: string; seKabupaten: boolean }[];
};

const LABEL: Record<string, string> = {
  bahan: "Bahan",
  upah: "Upah",
  alat: "Alat",
  fasilitas: "Fasilitas",
};

type Baris = BarisHargaRow & {
  /** Angka polos untuk grid — AG Grid tidak mengurut string rupiah. */
  hargaNum: number | null;
  biayaNum: number | null;
  rekomendasiTeks: string;
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
  const [pesan, setPesan] = useState<{ tone: "success" | "error"; teks: string } | null>(null);
  const [, mulai] = useTransition();
  const [data, setData] = useState<BarisHargaRow[]>(rows);

  const baris: Baris[] = useMemo(
    () =>
      data.map((r) => ({
        ...r,
        hargaNum: r.harga === null ? null : Number(r.harga),
        biayaNum: r.biaya === null ? null : Number(r.biaya),
        rekomendasiTeks: r.rekomendasi
          .map((k) => `${formatRupiahShort(BigInt(k.harga))} · ${k.lokasi}${k.seKabupaten ? " (sekab.)" : ""}`)
          .join("  |  "),
      })),
    [data],
  );

  const kolom: ColDef<Baris>[] = useMemo(
    () => [
      {
        field: "nama",
        headerName: "Sumber daya",
        flex: 2,
        minWidth: 240,
        filter: true,
        cellClass: (p: CellClassParams<Baris>) => (p.data?.harga === null ? "text-ink-muted" : ""),
      },
      {
        field: "kategori",
        headerName: "Kategori",
        width: 110,
        filter: true,
        valueFormatter: (p: ValueFormatterParams<Baris>) => LABEL[String(p.value)] ?? String(p.value),
      },
      {
        field: "jumlah",
        headerName: "Kebutuhan",
        width: 130,
        type: "numericColumn",
        valueFormatter: (p: ValueFormatterParams<Baris>) =>
          p.value == null ? "" : formatNumber(Number(p.value)),
        cellClass: "tabular text-right",
      },
      { field: "satuan", headerName: "Satuan", width: 90 },
      {
        ...rupiahCol<Baris>("hargaNum", "Harga satuan"),
        width: 150,
        // Inilah satu-satunya kolom yang boleh diedit. Sisanya turunan.
        editable: canInput,
        cellClass: () => cn("tabular text-right", canInput && "bg-[var(--color-surface-muted)]"),
      },
      { ...rupiahCol<Baris>("biayaNum", "Biaya"), width: 160 },
      {
        field: "rekomendasiTeks",
        headerName: "Harga di lokasi lain",
        flex: 1,
        minWidth: 220,
        cellClass: "text-ink-muted",
        tooltipField: "rekomendasiTeks",
      },
    ],
    [canInput],
  );

  const belum = data.filter((r) => r.harga === null).length;

  return (
    <div className="space-y-3">
      {pesan ? <Banner tone={pesan.tone} title={pesan.teks} /> : null}

      {canInput ? (
        <p className="text-[13px] text-ink-muted">
          Klik sel <strong>Harga satuan</strong> lalu ketik angkanya – Enter pindah ke baris
          berikutnya, seperti Excel. Kosongkan selnya untuk menghapus harga.
        </p>
      ) : null}

      <MarlinGrid<Baris>
        rowData={baris}
        columnDefs={kolom}
        quickFilter
        csvExport
        pageSize={50}
        height="60vh"
        persistKey="rapl-harga"
        editMode={canInput}
        getRowId={(d: Baris) => `${d.kategori}|${d.nama}|${d.satuan}`}
        emptyText="Belum ada kebutuhan – setujui padanan AHSP lebih dulu."
        onCellValueChanged={(e: CellValueChangedEvent<Baris>) => {
          if (e.colDef.field !== "hargaNum") return;
          const d = e.data;
          const teks = e.newValue == null || e.newValue === "" ? "" : String(e.newValue);
          setPesan(null);
          mulai(async () => {
            const hasil = await simpanHargaSel({
              locationId,
              slug,
              kategori: d.kategori,
              nama: d.nama,
              satuan: d.satuan,
              harga: teks,
            });
            if (!hasil.ok) {
              setPesan({ tone: "error", teks: hasil.error });
              return;
            }
            // Perbarui baris di tempat supaya kolom Biaya ikut benar tanpa
            // memuat ulang seluruh halaman.
            setData((lama) =>
              lama.map((r) =>
                r.kategori === d.kategori && r.nama === d.nama && r.satuan === d.satuan
                  ? {
                      ...r,
                      harga: hasil.harga,
                      biaya:
                        hasil.harga === null
                          ? null
                          : String(Math.round(r.jumlah * Number(hasil.harga))),
                    }
                  : r,
              ),
            );
            setPesan({
              tone: "success",
              teks:
                hasil.harga === null
                  ? `Harga "${d.nama}" dikosongkan.`
                  : `Harga "${d.nama}" disimpan.`,
            });
          });
        }}
      />

      <p className="text-[12px] text-ink-muted">
        {belum} dari {data.length} sumber daya belum berharga. Kolom &ldquo;Harga di lokasi
        lain&rdquo; hanya bahan pertimbangan – sekabupaten disebut lebih dulu.
      </p>
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
