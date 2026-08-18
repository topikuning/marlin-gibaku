"use client";

import { useActionState, useRef, useState } from "react";
import { Check, Download, FileUp, PencilLine, RefreshCw, ShieldCheck, Upload } from "lucide-react";
import { Badge, Banner, Button, ButtonLink } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  importJadwalAction,
  pratinjauJadwalAction,
  type PratinjauState,
  type RabActionState,
} from "../rab/actions";

/**
 * PERBARUI KURVA-S — satu alur resmi, dari awal sampai akhir (DECISIONS 364).
 *
 * Teguran user 2026-08-18: *"Yang harus diubah adalah membuat 'Perbarui
 * Kurva-S' menjadi workflow resmi yang jelas dari awal sampai akhir … pengguna
 * sulit membedakan mana hanya untuk melihat dan mana yang akan mengubah data
 * resmi. lalu pengguna juga bingung dimana mereka harus upload template
 * kurva-s."*
 *
 * Benar. Memindahkan kartu ke dalam tab tidak menyelesaikan itu — langkahnya
 * memang ADA, tapi berserak dan tak satu pun bernama:
 *
 *  - "unduh template" bernama **"Unduh Excel"** di header, tanpa menyebut bahwa
 *    berkas itulah yang harus disunting lalu dikirim balik;
 *  - "unggah" tersembunyi di bawah editor jadwal, bernama "Impor jadwal dari
 *    Excel" — istilah yang berbeda dari yang dicari orang ("template kurva-S");
 *  - **pratinjau tidak ada sama sekali**: satu-satunya cara tahu apa yang akan
 *    berubah adalah menerapkannya, lalu memulihkan versi lama kalau ternyata
 *    salah. Memperbaiki dengan cara merusak dulu.
 *
 * Di sini kelimanya jadi satu deret bernomor, dan langkah yang MENGUBAH DATA
 * RESMI berdiri sendiri di ujung — dengan akibatnya ditulis sebelum tombolnya,
 * bukan sesudah.
 */

type Langkah = 1 | 2 | 3 | 4 | 5;

const JUDUL: Record<Langkah, { judul: string; ket: string }> = {
  1: { judul: "Unduh template", ket: "Berisi jadwal baseline yang berlaku" },
  2: { judul: "Sunting di Excel", ket: "Ubah rentang/bobot mingguan" },
  3: { judul: "Unggah kembali", ket: "Berkas yang sudah disunting" },
  4: { judul: "Periksa hasilnya", ket: "Lihat apa yang berubah" },
  5: { judul: "Terapkan", ket: "Jadi baseline resmi baru" },
};

