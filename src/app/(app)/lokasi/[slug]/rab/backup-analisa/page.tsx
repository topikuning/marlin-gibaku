import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Banner, ButtonLink, Card, CardBody, CardHeader, KpiCard, StatusPill } from "@/components/ui";
import { RincianBerkasRingkas } from "@/components/knmp/rincian-berkas-ringkas";
import { hasilBarisBackup, totalBackupIsian } from "@/lib/ahsp/rapl-calc";
import { can } from "@/lib/authz";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { db } from "@/lib/db";
import { formatNumber, formatRupiahSatuan, formatTanggalWaktu } from "@/lib/format";
import type { RingkasanRincian } from "@/lib/rab/rincian/baca";
import type { BarisBerkas, Kepala, TitikSel } from "@/lib/rab/rincian/lacak";
import { analisaRevisi, sumberBackupRevisi } from "@/lib/rab/rincian/sumber-backup";
import type { SumberBackup } from "@/lib/rab/rincian/warisan";
import { requireLocationPage } from "../../get-location";
import { FormIsian, TabelIsian, type BarisIsianView } from "./isian-backup";

export const metadata: Metadata = { title: "Backup volume & analisa" };
export const dynamic = "force-dynamic";

/**
 * BACKUP VOLUME & ANALISA PER REVISI (DECISIONS 651, diperluas baru 2026-10-07).
 *
 * Teguran user: *"dalam konteks konstruksi ada istilah back up volume, kenapa
 * kamu sama sekali tidak akomodir ini"*, lalu: *"rab non aktif (rab awal) yang
 * sudah di cco … tetap harus ada sumber informasi backup volumenya, kemudian
 * yang sudah di cco juga ketahuan backup volumenya"*.
 *
 * Revisi mana pun bisa dibuka (`?rev=`): RAB awal yang sudah digantikan, CCO
 * aktif, atau draft adendum. Tiap item menyebut DARI MANA backup volumenya:
 * berkas revisi itu, diwarisi dari revisi sebelumnya (volume sama), diisi di
 * MARLIN, atau belum ada – beserta sebabnya.
 *
 * Halaman ini tidak mengubah angka resmi. Volume, harga, dan nilai tetap dari
 * RAB; selisih antara RAB dan backup disebut, tidak dibetulkan.
 */
