"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CellClassParams, ColDef, ValueFormatterParams } from "ag-grid-community";
import { Plus, Trash2 } from "lucide-react";
import {
  Badge,
  Banner,
  Button,
  Combobox,
  Input,
  Label,
  PanelGeser,
} from "@/components/ui";
import { MarlinGrid, rupiahCol } from "@/components/grid/marlin-grid";
import { cn } from "@/lib/cn";
import { formatNumber, formatPct, formatRupiah } from "@/lib/format";
import {
  hapusKomponenAction,
  setBoronganAction,
  setFaktorKonversiAction,
  tambahKomponenAction,
} from "@/lib/ahsp/rincian-actions";

/**
 * RINCIAN PER ITEM RAB (RAPL-08, DECISIONS 470).
 *
 * Inilah bentuk yang sebenarnya dipakai orang saat menawar: bukan "berapa
 * total semen se-lokasi", melainkan ITEM MANA YANG RUGI. Sebelum ini
 * pertanyaan itu tidak bisa dijawab sama sekali — komponen tiap item dilebur
 * ke satu peta global dan identitas itemnya hilang di sana.
 *
 * AHSP tetap jalur tercepat: ia MENGISI rincian, tidak menggerbanginya.
 * Koefisiennya sendiri terkunci (keputusan user 2026-08-29); yang bisa
 * dilakukan orang ada tiga — menyatakan faktor konversi satuan, menambah
 * komponen yang tidak ada di analisa, atau menyatakan item ini diborongkan.
 */

export type KomponenItemRow = {
  kategori: string;
  nama: string;
  satuan: string;
  jumlah: number;
  dariAhsp: boolean;
  harga: string | null;
  biaya: string | null;
};

export type ItemRaplRow = {
  lineageKey: string;
  code: string;
  uraian: string;
  satuan: string;
  volume: number | null;
  nilaiRab: string;
  cara: string;
  komponen: KomponenItemRow[];
  biaya: string;
  komponenBelumBerharga: number;
  lengkap: boolean;
  margin: string | null;
  marginPersen: number | null;
  alasanLewat: string | null;
  rinciLewat: string | null;
  faktorKonversi: number | null;
  catatanKonversi: string | null;
  hargaBorongan: string | null;
};

const LABEL_CARA: Record<string, string> = {
  ahsp: "Dari AHSP",
  manual: "Dirinci tangan",
  campuran: "AHSP + tambahan",
  borongan: "Borongan",
  belum: "Belum bisa dihitung",
};

const LABEL_ALASAN: Record<string, string> = {
  belum_disetujui: "Padanan AHSP belum disetujui",
  satuan_tidak_sepadan: "Satuan item ≠ satuan analisa",
  tanpa_koefisien: "Analisa belum punya koefisien",
  volume_kosong: "Item RAB tidak punya volume",
};

const KATEGORI = [
  { value: "bahan", label: "Bahan" },
  { value: "upah", label: "Upah" },
  { value: "alat", label: "Alat" },
  { value: "fasilitas", label: "Fasilitas" },
];

type Baris = ItemRaplRow & {
  nilaiRabNum: number;
  biayaNum: number | null;
  marginNum: number | null;
  caraLabel: string;
  keteranganl: string;
};

