"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { AlertTriangle, Check, RefreshCw, Search, X } from "lucide-react";
import { Badge, Banner, Button, Input } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatPct, formatRupiah } from "@/lib/format";
import {
  cariPadananAction,
  koreksiPadananAction,
  petakanRabAction,
  type PadananActionState,
} from "@/lib/ahsp/padanan-actions";

/**
 * Daftar item RAB + padanan AHSP-nya, dengan jalur koreksi per baris.
 *
 * Yang sengaja TIDAK dilakukan di sini: menyembunyikan baris yang belum
 * terpetakan. Justru itu yang paling perlu terlihat — dan saringan bawaannya
 * membuka pada "perlu dikerjakan", bukan pada semua baris.
 */

export type KeadaanPadanan = "belum" | "otomatis" | "koreksi" | "tidak_ada";

export type BarisPadananRow = {
  lineageKey: string;
  code: string;
  uraian: string;
  unit: string | null;
  volume: number | null;
  /** BigInt diserialisasi — batas server/client tidak menerima BigInt. */
  amount: string;
  tanda: string;
  ahspKode: string | null;
  ahspUraian: string | null;
  ahspSatuan: string | null;
  ahspTanpaKomponen: boolean;
  ahspPerluVerifikasi: boolean;
  keadaan: KeadaanPadanan;
  skor: number | null;
  meyakinkan: boolean;
  catatan: string | null;
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
  { key: "kerja", label: "Perlu dikerjakan" },
  { key: "belum", label: "Belum ada padanan" },
  { key: "periksa", label: "Perlu diperiksa" },
  { key: "beres", label: "Sudah pasti" },
  { key: "semua", label: "Semua" },
] as const;
type SaringKey = (typeof SARING)[number]["key"];

function lolosSaring(b: BarisPadananRow, s: SaringKey): boolean {
  const pasti = b.keadaan === "koreksi" || b.keadaan === "tidak_ada" || b.meyakinkan;
  switch (s) {
    case "belum":
      return b.keadaan === "belum";
    case "periksa":
      return b.keadaan === "otomatis" && !b.meyakinkan;
    case "beres":
      return pasti;
    case "kerja":
      return !pasti;
    default:
      return true;
  }
}

function LencanaKeadaan({ b }: { b: BarisPadananRow }) {
  if (b.keadaan === "belum") return <Badge tone="danger">Belum ada padanan</Badge>;
  if (b.keadaan === "tidak_ada") return <Badge tone="neutral">Dinyatakan tidak ada</Badge>;
  if (b.keadaan === "koreksi") return <Badge tone="success">Dikoreksi manusia</Badge>;
  return b.meyakinkan ? (
    <Badge tone="info">Otomatis {b.skor != null ? formatPct(b.skor * 100, 0) : ""}</Badge>
  ) : (
    <Badge tone="warning">
      Perlu diperiksa {b.skor != null ? formatPct(b.skor * 100, 0) : ""}
    </Badge>
  );
}

export function PadananPanel({
  locationId,
  slug,
  rows,
  canManage,
  basisAda,
}: {
  locationId: string;
  slug: string;
  rows: BarisPadananRow[];
  canManage: boolean;
  basisAda: boolean;
}) {
  const [saring, setSaring] = useState<SaringKey>("kerja");
  const [cari, setCari] = useState("");
  const [terbuka, setTerbuka] = useState<string | null>(null);

  const [petaState, petaAction, petaPending] = useActionState<PadananActionState, FormData>(
    petakanRabAction,
    undefined,
  );
  const [koreksiState, koreksiAction, koreksiPending] = useActionState<PadananActionState, FormData>(
    koreksiPadananAction,
    undefined,
  );

  const hitung = useMemo(() => {
    const h: Record<SaringKey, number> = { kerja: 0, belum: 0, periksa: 0, beres: 0, semua: rows.length };
    for (const b of rows) for (const s of SARING) if (s.key !== "semua" && lolosSaring(b, s.key)) h[s.key] += 1;
    return h;
  }, [rows]);

  const tampil = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return rows.filter(
      (b) =>
        lolosSaring(b, saring) &&
        (q === "" ||
          b.uraian.toLowerCase().includes(q) ||
          b.code.toLowerCase().includes(q) ||
          (b.ahspUraian ?? "").toLowerCase().includes(q)),
    );
  }, [rows, saring, cari]);

  return (
    <div className="space-y-3">
      {petaState?.error ? <Banner tone="error" title={petaState.error} /> : null}
      {petaState?.success ? <Banner tone="success" title={petaState.success} /> : null}
      {koreksiState?.error ? <Banner tone="error" title={koreksiState.error} /> : null}
      {koreksiState?.success ? <Banner tone="success" title={koreksiState.success} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        {SARING.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSaring(s.key)}
            className={cn(
              "rounded-full border px-3 py-1 text-[13px] transition",
              saring === s.key
                ? "border-brand bg-brand-soft font-medium text-brand"
                : "border-line text-ink-muted hover:bg-surface-inset",
            )}
          >
            {s.label} <span className="tabular">({hitung[s.key]})</span>
          </button>
        ))}
        <div className="ms-auto flex items-center gap-2">
          <Input
            value={cari}
            onChange={(e) => setCari(e.target.value)}
            placeholder="Cari uraian / kode…"
            className="w-56"
          />
          {canManage ? (
            <form action={petaAction}>
              <input type="hidden" name="locationId" value={locationId} />
              <input type="hidden" name="slug" value={slug} />
              <Button type="submit" variant="secondary" size="sm" loading={petaPending} disabled={!basisAda}>
                <RefreshCw aria-hidden className="size-3.5" />
                Petakan otomatis
              </Button>
            </form>
          ) : null}
        </div>
      </div>

      {tampil.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-muted">
          Tidak ada baris pada saringan ini.
        </p>
      ) : (
        <div className="divide-y divide-line rounded-lg border border-line">
          {tampil.map((b) => (
            <BarisPadanan
              key={b.lineageKey}
              b={b}
              locationId={locationId}
              slug={slug}
              canManage={canManage}
              terbuka={terbuka === b.lineageKey}
              onToggle={() => setTerbuka(terbuka === b.lineageKey ? null : b.lineageKey)}
              koreksiAction={koreksiAction}
              koreksiPending={koreksiPending}
            />
          ))}
        </div>
      )}

      {tampil.length > 0 ? (
        <p className="text-[12px] text-ink-muted">
          Menampilkan {tampil.length} dari {rows.length} baris RAB.
        </p>
      ) : null}
    </div>
  );
}