export default async function BackupAnalisaPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ item?: string; rev?: string }>;
}) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const { user, location } = await requireLocationPage(slug);
  requireCapabilityPage(user.role, "rab.view");

  const semua = await db.rabRevision.findMany({
    where: { locationId: location.id },
    orderBy: { revisionNo: "asc" },
    select: {
      id: true,
      revisionNo: true,
      status: true,
      source: true,
      sourceDocument: { select: { fileName: true } },
      rincian: true,
    },
  });
  const rev =
    semua.find((r) => r.id === sp.rev) ??
    semua.find((r) => r.status === "aktif") ??
    semua.find((r) => r.status === "draft") ??
    semua.at(-1) ??
    null;

  // Revisi aktif tidak perlu disebut di alamat; yang lain ya.
  const revQ = rev && rev.status !== "aktif" ? rev.id : undefined;
  const alamat = (q: { item?: string; rev?: string }) => {
    const p = new URLSearchParams();
    if (q.rev) p.set("rev", q.rev);
    if (q.item) p.set("item", q.item);
    const s = p.toString();
    return `/lokasi/${slug}/rab/backup-analisa${s ? `?${s}` : ""}`;
  };
  const kembali = (
    <ButtonLink
      href={sp.item ? alamat({ rev: revQ }) : `/lokasi/${slug}/rab`}
      variant="ghost"
      size="sm"
    >
      <ArrowLeft aria-hidden className="size-3.5" />
      {sp.item ? "Ringkasan" : "Kembali ke RAB"}
    </ButtonLink>
  );

  if (!rev) {
    return (
      <div className="max-w-4xl">
        <Card>
          <CardHeader title="Backup volume & analisa" action={kembali} />
          <CardBody>
            <Banner tone="info" title="Lokasi ini belum punya RAB" />
          </CardBody>
        </Card>
      </div>
    );
  }

  const { peta, ringkas } = await sumberBackupRevisi(rev.id);
  const bolehUbah = can(user.role, "rab.manage");
  const labelRev = (r: (typeof semua)[number]) =>
    `#${r.revisionNo} ${r.status === "aktif" ? "aktif" : r.status === "draft" ? "draft" : "lama"}`;
  const pemilih = (
    <div className="flex flex-wrap items-center gap-1.5 text-sm">
      <span className="text-ink-muted">Revisi:</span>
      {semua.map((r) => (
        <Link
          key={r.id}
          href={alamat({ rev: r.status === "aktif" ? undefined : r.id, item: sp.item })}
          aria-current={r.id === rev.id ? "page" : undefined}
          className={`rounded-full border px-2.5 py-0.5 ${r.id === rev.id ? "border-primary bg-primary-soft font-medium text-primary" : "border-border text-ink-muted hover:text-ink"}`}
        >
          {labelRev(r)}
        </Link>
      ))}
    </div>
  );

  if (sp.item) {
    return (
      <DetailItem
        slug={slug}
        rev={{ id: rev.id, revisionNo: rev.revisionNo }}
        lineageKey={sp.item}
        sumber={peta.get(sp.item) ?? null}
        kembali={kembali}
        pemilih={pemilih}
        bolehUbah={bolehUbah}
      />
    );
  }

  const [nodes, analisa, hargaDasar] = await Promise.all([
    db.rabNode.findMany({
      where: { revisionId: rev.id, kind: "item" },
      orderBy: { sortOrder: "asc" },
      select: { lineageKey: true, code: true, name: true, volume: true, unit: true },
    }),
    rev.rincian
      ? db.rabAnalisa.findMany({
          where: { revisionId: rev.id },
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
        })
      : Promise.resolve([]),
    rev.rincian
      ? db.rabHargaDasar.findMany({ where: { revisionId: rev.id }, orderBy: [{ sheet: "asc" }, { baris: "asc" }] })
      : Promise.resolve([]),
  ]);
  const tanpa = nodes.filter((n) => peta.get(n.lineageKey)?.jenis === "belum");
  const r = rev.rincian;

  return (
    <div className="max-w-5xl space-y-4">
      <Card>
        <CardHeader
          title="Backup volume & analisa"
          subtitle={`Revisi #${rev.revisionNo}${rev.sourceDocument ? ` · dari ${rev.sourceDocument.fileName}` : " · tanpa berkas sumber"}${r ? ` · ${r.asal === "impor" ? "dibaca saat impor" : "dilengkapi dari berkas arsip"} ${formatTanggalWaktu(r.dibuatAt)}` : ""}`}
          action={kembali}
        />
        <CardBody className="space-y-3">
          {pemilih}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Dari berkas revisi ini" value={formatNumber(ringkas.berkas)} sub={`dari ${ringkas.item} item`} />
            <KpiCard label="Diwarisi" value={formatNumber(ringkas.warisan)} sub="volume sama dengan revisi sebelumnya" />
            <KpiCard label="Diisi di MARLIN" value={formatNumber(ringkas.isian)} />
            <KpiCard
              label="Belum ada backup"
              value={formatNumber(ringkas.belum)}
              sub={
                ringkas.volumeBerubah + ringkas.baru > 0
                  ? `${ringkas.volumeBerubah} volume berubah, ${ringkas.baru} item baru`
                  : undefined
              }
              tone={ringkas.belum > 0 ? "warning" : "success"}
            />
          </div>
          {r ? (
            <RincianBerkasRingkas r={r.ringkasan as unknown as RingkasanRincian} tersembunyiDibaca={r.tersembunyiDibaca} />
          ) : rev.sourceDocument ? (
            <Banner
              tone="warning"
              title="Rincian berkas revisi ini belum dilengkapi"
              description={
                <span className="flex flex-wrap items-center gap-2">
                  <span>Berkas aslinya ({rev.sourceDocument.fileName}) masih ada, jadi bisa dilengkapi tanpa unggah ulang.</span>
                  {can(user.role, "system.manage") ? (
                    <ButtonLink href="/sistem/rincian-rab" variant="secondary" size="sm">
                      Lengkapi dari Sistem
                    </ButtonLink>
                  ) : null}
                </span>
              }
            />
          ) : (
            <Banner
              tone="info"
              title="Revisi ini dibuat tanpa berkas Excel"
              description="Item yang volumenya sama dengan revisi sebelumnya memakai backup revisi itu. Item yang volumenya berubah atau baru perlu diisi backup-nya di sini."
            />
          )}
        </CardBody>
      </Card>

      {tanpa.length > 0 ? (
        <Card>
          <CardHeader
            title={`Item tanpa backup volume (${tanpa.length})`}
            subtitle="Ketuk itemnya untuk melihat sebabnya dan mengisi backup-nya"
          />
          <CardBody>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-ink-muted">
                    <th className="py-2 pr-3">Kode</th>
                    <th className="py-2 pr-3">Uraian</th>
                    <th className="py-2 pr-3 text-right">Volume</th>
                    <th className="py-2">Sebab</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {tanpa.slice(0, 400).map((n) => {
                    const s = peta.get(n.lineageKey)!;
                    return (
                      <tr key={n.lineageKey}>
                        <td className="py-1.5 pr-3 text-xs whitespace-nowrap text-ink-muted">{n.code}</td>
                        <td className="py-1.5 pr-3">
                          <Link
                            href={alamat({ rev: revQ, item: n.lineageKey })}
                            className="text-primary hover:underline"
                          >
                            {n.name}
                          </Link>
                        </td>
                        <td className="tabular py-1.5 pr-3 text-right">
                          {n.volume != null ? formatNumber(Number(n.volume)) : "–"} {n.unit ?? ""}
                        </td>
                        <td className="py-1.5 text-ink-muted">{kalimatBelum(s)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {tanpa.length > 400 ? (
                <p className="mt-2 text-xs text-ink-muted">Ditampilkan 400 item pertama dari {tanpa.length}.</p>
              ) : null}
            </div>
          </CardBody>
        </Card>
      ) : null}

      {analisa.length > 0 ? (
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
      ) : null}

      {hargaDasar.length > 0 ? (
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
      ) : null}

      <p className="text-sm text-ink-muted">
        Rincian per item: buka RAB, lalu ketuk angka volume atau harga satuan yang bergaris bawah.
      </p>
    </div>
  );
}

const KATEGORI_LABEL: Record<string, string> = { upah: "Upah", bahan: "Bahan", alat: "Alat", lain: "Lain-lain" };

const STATUS_BV: Record<string, string> = {
  tertaut: "Tertaut ke sheet backup",
  angka_langsung: "Volume diketik langsung di sheet RAB – tidak ada backup",
  kosong: "Sel volume kosong di berkas",
  tidak_terbaca: "Rumusnya tidak bisa diikuti – lihat keterangannya",
};

/** Satu kalimat: kenapa item ini belum punya backup volume. */
function kalimatBelum(s: SumberBackup): string {
  if (s.jenis !== "belum") return "";
  const p = s.sebelumnya;
  switch (s.sebab) {
    case "volume_berubah":
      return `Volume berubah dari ${p?.volume != null ? formatNumber(Number(p.volume)) : "–"} di revisi #${p?.revisionNo}. Backup lama menghitung volume yang lain.`;
    case "baru":
      return "Item baru di revisi ini.";
    case "belum_dilengkapi":
      return "Rincian berkas revisi ini belum dilengkapi.";
    case "tanpa_berkas":
      return "Revisi ini dibuat tanpa berkas Excel, dan item ini tidak punya backup sebelumnya.";
    case "tanpa_backup":
      return s.berkas ? `${STATUS_BV[s.berkas] ?? s.berkas}.` : "Berkasnya tidak membawa backup untuk item ini.";
  }
}

function nilaiTampil(v: number | string | null): string {
  if (v == null) return "";
  if (typeof v === "number") return Number.isInteger(v) ? formatNumber(v) : v.toLocaleString("id-ID", { maximumFractionDigits: 4 });
  return v;
}

/** Baris isian satu item, hasilnya dihitung di calculation layer. */
async function muatIsian(revisionId: string, lineageKey: string, volumeRab: number | null) {
  const rows = await db.rabBackupIsian.findMany({
    where: { revisionId, lineageKey },
    orderBy: { urutan: "asc" },
    include: { dibuatOleh: { select: { fullName: true } } },
  });
  const angka = (d: { toString(): string } | null) => (d == null ? null : Number(d.toString()));
  const baris: BarisIsianView[] = rows.map((b) => {
    const u = { jumlah: angka(b.jumlah), panjang: angka(b.panjang), lebar: angka(b.lebar), tinggi: angka(b.tinggi), kurang: b.kurang };
    return {
      id: b.id,
      uraian: b.uraian,
      ...u,
      keterangan: b.keterangan,
      hasil: hasilBarisBackup(u),
      oleh: `${b.dibuatOleh.fullName}, ${formatTanggalWaktu(b.dibuatAt)}`,
    };
  });
  return { baris, ...totalBackupIsian(baris, volumeRab) };
}

async function BagianBerkas({ revisionId, lineageKey }: { revisionId: string; lineageKey: string }) {
  const [bv, rinci] = await Promise.all([
    db.rabBackupVolume.findUnique({ where: { revisionId_lineageKey: { revisionId, lineageKey } } }),
    db.rabRincianRevisi.findUnique({ where: { revisionId }, select: { kepala: true } }),
  ]);
  if (!bv) return null;
  const sumber = bv.sumber as unknown as TitikSel[];
  const baris = bv.baris as unknown as BarisBerkas[];
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-muted">{STATUS_BV[bv.status] ?? bv.status}</p>
      {bv.rumusRab ? (
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
              {s.tersembunyi ? <StatusPill tone="neutral" label="sheet tersembunyi" className="ml-1" /> : null}
            </span>
          ))}
          .
        </p>
      ) : null}
      {bv.catatan ? <Banner tone="warning" title={bv.catatan} /> : null}
      {baris.length > 0 ? (
        <TabelBaris baris={baris} kepala={(rinci?.kepala ?? {}) as unknown as Record<string, Kepala>} sorot={sumber} />
      ) : null}
    </div>
  );
}

