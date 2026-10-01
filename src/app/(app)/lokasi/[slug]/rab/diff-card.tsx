import { Card, CardBody, CardHeader } from "@/components/ui";
import type { RevisionDiff } from "@/lib/rab/adendum";

/**
 * Tabel perubahan dua revisi RAB (hasil `diffRevisions`) – dipakai halaman
 * draft adendum DAN halaman "Bandingkan revisi" (DECISIONS 637), supaya dua
 * layar menyebut perubahan yang sama dengan cara yang sama.
 */

const rupiah = new Intl.NumberFormat("id-ID");
const volFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 });

export function DiffCard({
  diff,
  judul,
  subjudul = "Revisi lama tidak pernah diubah, jadi item yang dihapus pun tetap tercatat.",
  kosong: teksKosong = "Belum ada perubahan terhadap revisi aktif.",
}: {
  diff: RevisionDiff;
  judul: string;
  subjudul?: string;
  kosong?: string;
}) {
  const kosong =
    diff.ditambah.length === 0 && diff.dihapus.length === 0 && diff.diubah.length === 0 && diff.pembulatan.length === 0;
  return (
    <Card>
      <CardHeader
        title={judul}
        subtitle={subjudul}
      />
      <CardBody>
        {kosong ? (
          <p className="text-sm text-ink-muted">{teksKosong}</p>
        ) : (
          <div className="space-y-4">
            <DiffSection judul="Diubah (volume / harga)" tone="warning" rows={diff.diubah} mode="ubah" />
            <DiffSection judul="Ditambah" tone="success" rows={diff.ditambah} mode="tambah" />
            <DiffSection judul="Dihapus" tone="danger" rows={diff.dihapus} mode="hapus" />
            {/* Selisih pembulatan: volume & harga satuan sama, nilai beda Rp 1.
                Bukan perubahan lingkup, jadi tidak dihitung "diubah" – tapi
                disebut, bukan disembunyikan. Tertutup bawaan: ratusan baris ±1
                mengubur perubahan yang sebenarnya. */}
            {diff.pembulatan.length > 0 ? (
              <details className="rounded-lg border border-border px-3 py-2">
                <summary className="cursor-pointer text-[12px] font-semibold text-ink-muted uppercase">
                  Selisih pembulatan · {diff.pembulatan.length} item · volume &amp; harga sama, nilai beda Rp 1
                </summary>
                <p className="mt-1 mb-2 text-xs text-ink-muted">
                  Kedua berkas RAB membulatkan nilainya dengan cara berbeda (mis. 50 × 7.055,97 = 352.798,5 →
                  352.799 atau 352.798). Selisihnya tetap ikut dihitung dalam total tambah/kurang.
                </p>
                <DiffSection tone="muted" rows={diff.pembulatan} mode="ubah" />
              </details>
            ) : null}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function DiffSection({
  judul,
  tone,
  rows,
  mode,
}: {
  /** Kosong = tanpa kepala (bagian yang sudah berjudul di pembungkusnya). */
  judul?: string;
  tone: "success" | "warning" | "danger" | "muted";
  rows: RevisionDiff["diubah"];
  mode: "tambah" | "hapus" | "ubah";
}) {
  if (rows.length === 0) return null;
  const toneCls =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "muted"
          ? "text-ink-muted"
          : "text-danger";
  return (
    <div>
      {judul ? (
        <div className={`mb-1 text-[12px] font-semibold uppercase ${toneCls}`}>
          {judul} · {rows.length} item
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-175 text-[13px]">
          <thead>
            <tr className="bg-surface-inset/60 text-left text-[11px] font-semibold text-ink-muted uppercase">
              <th className="px-3 py-1.5">Item</th>
              <th className="px-3 py-1.5 text-right">Vol. lama</th>
              <th className="px-3 py-1.5 text-right">Vol. baru</th>
              <th className="px-3 py-1.5 text-right">Harga satuan</th>
              <th className="px-3 py-1.5 text-right">Nilai lama</th>
              <th className="px-3 py-1.5 text-right">Nilai baru</th>
              <th className="px-3 py-1.5 text-right">Δ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => {
              const d = r.amountBaru - r.amountLama;
              return (
                <tr key={r.lineageKey}>
                  <td className="px-3 py-1.5">
                    {/* Jalur induk DI ATAS nama: satu RAB bisa punya belasan
                        bangunan dengan nama pekerjaan yang berulang persis,
                        jadi "Pasangan batu" saja tidak memberi tahu di mana.
                        DECISIONS 423. */}
                    {r.jalur ? (
                      <span className="block text-[11px] text-ink-faint">{r.jalur}</span>
                    ) : null}
                    <span className="text-ink-muted">{r.code}</span> {r.name}
                    {r.unit ? <span className="text-ink-muted"> ({r.unit})</span> : null}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {r.volumeLama != null ? volFmt.format(r.volumeLama) : mode === "tambah" ? "–" : ""}
                  </td>
                  <td className="px-3 py-1.5 text-right font-medium tabular-nums">
                    {r.volumeBaru != null ? volFmt.format(r.volumeBaru) : mode === "hapus" ? "–" : ""}
                  </td>
                  {/* Harga item kontrak lama yang bergeser ditulis "lama → baru"
                      dan diberi warna bahaya: kalau hanya harga barunya yang
                      tampil, satu-satunya jejaknya cuma kolom Δ — dan Δ terlihat
                      sama saja seperti perubahan volume. DECISIONS 213. */}
                  <td
                    className={`px-3 py-1.5 text-right tabular-nums ${r.hargaBergeser ? "font-medium text-danger" : ""}`}
                  >
                    {r.hargaBergeser ? (
                      <>
                        {r.hargaSatuanLama != null ? rupiah.format(r.hargaSatuanLama) : "–"} →{" "}
                        {r.hargaSatuan != null ? rupiah.format(r.hargaSatuan) : "–"}
                      </>
                    ) : r.hargaSatuan != null ? (
                      rupiah.format(r.hargaSatuan)
                    ) : (
                      ""
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-ink-muted">
                    {mode === "tambah" ? "–" : rupiah.format(r.amountLama)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-medium tabular-nums">
                    {mode === "hapus" ? "–" : rupiah.format(r.amountBaru)}
                  </td>
                  <td
                    className={`px-3 py-1.5 text-right font-medium tabular-nums ${d >= 0n ? "text-success" : "text-danger"}`}
                  >
                    {d >= 0n ? "+" : "−"}
                    {rupiah.format(d < 0n ? -d : d)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
