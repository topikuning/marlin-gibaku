"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  CellClassParams,
  CellValueChangedEvent,
  ColDef,
  ValueFormatterParams,
} from "ag-grid-community";
import { Check, Sparkles } from "lucide-react";
import { Banner, Button } from "@/components/ui";
import { MarlinGrid, rupiahCol } from "@/components/grid/marlin-grid";
import { cn } from "@/lib/cn";
import { formatNumber, formatPct, formatRupiah, formatRupiahShort } from "@/lib/format";
import {
  mintaUsulanHargaAiAction,
  simpanHargaSel,
  terapkanUsulanHargaAiAction,
} from "@/lib/ahsp/hsd-actions";

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
  usulanAiNum: number | null;
  keyakinanAi: string;
  alasanAi: string;
};

type UsulanAi = {
  kategori: string;
  nama: string;
  satuan: string;
  harga: string;
  keyakinan: "rendah" | "sedang" | "tinggi";
  alasan: string;
};

const kunci = (r: { kategori: string; nama: string; satuan: string }) =>
  JSON.stringify([r.kategori, r.nama, r.satuan.trim().toLowerCase()]);

export function HargaPanel({
  locationId,
  slug,
  rows,
  canInput,
  canUseAi,
}: {
  locationId: string;
  slug: string;
  rows: BarisHargaRow[];
  canInput: boolean;
  canUseAi: boolean;
}) {
  const router = useRouter();
  const [pesan, setPesan] = useState<{ tone: "success" | "error"; teks: string } | null>(null);
  const [, mulaiSimpan] = useTransition();
  const [aiPending, mulaiAi] = useTransition();
  const [terapkanPending, mulaiTerapkan] = useTransition();
  const [data, setData] = useState<BarisHargaRow[]>(rows);
  const [modelAi, setModelAi] = useState<string | null>(null);
  const [usulanAi, setUsulanAi] = useState<Map<string, UsulanAi>>(new Map());

  const baris: Baris[] = useMemo(
    () =>
      data.map((r) => {
        const usulan = usulanAi.get(kunci(r));
        return {
          ...r,
          hargaNum: r.harga === null ? null : Number(r.harga),
          biayaNum: r.biaya === null ? null : Number(r.biaya),
          rekomendasiTeks: r.rekomendasi
            .map((k) => `${formatRupiahShort(BigInt(k.harga))} · ${k.lokasi}${k.seKabupaten ? " (sekab.)" : ""}`)
            .join("  |  "),
          usulanAiNum: usulan ? Number(usulan.harga) : null,
          keyakinanAi: usulan ? `Keyakinan ${usulan.keyakinan}` : "",
          alasanAi: usulan?.alasan ?? "",
        };
      }),
    [data, usulanAi],
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
      {
        ...rupiahCol<Baris>("usulanAiNum", "Usulan AI"),
        width: 150,
        cellClass: "tabular text-right text-brand",
      },
      {
        field: "keyakinanAi",
        headerName: "Keyakinan AI",
        width: 130,
        cellClass: "text-ink-muted",
      },
      { ...rupiahCol<Baris>("biayaNum", "Biaya"), width: 160 },
      {
        field: "sumber",
        headerName: "Sumber harga",
        minWidth: 190,
        flex: 1,
        filter: true,
        cellClass: "text-ink-muted",
      },
      {
        field: "rekomendasiTeks",
        headerName: "Harga di lokasi lain",
        flex: 1,
        minWidth: 220,
        cellClass: "text-ink-muted",
        tooltipField: "rekomendasiTeks",
      },
      {
        field: "alasanAi",
        headerName: "Dasar usulan AI",
        flex: 1,
        minWidth: 260,
        cellClass: "text-ink-muted",
        tooltipField: "alasanAi",
      },
    ],
    [canInput],
  );

  const belum = data.filter((r) => r.harga === null).length;
  const daftarUsulan = [...usulanAi.values()];

  return (
    <div className="space-y-3">
      {pesan ? <Banner tone={pesan.tone} title={pesan.teks} /> : null}

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-inset px-3 py-2">
        <p className="min-w-[240px] flex-1 text-[13px] text-ink-muted">
          {canInput ? (
            <>Klik sel <strong>Harga satuan</strong> untuk input manual. Enter berpindah ke baris berikutnya.</>
          ) : (
            <>Harga hanya dapat diubah oleh pengguna dengan hak input keuangan.</>
          )}
        </p>
        {canInput && canUseAi && belum > 0 ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={aiPending}
            onClick={() => {
              setPesan(null);
              mulaiAi(async () => {
                const hasil = await mintaUsulanHargaAiAction({ locationId, slug });
                if (!hasil.ok) {
                  setPesan({ tone: "error", teks: hasil.error });
                  return;
                }
                setModelAi(hasil.model);
                setUsulanAi(new Map(hasil.usulan.map((u) => [kunci(u), u])));
                setPesan({
                  tone: "success",
                  teks: `${hasil.usulan.length} draf harga dari ${hasil.model} siap direview. Belum ada yang disimpan.`,
                });
              });
            }}
          >
            <Sparkles aria-hidden className="size-3.5" />
            Minta estimasi AI
          </Button>
        ) : null}
        {canInput && daftarUsulan.length > 0 ? (
          <Button
            type="button"
            size="sm"
            loading={terapkanPending}
            onClick={() => {
              setPesan(null);
              mulaiTerapkan(async () => {
                const hasil = await terapkanUsulanHargaAiAction({
                  locationId,
                  slug,
                  usulan: daftarUsulan.map(({ kategori, nama, satuan, harga }) => ({
                    kategori,
                    nama,
                    satuan,
                    harga,
                  })),
                });
                if (!hasil.ok) {
                  setPesan({ tone: "error", teks: hasil.error });
                  return;
                }
                const tersimpan = new Map(hasil.tersimpan.map((h) => [kunci(h), h]));
                setData((lama) =>
                  lama.map((r) => {
                    const h = tersimpan.get(kunci(r));
                    return h ? { ...r, harga: h.harga, biaya: h.biaya, sumber: h.sumber } : r;
                  }),
                );
                setUsulanAi(new Map());
                setPesan({
                  tone: "success",
                  teks: `${hasil.tersimpan.length} usulan AI diterima dan masuk kalkulasi RAPL.`,
                });
                router.refresh();
              });
            }}
          >
            <Check aria-hidden className="size-3.5" />
            Pakai {daftarUsulan.length} usulan
          </Button>
        ) : null}
      </div>

      {daftarUsulan.length > 0 ? (
        <Banner
          tone="warning"
          title={`Usulan ${modelAi ?? "AI"} belum tersimpan`}
          description="Periksa kolom Usulan AI, Keyakinan, dan Dasar usulan. Angka ini bukan survei pasar atau penawaran pemasok; tombol Pakai usulan adalah persetujuan manusia untuk memasukkannya ke RAPL."
        />
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
          mulaiSimpan(async () => {
            const hasil = await simpanHargaSel({
              locationId,
              slug,
              kategori: d.kategori,
              nama: d.nama,
              satuan: d.satuan,
              harga: teks,
              sumber: teks === "" ? null : "Input manual",
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
                      biaya: hasil.biaya,
                      sumber: hasil.sumber,
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
            router.refresh();
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

/** Ringkasan biaya + potensi margin terhadap nilai RAB aktif. */
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
    nilaiProyek: string;
    margin: string;
    marginPersen: number;
    cakupanNilai: number;
    cakupanHarga: number;
    utuh: boolean;
  };
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
              <p className="text-[12px] tracking-wide text-ink-muted uppercase">Nilai RAB aktif</p>
              <p className="tabular text-lg font-semibold text-ink">
                {formatRupiah(BigInt(perbandingan.nilaiProyek))}
              </p>
              <p className="text-[11px] text-ink-muted">nilai proyek pra-PPN</p>
            </div>
            <div>
              <p className="text-[12px] tracking-wide text-ink-muted uppercase">
                {perbandingan.utuh ? "Potensi margin" : "Selisih sementara"}
              </p>
              <p
                className={cn(
                  "tabular text-lg font-semibold",
                  BigInt(perbandingan.margin) >= 0n ? "text-success" : "text-danger",
                )}
              >
                {formatRupiah(BigInt(perbandingan.margin))}
                <span className="ms-1 text-[13px] font-normal">
                  ({formatPct(perbandingan.marginPersen, 1)})
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
            Angka ini adalah potensi margin pelaksanaan, bukan profit neto setelah pajak dan biaya
            lain di luar breakdown RAPL.
          </p>
        )}
      </div>
    </div>
  );
}
