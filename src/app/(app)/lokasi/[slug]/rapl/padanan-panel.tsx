"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { AlertTriangle, Check, CheckCheck, ChevronRight, RefreshCw, Search, X } from "lucide-react";
import { Badge, Banner, Button, Input } from "@/components/ui";
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
 * Daftar PEMETAAN, satu baris per URAIAN (DECISIONS 326).
 *
 * Versi sebelumnya menampilkan satu baris per baris RAB: 1.616 baris untuk 480
 * keputusan, dengan uraian yang sama berulang-ulang. Keputusannya memang per
 * uraian — dan karena kunci padanan global, satu keputusan bahkan berlaku di
 * lokasi lain. Yang hilang saat digabung (berapa baris & berapa rupiah yang
 * bergantung padanya) dikembalikan sebagai kolom, dan dipakai mengurutkan.
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

function LencanaKeadaan({ b }: { b: BarisUraianRow }) {
  if (b.keadaan === "putus") return <Badge tone="danger">Tautan putus</Badge>;
  if (b.keadaan === "belum") return <Badge tone="danger">Belum ada padanan</Badge>;
  if (b.keadaan === "tidak_ada") return <Badge tone="neutral">Dinyatakan tidak ada</Badge>;
  if (b.keadaan === "koreksi") return <Badge tone="success">Dikoreksi</Badge>;
  if (b.keadaan === "disetujui") {
    // Skor tetap ditampilkan setelah disetujui: "sudah disetujui" tidak boleh
    // menghapus jejak bahwa yang disetujui itu tebakan 45% yang beda tipis.
    return (
      <Badge tone="success">Disetujui {b.skor != null ? formatPct(b.skor * 100, 0) : ""}</Badge>
    );
  }
  return b.meyakinkan ? (
    <Badge tone="info">Usulan {b.skor != null ? formatPct(b.skor * 100, 0) : ""}</Badge>
  ) : (
    <Badge tone="warning">
      Beda tipis {b.skor != null ? formatPct(b.skor * 100, 0) : ""}
    </Badge>
  );
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
  const [cari, setCari] = useState("");
  const [terbuka, setTerbuka] = useState<string | null>(null);
  const [pilih, setPilih] = useState<Set<string>>(new Set());

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

  const tampil = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return rows.filter(
      (b) =>
        lolosSaring(b, saring) &&
        (q === "" ||
          b.uraian.toLowerCase().includes(q) ||
          b.kodeContoh.toLowerCase().includes(q) ||
          (b.ahspUraian ?? "").toLowerCase().includes(q)),
    );
  }, [rows, saring, cari]);

  const tandaTampil = useMemo(
    () => tampil.filter((b) => b.keadaan === "usulan").map((b) => b.tanda),
    [tampil],
  );
  const terpilih = tandaTampil.filter((t) => pilih.has(t));
  const nilaiTerpilih = tampil
    .filter((b) => pilih.has(b.tanda) && b.keadaan === "usulan")
    .reduce((a, b) => a + BigInt(b.nilai), 0n);

  const kirimSetuju = (daftar: string[]) => {
    if (daftar.length === 0) return;
    const fd = new FormData();
    fd.set("locationId", locationId);
    fd.set("slug", slug);
    fd.set("tanda", JSON.stringify(daftar));
    setujuAction(fd);
    setPilih(new Set());
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
            onClick={() => setSaring(s.key)}
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
        <div className="ms-auto flex items-center gap-2">
          <Input
            value={cari}
            onChange={(e) => setCari(e.target.value)}
            placeholder="Cari uraian…"
            className="w-52"
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

      {canManage && tandaTampil.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface-inset px-3 py-2">
          <label className="flex items-center gap-2 text-[13px] text-ink">
            <input
              type="checkbox"
              className="size-4 accent-[var(--brand)]"
              checked={terpilih.length === tandaTampil.length}
              onChange={(e) => setPilih(e.target.checked ? new Set(tandaTampil) : new Set())}
            />
            Pilih semua yang tampil ({tandaTampil.length})
          </label>
          <Button
            type="button"
            size="sm"
            className="ms-auto"
            loading={setujuPending}
            disabled={terpilih.length === 0}
            onClick={() => kirimSetuju(terpilih)}
          >
            <CheckCheck aria-hidden className="size-3.5" />
            Setujui {terpilih.length} uraian
            {terpilih.length > 0 ? ` · ${formatRupiahShort(nilaiTerpilih)}` : ""}
          </Button>
        </div>
      ) : null}

      {tampil.length === 0 ? (
        <p className="py-10 text-center text-sm text-ink-muted">
          Tidak ada uraian pada saringan ini.
        </p>
      ) : (
        <div className="divide-y divide-line rounded-lg border border-line">
          {tampil.map((b) => (
            <BarisUraianItem
              key={b.tanda}
              b={b}
              locationId={locationId}
              slug={slug}
              canManage={canManage}
              dipilih={pilih.has(b.tanda)}
              onPilih={() =>
                setPilih((lama) => {
                  const baru = new Set(lama);
                  if (baru.has(b.tanda)) baru.delete(b.tanda);
                  else baru.add(b.tanda);
                  return baru;
                })
              }
              terbuka={terbuka === b.tanda}
              onToggle={() => setTerbuka(terbuka === b.tanda ? null : b.tanda)}
              koreksiAction={koreksiAction}
              koreksiPending={koreksiPending}
            />
          ))}
        </div>
      )}

      {tampil.length > 0 ? (
        <p className="text-[12px] text-ink-muted">
          {tampil.length} dari {rows.length} uraian · diurut dari nilai terbesar.
        </p>
      ) : null}
    </div>
  );
}

