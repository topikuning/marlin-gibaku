"use client";

import { useState, useTransition } from "react";
import { Banner, Button, StatusPill } from "@/components/ui";
import {
  auditPenyimpananAction,
  bersihkanPenyimpananAction,
  type AuditR2State,
} from "@/lib/system/actions";
import { perbaikiFotoHeicAction } from "@/lib/photo-restamp/actions";

/**
 * PENYIMPANAN R2 DI LAYAR — bukan di terminal.
 *
 * Pertanyaan user 2026-09-09: *"saat ini di cloudflare sudah mencapai 10GB,
 * bagaimana mengecek itu memang file-file efektif, atau ada beberapa sampah?"*.
 * Jawaban pertamanya berupa perintah `pnpm audit:r2`, dan itu ditolak dengan
 * benar: *"sejak kapan harus buka console lalu harus jalankan perintah itu!
 * kalau kamu ngasih solusi yang praktis!"*
 *
 * Alat pemeliharaan yang menuntut orang membuka terminal produksi bukan alat —
 * ia pekerjaan rumah yang dititipkan. Jadi: satu tombol Periksa, hasilnya
 * terbaca, dan satu tombol Bersihkan yang hanya menyentuh yang terbukti tidak
 * dipakai.
 *
 * Yang SENGAJA tidak dibuat sekali klik: penghapusan tanpa melihat daftarnya
 * lebih dulu. Penghapusan obyek storage tidak bisa dibatalkan, dan satu-satunya
 * salinan foto lapangan ber-GPS ada di sana.
 */
/**
 * Foto HEIC yang TERLANJUR masuk sebelum dekoder HEVC ada.
 *
 * Laporan user 2026-09-09: dua foto Besole tampil sebagai petak kosong. Kunci
 * R2-nya berakhir `.heic` — penanda pasti bahwa pipeline jatuh ke jalur
 * "simpan gambar asli". Sekarang dekodernya ada, tapi foto yang sudah tersimpan
 * tidak berubah sendiri: tetap tak terbaca peramban, dan tetap TANPA cap
 * Timemark. Tombol ini yang mengubahnya, tanpa siapa pun perlu membuka terminal.
 */
function PerbaikanHeic({ jumlah }: { jumlah: number }) {
  const [pesan, setPesan] = useState<string | null>(null);
  const [jalan, mulai] = useTransition();
  if (jumlah === 0 && !pesan) return null;
  return (
    <div className="space-y-2 rounded border border-warning/40 bg-warning-soft/40 px-2.5 py-2">
      <p className="text-sm text-ink">
        <span className="font-medium">{jumlah} foto tersimpan sebagai HEIC.</span> Peramban selain Safari
        tidak bisa menampilkannya, dan foto-foto itu tidak ber-cap Timemark – jadi ia gagal sebagai bukti
        lapangan, bukan cuma kosong di layar.
      </p>
      <p className="text-xs text-ink-muted">
        Perbaikan membaca ulang arsip aslinya, mengubahnya jadi webp ber-cap, dan menaikkan revisi cap.
        Nilai capnya tidak diubah satu pun. Aman diulang.
      </p>
      {pesan ? <Banner tone="success" title="Perbaikan foto HEIC" description={pesan} /> : null}
      <Button
        variant="secondary"
        loading={jalan}
        onClick={() =>
          mulai(async () => {
            const r = await perbaikiFotoHeicAction();
            setPesan(r?.ok ?? r?.error ?? null);
          })
        }
      >
        Perbaiki foto HEIC
      </Button>
    </div>
  );
}

