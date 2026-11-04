"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Banner, Button, Combobox, Input } from "@/components/ui";
import { formatNumber, formatTanggal, parseDateKey } from "@/lib/format";
import { useAksi } from "@/lib/aksi-klien";
import { statusPadanan, type KandidatDraft, type PilihanPadan, type StatusPadan, type UsulanCatatan, type BarisAda } from "@/lib/luar-rab/padanan";
import type { CatatanTampil, CatatanSelesai, RekapKelompok } from "@/lib/luar-rab/service";
import {
  aktifkanLagiLuarRabAction,
  batalkanLuarRabAction,
  gabungLuarRabAction,
  lepasPadananAction,
  type LuarRabActionState,
} from "./luar-rab-actions";

/**
 * PEKERJAAN DI LUAR RAB di halaman draft adendum (DECISIONS 738).
 *
 * Usulan item dari sistem hanya SARAN: tiap pilihan bisa diubah sebelum
 * digabung. Status tiap baris dihitung ulang di sini dengan aturan yang sama
 * dengan server, supaya yang ditahan terlihat sebelum tombol ditekan – lalu
 * server menghitungnya lagi dari keadaan basis data saat itu.
 */

const tgl = (k: string) => formatTanggal(parseDateKey(k)!, "d MMM yyyy");

export function PanelLuarRab({
  slug,
  adaDraft,
  catatan,
  kandidat,
  usulan,
  barisAda,
  dipadankan,
  dibatalkan,
  kelompok,
}: {
  slug: string;
  adaDraft: boolean;
  catatan: CatatanTampil[];
  kandidat: KandidatDraft[];
  usulan: Record<string, UsulanCatatan>;
  barisAda: Record<string, BarisAda>;
  dipadankan: CatatanSelesai[];
  dibatalkan: CatatanSelesai[];
  kelompok: RekapKelompok[];
}) {
  if (catatan.length === 0 && dipadankan.length === 0 && dibatalkan.length === 0) return null;
  return (
    <section
      aria-labelledby="panel-luar-rab"
      className="space-y-4 rounded-lg border border-warning-border bg-surface p-4 shadow-xs"
    >
      <div>
        <h2 id="panel-luar-rab" className="text-base font-semibold text-ink">
          Pekerjaan di luar RAB{catatan.length > 0 ? ` – ${catatan.length} menunggu` : ""}
        </h2>
        <p className="mt-0.5 text-sm text-ink-muted">
          Dicatat pelaksana di laporan harian: sudah dikerjakan, tapi itemnya belum ada di RAB. Catatan ini tidak masuk
          progres. Setelah dipadankan, volumenya masuk draft adendum pada tanggal aslinya – angka resmi tetap tidak
          berubah sampai adendumnya diaktifkan.
        </p>
      </div>

      {catatan.length > 0 ? (
        adaDraft ? (
          <FormPadanan slug={slug} catatan={catatan} kandidat={kandidat} usulan={usulan} barisAda={barisAda} />
        ) : (
          <>
            <Banner
              tone="info"
              title="Buat draft adendum dulu untuk memadankan"
              description="Rekap di bawah bisa dipakai sebagai bahan menyusun CCO. Begitu draftnya ada, sistem menyarankan item yang cocok untuk tiap catatan."
            />
            <DaftarMenunggu slug={slug} catatan={catatan} />
          </>
        )
      ) : null}

      {kelompok.length > 0 ? <RekapCco kelompok={kelompok} /> : null}
      {dipadankan.length > 0 ? <DaftarSelesai slug={slug} judul="Sudah dipadankan" baris={dipadankan} jenis="padan" /> : null}
      {dibatalkan.length > 0 ? <DaftarSelesai slug={slug} judul="Dibatalkan" baris={dibatalkan} jenis="batal" /> : null}
    </section>
  );
}

const TONE: Record<StatusPadan, string> = {
  siap: "border-success-border bg-success-soft",
  pilih_item: "border-border bg-surface-muted",
  satuan_beda: "border-warning-border bg-warning-soft",
  melebihi: "border-danger-border bg-danger-soft",
  bentrok: "border-danger-border bg-danger-soft",
};

