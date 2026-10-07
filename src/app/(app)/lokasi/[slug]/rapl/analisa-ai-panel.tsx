"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Badge, Banner, Button } from "@/components/ui";
import { formatNumber, formatPct, formatRupiah } from "@/lib/format";
import {
  cabutAnalisaAiAction,
  mintaAnalisaAiAction,
  statusAnalisaAiAction,
  terimaAnalisaAiAction,
  tolakAnalisaAiAction,
} from "@/lib/ahsp/analisa-ai-actions";
import { perluTarikUlang, type RingkasUsulanAi } from "@/lib/ahsp/usulan-status";
import { BATAS_ITEM_ANALISA_AI } from "@/lib/ahsp/analisa-ai-parse";

/**
 * DRAF ANALISA AI (DECISIONS baru 2026-10-07).
 *
 * Untuk item yang tidak punya analisa dari mana pun – berkas kontrak, padanan
 * AHSP, rincian tangan, atau borongan. AI menyusun koefisien bahan, upah, dan
 * alat per satuan item; drafnya tersimpan di server dan baru dipakai RAPL
 * setelah diterima orang. Yang diterima selalu disebut "usulan AI".
 *
 * Seluruh angka biaya di sini dihitung server (`rapl-calc.ts`).
 */

export type DrafAnalisaRow = {
  id: string;
  lineageKey: string;
  code: string;
  uraian: string;
  satuan: string;
  keyakinan: string;
  alasan: string;
  volume: number | null;
  nilaiRab: string;
  komponen: { kategori: string; nama: string; satuan: string; koefisien: number; harga: string | null; biaya: string | null }[];
  biaya: string;
  komponenBelumBerharga: number;
  margin: string | null;
  marginPersen: number | null;
};

export type KeadaanAnalisaAiView = {
  menunggu: boolean;
  terputus: boolean;
  pendingSinceMs: number | null;
  model: string | null;
  error: string | null;
  jumlahTanpa: number;
  nilaiTanpa: string;
  draf: DrafAnalisaRow[];
  diterima: { id: string; code: string; uraian: string; komponen: number; pada: string; oleh: string | null }[];
};

const KATEGORI: Record<string, string> = { bahan: "Bahan", upah: "Upah", alat: "Alat" };
const NADA_YAKIN: Record<string, "success" | "warning" | "neutral"> = { tinggi: "success", sedang: "neutral", rendah: "warning" };