export function PenyimpananPanel({
  configured,
  fotoHeic,
}: {
  configured: boolean;
  /** Berapa foto yang kuncinya masih .heic/.heif – dihitung di server. */
  fotoHeic: number;
}) {
  const [state, setState] = useState<AuditR2State>(undefined);
  const [pesanBersih, setPesanBersih] = useState<string | null>(null);
  const [mintaKonfirmasi, setMintaKonfirmasi] = useState(false);
  const [periksa, mulaiPeriksa] = useTransition();
  const [bersih, mulaiBersih] = useTransition();

  const hasil = state?.hasil;
  const jalankan = () =>
    mulaiPeriksa(async () => {
      setPesanBersih(null);
      setMintaKonfirmasi(false);
      setState(await auditPenyimpananAction());
    });

  if (!configured)
    return (
      <Banner
        tone="info"
        title="R2 belum dikonfigurasi"
        description="Isi R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY lebih dulu."
      />
    );

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-muted">
        Membandingkan isi bucket dengan seluruh rujukan di basis data. Obyek yang tidak dirujuk satu
        baris pun disebut <span className="font-medium text-ink">yatim</span> – itulah sampahnya.
      </p>
      <PerbaikanHeic jumlah={fotoHeic} />
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={jalankan} loading={periksa} variant="secondary">
          Periksa penyimpanan
        </Button>
        {periksa ? (
          <span className="text-xs text-ink-muted">
            Membaca seluruh isi bucket – bucket besar bisa memakan beberapa puluh detik.
          </span>
        ) : null}
      </div>

      {state?.error ? <Banner tone="error" title="Gagal memeriksa" description={state.error} /> : null}
      {pesanBersih ? <Banner tone="success" title="Pembersihan selesai" description={pesanBersih} /> : null}

      {hasil ? (
        <div className="space-y-3">
          {hasil.terpotong ? (
            <Banner
              tone="warning"
              title="Bucket terlalu besar untuk dibaca sekali jalan"
              description="Angka di bawah baru sebagian isi bucket. Bersihkan yang terlihat dulu, lalu periksa lagi."
            />
          ) : null}

          <div className="flex flex-wrap gap-4 text-sm">
            <Ringkas label="Total" nilai={ukuran(hasil.totalBytes)} sub={`${hasil.totalObyek} obyek`} />
            <Ringkas
              label="Yatim (sampah)"
              nilai={ukuran(hasil.yatimBytes)}
              sub={`${hasil.yatimObyek} obyek · ${persen(hasil.yatimBytes, hasil.totalBytes)} dari bucket`}
              tone={hasil.yatimBytes > 0 ? "danger" : "success"}
            />
            <Ringkas
              label="Terpakai"
              nilai={ukuran(hasil.totalBytes - hasil.yatimBytes)}
              sub={`${hasil.kolomDipindai} kolom rujukan dipindai`}
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase text-ink-muted">
                  <th className="py-1.5 pr-3">Kelompok</th>
                  <th className="py-1.5 pr-3 text-right">Obyek</th>
                  <th className="py-1.5 pr-3 text-right">Ukuran</th>
                  <th className="py-1.5 pr-3 text-right">Yatim</th>
                  <th className="py-1.5 text-right">Ukuran yatim</th>
                </tr>
              </thead>
              <tbody>
                {hasil.perPrefix.map((p) => (
                  <tr key={p.prefix} className="border-b border-border/60">
                    <td className="py-1.5 pr-3 font-medium text-ink">{p.prefix}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{p.obyek}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{ukuran(p.bytes)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{p.yatim || "–"}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {p.yatimBytes ? ukuran(p.yatimBytes) : "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {hasil.rujukanHilang.length > 0 ? (
            <Banner
              tone="error"
              title="Ada berkas yang HILANG dari penyimpanan"
              description={
                <ul className="list-disc pl-4">
                  {hasil.rujukanHilang.map((r) => (
                    <li key={r.label}>
                      {r.label}: {r.hilang} baris menunjuk berkas yang tidak ada di R2 – contoh{" "}
                      {r.contoh.join(", ")}
                    </li>
                  ))}
                  <li>Ini bukan sampah, ini kehilangan: layarnya akan menampilkan berkas yang gagal dimuat.</li>
                </ul>
              }
            />
          ) : (
            <p className="text-xs text-ink-muted">
              Setiap baris di basis data menunjuk berkas yang benar ada – tidak ada yang hilang.
            </p>
          )}

          {hasil.healthcheck.obyek > 0 ? (
            <p className="text-xs text-ink-muted">
              {hasil.healthcheck.obyek} sisa <code>healthcheck/</code> ({ukuran(hasil.healthcheck.bytes)}) –
              jejak tes R2 yang gagal membersihkan dirinya. Selalu aman dibuang.
            </p>
          ) : null}

          {hasil.yatimTerbesar.length > 0 ? (
            <details className="rounded border border-border px-2.5 py-2">
              <summary className="cursor-pointer text-sm font-medium text-ink">
                Yatim terbesar ({hasil.yatimTerbesar.length} teratas) – periksa sebelum menghapus
              </summary>
              <ul className="mt-2 space-y-0.5 text-xs text-ink-muted">
                {hasil.yatimTerbesar.map((o) => (
                  <li key={o.key} className="flex gap-2">
                    <span className="w-20 shrink-0 text-right tabular-nums">{ukuran(o.bytes)}</span>
                    <span className="w-14 shrink-0 text-right tabular-nums">
                      {o.umurHari == null ? "?" : `${o.umurHari} hari`}
                    </span>
                    <span className="break-all">{o.key}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {hasil.yatimObyek > 0 ? (
            <div className="space-y-2 rounded border border-danger/40 bg-danger-soft/40 px-2.5 py-2">
              <p className="text-sm text-ink">
                Hapus {hasil.yatimObyek} obyek yatim ({ukuran(hasil.yatimBytes)})? Yang dihapus hanya yang
                <span className="font-medium"> pada detik penghapusan </span>
                masih terbukti tidak dirujuk – daftarnya dihitung ulang di server, bukan diambil dari layar
                ini.
              </p>
              <p className="text-xs text-ink-muted">
                Tidak bisa dibatalkan. Untuk foto lapangan, R2 adalah satu-satunya salinan.
              </p>
              {mintaKonfirmasi ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="danger"
                    loading={bersih}
                    onClick={() =>
                      mulaiBersih(async () => {
                        const r = await bersihkanPenyimpananAction();
                        setPesanBersih(r?.success ?? r?.error ?? null);
                        setMintaKonfirmasi(false);
                        setState(await auditPenyimpananAction());
                      })
                    }
                  >
                    Ya, hapus sekarang
                  </Button>
                  <Button variant="ghost" onClick={() => setMintaKonfirmasi(false)}>
                    Batal
                  </Button>
                </div>
              ) : (
                <Button variant="secondary" onClick={() => setMintaKonfirmasi(true)}>
                  Bersihkan yang yatim
                </Button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <StatusPill tone="success" label="Bersih" />
              <span className="text-sm text-ink-muted">
                Tidak ada obyek yatim – seluruh isi bucket masih dipakai.
              </span>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Ringkas({
  label,
  nilai,
  sub,
  tone,
}: {
  label: string;
  nilai: string;
  sub: string;
  tone?: "danger" | "success";
}) {
  return (
    <div className="rounded border border-border px-3 py-2">
      <p className="text-xs uppercase text-ink-muted">{label}</p>
      <p
        className={`text-lg font-semibold tabular-nums ${
          tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : "text-ink"
        }`}
      >
        {nilai}
      </p>
      <p className="text-xs text-ink-muted">{sub}</p>
    </div>
  );
}

function ukuran(b: number): string {
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(2)} GB`;
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024).toFixed(0)} KB`;
}

function persen(a: number, b: number): string {
  return b > 0 ? `${((a / b) * 100).toFixed(1)}%` : "0%";
}
