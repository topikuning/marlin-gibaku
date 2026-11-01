"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp } from "lucide-react";
import { Banner, Button, CollapsibleCard, Combobox, FileInput, Input, StatusPill } from "@/components/ui";
import { useAksi } from "@/lib/aksi-klien";
import type { BadgeTone } from "@/components/ui/badge";
import {
  bolehDisimpan,
  hitungStatus,
  type BahanUsulan,
  type BarisUsulan,
  type KandidatItem,
  type StatusBaris,
} from "@/lib/daily-report/impor-pelaksana/cocok";
import type { PratinjauImpor } from "@/lib/daily-report/impor-pelaksana/proses";
import {
  pratinjauImporPelaksanaAction,
  simpanImporPelaksanaAction,
  type PratinjauImporState,
  type SimpanImporState,
} from "./impor-pelaksana-actions";

/**
 * IMPOR LAPORAN HARIAN PELAKSANA (DECISIONS 733).
 *
 * Permintaan user 2026-11-01: pelaksana yang sudah membuat laporan sendiri
 * tidak perlu mengetik ulang. Berkasnya dibaca, Anda memilih yang masuk, dan
 * yang melebihi sisa RAB DITAHAN dengan peringatan (pilihan user: "Tahan +
 * peringatan") – volumenya bisa diubah, diarahkan ke item draft adendum, atau
 * dilewati.
 */

const LABEL_STATUS: Record<StatusBaris, { label: string; tone: BadgeTone }> = {
  siap: { label: "Siap", tone: "success" },
  melebihi: { label: "Melebihi sisa RAB", tone: "danger" },
  pilih_item: { label: "Pilih item", tone: "warning" },
  satuan_beda: { label: "Satuan beda", tone: "warning" },
  tanpa_volume: { label: "Tanpa volume", tone: "neutral" },
  dilewati: { label: "Dilewati", tone: "neutral" },
};

const LABEL_ROLE: Record<string, string> = {
  site_manager: "Site Manager / Penanggung Jawab",
  pelaksana: "Pelaksana",
  mandor: "Mandor",
  kepala_tukang: "Kepala Tukang",
  tukang_bongkar: "Tukang Bongkar",
  tukang_batu: "Tukang Batu",
  tukang_besi: "Tukang Besi",
  tukang_kayu: "Tukang Kayu",
  tukang_pipa: "Tukang Pipa",
  tukang_listrik: "Tukang Listrik",
  tukang_cat: "Tukang Cat",
  tenaga: "Tenaga / Pekerja",
  logistik: "Logistik",
  operator: "Operator",
};

const angka = (n: number | null | undefined) =>
  n == null ? "–" : n.toLocaleString("id-ID", { maximumFractionDigits: 3 });

function labelKandidat(k: KandidatItem): string {
  const induk = k.jalur.at(-1);
  const draft = k.basis === "draft_adendum" ? " · draft adendum" : "";
  return `${k.kode ? `${k.kode} ` : ""}${k.nama}${induk ? ` – ${induk}` : ""}${draft} (sisa ${angka(k.sisa)} ${k.satuan ?? ""})`.replace(/\s+\)/, ")");
}

