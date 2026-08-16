"use client";

import { useActionState, useCallback, useMemo, useState, useTransition } from "react";
import type { CellClassParams, ColDef, ValueFormatterParams } from "ag-grid-community";
import { AlertTriangle, Check, CheckCheck, RefreshCw, Search, X } from "lucide-react";
import { Badge, Banner, Button, Input } from "@/components/ui";
import { MarlinGrid, rupiahCol } from "@/components/grid/marlin-grid";
import { cn } from "@/lib/cn";
import { formatPct, formatRupiah, formatRupiahShort } from "@/lib/format";
import type { KeadaanUraian } from "@/lib/ahsp/kelompok";
import {
  cariPadananAction,
  koreksiPadananAction,
  petakanRabAction,
  setujuiPadananAction,
  type PadananActionState,
} from "@/lib/ahsp/padanan-actions";

/**
 * Daftar PEMETAAN, satu baris per URAIAN (DECISIONS 326), disajikan dengan
 * MarlinGrid (DECISIONS 328).
 *
 * Versi sebelumnya menyusun daftar `<div>` bertumpuk dengan tangan. Aturan repo
 * sudah menyebutnya sejak awal — "Tabel data → MarlinGrid" — dan melanggarnya
 * bukan cuma soal rupa: daftar buatan sendiri itu kehilangan urut per kolom,
 * saring per kolom, dan unduh CSV, padahal isinya 480 baris keputusan yang
 * memang perlu diurut dari nilai terbesar dan disaring per keadaan.
 *
 * Yang dipertahankan dari versi lama karena memang BUKAN tabel:
 *
 * - **Tombol saringan berhitung** di atas grid. Angkanya ("Perlu dikerjakan
 *   (312)") harus terbaca SEBELUM tabel; saringan kolom AG Grid menyembunyikan
 *   jumlahnya di balik menu.
 * - **Panel kandidat** di bawah grid. AG Grid Community tidak punya
 *   master/detail (itu Enterprise), dan memaksakannya ke dalam sel akan
 *   memampatkan pencarian AHSP ke lebar satu kolom.
 */

export type BarisUraianRow = {
  tanda: string;
  uraian: string;
  unit: string | null;
  kodeContoh: string;
  jumlahBaris: number;
  volume: number | null;
  /** BigInt diserialisasi — batas server/client tidak menerima BigInt. */
  nilai: string;
  keadaan: KeadaanUraian;
  skor: number | null;
  meyakinkan: boolean;
  catatan: string | null;
  petunjuk: string | null;
  ahspKode: string | null;
  ahspUraian: string | null;
  ahspSatuan: string | null;
  ahspTanpaKomponen: boolean;
  ahspPerluVerifikasi: boolean;
};

type Kandidat = {
  id: string;
  kode: string;
  uraian: string;
  satuan: string;
  bidang: string;
  perluVerifikasi: boolean;
  punyaKomponen: boolean;
  skor: number | null;
};

const SARING = [
  { key: "kerjakan", label: "Perlu dikerjakan" },
  { key: "menunggu", label: "Menunggu disetujui" },
  { key: "belum", label: "Belum ada padanan" },
  { key: "putus", label: "Tautan putus" },
  { key: "beres", label: "Sudah diputuskan" },
  { key: "semua", label: "Semua" },
] as const;
type SaringKey = (typeof SARING)[number]["key"];

function diputuskan(b: BarisUraianRow): boolean {
  return b.keadaan === "disetujui" || b.keadaan === "koreksi" || b.keadaan === "tidak_ada";
}

function lolosSaring(b: BarisUraianRow, s: SaringKey): boolean {
  switch (s) {
    case "kerjakan":
      return !diputuskan(b);
    case "menunggu":
      return b.keadaan === "usulan";
    case "belum":
      return b.keadaan === "belum";
    case "putus":
      return b.keadaan === "putus";
    case "beres":
      return diputuskan(b);
    default:
      return true;
  }
}

