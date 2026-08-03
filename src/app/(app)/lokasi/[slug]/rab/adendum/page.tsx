import type { Metadata } from "next";
import Link from "next/link";
import { Banner, ButtonLink, Card, CardBody, CardHeader } from "@/components/ui";
import { ArrowLeft, Download, FileSpreadsheet } from "lucide-react";
import { db } from "@/lib/db";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { cumulativeVolumeByLineage } from "@/lib/progress";
import { withPpn } from "@/lib/money";
import { diffRevisions, type RevisionDiff } from "@/lib/rab/adendum";
import { ringkasPersetujuan } from "@/lib/rab/persetujuan";
import { bolehMenyetujui } from "@/lib/rab/persetujuan-aturan";
import { ROLE_LABEL } from "@/lib/authz";
import { formatTanggal } from "@/lib/format";
import { requireLocationPage } from "../../get-location";
import { AdendumEditor, type EditorNode } from "./adendum-editor";
import { CreateDraftForm, type AmendmentOption } from "./create-draft-form";
import { DraftControls } from "./draft-controls";
import { ImportForm } from "../import/import-form";

export const metadata: Metadata = { title: "Adendum RAB" };
export const dynamic = "force-dynamic";

const rupiah = new Intl.NumberFormat("id-ID");
const volFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 });

function fmtDelta(d: bigint): string {
  return `${d >= 0n ? "+" : "−"}Rp ${rupiah.format(d < 0n ? -d : d)}`;
}

