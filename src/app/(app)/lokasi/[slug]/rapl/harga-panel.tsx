"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  CellClassParams,
  CellValueChangedEvent,
  ColDef,
  ValueFormatterParams,
} from "ag-grid-community";
import { Check, Sparkles, X } from "lucide-react";
import { Banner, Button } from "@/components/ui";
import { MarlinGrid, rupiahCol } from "@/components/grid/marlin-grid";
import { cn } from "@/lib/cn";
import { formatNumber, formatPct, formatRupiah, formatRupiahShort } from "@/lib/format";
import {
  mintaUsulanHargaAiAction,
  simpanHargaSel,
  terapkanUsulanHargaAiAction,
  tolakUsulanHargaAiAction,
} from "@/lib/ahsp/hsd-actions";

/**
 * Pengisian HARGA SATUAN DASAR memakai MarlinGrid (DECISIONS 328), dengan draf
 * AI yang TERSIMPAN DI SERVER (DECISIONS 473).
 *
 * Yang berubah dari versi pertama, dan alasannya:
 *
 * - **Draf tidak lagi tinggal di `useState`** (RAPL-02). Subtab RAPL berbasis
 *   URL, jadi menekan "Ringkasan" membongkar komponen ini dan menghapus hasil
 *   yang baru ditunggu semenit lebih. Orang lalu menyetujui tanpa memeriksa,
 *   karena memeriksa berarti kehilangan.
 * - **Layar menunggu, bukan request** (RAPL-01). Permintaan hanya mencatat;
 *   halaman menarik ulang dirinya sampai drafnya muncul.
 * - **Grid menyaring ke baris yang PUNYA usulan** begitu drafnya datang
 *   (RAPL-04) — sebelumnya usulan dijatuhkan ke kolom yang harus dicari
 *   sendiri di antara ratusan baris.
 * - **Terima/tolak per baris** (RAPL-05). Persetujuan yang tidak bisa sebagian
 *   bukan persetujuan.
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
  /** Nilai RAB yang tertahan oleh sumber daya ini — pengurut, bukan uang. */
  nilaiTertahan: string;
  /** Harga sumber daya yang sama di lokasi lain — bahan pertimbangan. */
  rekomendasi: { harga: string; lokasi: string; kabupaten: string; seKabupaten: boolean }[];
};

export type UsulanDrafRow = {
  id: string;
  kategori: string;
  nama: string;
  satuan: string;
  harga: string;
  keyakinan: string;
  alasan: string;
};

export type KeadaanUsulanView = {
  menunggu: boolean;
  terputus: boolean;
  pendingSinceMs: number | null;
  model: string | null;
  error: string | null;
  diminta: number;
  totalKosong: number;
  draf: UsulanDrafRow[];
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
  usulanId: string | null;
  usulanAiNum: number | null;
  keyakinanAi: string;
  alasanAi: string;
};

const kunci = (r: { kategori: string; nama: string; satuan: string }) =>
  JSON.stringify([r.kategori, r.nama, r.satuan.trim().toLowerCase()]);