/**
 * Teks keadaan untuk SEL grid — sengaja teks, bukan komponen lencana.
 *
 * Sel yang berisi teks polos ikut terurut, tersaring, dan terbawa ke CSV;
 * lencana ber-JSX tidak. Warnanya dibawa `cellClass`, dan katanya tetap ditulis
 * penuh supaya arti barisnya tidak bergantung pada warna saja.
 */
function keadaanTeks(b: BarisUraianRow): string {
  const skor = b.skor != null ? ` ${formatPct(b.skor * 100, 0)}` : "";
  switch (b.keadaan) {
    case "putus":
      return "Tautan putus";
    case "belum":
      return "Belum ada padanan";
    case "tidak_ada":
      return "Dinyatakan tidak ada";
    case "koreksi":
      return "Dikoreksi";
    case "disetujui":
      // Skor tetap ditulis setelah disetujui: "sudah disetujui" tidak boleh
      // menghapus jejak bahwa yang disetujui itu tebakan 45% yang beda tipis.
      return `Disetujui${skor}`;
    default:
      return b.meyakinkan ? `Usulan${skor}` : `Beda tipis${skor}`;
  }
}

function keadaanKelas(b: BarisUraianRow): string {
  switch (b.keadaan) {
    case "putus":
    case "belum":
      return "text-danger";
    case "tidak_ada":
      return "text-ink-muted";
    case "koreksi":
    case "disetujui":
      return "text-success";
    default:
      return b.meyakinkan ? "text-info" : "text-warning";
  }
}