function BarisPadanan({
  b,
  locationId,
  slug,
  canManage,
  terbuka,
  onToggle,
  koreksiAction,
  koreksiPending,
}: {
  b: BarisPadananRow;
  locationId: string;
  slug: string;
  canManage: boolean;
  terbuka: boolean;
  onToggle: () => void;
  koreksiAction: (formData: FormData) => void;
  koreksiPending: boolean;
}) {
  const [kandidat, setKandidat] = useState<Kandidat[] | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [memuat, mulai] = useTransition();

  /*
   * Usulan mesin diambil saat baris DIBUKA — di penangan klik, bukan di effect.
   * Menghitung 5.550 kandidat untuk ribuan baris sekaligus tidak ada gunanya
   * kalau yang dibuka cuma satu, dan React memang menyuruh memicu pengambilan
   * data dari peristiwa yang menyebabkannya.
   */
  const ambil = (q: string) => {
    setGalat(null);
    mulai(async () => {
      try {
        setKandidat(
          await cariPadananAction({ locationId, uraian: b.uraian, satuan: b.unit, kueri: q }),
        );
      } catch (e) {
        setGalat(e instanceof Error ? e.message : "Gagal mengambil kandidat.");
      }
    });
  };

  const buka = () => {
    if (!terbuka && canManage && kandidat === null) ambil("");
    onToggle();
  };

  return (
    <div className="px-3 py-2.5">
      <button
        type="button"
        onClick={buka}
        className="flex w-full items-start gap-3 text-start"
        aria-expanded={terbuka}
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">
            <span className="tabular text-ink-muted">{b.code}</span> {b.uraian}
          </p>
          <p className="mt-0.5 text-[12px] text-ink-muted">
            {b.volume != null ? `${b.volume.toLocaleString("id-ID")} ${b.unit ?? ""} · ` : ""}
            {formatRupiah(BigInt(b.amount))}
          </p>
          {b.ahspUraian ? (
            <p className="mt-1 text-[13px] text-ink">
              → <span className="tabular text-ink-muted">[{b.ahspKode}]</span> {b.ahspUraian}{" "}
              <span className="text-ink-muted">({b.ahspSatuan})</span>
            </p>
          ) : null}
          {b.ahspTanpaKomponen ? (
            <p className="mt-0.5 flex items-center gap-1 text-[12px] text-warning">
              <AlertTriangle aria-hidden className="size-3.5" />
              Analisa ini belum punya koefisien terstruktur — tidak bisa dipakai menghitung
              kebutuhan bahan.
            </p>
          ) : null}
          {b.ahspPerluVerifikasi ? (
            <p className="mt-0.5 text-[12px] text-warning">
              Analisa dari daftar tambahan — menurut sumbernya perlu diverifikasi dulu.
            </p>
          ) : null}
        </div>
        <div className="shrink-0">
          <LencanaKeadaan b={b} />
        </div>
      </button>

      {terbuka && canManage ? (
        <PemilihPadanan
          b={b}
          locationId={locationId}
          slug={slug}
          kandidat={kandidat}
          memuat={memuat}
          galat={galat}
          ambil={ambil}
          koreksiAction={koreksiAction}
          koreksiPending={koreksiPending}
        />
      ) : null}
      {terbuka && !canManage ? (
        <p className="mt-2 text-[13px] text-ink-muted">
          {b.catatan ?? "Belum ada catatan pemetaan."} Mengubah padanan butuh hak kelola RAB.
        </p>
      ) : null}
    </div>
  );
}

function PemilihPadanan({
  b,
  locationId,
  slug,
  kandidat,
  memuat,
  galat,
  ambil,
  koreksiAction,
  koreksiPending,
}: {
  b: BarisPadananRow;
  locationId: string;
  slug: string;
  kandidat: Kandidat[] | null;
  memuat: boolean;
  galat: string | null;
  ambil: (kueri: string) => void;
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
  };

  return (
    <div className="mt-3 rounded-lg border border-line bg-surface-inset p-3">
      {b.catatan ? <p className="mb-2 text-[12px] text-ink-muted">{b.catatan}</p> : null}

      <div className="mb-2 flex items-center gap-2">
        <Input
          value={kueri}
          onChange={(e) => setKueri(e.target.value)}
          placeholder="Cari analisa AHSP lain (min. 3 huruf)…"
          className="flex-1"
        />
        <Button type="button" variant="secondary" size="sm" loading={memuat} onClick={() => ambil(kueri)}>
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
                {!k.punyaKomponen ? (
                  <span className="text-warning"> · tanpa koefisien terstruktur</span>
                ) : null}
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
