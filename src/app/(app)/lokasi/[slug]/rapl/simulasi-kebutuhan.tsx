"use client";

import { useMemo, useState } from "react";
import type { CellClassParams, ColDef, ValueFormatterParams } from "ag-grid-community";
import { Badge, Banner } from "@/components/ui";
import { MarlinGrid, rupiahCol } from "@/components/grid/marlin-grid";
import { cn } from "@/lib/cn";
import { formatNumber, formatPct, formatRupiah } from "@/lib/format";

/**
 * Kebutuhan sumber daya + baris yang dikeluarkan — memakai MarlinGrid
 * (DECISIONS 328).
 *
 * Versi sebelumnya menyusun `<table>` sendiri: melanggar aturan repo ("Tabel
 * data → MarlinGrid") dan membuang saring/urut/unduh-CSV yang sudah ada gratis.
 * Untuk daftar 300 sumber daya, kehilangan itu bukan soal gaya — orang tidak
 * bisa mengurutkan dari kebutuhan terbesar atau mencari satu bahan.
 *
 * Dua hal yang TETAP di luar grid karena bukan data tabel: pernyataan cakupan
 * dan peringatan kategori janggal. Keduanya harus terbaca sebelum angkanya,
 * bukan tersembunyi di dalam sel.
 */

export type BarisKebutuhan = {
  kategori: string;
  nama: string;
  satuan: string;
  jumlah: number;
  dariBaris: number;
  janggal: boolean;
};

export type BarisDilewatRow = {
  code: string;
  uraian: string;
  amount: string;
  alasan: string;
  rinci: string;
};

const LABEL: Record<string, string> = {
  bahan: "Bahan",
  upah: "Upah",
  alat: "Alat",
  fasilitas: "Fasilitas",
};

const ALASAN_LABEL: Record<string, string> = {
  belum_disetujui: "Padanan belum disetujui",
  satuan_tidak_sepadan: "Satuan item ≠ satuan analisa",
  tanpa_koefisien: "Analisa belum punya koefisien",
  volume_kosong: "Item RAB tidak punya volume",
};

type BarisDilewatGrid = BarisDilewatRow & { nilai: number; alasanLabel: string };

