"use client";

import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { formatPct } from "@/lib/format";

/**
 * Isi `ScurveChart` di sisi peramban (DECISIONS 677): garis rencana &
 * realisasi seperti sebelumnya, ditambah
 * - penunjuk minggu: arahkan/ketuk di mana saja di grafik → garis vertikal,
 *   titik-titik minggu itu, dan kotak berisi angkanya (rencana, realisasi,
 *   deviasi, prognosa, dan tiap lokasi). Panah kiri/kanan untuk papan ketik.
 * - garis tipis per lokasi (khusus kurva paket), warna tetap mengikuti
 *   lokasinya; nama di keterangan bisa diklik untuk menyembunyikan garisnya.
 *
 * Komponen ini TIDAK menghitung apa pun – semua angka datang dari kurva yang
 * sudah dihitung `lib/baseline` / `progress-calc`.
 */
export type DeretLokasiKurva = {
  nama: string;
  planPct: number[];
  actualPct: (number | null)[];
};

const W = 640;
const H = 280;
const PAD_L = 40;
const PAD_R = 12;
const PAD_T = 12;
const PAD_B = 28;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;
const JUMLAH_WARNA = 8;

/** Lokasi ke-9 dst. tidak diberi warna karangan – abu-abu, tetap ada di keterangan. */
const warnaLokasi = (i: number) => (i < JUMLAH_WARNA ? `var(--color-seri-${i + 1})` : "var(--color-ink-faint)");

const tanda = (d: number) => `${d >= 0 ? "+" : "−"}${formatPct(Math.abs(d))}`;

/**
 * Letak kotak angka penunjuk, dalam px dari tepi kiri grafik. `batasKiri` /
 * `batasKanan` = irisan grafik dengan LAYAR YANG TERLIHAT, juga dalam px dari
 * tepi kiri grafik.
 *
 * Keluhan user 2026-10-18 (tangkapan layar HP): kotaknya keluar dari tepi kanan
 * layar dan menggeser seluruh halaman. Dulu sisinya dipilih dengan ambang tetap
 * 290 px, jadi di grafik HP (±330 px) minggu di tengah selalu ditaruh di kanan
 * walau ruang kanannya tinggal ±110 px. Disusul *"melebihi layar aktif,
 * peletakan kanan kiri layar yang pas perlu kamu pertimbangkan"* – batasnya
 * layar, bukan hanya grafik.
 *
 * Kini: di KIRI garis bila muat (bagian kiri-atas kurva-S hampir selalu kosong),
 * di KANAN bila muat, dan bila tidak ada yang muat kotak dijepit di dalam batas –
 * boleh menutupi garisnya, tidak boleh keluar layar.
 */
export function letakKotakPenunjuk(
  x: number,
  lebarKotak: number,
  batasKiri: number,
  batasKanan: number,
  jarak = 8,
): number {
  const muat = (posisi: number) => posisi >= batasKiri && posisi + lebarKotak <= batasKanan;
  const kiri = x - jarak - lebarKotak;
  if (muat(kiri)) return kiri;
  const kanan = x + jarak;
  if (muat(kanan)) return kanan;
  return Math.min(Math.max(batasKiri, x - lebarKotak / 2), Math.max(batasKiri, batasKanan - lebarKotak));
}

/** Jarak minimal kotak dari tepi layar. */
const TEPI_LAYAR = 8;
/** Lebar kotak (11rem – 16rem), keduanya dikecilkan bila layarnya lebih sempit. */
const LEBAR_KOTAK_MIN = 176;
const LEBAR_KOTAK_MAKS = 256;