async function DetailItem({
  slug,
  rev,
  lineageKey,
  sumber,
  kembali,
  pemilih,
  bolehUbah,
}: {
  slug: string;
  rev: { id: string; revisionNo: number };
  lineageKey: string;
  sumber: SumberBackup | null;
  kembali: React.ReactNode;
  pemilih: React.ReactNode;
  bolehUbah: boolean;
}) {
  const node = await db.rabNode.findUnique({
    where: { revisionId_lineageKey: { revisionId: rev.id, lineageKey } },
    select: { code: true, name: true, volume: true, unit: true, unitPrice: true, kind: true },
  });
  if (!node || node.kind !== "item" || !sumber) {
    return (
      <div className="max-w-4xl space-y-3">
        <Card>
          <CardHeader title="Item tidak ditemukan" action={kembali} />
          <CardBody className="space-y-3">
            {pemilih}
            <Banner tone="warning" title={`Item ini tidak ada di revisi #${rev.revisionNo}.`} />
          </CardBody>
        </Card>
      </div>
    );
  }
  const volume = node.volume == null ? null : Number(node.volume);
  const harga = node.unitPrice == null ? null : Number(node.unitPrice);
  const satuan = node.unit ?? "";

  // Isian milik revisi INI (boleh diubah), dan isian/berkas revisi asal (hanya dibaca).
  const isianSini = sumber.jenis === "isian" || sumber.jenis === "belum" ? await muatIsian(rev.id, lineageKey, volume) : null;
  const asal = sumber.jenis === "warisan" ? sumber : sumber.jenis === "belum" ? (sumber.sebelumnya?.sumber ?? null) : null;
  const isianAsal = asal && asal.jenis === "warisan" && asal.dari === "isian" ? await muatIsian(asal.revisionId, lineageKey, volume) : null;

  const sa = (await analisaRevisi(rev.id)).get(lineageKey) ?? null;
  const a = sa
    ? await db.rabAnalisa.findUnique({ where: { id: sa.analisaId }, include: { komponen: { orderBy: { urutan: "asc" } } } })
    : null;
  const hargaAnalisa = a?.hargaSatuan == null ? null : Number(a.hargaSatuan);

  return (
    <div className="max-w-5xl space-y-4">
      <Card>
        <CardHeader
          title={`${node.code} ${node.name}`}
          subtitle={`Revisi #${rev.revisionNo} · volume ${volume != null ? formatNumber(volume) : "–"} ${satuan} · harga satuan ${formatRupiahSatuan(harga)}`}
          action={kembali}
        />
        <CardBody>{pemilih}</CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Backup volume"
          subtitle={
            sumber.jenis === "berkas"
              ? "Dari berkas revisi ini"
              : sumber.jenis === "isian"
                ? "Diisi di MARLIN"
                : sumber.jenis === "warisan"
                  ? `Diwarisi dari revisi #${sumber.revisionNo}`
                  : "Belum ada"
          }
        />
        <CardBody className="space-y-3">
          {sumber.jenis === "berkas" ? <BagianBerkas revisionId={rev.id} lineageKey={lineageKey} /> : null}

          {sumber.jenis === "warisan" ? (
            <>
              <Banner
                tone="info"
                title={`Volume item ini sama dengan revisi #${sumber.revisionNo}, jadi backup-nya diambil dari sana`}
                description={
                  sumber.dari === "berkas"
                    ? "Baris di bawah dibaca dari berkas revisi itu."
                    : "Baris di bawah diisi di MARLIN untuk revisi itu."
                }
              />
              {sumber.dari === "berkas" ? (
                <BagianBerkas revisionId={sumber.revisionId} lineageKey={lineageKey} />
              ) : isianAsal ? (
                <TabelIsian baris={isianAsal.baris} total={isianAsal.total} volume={volume} selisih={isianAsal.selisih} satuan={satuan} bolehUbah={false} />
              ) : null}
            </>
          ) : null}

          {sumber.jenis === "belum" ? (
            <>
              <Banner tone="warning" title="Item ini belum punya backup volume" description={kalimatBelum(sumber)} />
              {sumber.berkas && sumber.berkas !== "tertaut" ? <BagianBerkas revisionId={rev.id} lineageKey={lineageKey} /> : null}
              {asal ? (
                <details className="text-sm">
                  <summary className="cursor-pointer text-primary">
                    Backup lama untuk volume {sumber.sebelumnya?.volume != null ? formatNumber(Number(sumber.sebelumnya.volume)) : "–"} (revisi #{sumber.sebelumnya?.revisionNo}) – hanya rujukan
                  </summary>
                  <div className="mt-2">
                    {asal.dari === "berkas" ? (
                      <BagianBerkas revisionId={asal.revisionId} lineageKey={lineageKey} />
                    ) : isianAsal ? (
                      <TabelIsian baris={isianAsal.baris} total={isianAsal.total} volume={null} selisih={null} satuan={satuan} bolehUbah={false} />
                    ) : null}
                  </div>
                </details>
              ) : null}
            </>
          ) : null}

          {isianSini && isianSini.baris.length > 0 ? (
            <TabelIsian
              baris={isianSini.baris}
              total={isianSini.total}
              volume={volume}
              selisih={isianSini.selisih}
              satuan={satuan}
              bolehUbah={bolehUbah}
            />
          ) : null}
          {bolehUbah && (sumber.jenis === "isian" || sumber.jenis === "belum") ? (
            <FormIsian revisionId={rev.id} lineageKey={lineageKey} />
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Analisa harga satuan"
          subtitle={
            a
              ? `${a.kode ?? "Tanpa kode"} · ${a.sheet}, baris ${a.barisAwal}–${a.barisAkhir}${sa?.warisan ? ` · dari berkas revisi #${sa.revisionNo}` : ""}`
              : "Item ini tidak punya analisa di berkasnya"
          }
        />
        {a ? (
          <CardBody className="space-y-3">
            {sa?.warisan ? (
              <Banner
                tone="info"
                title={`Harga satuan item ini sama dengan revisi #${sa.revisionNo}, jadi analisanya diambil dari berkas revisi itu`}
              />
            ) : null}
            {sa?.cara === "cocok_harga" ? (
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
              Baris item ini di berkasnya tidak menunjuk analisa, dan harga satuannya tidak sama persis dengan baris Resume
              Analisa mana pun. MARLIN tidak menebak pasangannya. Di RAPL, item seperti ini memakai padanan AHSP, atau draf
              analisa AI yang sudah Anda terima.
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