export function PadananPanel({
  locationId,
  slug,
  rows,
  canManage,
  basisAda,
  saringAwal,
}: {
  locationId: string;
  slug: string;
  rows: BarisUraianRow[];
  canManage: boolean;
  basisAda: boolean;
  /** Saringan pembuka — ditentukan tahap yang sedang aktif, bukan tebakan. */
  saringAwal: SaringKey;
}) {
  const [saring, setSaring] = useState<SaringKey>(saringAwal);
  const [terbuka, setTerbuka] = useState<BarisUraianRow | null>(null);
  const [terpilih, setTerpilih] = useState<BarisUraianRow[]>([]);

  // Kandidat AHSP dipegang DI SINI, bukan di panel rincian, supaya
  // pengambilannya terjadi di penangan ketukan baris — tempat yang benar untuk
  // efek samping. Memuat di dalam `useEffect` panel akan memicu render
  // beruntun setiap kali baris lain diketuk.
  const [kandidat, setKandidat] = useState<Kandidat[] | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [memuat, mulai] = useTransition();

  const ambil = useCallback(
    (b: BarisUraianRow, kueri: string) => {
      setGalat(null);
      mulai(async () => {
        try {
          setKandidat(
            await cariPadananAction({ locationId, uraian: b.uraian, satuan: b.unit, kueri }),
          );
        } catch (e) {
          setGalat(e instanceof Error ? e.message : "Gagal mengambil kandidat.");
        }
      });
    },
    [locationId],
  );

  const [petaState, petaAction, petaPending] = useActionState<PadananActionState, FormData>(
    petakanRabAction,
    undefined,
  );
  const [koreksiState, koreksiAction, koreksiPending] = useActionState<PadananActionState, FormData>(
    koreksiPadananAction,
    undefined,
  );
  const [setujuState, setujuAction, setujuPending] = useActionState<PadananActionState, FormData>(
    setujuiPadananAction,
    undefined,
  );

  const hitung = useMemo(() => {
    const h = {} as Record<SaringKey, number>;
    for (const s of SARING) h[s.key] = s.key === "semua" ? rows.length : 0;
    for (const b of rows) {
      for (const s of SARING) if (s.key !== "semua" && lolosSaring(b, s.key)) h[s.key] += 1;
    }
    return h;
  }, [rows]);

  const tampil = useMemo(() => rows.filter((b) => lolosSaring(b, saring)), [rows, saring]);

  // Hanya usulan yang bisa disetujui borongan; yang sudah diputuskan tidak
  // boleh ikut terpilih diam-diam saat "pilih semua" ditekan.
  const bisaDipilih = useCallback((b: BarisUraianRow) => b.keadaan === "usulan", []);
  const usulanTampil = tampil.filter(bisaDipilih).length;
  const nilaiTerpilih = terpilih.reduce((a, b) => a + BigInt(b.nilai), 0n);

  const kolom: ColDef<BarisUraianRow>[] = useMemo(
    () => [
      {
        field: "uraian",
        headerName: "Uraian pekerjaan (RAB)",
        flex: 2,
        minWidth: 260,
        filter: true,
        tooltipField: "uraian",
      },
      {
        field: "ahspUraian",
        headerName: "Padanan AHSP",
        flex: 2,
        minWidth: 240,
        filter: true,
        valueGetter: (p) =>
          p.data?.ahspUraian ? `[${p.data.ahspKode}] ${p.data.ahspUraian}` : "",
        cellClass: (p: CellClassParams<BarisUraianRow>) =>
          p.data?.ahspTanpaKomponen ? "text-warning" : "",
        tooltipValueGetter: (p) =>
          p.data?.ahspTanpaKomponen
            ? "Analisa ini belum punya koefisien — tidak bisa dipakai menghitung kebutuhan."
            : (p.value as string),
      },
      {
        colId: "keadaan",
        headerName: "Keadaan",
        width: 170,
        filter: true,
        valueGetter: (p) => (p.data ? keadaanTeks(p.data) : ""),
        cellClass: (p: CellClassParams<BarisUraianRow>) =>
          p.data ? `font-medium ${keadaanKelas(p.data)}` : "",
      },
      {
        ...rupiahCol<BarisUraianRow>("nilai", "Nilai RAB"),
        width: 160,
        sort: "desc",
        // Nilai datang sebagai string BigInt: tanpa ini AG Grid mengurutnya
        // seperti teks dan "9.000.000" naik di atas "80.000.000".
        valueGetter: (p) => (p.data ? Number(p.data.nilai) : 0),
      },
      {
        field: "jumlahBaris",
        headerName: "Baris RAB",
        width: 110,
        type: "numericColumn",
        cellClass: "tabular text-right",
      },
      {
        field: "volume",
        headerName: "Volume",
        width: 130,
        type: "numericColumn",
        cellClass: "tabular text-right",
        valueFormatter: (p: ValueFormatterParams<BarisUraianRow>) =>
          p.value == null
            ? "—"
            : `${Number(p.value).toLocaleString("id-ID")}${p.data?.unit ? ` ${p.data.unit}` : ""}`,
      },
      { field: "kodeContoh", headerName: "Kode", width: 110, hide: true },
    ],
    [],
  );

  const kirimSetuju = (daftar: string[]) => {
    if (daftar.length === 0) return;
    const fd = new FormData();
    fd.set("locationId", locationId);
    fd.set("slug", slug);
    fd.set("tanda", JSON.stringify(daftar));
    setujuAction(fd);
    setTerpilih([]);
  };

  return (
    <div className="space-y-3">
      {petaState?.error ? <Banner tone="error" title={petaState.error} /> : null}
      {petaState?.success ? <Banner tone="success" title={petaState.success} /> : null}
      {koreksiState?.error ? <Banner tone="error" title={koreksiState.error} /> : null}
      {koreksiState?.success ? <Banner tone="success" title={koreksiState.success} /> : null}
      {setujuState?.error ? <Banner tone="error" title={setujuState.error} /> : null}
      {setujuState?.success ? <Banner tone="success" title={setujuState.success} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        {SARING.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => {
              setSaring(s.key);
              setTerpilih([]);
              setTerbuka(null);
            }}
            disabled={hitung[s.key] === 0 && s.key !== saring}
            className={cn(
              "rounded-full border px-3 py-1 text-[13px] transition",
              saring === s.key
                ? "border-brand bg-brand-soft font-medium text-brand"
                : hitung[s.key] === 0
                  ? "border-line text-ink-faint opacity-50"
                  : "border-line text-ink-muted hover:bg-surface-inset",
            )}
          >
            {s.label} <span className="tabular">({hitung[s.key]})</span>
          </button>
        ))}
        {canManage ? (
          <form action={petaAction} className="ms-auto">
            <input type="hidden" name="locationId" value={locationId} />
            <input type="hidden" name="slug" value={slug} />
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              loading={petaPending}
              disabled={!basisAda}
            >
              <RefreshCw aria-hidden className="size-3.5" />
              Petakan otomatis
            </Button>
          </form>
        ) : null}
      </div>

      {canManage && usulanTampil > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface-inset px-3 py-2">
          <p className="text-[13px] text-ink-muted">
            Centang baris di grid — {usulanTampil} usulan menunggu keputusan pada saringan ini.
          </p>
          <Button
            type="button"
            size="sm"
            className="ms-auto"
            loading={setujuPending}
            disabled={terpilih.length === 0}
            onClick={() => kirimSetuju(terpilih.map((b) => b.tanda))}
          >
            <CheckCheck aria-hidden className="size-3.5" />
            Setujui {terpilih.length} uraian
            {terpilih.length > 0 ? ` · ${formatRupiahShort(nilaiTerpilih)}` : ""}
          </Button>
        </div>
      ) : null}

      <MarlinGrid<BarisUraianRow>
        rowData={tampil}
        columnDefs={kolom}
        quickFilter
        csvExport
        pageSize={50}
        height="55vh"
        persistKey="rapl-padanan"
        getRowId={(b: BarisUraianRow) => b.tanda}
        rowSelection={canManage ? "multi" : undefined}
        isRowSelectable={bisaDipilih}
        onSelectionChanged={setTerpilih}
        onRowClicked={(b: BarisUraianRow) => {
          if (terbuka?.tanda === b.tanda) {
            setTerbuka(null);
            return;
          }
          setTerbuka(b);
          setKandidat(null);
          if (canManage) ambil(b, "");
        }}
        emptyText="Tidak ada uraian pada saringan ini."
      />

      {terbuka ? (
        canManage ? (
          <PemilihPadanan
            key={terbuka.tanda}
            b={terbuka}
            locationId={locationId}
            slug={slug}
            kandidat={kandidat}
            memuat={memuat}
            galat={galat}
            ambil={(kueri) => ambil(terbuka, kueri)}
            onTutup={() => setTerbuka(null)}
            koreksiAction={koreksiAction}
            koreksiPending={koreksiPending}
          />
        ) : (
          <div className="rounded-lg border border-line bg-surface-inset p-3 text-[13px] text-ink-muted">
            <strong className="text-ink">{terbuka.uraian}</strong> —{" "}
            {terbuka.catatan ?? "belum ada catatan pemetaan."} Mengubah padanan butuh hak kelola RAB.
          </div>
        )
      ) : (
        <p className="text-[12px] text-ink-muted">
          {tampil.length} dari {rows.length} uraian. Ketuk satu baris untuk mengganti padanan
          AHSP-nya.
        </p>
      )}
    </div>
  );
}

