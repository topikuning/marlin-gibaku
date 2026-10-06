import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Banner, ButtonLink, Card, CardBody, CardHeader, StatusPill } from "@/components/ui";
import { RincianBerkasRingkas } from "@/components/knmp/rincian-berkas-ringkas";
import { can } from "@/lib/authz";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { db } from "@/lib/db";
import { formatNumber, formatRupiahSatuan, formatTanggalWaktu } from "@/lib/format";
import type { RingkasanRincian } from "@/lib/rab/rincian/baca";
import type { BarisBerkas, Kepala, TitikSel } from "@/lib/rab/rincian/lacak";
import { requireLocationPage } from "../../get-location";

export const metadata: Metadata = { title: "Backup volume & analisa" };
export const dynamic = "force-dynamic";

/**
 * BACKUP VOLUME & ANALISA RAB AKTIF (DECISIONS baru 2026-10-06).
 *
 * Teguran user: *"dalam konteks konstruksi ada istilah back up volume, kenapa
 * kamu sama sekali tidak akomodir ini"*. Tanpa `item`: ringkasan revisi, daftar
 * analisa, dan bahan & upah. Dengan `item` (lineageKey): dari mana volume dan
 * harga satuan item itu berasal, persis seperti tertulis di berkasnya.
 *
 * Halaman ini hanya MENAMPILKAN. Angka resmi tetap dari RAB; selisih antara
 * RAB dan berkas disebut, tidak dibetulkan.
 */