export default async function AdendumPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { user, location } = await requireLocationPage(slug);
  requireCapabilityPage(user.role, "rab.manage");

  const contract = location.package.contract;
  const ppnPercent = contract ? Number(contract.ppnPercent) : 11;

  const [revisions, amendments] = await Promise.all([
    db.rabRevision.findMany({
      where: { locationId: location.id, status: { in: ["aktif", "draft"] } },
      select: {
        id: true,
        revisionNo: true,
        status: true,
        totalValue: true,
        note: true,
        amendment: { select: { id: true, ccoNumber: true, valueDelta: true } },
      },
    }),
    contract
      ? db.contractAmendment.findMany({
          where: { contractId: contract.id },
          orderBy: { effectiveDate: "asc" },
          select: { id: true, ccoNumber: true, effectiveDate: true, valueDelta: true },
        })
      : Promise.resolve([]),
  ]);
  const active = revisions.find((r) => r.status === "aktif") ?? null;
  const draft = revisions.find((r) => r.status === "draft") ?? null;

  if (!active && !draft) {
    return (
      <Card>
        <CardHeader title="Adendum RAB" />
        <CardBody>
          <p className="text-sm text-ink-muted">
            Belum ada revisi RAB aktif — adendum butuh RAB untuk disalin. Impor HPS dulu di{" "}
            <Link href={`/lokasi/${slug}/rab/import`} className="font-medium text-primary hover:underline">
              Impor HPS
            </Link>
            .
          </p>
        </CardBody>
      </Card>
    );
  }

  if (!draft) {
    const amendmentOptions: AmendmentOption[] = amendments.map((a) => ({
      id: a.id,
      ccoNumber: a.ccoNumber,
      effectiveDate: a.effectiveDate.toISOString(),
      valueDelta: a.valueDelta.toString(),
    }));
    return (
      <Card>
        <CardHeader
          title="Adendum RAB"
          subtitle={`Revisi aktif #${active!.revisionNo} · Rp ${rupiah.format(active!.totalValue)} — draft adendum menyalinnya penuh; angka live tidak tersentuh sampai draft diaktifkan.`}
        />
        <CardBody>
          <CreateDraftForm slug={slug} amendments={amendmentOptions} />
        </CardBody>
      </Card>
    );
  }

  // ── Draft ada: susun node terurut pohon + tanda BARU/UBAH vs revisi aktif ──
  const [draftNodes, activeItems, realizedMap, revisiAwal] = await Promise.all([
    db.rabNode.findMany({
      where: { revisionId: draft.id },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        parentId: true,
        kind: true,
        code: true,
        name: true,
        unit: true,
        volume: true,
        unitPrice: true,
        amount: true,
        lineageKey: true,
      },
    }),
    active
      ? db.rabNode.findMany({
          where: { revisionId: active.id },
          select: { lineageKey: true, volume: true, amount: true },
        })
      : Promise.resolve([]),
    cumulativeVolumeByLineage(location.id),
    db.rabRevision.findFirst({
      where: { locationId: location.id },
      orderBy: { revisionNo: "asc" },
      select: { totalValue: true, revisionNo: true },
    }),
  ]);
  const activeByLineage = new Map(activeItems.map((n) => [n.lineageKey, n]));

  // Urut pohon (anak di bawah induknya) + depth untuk indentasi.
  const byParent = new Map<string | null, typeof draftNodes>();
  for (const n of draftNodes) {
    const arr = byParent.get(n.parentId) ?? [];
    arr.push(n);
    byParent.set(n.parentId, arr);
  }
  // Realisasi per subtree: node dengan realisasi (atau turunannya) tidak bisa dihapus.
  const subtreeRealized = new Map<string, number>();
  const sumRealized = (id: string, lineageKey: string, kind: string): number => {
    let sum = kind === "item" ? (realizedMap.get(lineageKey) ?? 0) : 0;
    for (const c of byParent.get(id) ?? []) sum += sumRealized(c.id, c.lineageKey, c.kind);
    subtreeRealized.set(id, sum);
    return sum;
  };
  for (const r of byParent.get(null) ?? []) sumRealized(r.id, r.lineageKey, r.kind);

  const nodes: EditorNode[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const n of byParent.get(parentId) ?? []) {
      const lama = activeByLineage.get(n.lineageKey);
      const volume = n.volume == null ? null : Number(n.volume);
      const volumeLama = lama?.volume == null ? null : Number(lama.volume);
      const amountLama = lama?.amount ?? 0n;
      nodes.push({
        id: n.id,
        parentId: n.parentId,
        kind: n.kind as EditorNode["kind"],
        code: n.code,
        name: n.name,
        unit: n.unit,
        volume,
        volumeLama,
        unitPrice: n.unitPrice == null ? null : Number(n.unitPrice),
        amount: n.amount.toString(),
        amountLama: amountLama.toString(),
        delta: (n.amount - amountLama).toString(),
        lineageKey: n.lineageKey,
        realized: realizedMap.get(n.lineageKey) ?? 0,
        isNew: !lama,
        isChanged:
          n.kind === "item" && lama != null && Math.abs((volume ?? 0) - (volumeLama ?? 0)) > 1e-6,
        canDelete: (subtreeRealized.get(n.id) ?? 0) <= 1e-6,
        depth,
      });
      walk(n.id, depth + 1);
    }
  };
  walk(null, 0);

  const diff = active ? await diffRevisions(active.id, draft.id) : null;

  /*
   * EMPAT MATA (DECISIONS 234). `null` bila belum ada RAB aktif — itu HPS awal,
   * bukan adendum: tidak ada kontrak berjalan yang digantikan, jadi tidak ada
   * yang perlu ditandatangani berdua.
   */
  const persetujuan = active
    ? await (async () => {
        const r = await ringkasPersetujuan(draft.id);
        return {
          lengkap: r.lengkap,
          kurang: r.kurang,
          berlaku: r.berlaku.map((v) => ({
            nama: v.nama,
            peran: ROLE_LABEL[v.role],
            waktu: formatTanggal(v.approvedAt, "d MMM yyyy HH.mm"),
          })),
          gugur: r.gugur.map((v) => ({ nama: v.nama, peran: ROLE_LABEL[v.role] })),
          bolehTtd: bolehMenyetujui(user.role),
          sudahTtd: r.berlaku.some((v) => v.userId === user.id),
        };
      })()
    : null;
  const delta = active ? draft.totalValue - active.totalValue : draft.totalValue;

  // ── Peringatan nilai (informasi, bukan penghalang — MARLIN mencatat kenyataan) ──
  const peringatan: string[] = [];
  if (diff && revisiAwal && revisiAwal.totalValue > 0n) {
    /*
     * Batas 10% Perpres 16/2018 Pasal 54 mengukur KENAIKAN NILAI KONTRAK
     * (nilai akhir vs nilai awal) — BUKAN jumlah kotor pekerjaan tambah.
     *
     * Dulu yang diuji `totalTambah` (Σ kenaikan per item). Akibatnya adendum
     * yang hanya MENUKAR pekerjaan — kurangi sana, tambah sini, nilai total
     * praktis sama — dituduh melanggar batas 10%. Terjadi nyata (laporan user
     * 2026-08-03): tambah +Rp 1.044.616.688, kurang −Rp 1.044.616.680, nilai
     * kontrak naik Rp 8, dan peringatannya tetap berteriak melanggar.
     *
     * Peringatan yang menyala pada keadaan yang sah adalah cara tercepat
     * membuat semua peringatan diabaikan — termasuk yang benar. DECISIONS 233.
     */
    const batas = revisiAwal.totalValue / 10n;
    if (delta > batas) {
      peringatan.push(
        `Nilai kontrak naik ${fmtDelta(delta)} — melebihi 10% nilai RAB kontrak awal ` +
          `(revisi #${revisiAwal.revisionNo} = Rp ${rupiah.format(revisiAwal.totalValue)}; batas Rp ${rupiah.format(batas)}). ` +
          `Perpres 16/2018 Pasal 54 membatasi kenaikan nilai kontrak 10%. Pastikan dasar hukumnya kuat sebelum aktivasi.`,
      );
    } else if (diff.totalTambah > batas) {
      /*
       * Nilai total aman, tapi isinya berpindah banyak. Ini BUKAN pelanggaran
       * batas 10% — tetapi tukar-menukar sebesar ini mengubah lingkup yang
       * disepakati, jadi tetap disebut, dengan nama yang benar.
       */
      peringatan.push(
        `Nilai kontrak hampir tidak berubah (${fmtDelta(delta)}), tetapi lingkupnya banyak bergeser: ` +
          `pekerjaan tambah ${fmtDelta(diff.totalTambah)} dan pekerjaan kurang ${fmtDelta(diff.totalKurang)}. ` +
          `Ini bukan pelanggaran batas 10% Perpres 16/2018 (yang dibatasi kenaikan NILAI kontrak), ` +
          `tetapi perubahan lingkup sebesar ini perlu dasar tertulis di dokumen adendum.`,
      );
    }
  }
  // Harga satuan item KONTRAK LAMA yang bergeser (DECISIONS 213). Adendum
  // mengubah VOLUME; harga yang sudah disepakati tidak boleh ikut bergerak,
  // karena nilai kontrak berubah tanpa ada pekerjaan yang bertambah. Editor
  // draft memang mengunci harga item lama — peringatan ini menangkap jalur
  // lain, terutama draft yang diisi lewat impor Excel.
  const hargaBergeser = diff?.diubah.filter((r) => r.hargaBergeser) ?? [];
  if (hargaBergeser.length > 0) {
    const contoh = hargaBergeser
      .slice(0, 5)
      .map(
        (r) =>
          `${r.code} ${r.name} (${r.hargaSatuanLama != null ? rupiah.format(r.hargaSatuanLama) : "—"} → ${
            r.hargaSatuan != null ? rupiah.format(r.hargaSatuan) : "—"
          })`,
      );
    peringatan.push(
      `Harga satuan ${hargaBergeser.length} item KONTRAK LAMA bergeser di draft ini: ` +
        `${contoh.join("; ")}${hargaBergeser.length > contoh.length ? `; +${hargaBergeser.length - contoh.length} lainnya` : ""}. ` +
        `Adendum mengubah volume — harga item yang sudah ada di kontrak seharusnya tetap. ` +
        `Pastikan pergeseran ini memang ada dasarnya sebelum aktivasi.`,
    );
  }
  if (diff && draft.amendment) {
    const deltaInclPpn = withPpn(diff.delta, ppnPercent);
    if (deltaInclPpn !== draft.amendment.valueDelta) {
      peringatan.push(
        `Δ RAB draft termasuk PPN ${ppnPercent}% = ${fmtDelta(deltaInclPpn)}, sedangkan CCO ` +
          `${draft.amendment.ccoNumber} tercatat ${fmtDelta(draft.amendment.valueDelta)}. ` +
          `Samakan dulu (edit draft atau betulkan CCO di halaman Kontrak) supaya nilai kontrak berjalan cocok.`,
      );
    }
  }

  const ringkasan = diff
    ? `${diff.ditambah.length} item baru · ${diff.dihapus.length} dihapus · ${diff.diubah.length} diubah · Δ ${fmtDelta(diff.delta)} (pra-PPN)`
    : `Total Rp ${rupiah.format(draft.totalValue)}`;

  return (
    <div className="space-y-4">
      {/* Impor Excel LANGSUNG ke draft ini. Sebelumnya satu-satunya jalur impor
          selalu mengaktifkan revisi, jadi adendum yang masih diajukan terpaksa
          diperlakukan seolah sudah sah (DECISIONS 209). */}
      <Card>
        <CardHeader
          title="Isi draft dari file Excel"
          subtitle="Ganti seluruh isi draft dengan file adendum. RAB aktif, progres, kurva-S, dan keuangan tidak tersentuh."
          action={
            <ButtonLink href={`/lokasi/${slug}/rab/adendum/template`} variant="secondary" size="sm" unduhan>
              <Download aria-hidden className="size-3.5" />
              Unduh template adendum
            </ButtonLink>
          }
        />
        <CardBody>
          {/* Template kerja: RAB aktif + kolom VOLUME ADENDUM siap isi
              (DECISIONS 216). Diunggah balik lewat form yang sama — sistem
              mengenalinya dari penanda di berkasnya. */}
          <p className="mb-3 rounded-md border border-border bg-surface-muted px-3 py-2 text-[13px] text-ink-muted">
            Belum punya file adendum? <strong className="text-ink">Unduh template</strong> di atas —
            isinya RAB aktif dengan kolom <strong className="text-ink">VOLUME ADENDUM</strong> siap
            diisi, lalu unggah balik di sini. Harga satuan item kontrak lama tetap; item baru
            disisipkan di dalam kategorinya. Volume 0 berarti volumenya nol,{" "}
            <strong className="text-ink">bukan</strong> item dihapus — untuk mencabut item, tulis{" "}
            <code className="rounded bg-surface-inset px-1">HAPUS</code> di kolom Keterangan.
          </p>
          {/* adaAktif WAJIB diisi. Halaman ini hanya dirender ketika lokasi punya
              RAB aktif (draft adendum disalin darinya), tapi ImportForm tidak
              bisa menebak itu: bawaannya false, dan itu MENGUNCI pilihan "Isi
              DRAFT adendum" sambil memasang alasan "Belum ada RAB aktif" yang
              justru terbalik di halaman ini. */}
          <ImportForm locationId={location.id} adaAktif modeAwal="draft" />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={`Draft adendum — revisi #${draft.revisionNo}`}
          subtitle={
            (draft.amendment ? `Terkait CCO ${draft.amendment.ccoNumber} · ` : "") +
            (draft.note ??
              "Harga satuan item lama terkunci; volume minimal = realisasi; item ber-realisasi tidak bisa dihapus.")
          }
          action={
            <div className="flex flex-wrap items-center gap-2">
              {/* Dokumen pengajuan CCO format KKP (DECISIONS 236). Butuh RAB
                  aktif DAN draft sekaligus — MC-0 vs CCO-01 — jadi tombolnya
                  hanya masuk akal di kartu draft ini. */}
              <ButtonLink href={`/lokasi/${slug}/rab/adendum/cco`} variant="secondary" size="sm" unduhan>
                <FileSpreadsheet aria-hidden className="size-3.5" />
                Unduh CCO (format KKP)
              </ButtonLink>
              <ButtonLink href={`/lokasi/${slug}/rab`} variant="ghost" size="sm">
                <ArrowLeft aria-hidden className="size-3.5" />
                Kembali ke RAB
              </ButtonLink>
            </div>
          }
        />
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 rounded-lg bg-surface-inset/60 px-4 py-3 text-sm">
            {active ? (
              <span className="text-ink-muted">
                Nilai lama{" "}
                <span className="font-semibold text-ink tabular-nums">Rp {rupiah.format(active.totalValue)}</span>
              </span>
            ) : null}
            <span className="text-ink-muted">
              Nilai baru{" "}
              <span className="font-semibold text-ink tabular-nums">Rp {rupiah.format(draft.totalValue)}</span>
            </span>
            <span className={delta >= 0n ? "font-semibold text-success" : "font-semibold text-danger"}>
              {fmtDelta(delta)}
            </span>
            {diff ? (
              <span className="text-[12px] text-ink-muted">
                tambah {fmtDelta(diff.totalTambah)} · kurang {fmtDelta(diff.totalKurang)}
              </span>
            ) : null}
          </div>
          {peringatan.map((p) => (
            <Banner key={p} tone="warning" title={p} />
          ))}
          <AdendumEditor slug={slug} revisionId={draft.id} nodes={nodes} />
          <DraftControls
            revisionId={draft.id}
            revisionNo={draft.revisionNo}
            ringkasan={ringkasan}
            adaPeringatan={peringatan.length > 0}
            persetujuan={persetujuan}
          />
        </CardBody>
      </Card>

      {diff ? <DiffCard diff={diff} activeNo={active!.revisionNo} draftNo={draft.revisionNo} /> : null}
    </div>
  );
}