export function AnalisaAiPanel({
  locationId,
  slug,
  canInput,
  canUseAi,
  tampilkanMargin,
  k,
}: {
  locationId: string;
  slug: string;
  canInput: boolean;
  canUseAi: boolean;
  tampilkanMargin: boolean;
  k: KeadaanAnalisaAiView;
}) {
  const router = useRouter();
  const [pesan, setPesan] = useState<{ tone: "success" | "error"; teks: string } | null>(null);
  const [sibuk, setSibuk] = useState<string | null>(null);
  const [, mulai] = useTransition();
  const [detik, setDetik] = useState(0);

  // Menunggu di layar, bukan di request – pola yang sama dengan draf harga.
  useEffect(() => {
    if (!k.menunggu || k.pendingSinceMs == null) return;
    const pending = k.pendingSinceMs;
    const hitung = () => setDetik(Math.max(0, Math.round((Date.now() - pending) / 1000)));
    hitung();
    const jam = setInterval(hitung, 1000);
    const semula: RingkasUsulanAi = { menunggu: k.menunggu, terputus: k.terputus, jumlahDraf: k.draf.length };
    let berhenti = false;
    const tarik = setInterval(() => {
      void statusAnalisaAiAction({ locationId }).then((h) => {
        if (berhenti || !h.ok) return;
        if (perluTarikUlang(semula, h.status)) router.refresh();
      });
    }, 3000);
    return () => {
      berhenti = true;
      clearInterval(jam);
      clearInterval(tarik);
    };
  }, [k.menunggu, k.terputus, k.pendingSinceMs, k.draf.length, locationId, router]);

  const jalankan = (kunci: string, fn: () => Promise<{ ok: true } | { ok: false; error: string }>, sukses: (h: never) => string) => {
    setPesan(null);
    setSibuk(kunci);
    mulai(async () => {
      try {
        const h = await fn();
        if (!h.ok) {
          setPesan({ tone: "error", teks: h.error });
          return;
        }
        setPesan({ tone: "success", teks: sukses(h as never) });
        router.refresh();
      } finally {
        setSibuk(null);
      }
    });
  };

  const minta = () =>
    jalankan(
      "minta",
      () => mintaAnalisaAiAction({ locationId, slug }),
      (h: { diminta: number; tidakDiminta: number }) =>
        `Draf analisa untuk ${h.diminta} item sedang disusun.${h.tidakDiminta > 0 ? ` ${h.tidakDiminta} item lain menyusul di permintaan berikutnya.` : ""}`,
    );

  if (k.jumlahTanpa === 0 && k.draf.length === 0 && k.diterima.length === 0) return null;

  return (
    <section className="space-y-3 rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-[240px] flex-1">
          <h3 className="text-[14px] font-semibold text-ink">Draf analisa AI</h3>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            {k.jumlahTanpa > 0 ? (
              <>
                <strong className="text-ink">{k.jumlahTanpa} item</strong> belum punya analisa sama sekali (nilai RAB{" "}
                {formatRupiah(BigInt(k.nilaiTanpa))}): tidak ada di berkas kontrak, tidak punya padanan AHSP, belum dirinci, dan
                bukan borongan.{" "}
              </>
            ) : (
              <>Semua item sudah punya analisa. </>
            )}
            AI menyusun koefisien bahan, upah, dan alat per satuan item. Drafnya baru dipakai setelah Anda terima, dan
            tetap disebut &quot;usulan AI&quot; di layar dan Excel. Ini perkiraan, bukan analisa resmi.
          </p>
        </div>
        {canInput && canUseAi && k.jumlahTanpa > 0 ? (
          <Button type="button" size="sm" variant="secondary" loading={sibuk === "minta"} disabled={k.menunggu} onClick={minta}>
            <Sparkles aria-hidden className="size-3.5" />
            Minta draf untuk {Math.min(BATAS_ITEM_ANALISA_AI, k.jumlahTanpa)} item bernilai terbesar
          </Button>
        ) : null}
      </div>

      {pesan ? <Banner tone={pesan.tone} title={pesan.teks} /> : null}
      {k.menunggu ? (
        <Banner
          tone="info"
          title={`Draf analisa sedang disusun – ${detik} detik`}
          description="Permintaannya sudah tercatat, jadi Anda boleh meninggalkan halaman ini. Hasilnya muncul di sini begitu siap."
        />
      ) : null}
      {k.terputus ? (
        <Banner
          tone="warning"
          title="Permintaan draf analisa sebelumnya tidak selesai"
          description="Prosesnya berhenti sebelum selesai, mungkin karena aplikasi sedang diperbarui. Silakan minta lagi."
        />
      ) : null}
      {!k.menunggu && k.error ? <Banner tone="error" title="Permintaan draf analisa gagal" description={k.error} /> : null}

      {k.draf.length > 0 ? (
        <div className="space-y-3">
          <p className="text-[13px] text-ink-muted">
            {k.draf.length} draf menunggu keputusan{k.model ? ` · disusun ${k.model}` : ""}.
          </p>
          {k.draf.map((d) => (
            <article key={d.id} className="rounded-lg border border-line">
              <header className="flex flex-wrap items-start gap-2 border-b border-line px-3 py-2">
                <div className="min-w-[220px] flex-1">
                  <p className="text-[13px] font-medium text-ink">
                    {d.code} · {d.uraian}
                  </p>
                  <p className="text-[12px] text-ink-muted">
                    {d.volume != null ? `${formatNumber(d.volume)} ${d.satuan}` : "tanpa volume"} · nilai RAB{" "}
                    {formatRupiah(BigInt(d.nilaiRab))}
                  </p>
                </div>
                <Badge tone={NADA_YAKIN[d.keyakinan] ?? "neutral"}>keyakinan {d.keyakinan}</Badge>
              </header>
              <div className="space-y-2 px-3 py-2">
                <p className="text-[12px] text-ink-muted">{d.alasan}</p>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-[13px]">
                    <thead>
                      <tr className="border-b border-line text-left text-[11px] uppercase text-ink-muted">
                        <th className="py-1 pr-2">Kelompok</th>
                        <th className="py-1 pr-2">Sumber daya</th>
                        <th className="py-1 pr-2 text-right">Koefisien / {d.satuan}</th>
                        <th className="py-1 pr-2">Satuan</th>
                        <th className="py-1 pr-2 text-right">Harga</th>
                        <th className="py-1 text-right">Biaya item</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {d.komponen.map((c) => (
                        <tr key={`${c.kategori}|${c.nama}|${c.satuan}`}>
                          <td className="py-1 pr-2 text-ink-muted">{KATEGORI[c.kategori] ?? c.kategori}</td>
                          <td className="py-1 pr-2">{c.nama}</td>
                          <td className="tabular py-1 pr-2 text-right">
                            {c.koefisien.toLocaleString("id-ID", { maximumFractionDigits: 6 })}
                          </td>
                          <td className="py-1 pr-2 text-ink-muted">{c.satuan}</td>
                          <td className="tabular py-1 pr-2 text-right">
                            {c.harga == null ? <span className="text-ink-faint">belum ada</span> : formatRupiah(BigInt(c.harga))}
                          </td>
                          <td className="tabular py-1 text-right">{c.biaya == null ? "–" : formatRupiah(BigInt(c.biaya))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[12px] text-ink-muted">
                  Perkiraan biaya item <strong className="tabular text-ink">{formatRupiah(BigInt(d.biaya))}</strong>
                  {d.komponenBelumBerharga > 0 ? ` (${d.komponenBelumBerharga} komponen belum berharga, jadi belum lengkap)` : ""}
                  {tampilkanMargin && d.margin != null && d.marginPersen != null
                    ? ` · margin ${formatRupiah(BigInt(d.margin))} (${formatPct(d.marginPersen, 1)})`
                    : ""}
                </p>
                {canInput ? (
                  <div className="flex flex-wrap gap-2">
                    {canUseAi ? (
                      <Button
                        type="button"
                        size="sm"
                        loading={sibuk === `terima:${d.id}`}
                        onClick={() =>
                          jalankan(
                            `terima:${d.id}`,
                            () => terimaAnalisaAiAction({ locationId, slug, ids: [d.id] }),
                            () => `Analisa "${d.uraian}" diterima dan masuk hitungan RAPL sebagai usulan AI.`,
                          )
                        }
                      >
                        Terima
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      loading={sibuk === `tolak:${d.id}`}
                      onClick={() =>
                        jalankan(
                          `tolak:${d.id}`,
                          () => tolakAnalisaAiAction({ locationId, slug, ids: [d.id] }),
                          () => `Draf analisa "${d.uraian}" ditolak.`,
                        )
                      }
                    >
                      Tolak
                    </Button>
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {k.diterima.length > 0 ? (
        <details className="text-[13px]">
          <summary className="cursor-pointer text-primary">{k.diterima.length} item memakai analisa usulan AI</summary>
          <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
            {k.diterima.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <div className="min-w-[220px] flex-1">
                  <p className="text-ink">
                    {d.code} · {d.uraian}
                  </p>
                  <p className="text-[12px] text-ink-muted">
                    {d.komponen} komponen · diterima {d.oleh ?? "–"}, {d.pada}
                  </p>
                </div>
                {canInput ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    loading={sibuk === `cabut:${d.id}`}
                    onClick={() =>
                      jalankan(
                        `cabut:${d.id}`,
                        () => cabutAnalisaAiAction({ locationId, slug, ids: [d.id] }),
                        () => `Analisa usulan AI untuk "${d.uraian}" dicabut.`,
                      )
                    }
                  >
                    Cabut
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