export function SimulasiKebutuhan({
  kebutuhan,
  dilewat,
  nilaiDipakai,
  barisDipakai,
  nilaiRab,
  barisRab,
}: {
  kebutuhan: BarisKebutuhan[];
  dilewat: BarisDilewatRow[];
  nilaiDipakai: string;
  barisDipakai: number;
  nilaiRab: string;
  barisRab: number;
}) {
  const [tab, setTab] = useState<"kebutuhan" | "dilewat">("kebutuhan");

  const total = BigInt(nilaiRab);
  const dipakai = BigInt(nilaiDipakai);
  const pct = total > 0n ? (Number(dipakai) / Number(total)) * 100 : 0;
  const janggal = kebutuhan.filter((k) => k.janggal).length;

  const kolomKebutuhan: ColDef<BarisKebutuhan>[] = useMemo(
    () => [
      {
        field: "nama",
        headerName: "Sumber daya",
        flex: 2,
        minWidth: 240,
        filter: true,
        cellClass: (p: CellClassParams<BarisKebutuhan>) =>
          p.data?.janggal ? "text-danger" : "",
      },
      {
        field: "kategori",
        headerName: "Kategori",
        width: 110,
        filter: true,
        valueFormatter: (p: ValueFormatterParams<BarisKebutuhan>) =>
          LABEL[String(p.value)] ?? String(p.value),
      },
      {
        field: "jumlah",
        headerName: "Kebutuhan",
        width: 140,
        type: "numericColumn",
        sort: "desc",
        valueFormatter: (p: ValueFormatterParams<BarisKebutuhan>) =>
          p.value == null ? "" : formatNumber(Number(p.value)),
        cellClass: "tabular text-right",
      },
      { field: "satuan", headerName: "Satuan", width: 100 },
      {
        field: "dariBaris",
        headerName: "Dari baris",
        width: 110,
        type: "numericColumn",
        cellClass: "tabular text-right",
      },
      {
        field: "janggal",
        headerName: "Catatan",
        flex: 1,
        minWidth: 200,
        valueFormatter: (p: ValueFormatterParams<BarisKebutuhan>) =>
          p.value ? "kategori janggal menurut berkas AHSP" : "",
        cellClass: "text-danger",
      },
    ],
    [],
  );

  const barisDilewat: BarisDilewatGrid[] = useMemo(
    () =>
      dilewat.map((d) => ({
        ...d,
        nilai: Number(d.amount),
        alasanLabel: ALASAN_LABEL[d.alasan] ?? d.alasan,
      })),
    [dilewat],
  );

  const kolomDilewat: ColDef<BarisDilewatGrid>[] = useMemo(
    () => [
      { field: "code", headerName: "Kode", width: 100 },
      { field: "uraian", headerName: "Uraian item RAB", flex: 2, minWidth: 260, filter: true },
      { ...rupiahCol<BarisDilewatGrid>("nilai", "Nilai"), width: 160, sort: "desc" },
      { field: "alasanLabel", headerName: "Sebab", width: 220, filter: true },
      { field: "rinci", headerName: "Keterangan", flex: 1, minWidth: 240 },
    ],
    [],
  );

  const nilaiDilewat = dilewat.reduce((a, d) => a + BigInt(d.amount), 0n);

  if (barisDipakai === 0) {
    return (
      <Banner
        tone="info"
        title="Belum ada padanan yang disetujui"
        description={`Simulasi kebutuhan hanya memakai padanan yang sudah disetujui orang — usulan mesin tidak dihitung. Setujui usulan di tahap 2 lebih dulu (${barisRab} baris RAB menunggu).`}
      />
    );
  }

  return (
    <div className="space-y-3">
      <Banner
        tone={pct >= 80 ? "success" : pct >= 40 ? "warning" : "info"}
        title={`Menutup ${formatPct(pct, 1)} nilai RAB — ${formatRupiah(dipakai)} dari ${formatRupiah(total)}`}
        description={`Dihitung dari ${barisDipakai} dari ${barisRab} baris kerja. Angka di tabel ini VOLUME kebutuhan, belum biaya — harga diisi di tahap 4.`}
      />

      {janggal > 0 ? (
        <p className="text-[12px] text-warning">
          {janggal} baris ditandai <strong>kategori janggal</strong>: berkas AHSP resminya
          mendaftarkannya sebagai upah padahal satuannya satuan bahan. MARLIN tidak memindahkannya
          sendiri — periksa halaman PDF analisanya.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setTab("kebutuhan")}
          className={cn(
            "rounded-full border px-3 py-1 text-[13px]",
            tab === "kebutuhan"
              ? "border-brand bg-brand-soft font-medium text-brand"
              : "border-line text-ink-muted hover:bg-surface-inset",
          )}
        >
          Kebutuhan <span className="tabular">({kebutuhan.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setTab("dilewat")}
          className={cn(
            "rounded-full border px-3 py-1 text-[13px]",
            tab === "dilewat"
              ? "border-brand bg-brand-soft font-medium text-brand"
              : "border-line text-ink-muted hover:bg-surface-inset",
          )}
        >
          Tidak masuk hitungan <span className="tabular">({dilewat.length})</span>
        </button>
        {tab === "dilewat" && dilewat.length > 0 ? (
          <Badge tone="warning">senilai {formatRupiah(nilaiDilewat)}</Badge>
        ) : null}
      </div>

      {tab === "kebutuhan" ? (
        <MarlinGrid<BarisKebutuhan>
          rowData={kebutuhan}
          columnDefs={kolomKebutuhan}
          quickFilter
          csvExport
          pageSize={50}
          height="55vh"
          persistKey="rapl-kebutuhan"
          getRowId={(d: BarisKebutuhan) => `${d.kategori}|${d.nama}|${d.satuan}`}
          emptyText="Belum ada kebutuhan."
        />
      ) : (
        <MarlinGrid<BarisDilewatGrid>
          rowData={barisDilewat}
          columnDefs={kolomDilewat}
          quickFilter
          csvExport
          pageSize={50}
          height="55vh"
          persistKey="rapl-dilewat"
          getRowId={(d: BarisDilewatGrid) => `${d.code}|${d.uraian}`}
          emptyText="Seluruh baris kerja masuk hitungan."
        />
      )}

      <p className="text-[12px] text-ink-muted">
        Nama sumber daya TIDAK disatukan antar ejaan yang berbeda (&ldquo;Semen PC&rdquo; dan
        &ldquo;Semen Portland&rdquo; tetap dua baris) — menggabungkannya keputusan yang tidak boleh
        diambil diam-diam.
      </p>
    </div>
  );
}