export function ImporLaporanPelaksana({ locationId, slug, dateKey }: { locationId: string; slug: string; dateKey: string }) {
  const router = useRouter();
  const [baca, aksiBaca, membaca] = useAksi<PratinjauImporState>(pratinjauImporPelaksanaAction, undefined);
  const [simpan, aksiSimpan, menyimpan] = useAksi<SimpanImporState>(simpanImporPelaksanaAction, undefined);
  // Pratinjau DITURUNKAN dari hasil baca terakhir; yang dicatat hanya mana
  // yang dibatalkan dan mana yang sudah dikirim (lewat event, bukan effect).
  const [dibatalkan, setDibatalkan] = useState<PratinjauImpor | null>(null);
  const [dikirimUntuk, setDikirimUntuk] = useState<PratinjauImpor | null>(null);
  const terakhir = baca?.pratinjau ?? null;
  const sudahDisimpan = !!simpan?.success && dikirimUntuk === terakhir;
  const p = terakhir && terakhir !== dibatalkan && !sudahDisimpan ? terakhir : null;

  useEffect(() => {
    if (simpan?.success) router.refresh();
  }, [simpan, router]);

  return (
    <CollapsibleCard
      title="Impor dari laporan pelaksana"
      subtitle="Pelaksana sudah membuat laporan harian sendiri (PDF)? Unggah di sini – pekerjaan, tenaga kerja, dan bahan/alatnya dibaca, lalu Anda memilih yang dimasukkan ke draft ini."
      defaultOpen={!!p}
    >
      <form action={aksiBaca} className="space-y-2">
        <input type="hidden" name="locationId" value={locationId} />
        <input type="hidden" name="dateKey" value={dateKey} />
        <FileInput name="berkas" accept="application/pdf,.pdf" required maxBytes={15 * 1024 * 1024} />
        <Button type="submit" variant="secondary" loading={membaca}>
          <FileUp aria-hidden className="size-4" />
          Baca berkas
        </Button>
      </form>
      {baca?.error ? <Banner tone="error" title={baca.error} className="mt-3" /> : null}
      {simpan?.success ? <Banner tone="success" title={simpan.success} className="mt-3" /> : null}
      {simpan?.error ? <Banner tone="error" title={simpan.error} className="mt-3" /> : null}
      {simpan?.ditolak?.length ? (
        <ul className="mt-2 space-y-1 text-[13px] text-ink">
          {simpan.ditolak.map((d, i) => (
            <li key={i}>
              <span className="font-medium">{d.uraian}</span> – {d.pesan}
            </li>
          ))}
        </ul>
      ) : null}
      {p ? (
        <Pratinjau
          key={`${p.berkas}-${p.baris.length}`}
          p={p}
          locationId={locationId}
          slug={slug}
          dateKey={dateKey}
          aksiSimpan={aksiSimpan}
          menyimpan={menyimpan}
          onKirim={() => setDikirimUntuk(p)}
          onBatal={() => setDibatalkan(p)}
        />
      ) : null}
    </CollapsibleCard>
  );
}