/**
 * Panel kandidat untuk SATU uraian — muncul di bawah grid saat barisnya diketuk.
 * Bukan di dalam sel: pencarian AHSP butuh lebar penuh, dan master/detail AG
 * Grid hanya ada di edisi Enterprise yang dilarang repo ini.
 */
function PemilihPadanan({
  b,
  locationId,
  slug,
  kandidat,
  memuat,
  galat,
  ambil,
  onTutup,
  koreksiAction,
  koreksiPending,
}: {
  b: BarisUraianRow;
  locationId: string;
  slug: string;
  kandidat: Kandidat[] | null;
  memuat: boolean;
  galat: string | null;
  ambil: (kueri: string) => void;
  onTutup: () => void;
  koreksiAction: (formData: FormData) => void;
  koreksiPending: boolean;
}) {
  const [kueri, setKueri] = useState("");

  const kirim = (entryId: string) => {
    const fd = new FormData();
    fd.set("locationId", locationId);
    fd.set("slug", slug);
    fd.set("tanda", b.tanda);
    fd.set("uraianContoh", b.uraian);
    fd.set("satuan", b.unit ?? "");
    fd.set("entryId", entryId);
    koreksiAction(fd);
    onTutup();
  };

  return (
    <div className="rounded-lg border border-brand bg-surface-inset p-3">
      <div className="mb-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">{b.uraian}</p>
          <p className="text-[12px] text-ink-muted">
            {formatRupiah(BigInt(b.nilai))} · keputusan ini berlaku untuk{" "}
            <strong>{b.jumlahBaris} baris RAB</strong> di lokasi ini, dan untuk semua lokasi lain
            yang uraiannya persis sama.
            {b.catatan ? ` ${b.catatan}` : ""}
            {b.petunjuk ? ` ${b.petunjuk}` : ""}
          </p>
          {b.ahspTanpaKomponen ? (
            <p className="mt-1 flex items-center gap-1 text-[12px] text-warning">
              <AlertTriangle aria-hidden className="size-3.5" />
              Analisa yang terpasang belum punya koefisien — tidak bisa dipakai menghitung kebutuhan.
            </p>
          ) : null}
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onTutup}>
          <X aria-hidden className="size-3.5" />
          Tutup
        </Button>
      </div>

      <div className="mb-2 flex items-center gap-2">
        <Input
          value={kueri}
          onChange={(e) => setKueri(e.target.value)}
          placeholder="Cari analisa AHSP lain (min. 3 huruf)…"
          className="flex-1"
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={memuat}
          onClick={() => ambil(kueri)}
        >
          <Search aria-hidden className="size-3.5" />
          Cari
        </Button>
      </div>

      {galat ? <Banner tone="error" title={galat} /> : null}
      {memuat && kandidat === null ? (
        <p className="py-3 text-[13px] text-ink-muted">Menghitung kandidat…</p>
      ) : null}
      {kandidat && kandidat.length === 0 ? (
        <p className="py-2 text-[13px] text-ink-muted">
          Tidak ada analisa yang mendekati. Coba kata kunci lain, atau nyatakan memang tidak ada
          padanannya.
        </p>
      ) : null}

      <ul className="space-y-1">
        {(kandidat ?? []).map((k) => (
          <li key={k.id}>
            <button
              type="button"
              disabled={koreksiPending}
              onClick={() => kirim(k.id)}
              className="flex w-full items-start gap-2 rounded-md border border-line bg-surface px-2.5 py-2 text-start text-[13px] hover:border-brand disabled:opacity-60"
            >
              <Check aria-hidden className="mt-0.5 size-3.5 shrink-0 text-brand" />
              <span className="min-w-0 flex-1">
                <span className="tabular text-ink-muted">[{k.kode}]</span> {k.uraian}{" "}
                <span className="text-ink-muted">({k.satuan})</span>
                {!k.punyaKomponen ? <span className="text-warning"> · tanpa koefisien</span> : null}
                {k.perluVerifikasi ? <span className="text-warning"> · perlu verifikasi</span> : null}
              </span>
              {k.skor != null ? (
                <span className="tabular shrink-0 text-ink-muted">{formatPct(k.skor * 100, 0)}</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-2 border-t border-line pt-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={koreksiPending}
          onClick={() => kirim("")}
        >
          <X aria-hidden className="size-3.5" />
          Tidak ada analisa AHSP yang cocok untuk pekerjaan ini
        </Button>
      </div>
    </div>
  );
}

/** Lencana keadaan — dipakai ringkasan di luar grid. */
export function LencanaKeadaan({ b }: { b: BarisUraianRow }) {
  const teks = keadaanTeks(b);
  if (b.keadaan === "putus" || b.keadaan === "belum") return <Badge tone="danger">{teks}</Badge>;
  if (b.keadaan === "tidak_ada") return <Badge tone="neutral">{teks}</Badge>;
  if (b.keadaan === "koreksi" || b.keadaan === "disetujui")
    return <Badge tone="success">{teks}</Badge>;
  return <Badge tone={b.meyakinkan ? "info" : "warning"}>{teks}</Badge>;
}