export function RincianPanel({
  locationId,
  slug,
  items,
  canInput,
  ringkas,
}: {
  locationId: string;
  slug: string;
  items: ItemRaplRow[];
  canInput: boolean;
  ringkas: { biayaLengkap: string; nilaiRabLengkap: string; jumlahLengkap: number; jumlahRugi: number };
}) {
  const router = useRouter();
  const [dibuka, setDibuka] = useState<ItemRaplRow | null>(null);
  const [pesan, setPesan] = useState<{ tone: "success" | "error"; teks: string } | null>(null);
  const [pending, mulai] = useTransition();

  const baris: Baris[] = useMemo(
    () =>
      items.map((i) => ({
        ...i,
        nilaiRabNum: Number(i.nilaiRab),
        biayaNum: i.cara === "belum" ? null : Number(i.biaya),
        marginNum: i.margin === null ? null : Number(i.margin),
        caraLabel: LABEL_CARA[i.cara] ?? i.cara,
        keteranganl:
          i.alasanLewat !== null
            ? (LABEL_ALASAN[i.alasanLewat] ?? i.alasanLewat)
            : i.lengkap
              ? ""
              : `${i.komponenBelumBerharga} komponen belum berharga`,
      })),
    [items],
  );

  const kolom: ColDef<Baris>[] = useMemo(
    () => [
      { field: "code", headerName: "Kode", width: 110, filter: true },
      { field: "uraian", headerName: "Uraian pekerjaan", flex: 2, minWidth: 280, filter: true },
      { field: "satuan", headerName: "Satuan", width: 90 },
      {
        field: "volume",
        headerName: "Volume",
        width: 120,
        type: "numericColumn",
        valueFormatter: (p: ValueFormatterParams<Baris>) =>
          p.value == null ? "" : formatNumber(Number(p.value)),
        cellClass: "tabular text-right",
      },
      { ...rupiahCol<Baris>("nilaiRabNum", "Nilai RAB"), width: 160 },
      { field: "caraLabel", headerName: "Cara hitung", width: 150, filter: true },
      { ...rupiahCol<Baris>("biayaNum", "Biaya pelaksanaan"), width: 170 },
      {
        ...rupiahCol<Baris>("marginNum", "Margin"),
        width: 160,
        cellClass: (p: CellClassParams<Baris>) =>
          cn(
            "tabular text-right",
            p.data?.marginNum != null && p.data.marginNum < 0 && "text-danger font-semibold",
          ),
      },
      {
        field: "marginPersen",
        headerName: "Margin %",
        width: 110,
        type: "numericColumn",
        valueFormatter: (p: ValueFormatterParams<Baris>) =>
          p.value == null ? "" : formatPct(Number(p.value), 1),
        cellClass: "tabular text-right",
      },
      {
        field: "keteranganl",
        headerName: "Keterangan",
        flex: 1,
        minWidth: 220,
        filter: true,
        cellClass: "text-ink-muted",
      },
    ],
    [],
  );

  const jalankan = (fn: () => Promise<{ ok: boolean; error?: string }>, sukses: string) => {
    setPesan(null);
    mulai(async () => {
      const hasil = await fn();
      if (!hasil.ok) {
        setPesan({ tone: "error", teks: hasil.error ?? "Gagal." });
        return;
      }
      setPesan({ tone: "success", teks: sukses });
      setDibuka(null);
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      {pesan ? <Banner tone={pesan.tone} title={pesan.teks} /> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-line px-3 py-2">
          <p className="text-[12px] tracking-wide text-ink-muted uppercase">Item berrincian lengkap</p>
          <p className="tabular mt-0.5 text-lg font-semibold text-ink">
            {ringkas.jumlahLengkap} dari {items.length}
          </p>
          <p className="text-[12px] text-ink-muted">hanya ini yang marginnya berarti</p>
        </div>
        <div className="rounded-lg border border-line px-3 py-2">
          <p className="text-[12px] tracking-wide text-ink-muted uppercase">Biaya item lengkap</p>
          <p className="tabular mt-0.5 text-lg font-semibold text-ink">
            {formatRupiah(BigInt(ringkas.biayaLengkap))}
          </p>
          <p className="text-[12px] text-ink-muted">
            terhadap nilai RAB {formatRupiah(BigInt(ringkas.nilaiRabLengkap))}
          </p>
        </div>
        <div
          className={cn(
            "rounded-lg border px-3 py-2",
            ringkas.jumlahRugi > 0 ? "border-danger-border bg-danger-soft" : "border-line",
          )}
        >
          <p className="text-[12px] tracking-wide text-ink-muted uppercase">Item yang rugi</p>
          <p
            className={cn(
              "tabular mt-0.5 text-lg font-semibold",
              ringkas.jumlahRugi > 0 ? "text-danger" : "text-ink",
            )}
          >
            {ringkas.jumlahRugi}
          </p>
          <p className="text-[12px] text-ink-muted">biayanya melampaui nilai RAB-nya</p>
        </div>
      </div>

      <MarlinGrid<Baris>
        rowData={baris}
        columnDefs={kolom}
        quickFilter
        csvExport
        pageSize={50}
        height="60vh"
        persistKey="rapl-rincian-item"
        getRowId={(d: Baris) => d.lineageKey}
        onRowClicked={(d: Baris) => setDibuka(items.find((i) => i.lineageKey === d.lineageKey) ?? null)}
        rowLink
        emptyText="Belum ada revisi RAB aktif di lokasi ini."
      />

      <PanelGeser
        terbuka={dibuka !== null}
        onTutup={() => setDibuka(null)}
        title={dibuka ? `${dibuka.code} · ${dibuka.uraian}` : ""}
        subtitle={
          dibuka
            ? `${dibuka.volume === null ? "tanpa volume" : formatNumber(dibuka.volume)} ${dibuka.satuan} · nilai RAB ${formatRupiah(BigInt(dibuka.nilaiRab))}`
            : undefined
        }
      >
        {dibuka ? (
          <div className="space-y-4">
            {dibuka.alasanLewat ? (
              <Banner
                tone="warning"
                title={LABEL_ALASAN[dibuka.alasanLewat] ?? dibuka.alasanLewat}
                description={dibuka.rinciLewat ?? undefined}
              />
            ) : null}

            <section>
              <h3 className="text-[13px] font-semibold text-ink">Komponen</h3>
              {dibuka.komponen.length === 0 ? (
                <p className="mt-1 text-[13px] text-ink-muted">
                  {dibuka.cara === "borongan"
                    ? "Item ini diborongkan – kebutuhan bahan/upah/alatnya memang tidak diketahui, dan tidak dikarang."
                    : "Belum ada komponen. Tambahkan di bawah, atau nyatakan item ini diborongkan."}
                </p>
              ) : (
                <ul className="mt-1 divide-y divide-line rounded-lg border border-line">
                  {dibuka.komponen.map((k) => (
                    <li key={`${k.kategori}|${k.nama}|${k.satuan}`} className="flex items-center gap-2 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] text-ink">
                          {k.nama}{" "}
                          <Badge tone={k.dariAhsp ? "neutral" : "info"}>
                            {k.dariAhsp ? "AHSP" : "tambahan"}
                          </Badge>
                        </p>
                        <p className="tabular text-[12px] text-ink-muted">
                          {formatNumber(k.jumlah)} {k.satuan} ·{" "}
                          {k.harga === null
                            ? "harga belum diisi"
                            : `${formatRupiah(BigInt(k.harga))} → ${formatRupiah(BigInt(k.biaya ?? "0"))}`}
                        </p>
                      </div>
                      {canInput && !k.dariAhsp ? (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          loading={pending}
                          onClick={() =>
                            jalankan(
                              () =>
                                hapusKomponenAction({
                                  locationId,
                                  slug,
                                  lineageKey: dibuka.lineageKey,
                                  kategori: k.kategori,
                                  nama: k.nama,
                                  satuan: k.satuan,
                                }),
                              `Komponen "${k.nama}" dihapus.`,
                            )
                          }
                        >
                          <Trash2 aria-hidden className="size-3.5" />
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {dibuka.komponen.some((k) => k.dariAhsp) ? (
                <p className="mt-1 text-[12px] text-ink-muted">
                  Koefisien bertanda AHSP tidak bisa diubah – ia angka resmi yang harus bisa
                  dipertahankan saat diperiksa. Yang bisa kamu lakukan: menambah komponen yang
                  belum ada.
                </p>
              ) : null}
            </section>

            {canInput ? (
              <>
                <FormTambahKomponen
                  pending={pending}
                  onKirim={(v) =>
                    jalankan(
                      () =>
                        tambahKomponenAction({
                          locationId,
                          slug,
                          lineageKey: dibuka.lineageKey,
                          ...v,
                        }),
                      `Komponen "${v.nama}" ditambahkan.`,
                    )
                  }
                />

                <FormKonversi
                  pending={pending}
                  faktor={dibuka.faktorKonversi}
                  catatan={dibuka.catatanKonversi}
                  onKirim={(faktor, catatan) =>
                    jalankan(
                      () =>
                        setFaktorKonversiAction({
                          locationId,
                          slug,
                          lineageKey: dibuka.lineageKey,
                          faktor,
                          catatan,
                        }),
                      faktor.trim() === "" ? "Faktor konversi dihapus." : "Faktor konversi disimpan.",
                    )
                  }
                />

                <FormBorongan
                  pending={pending}
                  harga={dibuka.hargaBorongan}
                  onKirim={(harga, catatan) =>
                    jalankan(
                      () =>
                        setBoronganAction({
                          locationId,
                          slug,
                          lineageKey: dibuka.lineageKey,
                          harga,
                          catatan,
                        }),
                      harga.trim() === "" ? "Borongan dibatalkan." : "Harga borongan disimpan.",
                    )
                  }
                />
              </>
            ) : null}
          </div>
        ) : null}
      </PanelGeser>
    </div>
  );
}

function FormTambahKomponen({
  pending,
  onKirim,
}: {
  pending: boolean;
  onKirim: (v: { kategori: string; nama: string; satuan: string; koefisien: string }) => void;
}) {
  const [kategori, setKategori] = useState("bahan");
  const [nama, setNama] = useState("");
  const [satuan, setSatuan] = useState("");
  const [koefisien, setKoefisien] = useState("");

  return (
    <section className="rounded-lg border border-line p-3">
      <h3 className="text-[13px] font-semibold text-ink">Tambah komponen</h3>
      <p className="mt-0.5 text-[12px] text-ink-muted">
        Koefisiennya per SATU {""}satuan item ini – bukan per satuan analisa AHSP.
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div>
          <Label htmlFor="rincian-kategori">Kategori</Label>
          <Combobox
            id="rincian-kategori"
            name="kategori"
            options={KATEGORI}
            value={kategori}
            onChange={setKategori}
          />
        </div>
        <div>
          <Label htmlFor="rincian-nama">Nama sumber daya</Label>
          <Input
            id="rincian-nama"
            value={nama}
            onChange={(e) => setNama(e.target.value)}
            placeholder="mis. Sewa truk 8 ton"
          />
        </div>
        <div>
          <Label htmlFor="rincian-satuan">Satuan</Label>
          <Input
            id="rincian-satuan"
            value={satuan}
            onChange={(e) => setSatuan(e.target.value)}
            placeholder="mis. unit, OH, kg"
          />
        </div>
        <div>
          <Label htmlFor="rincian-koef">Koefisien</Label>
          <Input
            id="rincian-koef"
            value={koefisien}
            onChange={(e) => setKoefisien(e.target.value)}
            placeholder="mis. 0,25"
            inputMode="decimal"
          />
        </div>
      </div>
      <Button
        type="button"
        size="sm"
        className="mt-2"
        loading={pending}
        disabled={nama.trim().length < 2 || satuan.trim() === "" || koefisien.trim() === ""}
        onClick={() => {
          onKirim({ kategori, nama, satuan, koefisien });
          setNama("");
          setSatuan("");
          setKoefisien("");
        }}
      >
        <Plus aria-hidden className="size-3.5" />
        Tambahkan
      </Button>
    </section>
  );
}

function FormKonversi({
  pending,
  faktor,
  catatan,
  onKirim,
}: {
  pending: boolean;
  faktor: number | null;
  catatan: string | null;
  onKirim: (faktor: string, catatan: string) => void;
}) {
  const [nilai, setNilai] = useState(faktor === null ? "" : String(faktor));
  const [alasan, setAlasan] = useState(catatan ?? "");

  return (
    <section className="rounded-lg border border-line p-3">
      <h3 className="text-[13px] font-semibold text-ink">Faktor konversi satuan</h3>
      <p className="mt-0.5 text-[12px] text-ink-muted">
        Dipakai bila satuan item berbeda dari satuan analisa (mis. item m² dinding vs analisa m³
        pasangan → 0,15 untuk tebal 15 cm). Alasannya WAJIB: angka konversi tanpa alasan tidak bisa
        dipertahankan saat diperiksa.
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div>
          <Label htmlFor="rincian-faktor">Faktor</Label>
          <Input
            id="rincian-faktor"
            value={nilai}
            onChange={(e) => setNilai(e.target.value)}
            placeholder="kosongkan untuk menghapus"
            inputMode="decimal"
          />
        </div>
        <div>
          <Label htmlFor="rincian-alasan">Alasan</Label>
          <Input
            id="rincian-alasan"
            value={alasan}
            onChange={(e) => setAlasan(e.target.value)}
            placeholder="mis. tebal dinding 15 cm"
          />
        </div>
      </div>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="mt-2"
        loading={pending}
        onClick={() => onKirim(nilai, alasan)}
      >
        Simpan faktor
      </Button>
    </section>
  );
}

function FormBorongan({
  pending,
  harga,
  onKirim,
}: {
  pending: boolean;
  harga: string | null;
  onKirim: (harga: string, catatan: string) => void;
}) {
  const [nilai, setNilai] = useState(harga ?? "");
  const [catatan, setCatatan] = useState("");

  return (
    <section className="rounded-lg border border-line p-3">
      <h3 className="text-[13px] font-semibold text-ink">Borongan</h3>
      <p className="mt-0.5 text-[12px] text-ink-muted">
        Satu harga per satuan item, tanpa rincian komponen – bentuk yang jujur untuk pekerjaan yang
        memang disubkan. Bila diisi, ia mengalahkan rincian komponen: satu item satu cara hitung.
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div>
          <Label htmlFor="rincian-borongan">Harga borongan per satuan</Label>
          <Input
            id="rincian-borongan"
            value={nilai}
            onChange={(e) => setNilai(e.target.value)}
            placeholder="kosongkan untuk membatalkan"
            inputMode="numeric"
          />
        </div>
        <div>
          <Label htmlFor="rincian-borongan-catatan">Dari mana harganya</Label>
          <Input
            id="rincian-borongan-catatan"
            value={catatan}
            onChange={(e) => setCatatan(e.target.value)}
            placeholder="mis. penawaran subkontraktor 2026-08"
          />
        </div>
      </div>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="mt-2"
        loading={pending}
        onClick={() => onKirim(nilai, catatan)}
      >
        Simpan borongan
      </Button>
    </section>
  );
}