function FormPadanan({
  slug,
  catatan,
  kandidat,
  usulan,
  barisAda,
}: {
  slug: string;
  catatan: CatatanTampil[];
  kandidat: KandidatDraft[];
  usulan: Record<string, UsulanCatatan>;
  barisAda: Record<string, BarisAda>;
}) {
  const [state, formAction, pending] = useAksi<LuarRabActionState>(gabungLuarRabAction, undefined);
  /*
   * Hanya pilihan yang DISENTUH orang yang disimpan. Catatan yang belum
   * disentuh selalu mengikuti usulan terbaru – jadi begitu draft berubah (item
   * baru ditambahkan, berkas diganti), sarannya ikut dihitung ulang tanpa
   * menimpa pilihan yang sudah dibuat orang.
   */
  const [manual, setManual] = useState<Record<string, PilihanPadan>>({});
  const opsi = useMemo(
    () =>
      kandidat.map((k) => ({
        value: k.id,
        label: `${k.kode ? `${k.kode} ` : ""}${k.nama}${k.satuan ? ` (${k.satuan})` : ""}${k.baru ? " – item baru" : ""}${
          k.jalur.length ? ` – ${k.jalur[k.jalur.length - 1]}` : ""
        }`,
      })),
    [kandidat],
  );
  const byId = useMemo(() => new Map(kandidat.map((k) => [k.id, k])), [kandidat]);
  const pilihan = useMemo<Record<string, PilihanPadan>>(
    () =>
      Object.fromEntries(
        catatan.map((c) => {
          const m = manual[c.id];
          // Pilihan yang itemnya sudah tidak ada di draft dianggap belum dipilih.
          const p = m && (!m.kandidatId || byId.has(m.kandidatId)) ? m : undefined;
          return [c.id, p ?? { catatanId: c.id, kandidatId: usulan[c.id]?.kandidatId ?? null, terimaSatuanBeda: false }];
        }),
      ),
    [catatan, manual, usulan, byId],
  );
  const status = useMemo(
    () => statusPadanan(catatan, Object.values(pilihan), kandidat, new Map(Object.entries(barisAda))),
    [catatan, pilihan, kandidat, barisAda],
  );
  const siap = catatan.filter((c) => status.get(c.id)?.status === "siap").length;
  const ubah = (id: string, p: Partial<PilihanPadan>) => setManual((lama) => ({ ...lama, [id]: { ...pilihan[id]!, ...p } }));

  return (
    <div className="space-y-3">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      {state?.success ? <Banner tone="success" title={state.success} /> : null}
      {state?.warning ? <Banner tone="warning" title="Sebagian ditahan" description={state.warning} /> : null}
      <ul className="divide-y divide-border rounded-md border border-border">
        {catatan.map((c) => {
          const p = pilihan[c.id]!;
          const st = status.get(c.id);
          const u = usulan[c.id];
          const k = p.kandidatId ? byId.get(p.kandidatId) : undefined;
          return (
            <li key={c.id} className="space-y-2 px-3 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink">{c.uraian}</div>
                  <div className="text-xs text-ink-muted tabular-nums">
                    {formatNumber(c.volume)} {c.satuan} ·{" "}
                    <Link href={`/lokasi/${slug}/harian/${c.tanggal}`} className="text-primary hover:underline">
                      {tgl(c.tanggal)}
                    </Link>
                    {c.dicatatOleh ? ` · ${c.dicatatOleh}` : ""} · {c.jumlahFoto} foto
                  </div>
                  {c.catatan ? <div className="text-xs text-ink-faint">“{c.catatan}”</div> : null}
                </div>
                <BatalkanCatatan slug={slug} catatanId={c.id} uraian={c.uraian} />
              </div>
              <div>
                <label htmlFor={`padan-${c.id}`} className="text-[12px] text-ink-muted">
                  Item draft adendum
                </label>
                <Combobox
                  id={`padan-${c.id}`}
                  value={p.kandidatId ?? ""}
                  onChange={(v) => ubah(c.id, { kandidatId: v || null, terimaSatuanBeda: false })}
                  options={opsi}
                  placeholder="Pilih item…"
                  searchThreshold={0}
                  disabled={pending}
                />
                {u && !u.kandidatId && !p.kandidatId && u.alasanKosong ? (
                  <p className="mt-1 text-[12px] text-ink-muted">
                    {u.alasanKosong}
                    {u.saran.length > 0 ? " Yang paling mirip:" : ""}
                  </p>
                ) : null}
                {u && u.kandidatId && p.kandidatId === u.kandidatId ? (
                  <p className="mt-1 text-[12px] text-ink-muted">Saran sistem – periksa dulu sebelum digabung.</p>
                ) : null}
                {!p.kandidatId && u && u.saran.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {u.saran.slice(0, 3).map((s) => {
                      const kk = byId.get(s.id);
                      if (!kk) return null;
                      return (
                        <Button
                          key={s.id}
                          type="button"
                          variant="secondary"
                          size="sm"
                          // Nama item bisa panjang: dibiarkan membungkus, tidak meluber ke kanan di HP.
                          className="h-auto max-w-full flex-col items-start py-1.5 text-left whitespace-normal"
                          onClick={() => ubah(c.id, { kandidatId: s.id, terimaSatuanBeda: false })}
                        >
                          <span>
                            {kk.nama}
                            {kk.satuan ? ` (${kk.satuan})` : ""}
                          </span>
                          {/* Nama item KNMP berulang di banyak bangunan; induknya pembedanya. */}
                          {kk.jalur.length ? (
                            <span className="text-[12px] font-normal text-ink-muted">{kk.jalur[kk.jalur.length - 1]}</span>
                          ) : null}
                        </Button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
              {k && st ? (
                <div className={`rounded-md border px-2.5 py-1.5 text-[12px] text-ink ${TONE[st.status]}`}>
                  {st.status === "siap" ? (
                    <>
                      Siap digabung
                      {k.sisa != null ? ` · sisa volume draft ${formatNumber(Math.max(0, k.sisa))} ${k.satuan ?? ""}` : ""}
                    </>
                  ) : (
                    st.pesan
                  )}
                  {st.status === "satuan_beda" || (p.terimaSatuanBeda && st.status === "siap") ? (
                    <label className="mt-1 flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={p.terimaSatuanBeda}
                        onChange={(e) => ubah(c.id, { terimaSatuanBeda: e.target.checked })}
                        className="size-4"
                      />
                      Satuannya memang benar
                    </label>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <form action={formAction} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="pilihan" value={JSON.stringify(Object.values(pilihan).filter((p) => p.kandidatId))} />
        <Button type="submit" loading={pending} disabled={siap === 0}>
          {siap > 0 ? `Gabungkan ${siap} catatan ke draft` : "Belum ada yang siap digabung"}
        </Button>
        <p className="text-xs text-ink-muted">
          Yang belum dipilih atau ditahan tetap menunggu. Tidak ada yang hilang.
        </p>
      </form>
    </div>
  );
}

function BatalkanCatatan({ slug, catatanId, uraian }: { slug: string; catatanId: string; uraian: string }) {
  const [buka, setBuka] = useState(false);
  const [state, formAction, pending] = useAksi<LuarRabActionState>(batalkanLuarRabAction, undefined);
  if (!buka) {
    return (
      <Button type="button" variant="secondary" size="sm" onClick={() => setBuka(true)}>
        Batalkan
      </Button>
    );
  }
  return (
    <form action={formAction} className="w-full space-y-2 rounded-md border border-border bg-surface-muted p-2.5 sm:w-80">
      {state?.error ? <Banner tone="error" title={state.error} /> : null}
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="catatanId" value={catatanId} />
      <label htmlFor={`alasan-${catatanId}`} className="text-[12px] text-ink-muted">
        Alasan membatalkan &quot;{uraian}&quot;
      </label>
      <Input
        id={`alasan-${catatanId}`}
        name="alasan"
        required
        minLength={5}
        maxLength={500}
        placeholder="mis. sudah termasuk item galian"
        className="h-10"
      />
      <div className="flex items-center gap-2">
        <Button type="submit" variant="secondary" size="sm" loading={pending}>
          Batalkan catatan
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setBuka(false)} disabled={pending}>
          Tutup
        </Button>
      </div>
      <p className="text-[11px] text-ink-faint">Catatan dan fotonya tetap tersimpan, hanya tidak lagi menunggu.</p>
    </form>
  );
}

function DaftarMenunggu({ slug, catatan }: { slug: string; catatan: CatatanTampil[] }) {
  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {catatan.map((c) => (
        <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2.5">
          <div className="min-w-0">
            <div className="text-sm font-medium text-ink">{c.uraian}</div>
            <div className="text-xs text-ink-muted tabular-nums">
              {formatNumber(c.volume)} {c.satuan} ·{" "}
              <Link href={`/lokasi/${slug}/harian/${c.tanggal}`} className="text-primary hover:underline">
                {tgl(c.tanggal)}
              </Link>
              {c.dicatatOleh ? ` · ${c.dicatatOleh}` : ""} · {c.jumlahFoto} foto
            </div>
          </div>
          <BatalkanCatatan slug={slug} catatanId={c.id} uraian={c.uraian} />
        </li>
      ))}
    </ul>
  );
}

function RekapCco({ kelompok }: { kelompok: RekapKelompok[] }) {
  return (
    <details className="rounded-md border border-border">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-ink">
        Rekap yang menunggu, untuk menyusun CCO ({kelompok.length} jenis pekerjaan)
      </summary>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-border text-left text-xs text-ink-muted">
              <th className="px-3 py-1.5 font-medium">Uraian</th>
              <th className="px-3 py-1.5 text-right font-medium">Volume</th>
              <th className="px-3 py-1.5 font-medium">Catatan</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {kelompok.map((g) => (
              <tr key={`${g.uraian}|${g.satuan}`}>
                <td className="px-3 py-1.5 text-ink">{g.uraian}</td>
                <td className="px-3 py-1.5 text-right whitespace-nowrap tabular-nums">
                  {formatNumber(g.volume)} {g.satuan}
                </td>
                <td className="px-3 py-1.5 text-xs whitespace-nowrap text-ink-muted">
                  {g.jumlahCatatan}× · {g.tanggalAwal === g.tanggalAkhir ? tgl(g.tanggalAwal) : `${tgl(g.tanggalAwal)} – ${tgl(g.tanggalAkhir)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-3 py-2 text-[11px] text-ink-faint">
        Dikelompokkan menurut uraian dan satuan yang ditulis pelaksana. Uraian yang ditulis berbeda untuk pekerjaan yang sama
        tetap terpisah – periksa sebelum dipakai.
      </p>
    </details>
  );
}

function DaftarSelesai({
  slug,
  judul,
  baris,
  jenis,
}: {
  slug: string;
  judul: string;
  baris: CatatanSelesai[];
  jenis: "padan" | "batal";
}) {
  return (
    <details className="rounded-md border border-border">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-ink">
        {judul} ({baris.length})
      </summary>
      <ul className="divide-y divide-border border-t border-border">
        {baris.map((c) => (
          <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-sm text-ink">{c.uraian}</div>
              <div className="text-xs text-ink-muted tabular-nums">
                {formatNumber(c.volume)} {c.satuan} ·{" "}
                <Link href={`/lokasi/${slug}/harian/${c.tanggal}`} className="text-primary hover:underline">
                  {tgl(c.tanggal)}
                </Link>
                {c.oleh ? ` · ${c.oleh}` : ""}
              </div>
              {jenis === "padan" && c.item ? (
                <div className="text-xs text-ink-muted">
                  {c.resmi ? "Sudah resmi" : "Di draft"}: {c.item}
                </div>
              ) : null}
              {jenis === "batal" && c.alasan ? <div className="text-xs text-ink-faint">Alasan: {c.alasan}</div> : null}
            </div>
            {jenis === "padan" && !c.resmi ? (
              <AksiSatu slug={slug} catatanId={c.id} aksi={lepasPadananAction} label="Lepas padanan" />
            ) : null}
            {jenis === "batal" ? (
              <AksiSatu slug={slug} catatanId={c.id} aksi={aktifkanLagiLuarRabAction} label="Aktifkan lagi" />
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

function AksiSatu({
  slug,
  catatanId,
  aksi,
  label,
}: {
  slug: string;
  catatanId: string;
  aksi: (prev: LuarRabActionState, fd: FormData) => Promise<LuarRabActionState>;
  label: string;
}) {
  const [state, formAction, pending] = useAksi<LuarRabActionState>(aksi, undefined);
  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="catatanId" value={catatanId} />
      <Button type="submit" variant="secondary" size="sm" loading={pending}>
        {label}
      </Button>
      {state?.error ? <span className="max-w-64 text-right text-[12px] text-danger">{state.error}</span> : null}
    </form>
  );
}