function Pratinjau({
  p,
  locationId,
  slug,
  dateKey,
  aksiSimpan,
  menyimpan,
  onKirim,
  onBatal,
}: {
  p: PratinjauImpor;
  locationId: string;
  slug: string;
  dateKey: string;
  aksiSimpan: (fd: FormData) => void;
  menyimpan: boolean;
  onKirim: () => void;
  onBatal: () => void;
}) {
  const [baris, setBaris] = useState<BarisUsulan[]>(p.baris);
  const [terimaSatuan, setTerimaSatuan] = useState<Record<number, boolean>>({});
  const [pakaiTenaga, setPakaiTenaga] = useState(!p.laporan.adaTenaga && p.tenaga.workers.length > 0);
  const [bahan, setBahan] = useState<BahanUsulan[]>(p.bahan);
  const byId = useMemo(() => new Map(p.kandidat.map((k) => [k.id, k])), [p.kandidat]);
  const status = useMemo(() => hitungStatus(baris, p.kandidat), [baris, p.kandidat]);

  const ubah = (idx: number, perubahan: Partial<BarisUsulan>) =>
    setBaris((bs) => bs.map((b) => (b.idx === idx ? { ...b, ...perubahan } : b)));

  const masuk = baris.filter((b, i) => !b.lewati && bolehDisimpan(status[i], !!terimaSatuan[b.idx]) && b.kandidatId && b.volume);
  const ditahan = baris.filter((b, i) => !b.lewati && !bolehDisimpan(status[i], !!terimaSatuan[b.idx])).length;
  const bahanDipakai = bahan.filter((b) => b.pakai);
  const payload = JSON.stringify({
    berkas: p.berkas,
    sumber: p.sumber,
    baris: masuk.map((b) => ({ kandidatId: b.kandidatId, volume: b.volume, uraian: b.uraian, catatan: b.catatan })),
    tenaga: pakaiTenaga ? p.tenaga.workers : null,
    bahan: bahanDipakai.map((b) => ({ jenis: b.jenis, nama: b.nama, qty: b.qty, satuan: b.satuan })),
  });
  const adaYangMasuk = masuk.length > 0 || (pakaiTenaga && p.tenaga.workers.length > 0) || bahanDipakai.length > 0;

  return (
    <div className="mt-4 space-y-4">
      <p className="text-[13px] text-ink-muted">
        {p.berkas} ·{" "}
        {p.sumber === "ai" ? "dibaca AI (format belum dikenali)" : "dibaca dari templat laporan harian"}
      </p>
      {p.peringatan.map((w, i) => (
        <Banner key={i} tone="warning" title={w} />
      ))}
      {p.catatanBaca.map((c, i) => (
        <Banner key={`c${i}`} tone="info" title={c} />
      ))}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-ink">Pekerjaan ({baris.length})</h3>
        {baris.length === 0 ? <p className="text-[13px] text-ink-muted">Tidak ada baris pekerjaan yang terbaca.</p> : null}
        {baris.map((b, i) => {
          const s = status[i];
          const k = b.kandidatId ? byId.get(b.kandidatId) : undefined;
          const saranId = new Set(b.saran.map((x) => x.id));
          const opsi = [
            ...b.saran.map((x) => byId.get(x.id)).filter((x): x is KandidatItem => !!x),
            ...p.kandidat.filter((x) => !saranId.has(x.id)),
          ].map((x) => ({ value: x.id, label: labelKandidat(x) }));
          return (
            <div key={b.idx} className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 text-[13px] text-ink">
                  <span className="font-medium">{b.no ? `${b.no}. ` : ""}{b.uraian}</span>
                  <span className="text-ink-muted">
                    {" "}
                    · berkas: {angka(p.baris[i]?.volume)} {b.satuanBerkas ?? ""}
                    {b.catatan ? ` · ${b.catatan}` : ""}
                  </span>
                </p>
                <StatusPill tone={LABEL_STATUS[s.status].tone} label={LABEL_STATUS[s.status].label} />
              </div>
              {b.lewati && s.status === "tanpa_volume" ? null : (
                <div className="grid gap-2 sm:grid-cols-[1fr_9rem]">
                  <p className="text-[11px] font-medium tracking-wide text-ink-muted uppercase sm:col-span-2">
                    Item RAB · Volume{k?.satuan ? ` (${k.satuan})` : ""}
                  </p>
                  <Combobox
                    value={b.kandidatId ?? ""}
                    onChange={(v) => ubah(b.idx, { kandidatId: v || null })}
                    options={opsi}
                    placeholder="Pilih item RAB…"
                    disabled={b.lewati}
                    searchThreshold={0}
                  />
                  <Input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min="0"
                    aria-label={`Volume yang dimasukkan${k?.satuan ? ` (${k.satuan})` : ""}`}
                    placeholder={k?.satuan ? `Volume (${k.satuan})` : "Volume"}
                    value={b.volume ?? ""}
                    disabled={b.lewati}
                    onChange={(e) => ubah(b.idx, { volume: e.target.value === "" ? null : Number(e.target.value) })}
                  />
                </div>
              )}
              {s.pesan && s.status !== "siap" && !(b.lewati && s.status === "tanpa_volume") ? (
                <p className={s.status === "melebihi" ? "text-[13px] text-danger" : "text-[13px] text-ink-muted"}>{s.pesan}</p>
              ) : null}
              {k?.diLaporan != null && !b.lewati ? (
                <p className="text-[12px] text-ink-muted">
                  Item ini sudah ada di laporan ({angka(k.diLaporan)} {k.satuan ?? ""}) – volumenya akan diganti, bukan ditambah.
                </p>
              ) : null}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                {s.status === "satuan_beda" && !b.lewati ? (
                  <label className="inline-flex items-center gap-2 pointer-coarse:min-h-11">
                    <input
                      type="checkbox"
                      checked={!!terimaSatuan[b.idx]}
                      onChange={(e) => setTerimaSatuan((t) => ({ ...t, [b.idx]: e.target.checked }))}
                    />
                    Itemnya sudah benar, tetap masukkan
                  </label>
                ) : null}
                {s.status !== "tanpa_volume" || !b.lewati ? (
                  <label className="inline-flex items-center gap-2 pointer-coarse:min-h-11">
                    <input type="checkbox" checked={b.lewati} onChange={(e) => ubah(b.idx, { lewati: e.target.checked })} />
                    Lewati baris ini
                  </label>
                ) : null}
              </div>
            </div>
          );
        })}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-ink">Tenaga kerja</h3>
        {p.tenaga.rincian.length === 0 ? (
          <p className="text-[13px] text-ink-muted">Tidak ada tenaga kerja yang terbaca.</p>
        ) : (
          <>
            <ul className="space-y-0.5 text-[13px] text-ink">
              {p.tenaga.rincian.map((t, i) => (
                <li key={i}>
                  {t.jabatan}: {t.jumlah} orang
                  {t.pagi != null && t.siang != null && t.pagi !== t.siang ? ` (pagi ${t.pagi}, siang ${t.siang})` : ""}
                  <span className="text-ink-muted"> → {t.role ? LABEL_ROLE[t.role] : "tidak ada padanan di MARLIN, dilewati"}</span>
                </li>
              ))}
            </ul>
            {p.tenaga.workers.length > 0 ? (
              <label className="inline-flex items-center gap-2 text-[13px] pointer-coarse:min-h-11">
                <input type="checkbox" checked={pakaiTenaga} onChange={(e) => setPakaiTenaga(e.target.checked)} />
                {p.laporan.adaTenaga
                  ? "Ganti tenaga kerja laporan ini dengan isian dari berkas"
                  : "Masukkan tenaga kerja dari berkas"}
              </label>
            ) : null}
          </>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-ink">Bahan / alat yang datang</h3>
        {bahan.length === 0 ? <p className="text-[13px] text-ink-muted">Tidak ada bahan/alat yang terbaca.</p> : null}
        {bahan.map((b) => (
          <div key={b.idx} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
            <label className="inline-flex min-w-0 items-center gap-2 pointer-coarse:min-h-11">
              <input
                type="checkbox"
                checked={b.pakai}
                onChange={(e) => setBahan((xs) => xs.map((x) => (x.idx === b.idx ? { ...x, pakai: e.target.checked } : x)))}
              />
              <span className="font-medium text-ink">{b.nama}</span>
            </label>
            <span className="text-ink-muted">
              {b.qty != null ? `${angka(b.qty)} ${b.satuan ?? ""}` : b.teksTerima === "✓" ? "diterima (jumlah tidak ditulis)" : (b.teksTerima ?? "–")}
              {b.ditolak ? ` · ditolak: ${b.ditolak}` : ""}
            </span>
            <div className="w-28">
              <Combobox
                value={b.jenis}
                onChange={(v) => setBahan((xs) => xs.map((x) => (x.idx === b.idx ? { ...x, jenis: v === "alat" ? "alat" : "bahan" } : x)))}
                options={[
                  { value: "bahan", label: "Bahan" },
                  { value: "alat", label: "Alat" },
                ]}
              />
            </div>
          </div>
        ))}
      </section>

      <form action={aksiSimpan} onSubmit={onKirim} className="space-y-2 border-t border-border pt-3">
        <input type="hidden" name="locationId" value={locationId} />
        <input type="hidden" name="dateKey" value={dateKey} />
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="payload" value={payload} />
        <p className="text-[13px] text-ink-muted">
          {masuk.length} pekerjaan akan masuk draft{ditahan > 0 ? ` · ${ditahan} ditahan (lihat tanda merah/kuning)` : ""}.
          Penjaga sisa RAB tetap memeriksa lagi saat disimpan.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={menyimpan} disabled={!p.laporan.bisaDiisi || !adaYangMasuk}>
            Masukkan ke draft
          </Button>
          <Button type="button" variant="secondary" onClick={onBatal} disabled={menyimpan}>
            Batal
          </Button>
        </div>
      </form>
    </div>
  );
}
