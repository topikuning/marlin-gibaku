import type { Metadata } from "next";
import Link from "next/link";
import { Banner, Card, CardBody, CardHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { cumulativeVolumeByLineage } from "@/lib/progress";
import { withPpn } from "@/lib/money";
import { diffRevisions, type RevisionDiff } from "@/lib/rab/adendum";
import { requireLocationPage } from "../../get-location";
import { AdendumEditor, type EditorNode } from "./adendum-editor";
import { CreateDraftForm, type AmendmentOption } from "./create-draft-form";
import { DraftControls } from "./draft-controls";

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
  const delta = active ? draft.totalValue - active.totalValue : draft.totalValue;

  // ── Peringatan nilai (informasi, bukan penghalang — MARLIN mencatat kenyataan) ──
  const peringatan: string[] = [];
  if (diff && revisiAwal && revisiAwal.totalValue > 0n) {
    // Perpres 16/2018: pekerjaan tambah maksimal 10% nilai kontrak awal.
    const batas = revisiAwal.totalValue / 10n;
    if (diff.totalTambah > batas) {
      peringatan.push(
        `Pekerjaan tambah ${fmtDelta(diff.totalTambah)} melebihi 10% nilai RAB kontrak awal ` +
          `(revisi #${revisiAwal.revisionNo} = Rp ${rupiah.format(revisiAwal.totalValue)}; batas Rp ${rupiah.format(batas)}) — ` +
          `Perpres 16/2018 membatasi pekerjaan tambah 10%. Pastikan dasar hukumnya kuat sebelum aktivasi.`,
      );
    }
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
      <Card>
        <CardHeader
          title={`Draft adendum — revisi #${draft.revisionNo}`}
          subtitle={
            (draft.amendment ? `Terkait CCO ${draft.amendment.ccoNumber} · ` : "") +
            (draft.note ??
              "Harga satuan item lama terkunci; volume minimal = realisasi; item ber-realisasi tidak bisa dihapus.")
          }
          action={
            <Link
              href={`/lokasi/${slug}/rab`}
              className="text-[13px] font-medium text-primary hover:underline"
            >
              ← Kembali ke RAB
            </Link>
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
            <DiffSection judul="Diubah (volume)" tone="warning" rows={diff.diubah} mode="ubah" />
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
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {r.hargaSatuan != null ? rupiah.format(r.hargaSatuan) : ""}
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