/** Ringkasan perubahan vs revisi aktif — item terhapus TETAP terlihat di sini. */
function DiffCard({ diff, activeNo, draftNo }: { diff: RevisionDiff; activeNo: number; draftNo: number }) {
  const kosong = diff.ditambah.length === 0 && diff.dihapus.length === 0 && diff.diubah.length === 0;
  return (
    <Card>
      <CardHeader
        title={`Perubahan revisi #${activeNo} → draft #${draftNo}`}
        subtitle="Jejak permanen — revisi lama tidak pernah diubah, jadi item yang dihapus tetap tercatat."
      />
      <CardBody>
        {kosong ? (
          <p className="text-sm text-ink-muted">Belum ada perubahan terhadap revisi aktif.</p>
        ) : (
          <div className="space-y-4">
            <DiffSection judul="Diubah (volume / harga)" tone="warning" rows={diff.diubah} mode="ubah" />
            <DiffSection judul="Ditambah" tone="success" rows={diff.ditambah} mode="tambah" />
            <DiffSection judul="Dihapus" tone="danger" rows={diff.dihapus} mode="hapus" />
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
  judul: string;
  tone: "success" | "warning" | "danger";
  rows: RevisionDiff["diubah"];
  mode: "tambah" | "hapus" | "ubah";
}) {
  if (rows.length === 0) return null;
  const toneCls =
    tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-danger";
  return (
    <div>
      <div className={`mb-1 text-[12px] font-semibold uppercase ${toneCls}`}>
        {judul} · {rows.length} item
      </div>
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
                    <span className="text-ink-muted">{r.code}</span> {r.name}
                    {r.unit ? <span className="text-ink-muted"> ({r.unit})</span> : null}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {r.volumeLama != null ? volFmt.format(r.volumeLama) : mode === "tambah" ? "—" : ""}
                  </td>
                  <td className="px-3 py-1.5 text-right font-medium tabular-nums">
                    {r.volumeBaru != null ? volFmt.format(r.volumeBaru) : mode === "hapus" ? "—" : ""}
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
                        {r.hargaSatuanLama != null ? rupiah.format(r.hargaSatuanLama) : "—"} →{" "}
                        {r.hargaSatuan != null ? rupiah.format(r.hargaSatuan) : "—"}
                      </>
                    ) : r.hargaSatuan != null ? (
                      rupiah.format(r.hargaSatuan)
                    ) : (
                      ""
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-ink-muted">
                    {mode === "tambah" ? "—" : rupiah.format(r.amountLama)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-medium tabular-nums">
                    {mode === "hapus" ? "—" : rupiah.format(r.amountBaru)}
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