export function HargaPanel({
  locationId,
  slug,
  rows,
  canInput,
  canUseAi,
  usulan,
}: {
  locationId: string;
  slug: string;
  rows: BarisHargaRow[];
  canInput: boolean;
  canUseAi: boolean;
  usulan: KeadaanUsulanView;
}) {
  const router = useRouter();
  const [pesan, setPesan] = useState<{ tone: "success" | "error"; teks: string } | null>(null);
  const [, mulaiSimpan] = useTransition();
  const [aiPending, mulaiAi] = useTransition();
  const [putusanPending, mulaiPutusan] = useTransition();
  const [dicentang, setDicentang] = useState<Baris[]>([]);
  const [hanyaUsulan, setHanyaUsulan] = useState(true);
  const [detik, setDetik] = useState(0);

  /*
   * Menunggu di layar, bukan di dalam request (pola DECISIONS 455).
   * `router.refresh()` menarik ulang server component, jadi draf muncul begitu
   * tertulis tanpa endpoint status tersendiri. Detiknya dihitung dari
   * `pendingSinceMs` supaya tetap benar bila halaman ditinggal lalu dibuka lagi.
   */
  useEffect(() => {
    if (!usulan.menunggu || usulan.pendingSinceMs == null) return;
    const pending = usulan.pendingSinceMs;
    const hitung = () => setDetik(Math.max(0, Math.round((Date.now() - pending) / 1000)));
    hitung();
    const jam = setInterval(hitung, 1000);
    const tarik = setInterval(() => router.refresh(), 3000);
    return () => {
      clearInterval(jam);
      clearInterval(tarik);
    };
  }, [usulan.menunggu, usulan.pendingSinceMs, router]);

  const drafPerKunci = useMemo(
    () => new Map(usulan.draf.map((u) => [kunci(u), u])),
    [usulan.draf],
  );

  const baris: Baris[] = useMemo(
    () =>
      rows.map((r) => {
        const d = drafPerKunci.get(kunci(r));
        return {
          ...r,
          hargaNum: r.harga === null ? null : Number(r.harga),
          biayaNum: r.biaya === null ? null : Number(r.biaya),
          rekomendasiTeks: r.rekomendasi
            .map((k) => `${formatRupiahShort(BigInt(k.harga))} · ${k.lokasi}${k.seKabupaten ? " (sekab.)" : ""}`)
            .join("  |  "),
          usulanId: d?.id ?? null,
          usulanAiNum: d ? Number(d.harga) : null,
          keyakinanAi: d ? `Keyakinan ${d.keyakinan}` : "",
          alasanAi: d?.alasan ?? "",
        };
      }),
    [rows, drafPerKunci],
  );

  const adaDraf = usulan.draf.length > 0;
  /*
   * Saringan bawaan mengikuti pekerjaan yang sedang berjalan: begitu draf
   * datang, yang perlu dilihat orang adalah 25 baris itu — bukan 300 baris
   * tempat 25 itu bersembunyi.
   */
  const tampil = useMemo(
    () => (adaDraf && hanyaUsulan ? baris.filter((b) => b.usulanId !== null) : baris),
    [adaDraf, hanyaUsulan, baris],
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
      {
        field: "alasanAi",
        headerName: "Dasar usulan AI",
        flex: 1,
        minWidth: 240,
        cellClass: "text-ink-muted",
        tooltipField: "alasanAi",
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
    ],
    [canInput],
  );

  const belum = rows.filter((r) => r.harga === null).length;
  const centangBerdraf = dicentang.filter((d) => d.usulanId !== null);
  const centangKosong = dicentang.filter((d) => d.harga === null);

  const putuskan = (
    ids: string[],
    aksi: typeof terapkanUsulanHargaAiAction | typeof tolakUsulanHargaAiAction,
  ) => {
    setPesan(null);
    mulaiPutusan(async () => {
      const hasil = await aksi({ locationId, slug, ids });
      if (!hasil.ok) {
        setPesan({ tone: "error", teks: hasil.error });
        return;
      }
      setDicentang([]);
      setPesan({
        tone: "success",
        teks:
          "tersimpan" in hasil
            ? `${hasil.tersimpan.length} usulan diterima dan masuk kalkulasi RAPL${hasil.dilewat > 0 ? ` – ${hasil.dilewat} dilewati karena sudah berharga` : ""}.`
            : `${hasil.ditolak} usulan ditolak dan tidak akan ditawarkan lagi.`,
      });
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      {pesan ? <Banner tone={pesan.tone} title={pesan.teks} /> : null}

      {usulan.menunggu ? (
        <Banner
          tone="info"
          title={`Draf harga sedang disusun – ${detik} detik`}
          description="Permintaannya sudah tercatat, jadi halaman ini boleh ditinggal. Hasilnya muncul di sini sendiri saat siap, dan tetap ada saat kamu kembali."
        />
      ) : null}

      {usulan.terputus ? (
        <Banner
          tone="warning"
          title="Permintaan draf harga sebelumnya tidak selesai"
          description="Prosesnya berhenti sebelum menjawab – bisa karena aplikasi di-deploy ulang. Silakan minta lagi."
        />
      ) : null}

      {!usulan.menunggu && usulan.error ? (
        <Banner tone="error" title="Permintaan draf harga gagal" description={usulan.error} />
      ) : null}

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
            disabled={usulan.menunggu}
            onClick={() => {
              setPesan(null);
              const dipilih = centangKosong.map((d) => kunci(d));
              mulaiAi(async () => {
                const hasil = await mintaUsulanHargaAiAction({ locationId, slug, dipilih });
                if (!hasil.ok) {
                  setPesan({ tone: "error", teks: hasil.error });
                  return;
                }
                setDicentang([]);
                setPesan({
                  tone: "success",
                  teks: `Permintaan ${hasil.diminta} draf harga tercatat${
                    hasil.totalKosong > hasil.diminta
                      ? ` – ${hasil.totalKosong - hasil.diminta} sumber daya lain belum ikut dimintakan`
                      : ""
                  }.`,
                });
                router.refresh();
              });
            }}
          >
            <Sparkles aria-hidden className="size-3.5" />
            {centangKosong.length > 0
              ? `Minta estimasi AI (${centangKosong.length} dicentang)`
              : "Minta estimasi AI"}
          </Button>
        ) : null}

        {canInput && adaDraf ? (
          <>
            <Button
              type="button"
              size="sm"
              loading={putusanPending}
              disabled={centangBerdraf.length === 0}
              onClick={() =>
                putuskan(
                  centangBerdraf.map((d) => d.usulanId as string),
                  terapkanUsulanHargaAiAction,
                )
              }
            >
              <Check aria-hidden className="size-3.5" />
              Pakai {centangBerdraf.length} yang dicentang
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={putusanPending}
              disabled={centangBerdraf.length === 0}
              onClick={() =>
                putuskan(
                  centangBerdraf.map((d) => d.usulanId as string),
                  tolakUsulanHargaAiAction,
                )
              }
            >
              <X aria-hidden className="size-3.5" />
              Tolak {centangBerdraf.length}
            </Button>
          </>
        ) : null}
      </div>

      {adaDraf ? (
        <Banner
          tone="warning"
          title={`${usulan.draf.length} draf ${usulan.model ?? "AI"} menunggu keputusanmu – belum tersimpan`}
          description={
            `Periksa kolom Usulan AI, Keyakinan, dan Dasar usulan, lalu centang yang kamu setujui. ` +
            `Angka ini bukan survei pasar atau penawaran pemasok. ` +
            (usulan.totalKosong > usulan.diminta
              ? `Permintaan lalu mencakup ${usulan.diminta} dari ${usulan.totalKosong} sumber daya yang belum berharga – yang menahan nilai RAB terbesar didahulukan.`
              : "")
          }
        />
      ) : null}

      {adaDraf ? (
        <label className="flex items-center gap-2 text-[13px] text-ink">
          <input
            type="checkbox"
            checked={hanyaUsulan}
            onChange={(e) => setHanyaUsulan(e.target.checked)}
            className="size-3.5"
          />
          Tampilkan hanya baris yang ada usulannya ({usulan.draf.length})
        </label>
      ) : null}

      <MarlinGrid<Baris>
        rowData={tampil}
        columnDefs={kolom}
        quickFilter
        csvExport
        pageSize={50}
        height="60vh"
        persistKey="rapl-harga"
        editMode={canInput}
        rowSelection={canInput ? "multi" : undefined}
        onSelectionChanged={canInput ? setDicentang : undefined}
        isRowSelectable={(d: Baris) => (adaDraf ? d.usulanId !== null : d.harga === null)}
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
            });
            if (!hasil.ok) {
              setPesan({ tone: "error", teks: hasil.error });
              return;
            }
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
        {belum} dari {rows.length} sumber daya belum berharga. Kolom &ldquo;Harga di lokasi
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