export function ScurveChartInteraktif({
  totalWeeks: n,
  currentWeek,
  planPct,
  actualPct,
  forecast,
  lokasi,
}: {
  totalWeeks: number;
  currentWeek: number;
  planPct: number[];
  actualPct: (number | null)[];
  forecast: (number | null)[] | null;
  lokasi: DeretLokasiKurva[];
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const wadahRef = useRef<HTMLDivElement>(null);
  const kotakRef = useRef<HTMLDivElement>(null);
  const [aktif, setAktif] = useState<number | null>(null);
  const [sembunyi, setSembunyi] = useState<ReadonlySet<number>>(new Set());

  // Ada data realisasi? (pratinjau editor kirim semua null → sembunyikan.)
  const hasActual = actualPct.some((v) => v != null);

  // Sumbu-X = akhir minggu 0..n; indeks 0 = MULAI proyek (0%), indeks k = akhir
  // minggu k. Anchor 0% di awal supaya kurva mulai dari 0 (bukan "agak naik").
  const plan = [0, ...planPct];
  const actual: (number | null)[] = [hasActual ? 0 : null, ...actualPct];

  const xFor = (i: number) => PAD_L + (i / n) * PLOT_W;
  const yFor = (pct: number) => PAD_T + (1 - Math.min(Math.max(pct, 0), 100) / 100) * PLOT_H;
  const titik = (deret: (number | null)[]) =>
    deret
      .map((p, i) => (p == null ? null : `${xFor(i)},${yFor(p)}`))
      .filter((s): s is string => s != null)
      .join(" ");

  const planPts = titik(plan);
  const actualIdx = actual.map((p, i) => (p == null ? null : i)).filter((i): i is number => i != null);
  const actualPts = titik(actual);

  // Garis prognosa (opsional). Prepend null utk indeks 0 (mulai) → selaras sumbu.
  const fc: (number | null)[] = forecast ? [null, ...forecast] : [];
  const fcIdx = fc.map((p, i) => (p == null ? null : i)).filter((i): i is number => i != null);
  const hasForecast = fcIdx.length >= 2;
  const forecastEndPct = hasForecast ? (fc[fcIdx[fcIdx.length - 1]] as number) : 0;

  const deretLokasi = lokasi.map((l) => {
    const ada = l.actualPct.some((v) => v != null);
    const nilai: (number | null)[] = [ada ? 0 : null, ...l.actualPct];
    const terakhir = [...l.actualPct].reverse().find((v) => v != null) ?? null;
    return { ...l, nilai, terakhir };
  });

  const gridY = [0, 25, 50, 75, 100];
  const lastActual = actualIdx.length ? (actual[actualIdx[actualIdx.length - 1]] as number) : 0;
  const lastPlan = planPct[currentWeek - 1] ?? planPct[planPct.length - 1] ?? 0;
  // Label minggu: mulai (0), tengah, akhir.
  const weekTicks = [...new Set([0, Math.round(n / 2), n])];

  const tunjuk = (i: number) => setAktif(Math.min(n, Math.max(1, i)));

  // Kotak diletakkan sesudah lebarnya diketahui (isinya berubah tiap minggu),
  // sebelum dilukis – jadi tidak pernah sempat terlihat di tempat yang salah.
  // Batasnya irisan grafik dengan layar yang TERLIHAT: `visualViewport` ikut
  // memperhitungkan layar HP yang sedang di-zoom dua jari.
  useLayoutEffect(() => {
    const wadah = wadahRef.current;
    const kotak = kotakRef.current;
    if (aktif == null || !wadah || !kotak) return;
    const r = wadah.getBoundingClientRect();
    const vv = window.visualViewport;
    const layarKiri = (vv?.offsetLeft ?? 0) + TEPI_LAYAR;
    const layarKanan = (vv ? vv.offsetLeft + vv.width : document.documentElement.clientWidth) - TEPI_LAYAR;
    const batasKiri = Math.max(0, layarKiri - r.left);
    const batasKanan = Math.min(r.width, layarKanan - r.left);
    // min-width menang atas max-width di CSS: keduanya dijepit ke ruang yang ada.
    const ruang = Math.max(0, batasKanan - batasKiri);
    kotak.style.maxWidth = `${Math.min(LEBAR_KOTAK_MAKS, ruang)}px`;
    kotak.style.minWidth = `${Math.min(LEBAR_KOTAK_MIN, ruang)}px`;
    const x = (xFor(aktif) / W) * r.width;
    kotak.style.left = `${letakKotakPenunjuk(x, kotak.offsetWidth, batasKiri, batasKanan)}px`;
  });
  const arahkan = (e: PointerEvent<SVGRectElement>) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    const xv = ((e.clientX - r.left) / r.width) * W;
    tunjuk(Math.round(((xv - PAD_L) / PLOT_W) * n));
  };
  const tombol = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    tunjuk((aktif ?? currentWeek) + (e.key === "ArrowLeft" ? -1 : 1));
  };
  const alih = (i: number) =>
    setSembunyi((s) => {
      const baru = new Set(s);
      if (baru.has(i)) baru.delete(i);
      else baru.add(i);
      return baru;
    });

  const nilaiAktif = aktif != null ? actual[aktif] : null;
  const rencanaAktif = aktif != null ? plan[aktif] : 0;
  const prognosaAktif = aktif != null ? (fc[aktif] ?? null) : null;

  return (
    <div ref={wadahRef} className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full outline-none focus-visible:ring-2 focus-visible:ring-primary"
        role="img"
        aria-label="Kurva-S rencana vs realisasi. Arahkan ke grafik atau pakai panah kiri/kanan untuk melihat angka tiap minggu."
        tabIndex={0}
        onKeyDown={tombol}
        onFocus={() => {
          if (aktif == null) tunjuk(currentWeek);
        }}
        onBlur={() => setAktif(null)}
      >
        {/* gridlines + label Y */}
        {gridY.map((g) => {
          const y = yFor(g);
          return (
            <g key={g}>
              <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="var(--color-border)" strokeWidth={1} />
              <text x={PAD_L - 6} y={y + 3} textAnchor="end" fontSize={10} fill="var(--color-ink-faint)">
                {g}%
              </text>
            </g>
          );
        })}

        {/* penanda minggu berjalan (akhir minggu berjalan = indeks currentWeek) */}
        {hasActual && (
          <line
            x1={xFor(currentWeek)}
            y1={PAD_T}
            x2={xFor(currentWeek)}
            y2={PAD_T + PLOT_H}
            stroke="var(--color-border-strong)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}

        {/* realisasi tiap lokasi – tipis, DI BAWAH garis paket */}
        {deretLokasi.map((l, i) =>
          sembunyi.has(i) ? null : (
            <polyline
              key={i}
              points={titik(l.nilai)}
              fill="none"
              stroke={warnaLokasi(i)}
              strokeWidth={1.5}
              strokeLinejoin="round"
            />
          ),
        )}

        {/* kurva rencana */}
        <polyline points={planPts} fill="none" stroke="var(--color-ink-faint)" strokeWidth={2} strokeDasharray="5 4" />
        {/* kurva realisasi – dengan cincin latar supaya tetap menonjol di atas garis lokasi */}
        {actualPts && (
          <>
            {lokasi.length > 0 && (
              <polyline points={actualPts} fill="none" stroke="var(--color-surface)" strokeWidth={5.5} />
            )}
            <polyline points={actualPts} fill="none" stroke="var(--color-primary)" strokeWidth={2.5} />
          </>
        )}
        {actualIdx.map((i) => (
          <circle key={i} cx={xFor(i)} cy={yFor(actual[i] as number)} r={2.5} fill="var(--color-primary)" />
        ))}

        {/* garis prognosa (dari titik aktual terakhir → proyeksi) */}
        {hasForecast && (
          <polyline points={titik(fc)} fill="none" stroke="var(--color-warning)" strokeWidth={2} strokeDasharray="2 3" />
        )}

        {/* penunjuk minggu yang sedang dilihat */}
        {aktif != null && (
          <g pointerEvents="none">
            <line x1={xFor(aktif)} y1={PAD_T} x2={xFor(aktif)} y2={PAD_T + PLOT_H} stroke="var(--color-ink-muted)" strokeWidth={1} />
            {deretLokasi.map((l, i) => {
              const v = l.nilai[aktif];
              return sembunyi.has(i) || v == null ? null : (
                <circle key={i} cx={xFor(aktif)} cy={yFor(v)} r={3.5} fill={warnaLokasi(i)} stroke="var(--color-surface)" strokeWidth={1.5} />
              );
            })}
            <circle cx={xFor(aktif)} cy={yFor(rencanaAktif)} r={4} fill="var(--color-ink-faint)" stroke="var(--color-surface)" strokeWidth={2} />
            {nilaiAktif != null && (
              <circle cx={xFor(aktif)} cy={yFor(nilaiAktif)} r={4.5} fill="var(--color-primary)" stroke="var(--color-surface)" strokeWidth={2} />
            )}
          </g>
        )}

        {/* label minggu — anchor tepi supaya label pertama/terakhir tidak keklip */}
        {weekTicks.map((i) => {
          const anchor = i === 0 ? "start" : i === n ? "end" : "middle";
          return (
            <text key={i} x={xFor(i)} y={H - 8} textAnchor={anchor} fontSize={10} fill="var(--color-ink-faint)">
              {i === 0 ? "mulai" : `mgg ${i}`}
            </text>
          );
        })}

        {/* bidang tangkap penunjuk – di atas segalanya, lebih lebar dari garisnya */}
        <rect
          x={PAD_L}
          y={PAD_T}
          width={PLOT_W}
          height={PLOT_H}
          fill="transparent"
          style={{ touchAction: "pan-y", cursor: "crosshair" }}
          onPointerMove={arahkan}
          onPointerDown={arahkan}
          onPointerLeave={(e) => {
            if (e.pointerType === "mouse") setAktif(null);
          }}
        />
      </svg>

      {aktif != null && (
        <div
          ref={kotakRef}
          role="status"
          className="pointer-events-none absolute top-1 left-0 z-10 w-max rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-md"
        >
          <p className="font-semibold text-ink">
            Minggu ke-{aktif}
            {aktif === currentWeek && hasActual ? <span className="font-normal text-ink-muted"> · minggu ini</span> : null}
          </p>
          <dl className="mt-1 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5">
            <dt className="text-ink-muted">Rencana</dt>
            <dd className="tabular text-right text-ink">{formatPct(rencanaAktif)}</dd>
            <dt className="text-ink-muted">Realisasi</dt>
            <dd className="tabular text-right font-semibold text-ink">
              {nilaiAktif != null ? formatPct(nilaiAktif) : "belum ada"}
            </dd>
            {nilaiAktif != null && (
              <>
                <dt className="text-ink-muted">Deviasi</dt>
                <dd className="tabular text-right text-ink">{tanda(nilaiAktif - rencanaAktif)}</dd>
              </>
            )}
            {prognosaAktif != null && (
              <>
                <dt className="text-ink-muted">Prognosa</dt>
                <dd className="tabular text-right text-ink">{formatPct(prognosaAktif)}</dd>
              </>
            )}
          </dl>
          {deretLokasi.some((_, i) => !sembunyi.has(i)) && (
            <ul className="mt-1.5 space-y-0.5 border-t border-border pt-1.5">
              {deretLokasi.map((l, i) => {
                if (sembunyi.has(i)) return null;
                const v = l.nilai[aktif];
                const rencana = l.planPct[aktif - 1] ?? 100;
                return (
                  <li key={i} className="flex items-center gap-2">
                    <span aria-hidden className="inline-block h-0.5 w-3 shrink-0" style={{ background: warnaLokasi(i) }} />
                    <span className="min-w-0 flex-1 truncate text-ink">{l.nama}</span>
                    <span className="tabular text-ink">{v != null ? formatPct(v) : "–"}</span>
                    <span className="tabular text-ink-muted">/ {formatPct(rencana)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {hasActual && (
          <span className="flex items-center gap-1.5 text-ink">
            <span aria-hidden className="inline-block h-0.5 w-5 bg-primary" /> Realisasi{lokasi.length > 0 ? " paket" : ""} (
            {formatPct(lastActual)})
          </span>
        )}
        <span className="flex items-center gap-1.5 text-ink">
          <span aria-hidden className="inline-block h-0.5 w-5 border-t-2 border-dashed border-ink-faint" /> Rencana
          {lokasi.length > 0 ? " paket" : ""} ({formatPct(lastPlan)})
        </span>
        {hasForecast && (
          <span className="flex items-center gap-1.5 text-ink">
            <span aria-hidden className="inline-block h-0.5 w-5 border-t-2 border-dotted border-warning" /> Prognosa (
            {formatPct(forecastEndPct)})
          </span>
        )}
        {hasActual && (
          <span className="text-ink-muted">
            Minggu {currentWeek}/{n}
          </span>
        )}
      </div>

      {lokasi.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-1 gap-y-1 text-xs">
          <span className="mr-1 text-ink-muted">Realisasi tiap lokasi:</span>
          {deretLokasi.map((l, i) => (
            <button
              key={i}
              type="button"
              aria-pressed={!sembunyi.has(i)}
              title={sembunyi.has(i) ? "Tampilkan garisnya" : "Sembunyikan garisnya"}
              onClick={() => alih(i)}
              className={`flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-surface-inset ${
                sembunyi.has(i) ? "text-ink-faint line-through" : "text-ink"
              }`}
            >
              <span
                aria-hidden
                className="inline-block h-0.5 w-4"
                style={{ background: warnaLokasi(i), opacity: sembunyi.has(i) ? 0.35 : 1 }}
              />
              {l.nama} ({formatPct(l.terakhir ?? 0)})
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