function BarisUraianItem({
  b,
  locationId,
  slug,
  canManage,
  dipilih,
  onPilih,
  terbuka,
  onToggle,
  koreksiAction,
  koreksiPending,
}: {
  b: BarisUraianRow;
  locationId: string;
  slug: string;
  canManage: boolean;
  dipilih: boolean;
  onPilih: () => void;
  terbuka: boolean;
  onToggle: () => void;
  koreksiAction: (formData: FormData) => void;
  koreksiPending: boolean;
}) {
  const [kandidat, setKandidat] = useState<Kandidat[] | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [memuat, mulai] = useTransition();

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
    <div className="flex items-start gap-2.5 px-3 py-2.5">
      {canManage && b.keadaan === "usulan" ? (
        <input
          type="checkbox"
          className="mt-1 size-4 shrink-0 accent-[var(--brand)]"
          checked={dipilih}
          onChange={onPilih}
          aria-label={`Pilih ${b.uraian}`}
        />
      ) : (
        <span className="mt-1 size-4 shrink-0" />
      )}

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={buka}
          className="flex w-full items-start gap-3 text-start"
          aria-expanded={terbuka}
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink">{b.uraian}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-ink-muted">
              <span className="tabular font-medium text-ink">{formatRupiah(BigInt(b.nilai))}</span>
              <span>·</span>
              <span>
                {b.jumlahBaris} baris RAB
                {b.volume != null ? ` · ${b.volume.toLocaleString("id-ID")} ${b.unit ?? ""}` : ""}
              </span>
            </p>
            {b.ahspUraian ? (
              <p className="mt-1 text-[13px] text-ink">
                <ChevronRight aria-hidden className="inline size-3 text-ink-muted" />{" "}
                <span className="tabular text-ink-muted">[{b.ahspKode}]</span> {b.ahspUraian}
              </p>
            ) : null}
            {b.petunjuk ? (
              <p className="mt-0.5 text-[12px] text-ink-muted">{b.petunjuk}</p>
            ) : null}
            {b.ahspTanpaKomponen ? (
              <p className="mt-0.5 flex items-center gap-1 text-[12px] text-warning">
                <AlertTriangle aria-hidden className="size-3.5" />
                Analisa ini belum punya koefisien — tidak bisa dipakai menghitung kebutuhan.
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
  b: BarisUraianRow;
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
      <p className="mb-2 text-[12px] text-ink-muted">
        Keputusan ini berlaku untuk <strong>{b.jumlahBaris} baris RAB</strong> di lokasi ini, dan
        untuk semua lokasi lain yang uraiannya persis sama.
        {b.catatan ? ` ${b.catatan}` : ""}
      </p>

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
        <Button type="button" variant="ghost" size="sm" disabled={koreksiPending} onClick={() => kirim("")}>
          <X aria-hidden className="size-3.5" />
          Tidak ada analisa AHSP yang cocok untuk pekerjaan ini
        </Button>
      </div>
    </div>
  );
}