export function PerbaruiKurvaS({
  locationId,
  slug,
  baselineAktif,
}: {
  locationId: string;
  slug: string;
  baselineAktif: number | null;
}) {
  const [pratinjau, periksa, memeriksa] = useActionState<PratinjauState, FormData>(
    pratinjauJadwalAction,
    undefined,
  );
  const [terap, terapkan, menerapkan] = useActionState<RabActionState, FormData>(
    importJadwalAction,
    undefined,
  );

  const [namaBerkas, setNamaBerkas] = useState<string | null>(null);
  const [sudahUnduh, setSudahUnduh] = useState(false);
  const [sesuaikan, setSesuaikan] = useState(false);
  const berkasRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const data = pratinjau?.data ?? null;
  const selesai = !!terap?.success;

  // Langkah berjalan = yang PALING AWAL belum tuntas. Dihitung dari keadaan
  // sebenarnya, bukan disimpan terpisah — penanda langkah yang punya sumber
  // kebenaran sendiri cepat atau lambat berselisih dengan isinya.
  const aktif: Langkah = selesai ? 5 : data ? 4 : namaBerkas ? 3 : sudahUnduh ? 2 : 1;
  const tuntas = (n: Langkah): boolean =>
    selesai ? true : n === 1 ? sudahUnduh : n === 2 ? !!namaBerkas : n === 3 ? !!data : false;

  return (
    <section className="rounded-lg border border-primary-600/30 bg-primary-50/40">
      <header className="border-b border-border px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[13px] font-semibold text-ink">Perbarui Kurva-S dari Excel</p>
          <Badge tone="warning" label="Mengubah data resmi" />
        </div>
        <p className="mt-0.5 text-[11px] text-ink-muted">
          Satu alur terpandu: unduh template → sunting → unggah → periksa → terapkan. Selama belum
          diterapkan, tidak ada satu pun angka resmi yang berubah.
        </p>
      </header>

      {/* Deret langkah. Bukan hiasan: ia menjawab "saya sedang di mana" dan
          "berapa lagi", dua pertanyaan yang tak terjawab di halaman lama. */}
      <ol className="grid gap-1.5 border-b border-border p-3 sm:grid-cols-3 lg:grid-cols-5">
        {([1, 2, 3, 4, 5] as Langkah[]).map((n) => {
          const done = tuntas(n);
          const now = aktif === n && !done;
          return (
            <li
              key={n}
              aria-current={now ? "step" : undefined}
              className={cn(
                "flex items-start gap-2 rounded-md border p-2",
                done
                  ? "border-success-border bg-success-soft"
                  : now
                    ? "border-primary-600 bg-surface"
                    : "border-border bg-surface",
              )}
            >
              <span
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-bold",
                  done
                    ? "bg-success text-white"
                    : now
                      ? "bg-primary-600 text-white"
                      : "bg-surface-inset text-ink-muted",
                )}
              >
                {done ? <Check aria-hidden className="size-3" /> : n}
              </span>
              <span className="min-w-0">
                <span className="block text-[11px] font-semibold text-ink">{JUDUL[n].judul}</span>
                <span className="block text-[10px] leading-snug text-ink-muted">{JUDUL[n].ket}</span>
              </span>
            </li>
          );
        })}
      </ol>

      <div className="space-y-3 p-3">
        {/* ── 1 & 2 ─────────────────────────────────────────────────────── */}
        <div className="rounded-md border border-border bg-surface p-3">
          <p className="text-[12px] font-semibold text-ink">
            1. Mulai dari template baseline yang berlaku
          </p>
          <p className="mt-0.5 mb-2 text-[11px] text-ink-muted">
            Berkas ini sudah berisi seluruh pekerjaan dan jadwal baseline
            {baselineAktif != null ? ` #${baselineAktif}` : ""} yang aktif. Sunting rentang/bobot
            mingguannya di Excel, lalu kirim balik di langkah 3.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <ButtonLink
              href={`/lokasi/${slug}/jadwal/export`}
              unduhan
              size="sm"
              onClick={() => setSudahUnduh(true)}
            >
              <Download aria-hidden className="size-3.5" />
              Unduh template Kurva-S (.xlsx)
            </ButtonLink>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted">
              <PencilLine aria-hidden className="size-3.5" />
              2. Sunting di Excel — kolom minggu boleh dikosongkan (= jeda)
            </span>
          </div>
          {/* Yang SALAH diunggah adalah sumber kebingungan paling sering, jadi
              disebut di tempat orang akan membacanya — bukan di dokumentasi. */}
          <p className="mt-2 rounded border border-warning-border bg-warning-soft p-2 text-[11px] text-ink-muted">
            <strong className="font-semibold text-ink">Jangan unggah berkas RAB</strong>{" "}
            atau Excel buatan sendiri. Hanya template dari tombol di atas yang punya kolom minggu &amp; identitas
            pekerjaan yang bisa dibaca sistem.
          </p>
        </div>

        {/* ── 3 & 4: pilih berkas lalu periksa ──────────────────────────── */}
        {/* SATU form untuk langkah 3–5. Tombol "Terapkan" memakai
            `formAction`, sehingga berkas yang DITERAPKAN persis berkas yang
            barusan diperiksa — bukan salinan yang disusun ulang di klien. */}
        <form ref={formRef} action={periksa} className="space-y-3">
          <div className="rounded-md border border-border bg-surface p-3">
          <input type="hidden" name="locationId" value={locationId} />
          <p className="text-[12px] font-semibold text-ink">3. Unggah berkas yang sudah disunting</p>
          <p className="mt-0.5 mb-2 text-[11px] text-ink-muted">
            Belum ada yang berubah setelah ini — berkasnya hanya dibaca dan dihitung.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={berkasRef}
              type="file"
              name="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => setNamaBerkas(e.target.files?.[0]?.name ?? null)}
            />
            <Button type="button" size="sm" variant="secondary" onClick={() => berkasRef.current?.click()}>
              <FileUp aria-hidden className="size-3.5" />
              {namaBerkas ? "Ganti berkas…" : "Pilih berkas Excel…"}
            </Button>
            {namaBerkas ? (
              <span className="max-w-64 truncate text-[11px] text-ink-muted">{namaBerkas}</span>
            ) : null}
            <Button type="submit" size="sm" loading={memeriksa} disabled={!namaBerkas}>
              <ShieldCheck aria-hidden className="size-3.5" />
              4. Periksa hasilnya
            </Button>
          </div>

          <label className="mt-2 flex items-start gap-2 text-[11px] text-ink-muted">
            <input
              type="checkbox"
              name="sesuaikanRab"
              value="1"
              checked={sesuaikan}
              onChange={(e) => setSesuaikan(e.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-(--color-primary)"
            />
            <span>
              Sesuaikan bobot ke RAB — bentuk &amp; jeda dari Excel dipertahankan, tetapi bobot tiap
              pekerjaan diskalakan ke bobot RAB, dan pekerjaan yang belum dijadwalkan diisi otomatis.{" "}
              <span className="text-ink-muted/80">
                Kosongkan bila jadwal Anda sudah final — angka Excel dipakai apa adanya.
              </span>
            </span>
          </label>

          {pratinjau?.error ? (
            <div className="mt-2">
              <Banner tone="error" title={pratinjau.error} />
            </div>
          ) : null}
          </div>

        {/* ── Hasil pemeriksaan + langkah 5 ─────────────────────────────── */}
        {data ? (
          <div className="rounded-md border border-border bg-surface p-3">
            <p className="text-[12px] font-semibold text-ink">
              Hasil pemeriksaan — <span className="font-normal text-ink-muted">{data.namaBerkas}</span>
            </p>

            <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {data.periksa.map((p) => (
                <li key={p.judul} className="flex items-start gap-2 rounded border border-border p-2">
                  <span
                    className={cn(
                      "grid size-4 shrink-0 place-items-center rounded-full text-[9px] font-bold",
                      p.lolos ? "bg-success-soft text-success" : "bg-warning-soft text-warning",
                    )}
                  >
                    {p.lolos ? "✓" : "!"}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[11px] font-semibold text-ink">{p.judul}</span>
                    <span className="block text-[10px] leading-snug text-ink-muted">{p.rincian}</span>
                  </span>
                </li>
              ))}
            </ul>

            {data.perubahan.length > 0 ? (
              <div className="mt-3">
                <p className="text-[11px] text-ink-muted">
                  {data.jumlahMingguBerubah} minggu berubah
                  {data.jumlahMingguBerubah > data.perubahan.length
                    ? ` — ${data.perubahan.length} pertama ditampilkan`
                    : ""}
                  . Angka di bawah adalah %-kumulatif rencana.
                </p>
                <div className="mt-1.5 max-h-64 overflow-auto rounded border border-border">
                  <table className="w-full text-[11px]">
                    <thead className="sticky top-0 bg-surface-muted">
                      <tr className="text-left text-ink-muted uppercase">
                        <th className="px-2 py-1.5">Minggu</th>
                        <th className="px-2 py-1.5 text-right">
                          Baseline{data.baselineAktif != null ? ` #${data.baselineAktif}` : ""}
                        </th>
                        <th className="px-2 py-1.5 text-right">Berkas baru</th>
                        <th className="px-2 py-1.5 text-right">Selisih</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data.perubahan.map((r) => {
                        const d = r.lama == null ? null : r.baru - r.lama;
                        return (
                          <tr key={r.minggu}>
                            <td className="tabular px-2 py-1">{r.minggu}</td>
                            <td className="tabular px-2 py-1 text-right">
                              {r.lama == null ? "—" : `${r.lama.toFixed(2)}%`}
                            </td>
                            <td className="tabular px-2 py-1 text-right">{r.baru.toFixed(2)}%</td>
                            <td
                              className={cn(
                                "tabular px-2 py-1 text-right font-semibold",
                                d == null ? "text-ink-muted" : d > 0 ? "text-success" : "text-danger",
                              )}
                            >
                              {d == null ? "baru" : `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(2)} pp`}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {/* Langkah 5 dipisah garis: SEGALANYA di atasnya boleh dibatalkan
                dengan menutup halaman; yang di bawah tidak. */}
            <div className="mt-3 border-t border-border pt-3">
              <p className="text-[12px] font-semibold text-ink">5. Terapkan sebagai baseline baru</p>
              <ul className="mt-1 mb-2 space-y-0.5 text-[11px] text-ink-muted">
                <li>
                  • Baseline{data.baselineAktif != null ? ` #${data.baselineAktif}` : ""} TIDAK dihapus
                  — ia jadi histori dan bisa dipulihkan lewat Riwayat baseline.
                </li>
                <li>• Realisasi lapangan yang sudah tercatat tidak berubah sama sekali.</li>
                <li>• Deviasi &amp; prognosa selanjutnya dihitung terhadap baseline baru.</li>
                <li>• Siapa dan kapan tercatat di jejak audit.</li>
              </ul>

              {data.samaSaja ? (
                <Banner
                  tone="info"
                  title="Tidak perlu diterapkan"
                  description="Berkas ini menghasilkan kurva yang identik dengan baseline aktif."
                />
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="submit" formAction={terapkan} size="sm" loading={menerapkan}>
                    <Upload aria-hidden className="size-3.5" />
                    Terapkan sebagai baseline baru
                  </Button>
                  <span className="text-[11px] text-ink-muted">
                    Setelah ini, angka resmi memakai kurva yang barusan Anda periksa.
                  </span>
                </div>
              )}
            </div>
          </div>
        ) : null}
        </form>

        {terap?.error ? <Banner tone="error" title={terap.error} /> : null}
        {terap?.success ? (
          <div className="space-y-2">
            <Banner tone="success" title={terap.success} />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setNamaBerkas(null);
                setSudahUnduh(false);
                if (berkasRef.current) berkasRef.current.value = "";
                formRef.current?.reset();
              }}
            >
              <RefreshCw aria-hidden className="size-3.5" />
              Mulai pembaruan lain
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