export default async function RincianRabPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ item?: string }>;
}) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const { user, location } = await requireLocationPage(slug);
  requireCapabilityPage(user.role, "rab.view");

  const aktif = await db.rabRevision.findFirst({
    where: { locationId: location.id, status: "aktif" },
    select: {
      id: true,
      revisionNo: true,
      sourceDocument: { select: { fileName: true } },
      rincian: true,
    },
  });

  const kembali = (
    <ButtonLink href={sp.item ? `/lokasi/${slug}/rab/backup-analisa` : `/lokasi/${slug}/rab`} variant="ghost" size="sm">
      <ArrowLeft aria-hidden className="size-3.5" />
      {sp.item ? "Ringkasan" : "Kembali ke RAB"}
    </ButtonLink>
  );

  if (!aktif || !aktif.rincian) {
    return (
      <div className="max-w-4xl">
        <Card>
          <CardHeader title="Backup volume & analisa" action={kembali} />
          <CardBody>
            {!aktif ? (
              <Banner tone="info" title="Lokasi ini belum punya RAB aktif" />
            ) : (
              <Banner
                tone="warning"
                title={`Backup volume dan analisa revisi #${aktif.revisionNo} belum tersimpan`}
                description={
                  <span className="flex flex-wrap items-center gap-2">
                    <span>
                      {aktif.sourceDocument
                        ? `Berkas aslinya (${aktif.sourceDocument.fileName}) masih ada, jadi rinciannya bisa dilengkapi tanpa unggah ulang.`
                        : "Revisi ini tidak punya berkas sumber, jadi rinciannya tidak bisa dibaca."}
                    </span>
                    {aktif.sourceDocument && can(user.role, "system.manage") ? (
                      <ButtonLink href="/sistem/rincian-rab" variant="secondary" size="sm">
                        Lengkapi dari Sistem
                      </ButtonLink>
                    ) : null}
                  </span>
                }
              />
            )}
          </CardBody>
        </Card>
      </div>
    );
  }

  const kepala = aktif.rincian.kepala as unknown as Record<string, Kepala>;

  if (sp.item) {
    return (
      <DetailItem
        slug={slug}
        revisionId={aktif.id}
        revisionNo={aktif.revisionNo}
        lineageKey={sp.item}
        kepala={kepala}
        kembali={kembali}
      />
    );
  }

  const [analisa, hargaDasar] = await Promise.all([
    db.rabAnalisa.findMany({
      where: { revisionId: aktif.id },
      select: {
        id: true,
        kode: true,
        uraian: true,
        hargaSatuan: true,
        sheet: true,
        barisAwal: true,
        _count: { select: { komponen: true, items: true } },
      },
      orderBy: [{ sheet: "asc" }, { barisAwal: "asc" }],
    }),
    db.rabHargaDasar.findMany({
      where: { revisionId: aktif.id },
      orderBy: [{ sheet: "asc" }, { baris: "asc" }],
    }),
  ]);
  const r = aktif.rincian;

  return (
    <div className="max-w-5xl space-y-4">
      <Card>
        <CardHeader
          title="Backup volume & analisa"
          subtitle={`Revisi aktif #${aktif.revisionNo}${aktif.sourceDocument ? ` · dari ${aktif.sourceDocument.fileName}` : ""} · ${r.asal === "impor" ? "dibaca saat impor" : "dilengkapi dari berkas arsip"} ${formatTanggalWaktu(r.dibuatAt)}`}
          action={kembali}
        />
        <CardBody className="space-y-3">
          <RincianBerkasRingkas r={r.ringkasan as unknown as RingkasanRincian} tersembunyiDibaca={r.tersembunyiDibaca} />
          <p className="text-sm text-ink-muted">
            Rincian per item: buka RAB Aktif, lalu ketuk angka volume atau harga satuan yang bergaris bawah.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={`Analisa (${analisa.length})`} subtitle="Seperti tertulis di sheet analisa berkas, urut letaknya di berkas" />
        <CardBody>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase text-ink-muted">
                  <th className="py-2 pr-3">Kode</th>
                  <th className="py-2 pr-3">Uraian</th>
                  <th className="py-2 pr-3 text-right">Harga satuan</th>
                  <th className="py-2 pr-3 text-right">Komponen</th>
                  <th className="py-2 text-right">Dipakai item</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {analisa.map((a) => (
                  <tr key={a.id}>
                    <td className="py-1.5 pr-3 align-top text-xs whitespace-nowrap text-ink-muted">{a.kode ?? "–"}</td>
                    <td className="py-1.5 pr-3">
                      {a.uraian ?? "–"}
                      <span className="block text-[11px] text-ink-faint">
                        {a.sheet}, baris {a.barisAwal}
                      </span>
                    </td>
                    <td className="tabular py-1.5 pr-3 text-right align-top">
                      {a.hargaSatuan != null ? formatRupiahSatuan(Number(a.hargaSatuan)) : "–"}
                    </td>
                    <td className="tabular py-1.5 pr-3 text-right align-top">{a._count.komponen}</td>
                    <td className="tabular py-1.5 text-right align-top">{a._count.items}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={`Bahan & upah (${hargaDasar.length})`}
          subtitle="Yang dipakai analisa, dengan harga seperti di sheet Bahan & Upah berkas"
        />
        <CardBody>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase text-ink-muted">
                  <th className="py-2 pr-3">Nama</th>
                  <th className="py-2 pr-3">Satuan</th>
                  <th className="py-2 pr-3 text-right">Harga</th>
                  <th className="py-2">Letak di berkas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {hargaDasar.map((h) => (
                  <tr key={h.id}>
                    <td className="py-1.5 pr-3">{h.nama ?? "–"}</td>
                    <td className="py-1.5 pr-3 text-ink-muted">{h.satuan ?? "–"}</td>
                    <td className="tabular py-1.5 pr-3 text-right">
                      {h.harga != null ? formatRupiahSatuan(Number(h.harga)) : "–"}
                    </td>
                    <td className="py-1.5 text-xs text-ink-muted">
                      {h.sheet}!{h.sel}
                      {h.tersembunyi ? " (sheet tersembunyi)" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

const KATEGORI_LABEL: Record<string, string> = { upah: "Upah", bahan: "Bahan", alat: "Alat", lain: "Lain-lain" };

const STATUS_BV: Record<string, string> = {
  tertaut: "Tertaut ke sheet backup",
  angka_langsung: "Volume diketik langsung di sheet RAB – tidak ada backup",
  kosong: "Sel volume kosong di berkas",
  tidak_terbaca: "Rumusnya menunjuk sheet yang tidak ada",
};

function nilaiTampil(v: number | string | null): string {
  if (v == null) return "";
  if (typeof v === "number") return Number.isInteger(v) ? formatNumber(v) : v.toLocaleString("id-ID", { maximumFractionDigits: 4 });
  return v;
}

async function DetailItem({
  slug,
  revisionId,
  revisionNo,
  lineageKey,
  kepala,
  kembali,
}: {
  slug: string;
  revisionId: string;
  revisionNo: number;
  lineageKey: string;
  kepala: Record<string, Kepala>;
  kembali: React.ReactNode;
}) {
  const [node, bv, ia] = await Promise.all([
    db.rabNode.findUnique({
      where: { revisionId_lineageKey: { revisionId, lineageKey } },
      select: { code: true, name: true, volume: true, unit: true, unitPrice: true, kind: true },
    }),
    db.rabBackupVolume.findUnique({ where: { revisionId_lineageKey: { revisionId, lineageKey } } }),
    db.rabItemAnalisa.findUnique({
      where: { revisionId_lineageKey: { revisionId, lineageKey } },
      include: { analisa: { include: { komponen: { orderBy: { urutan: "asc" } } } } },
    }),
  ]);
  if (!node || node.kind !== "item") {
    return (
      <div className="max-w-4xl">
        <Card>
          <CardHeader title="Item tidak ditemukan" action={kembali} />
          <CardBody>
            <Banner tone="warning" title={`Item ini tidak ada di revisi aktif #${revisionNo}.`} />
          </CardBody>
        </Card>
      </div>
    );
  }
  const volume = node.volume == null ? null : Number(node.volume);
  const harga = node.unitPrice == null ? null : Number(node.unitPrice);
  const sumber = (bv?.sumber ?? []) as unknown as TitikSel[];
  const baris = (bv?.baris ?? []) as unknown as BarisBerkas[];
  const a = ia?.analisa ?? null;
  const hargaAnalisa = a?.hargaSatuan == null ? null : Number(a.hargaSatuan);

  return (
    <div className="max-w-5xl space-y-4">
      <Card>
        <CardHeader
          title={`${node.code} ${node.name}`}
          subtitle={`Revisi aktif #${revisionNo} · volume ${volume != null ? formatNumber(volume) : "–"} ${node.unit ?? ""} · harga satuan ${formatRupiahSatuan(harga)}`}
          action={kembali}
        />
      </Card>

      <Card>
        <CardHeader title="Backup volume" subtitle={bv ? STATUS_BV[bv.status] ?? bv.status : "Belum ada rincian untuk item ini"} />
        <CardBody className="space-y-3">
          {bv?.rumusRab ? (
            <p className="text-sm text-ink">
              Rumus di sheet RAB: <code className="rounded bg-surface-inset px-1.5 py-0.5 text-xs">={bv.rumusRab}</code>
            </p>
          ) : null}
          {sumber.length > 0 ? (
            <p className="text-sm text-ink">
              Diambil dari{" "}
              {sumber.map((s, i) => (
                <span key={`${s.sheet}!${s.sel}`}>
                  {i > 0 ? ", " : ""}
                  <span className="font-medium">
                    {s.sheet}!{s.sel}
                  </span>
                  {s.nilai != null ? ` = ${nilaiTampil(s.nilai)}` : ""}
                  {s.tersembunyi ? (
                    <StatusPill tone="neutral" label="sheet tersembunyi" className="ml-1" />
                  ) : null}
                </span>
              ))}
              .
            </p>
          ) : null}
          {bv?.catatan ? <Banner tone="warning" title={bv.catatan} /> : null}
          {baris.length > 0 ? <TabelBaris baris={baris} kepala={kepala} sorot={sumber} /> : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Analisa harga satuan"
          subtitle={
            a
              ? `${a.kode ?? "Tanpa kode"} · ${a.sheet}, baris ${a.barisAwal}–${a.barisAkhir}`
              : "Item ini tidak punya analisa di berkasnya"
          }
        />
        {a ? (
          <CardBody className="space-y-3">
            {ia?.cara === "cocok_harga" ? (
              <Banner
                tone="warning"
                title="Dicocokkan lewat harga, bukan rumus"
                description="Baris item ini di sheet RAB tidak menunjuk analisa mana pun. Analisa ini dipilih karena harga satuannya sama persis dengan satu-satunya baris Resume Analisa yang bernilai itu."
              />
            ) : null}
            {a.uraian ? <p className="text-sm text-ink">{a.uraian}</p> : null}
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span>
                Harga analisa: <span className="tabular font-medium">{formatRupiahSatuan(hargaAnalisa)}</span>
              </span>
              <span>
                Harga satuan kontrak: <span className="tabular font-medium">{formatRupiahSatuan(harga)}</span>
              </span>
              {harga != null && hargaAnalisa != null && Math.abs(harga - hargaAnalisa) > 0.005 ? (
                <span className="text-warning">
                  Selisih {formatRupiahSatuan(Math.round((harga - hargaAnalisa) * 100) / 100)} (
                  {((harga / hargaAnalisa - 1) * 100).toLocaleString("id-ID", { maximumFractionDigits: 2 })}%)
                </span>
              ) : null}
              {a.overhead != null ? (
                <span>Overhead & profit: {(Number(a.overhead) * 100).toLocaleString("id-ID", { maximumFractionDigits: 2 })}%</span>
              ) : null}
            </div>
            {a.komponen.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase text-ink-muted">
                      <th className="py-2 pr-3">Kelompok</th>
                      <th className="py-2 pr-3">Uraian</th>
                      <th className="py-2 pr-3 text-right">Koefisien</th>
                      <th className="py-2 pr-3">Satuan</th>
                      <th className="py-2 pr-3 text-right">Harga dasar</th>
                      <th className="py-2 text-right">Jumlah</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {a.komponen.map((k) => (
                      <tr key={k.id}>
                        <td className="py-1.5 pr-3 text-ink-muted">{KATEGORI_LABEL[k.kategori] ?? k.kategori}</td>
                        <td className="py-1.5 pr-3">{k.nama}</td>
                        <td className="tabular py-1.5 pr-3 text-right">
                          {k.koefisien != null ? Number(k.koefisien).toLocaleString("id-ID", { maximumFractionDigits: 6 }) : "–"}
                        </td>
                        <td className="py-1.5 pr-3 text-ink-muted">{k.satuan ?? "–"}</td>
                        <td className="tabular py-1.5 pr-3 text-right">
                          {k.harga != null ? formatRupiahSatuan(Number(k.harga)) : "–"}
                          {k.sumberSheet ? (
                            <span className="block text-[11px] text-ink-faint">
                              {k.sumberSheet}!{k.sumberSel}
                            </span>
                          ) : null}
                        </td>
                        <td className="tabular py-1.5 text-right">
                          {k.jumlah != null ? formatRupiahSatuan(Math.round(Number(k.jumlah) * 100) / 100) : "–"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-ink-muted">Komponennya tidak bisa diurai dari blok ini. Baris aslinya di bawah.</p>
            )}
            <details className="text-sm">
              <summary className="cursor-pointer text-primary">Baris asli blok analisa di berkas</summary>
              <div className="mt-2">
                <TabelBaris baris={a.baris as unknown as BarisBerkas[]} kepala={{}} sorot={[]} />
              </div>
            </details>
          </CardBody>
        ) : (
          <CardBody>
            <p className="text-sm text-ink-muted">
              Baris item ini di sheet RAB tidak menunjuk analisa, dan harga satuannya tidak sama persis dengan baris Resume
              Analisa mana pun. MARLIN tidak menebak pasangannya.
            </p>
          </CardBody>
        )}
      </Card>

      <p className="text-xs text-ink-muted">
        <Link href={`/lokasi/${slug}/rab`} className="text-primary hover:underline">
          Kembali ke RAB
        </Link>{" "}
        · Angka di halaman ini dibaca dari berkas apa adanya. Volume, harga, dan nilai resmi tetap dari RAB.
      </p>
    </div>
  );
}

/** Baris berkas sebagai tabel, kolom = gabungan kolom terisi, judul dari baris kepala sheet. */
function TabelBaris({ baris, kepala, sorot }: { baris: BarisBerkas[]; kepala: Record<string, Kepala>; sorot: TitikSel[] }) {
  const perSheet = new Map<string, BarisBerkas[]>();
  for (const b of baris) perSheet.set(b.sheet, [...(perSheet.get(b.sheet) ?? []), b]);
  const tersorot = new Set(sorot.map((s) => `${s.sheet}!${s.sel}`));
  return (
    <div className="space-y-3">
      {[...perSheet].map(([sheet, bs]) => {
        const kolom = [...new Set(bs.flatMap((b) => b.sel.map((s) => s.kolom)))].sort((p, q) => p - q);
        const huruf = new Map(bs.flatMap((b) => b.sel.map((s) => [s.kolom, s.huruf] as const)));
        const judul = kepala[sheet] ?? {};
        return (
          <div key={sheet} className="space-y-1">
            <p className="text-xs font-medium text-ink-muted">Sheet {sheet}</p>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-surface-muted text-left text-ink-muted">
                    <th className="px-2 py-1.5">Baris</th>
                    {kolom.map((c) => (
                      <th key={c} className="px-2 py-1.5 whitespace-nowrap">
                        {judul[c] ? `${judul[c]} (${huruf.get(c)})` : huruf.get(c)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {bs.map((b) => {
                    const sel = new Map(b.sel.map((s) => [s.kolom, s]));
                    return (
                      <tr key={b.baris}>
                        <td className="tabular px-2 py-1 text-ink-muted">{b.baris}</td>
                        {kolom.map((c) => {
                          const s = sel.get(c);
                          const sorotan = s && tersorot.has(`${sheet}!${s.huruf}${b.baris}`);
                          return (
                            <td
                              key={c}
                              title={s?.rumus ? `=${s.rumus}` : undefined}
                              className={`px-2 py-1 ${typeof s?.nilai === "number" ? "tabular text-right" : ""} ${sorotan ? "bg-warning-soft font-semibold" : ""}`}
                            >
                              {s ? nilaiTampil(s.nilai) : ""}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
      <p className="text-[11px] text-ink-faint">Sel yang disorot adalah sumber volume. Arahkan kursor ke angka untuk melihat rumusnya.</p>
    </div>
  );
}
