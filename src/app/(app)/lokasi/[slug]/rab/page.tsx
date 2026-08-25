import type { Metadata } from "next";
import { Download, FilePen, Upload } from "lucide-react";
import { Banner, ButtonLink, Card, CardBody, CardHeader, SubTabs } from "@/components/ui";
import { db } from "@/lib/db";
import { can } from "@/lib/authz";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { getLocationProgress, COUNTED_REPORT_STATUSES } from "@/lib/progress";
import { ppnAmount, withPpn } from "@/lib/money";
import { formatRupiah, formatTanggal } from "@/lib/format";
import { bacaBagian, hrefBagian, type BagianRab } from "@/lib/rab/bagian";
import { requireLocationPage } from "../get-location";
import { RabTree, type RabNodeRow } from "./rab-tree";
import { RevisionList, type RevisionRow } from "./revision-list";
import { getRencanaMingguan } from "@/lib/plan/rencana-mingguan";
import {
  WeeklyPlanSection,
  type LeafOption,
  type PlanItemRow,
  type RingkasRencana,
} from "./weekly-plan";

export const metadata: Metadata = { title: "Rencana & RAB" };
export const dynamic = "force-dynamic";

const DAY_MS = 24 * 3600 * 1000;

/**
 * RENCANA & RAB — tiga bagian setara, dipisah SUB-TAB (DECISIONS 362).
 *
 * Sebelumnya ketiganya ditumpuk sebagai tiga kartu di satu halaman, dengan
 * pohon RAB — ratusan item — sebagai kartu pertama. Akibatnya "Rencana
 * mingguan" dan "Riwayat revisi" ada di bawah gulungan yang sangat panjang.
 * Laporan user 2026-08-18: *"ada pengguna yang bilang baru tau kalau ternyata
 * ada fitur rencana, karena terlalu ke bawah menunya."* Fitur yang tidak pernah
 * terlihat sama dengan fitur yang tidak ada.
 *
 * Alur RAB → adendum → rencana TIDAK berubah: aksi, gerbang izin, dan halaman
 * adendum tetap persis seperti sebelumnya. Yang berubah hanya di mana ketiganya
 * diletakkan, dan bagian mana yang dikirim ke peramban.
 */

export default async function RabPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ minggu?: string; bagian?: string }>;
}) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const { user, location } = await requireLocationPage(slug);
  requireCapabilityPage(user.role, "rab.view");
  const canManage = can(user.role, "rab.manage");
  const canPlan = can(user.role, "weekly_plan.manage");
  const bagian = bacaBagian(sp.bagian);

  const [progress, revisions] = await Promise.all([
    getLocationProgress(location.id),
    db.rabRevision.findMany({
      where: { locationId: location.id },
      orderBy: { revisionNo: "desc" },
      select: {
        id: true,
        revisionNo: true,
        source: true,
        status: true,
        totalValue: true,
        createdAt: true,
        note: true,
      },
    }),
  ]);
  const active = revisions.find((r) => r.status === "aktif") ?? null;
  const draft = revisions.find((r) => r.status === "draft") ?? null;

  /*
   * Pohon RAB HANYA diambil saat memang dipakai.
   *
   * Isinya ratusan baris yang ikut diserialisasi ke klien. Selama ketiganya
   * ditumpuk, ongkos itu dibayar bahkan oleh orang yang cuma mau mengisi
   * rencana minggu ini. Jumlah itemnya tetap disebut di judul lewat `count()`,
   * yang tidak menarik satu baris pun.
   */
  const butuhNode = bagian === "rab" || bagian === "rencana";
  const [itemCount, nodes] = await Promise.all([
    active
      ? db.rabNode.count({ where: { revisionId: active.id, kind: "item" } })
      : Promise.resolve(0),
    active && butuhNode
      ? db.rabNode.findMany({
          where: { revisionId: active.id },
          orderBy: { sortOrder: "asc" },
          select: {
            id: true,
            parentId: true,
            kind: true,
            code: true,
            name: true,
            volume: true,
            unit: true,
            unitPrice: true,
            amount: true,
            sortOrder: true,
          },
        })
      : Promise.resolve([]),
  ]);

  // Serialisasi SEKALI untuk boundary client (BigInt → string, Decimal → number).
  const nodeRows: RabNodeRow[] = nodes.map((n) => ({
    id: n.id,
    parentId: n.parentId,
    kind: n.kind,
    code: n.code,
    name: n.name,
    volume: n.volume == null ? null : Number(n.volume),
    unit: n.unit,
    unitPrice: n.unitPrice == null ? null : Number(n.unitPrice),
    amount: n.amount.toString(),
    sortOrder: n.sortOrder,
  }));

  const contract = location.package.contract;
  const ppnPercent = contract ? Number(contract.ppnPercent) : 11;
  const grand = active?.totalValue ?? 0n;
  const ppnValue = ppnAmount(grand, ppnPercent);
  const totalWithPpn = withPpn(grand, ppnPercent);

  const revisionRows: RevisionRow[] = revisions.map((r) => ({
    id: r.id,
    revisionNo: r.revisionNo,
    source: r.source,
    status: r.status,
    totalValue: r.totalValue.toString(),
    createdAt: r.createdAt.toISOString(),
    note: r.note,
  }));

  // ── Rencana mingguan (minggu terpilih, default berjalan) ─────────────────
  const parsedWeek = Number.parseInt(sp.minggu ?? "", 10);
  const weekNumber =
    Number.isInteger(parsedWeek) && parsedWeek >= 1 && parsedWeek <= 520
      ? parsedWeek
      : progress.weekNumber;

  const startDate = contract?.startDate ?? null;
  const weekStart = startDate ? new Date(startDate.getTime() + (weekNumber - 1) * 7 * DAY_MS) : null;
  const weekEnd = weekStart ? new Date(weekStart.getTime() + 6 * DAY_MS) : null;

  // Kueri rencana ikut hanya saat tabnya dibuka — tiga kueri + rekap kurva-S
  // yang tidak murah, dan tidak ada yang membacanya dari tab lain.
  const perluRencana = bagian === "rencana" && active !== null;

  const [plan, realizedRows] = await Promise.all([
    perluRencana
      ? db.weeklyPlan.findUnique({
          where: { locationId_weekNumber: { locationId: location.id, weekNumber } },
          select: {
            items: {
              orderBy: { priority: "asc" },
              select: {
                id: true,
                targetVolume: true,
                priority: true,
                picName: true,
                note: true,
                rabNode: { select: { code: true, name: true, unit: true, lineageKey: true } },
              },
            },
          },
        })
      : Promise.resolve(null),
    perluRencana && weekStart && weekEnd
      ? db.dailyReportItem.groupBy({
          by: ["lineageKey"],
          where: {
            // Target rencana mingguan bersumber dari RAB aktif, jadi
            // realisasinya pun basis aktif (DECISIONS 211).
            basis: "aktif",
            report: {
              locationId: location.id,
              status: { in: [...COUNTED_REPORT_STATUSES] },
              reportDate: { gte: weekStart, lte: weekEnd },
            },
          },
          _sum: { volumeDone: true },
        })
      : Promise.resolve([]),
  ]);
  const realizedByLineage = new Map(
    realizedRows.map((r) => [r.lineageKey, Number(r._sum.volumeDone ?? 0)]),
  );

  const planItems: PlanItemRow[] = (plan?.items ?? []).map((it) => ({
    id: it.id,
    code: it.rabNode.code,
    name: it.rabNode.name,
    unit: it.rabNode.unit,
    targetVolume: Number(it.targetVolume),
    priority: it.priority,
    picName: it.picName,
    note: it.note,
    realizedVolume: realizedByLineage.get(it.rabNode.lineageKey) ?? 0,
  }));

  const leafOptions: LeafOption[] = nodeRows
    .filter((n) => n.kind === "item")
    .map((n) => ({ id: n.id, code: n.code, name: n.name, unit: n.unit, volume: n.volume }));

  const weekPeriod =
    weekStart && weekEnd ? `${formatTanggal(weekStart)} – ${formatTanggal(weekEnd)}` : null;

  // Ringkasan + proyeksi: SUMBER YANG SAMA dengan formulir cetak & Excel, supaya
  // angka di layar tidak pernah berbeda dari berkas yang beredar (DECISIONS 258).
  // null bila prasyarat dokumen belum ada (SPMK/baseline/RAB aktif) — panelnya
  // disembunyikan, bukan diisi angka tebakan.
  const rencana = perluRencana ? await getRencanaMingguan(location.id, weekNumber) : null;
  const ringkas: RingkasRencana | null = rencana
    ? {
        actualPct: rencana.actualPct,
        targetPct: rencana.targetPct,
        deviationPct: rencana.deviationPct,
        status: rencana.status,
        tambahanPct: rencana.proyeksi.tambahanPct,
        proyeksiPct: rencana.proyeksi.proyeksiPct,
        selisihPct: rencana.proyeksi.selisihPct,
        masihTertinggal: rencana.proyeksi.masihTertinggal,
        totalNilai: rencana.totalNilai,
        totalBobot: rencana.totalBobot,
        jumlahKomitmen: rencana.baris.length,
        ppc: rencana.ppc,
        cetakHref: `/cetak/rencana/${slug}/${weekNumber}`,
        excelHref: `/lokasi/${slug}/rab/rencana-export?minggu=${weekNumber}`,
      }
    : null;

  // Minggu yang sedang dilihat ikut dibawa saat berpindah bagian: kembali ke
  // "Rencana" setelah melihat RAB harus mendarat di minggu yang sama, bukan
  // melompat ke minggu berjalan.
  const href = (b: BagianRab) => hrefBagian(slug, b, sp.minggu);

  return (
    <div className="space-y-3">
      {/* Draft menggantung diumumkan di SEMUA bagian, bukan cuma di tab revisi.
          Selama ia ada, angka resmi di seluruh sistem masih memakai revisi
          aktif — dan orang yang sedang membaca pohon RAB berhak tahu bahwa ada
          versi lain yang sedang disiapkan. */}
      {draft ? (
        <Banner
          tone="warning"
          title={`Ada draft revisi #${draft.revisionNo} yang belum diaktifkan`}
          description={
            <span className="flex flex-wrap items-center gap-2">
              <span>
                {active
                  ? `Progress, laporan, dan seluruh perhitungan resmi masih memakai revisi aktif #${active.revisionNo}. Draft baru menjadi sumber resmi hanya setelah diaktifkan.`
                  : "Belum ada revisi aktif – aktifkan draft ini agar RAB bisa dipakai."}
              </span>
              <ButtonLink href={href("revisi")} variant="secondary" size="sm">
                Lihat revisi
              </ButtonLink>
            </span>
          }
        />
      ) : null}

      <Card>
        <CardHeader
          title="Rencana & RAB"
          subtitle={
            active
              ? `Revisi aktif #${active.revisionNo} · ${itemCount} item · ${formatRupiah(Number(grand))} pra-PPN`
              : "Belum ada revisi aktif – impor HPS terlebih dahulu."
          }
          action={
            // Aksi = TOMBOL, bukan teks biru bergaris bawah di sebelah judul.
            // Yang lama terbaca seperti keterangan kartu, bukan seperti sesuatu
            // yang bisa ditekan. DECISIONS 232.
            <span className="flex flex-wrap items-center gap-2">
              {active ? (
                <ButtonLink
                  href={`/lokasi/${slug}/rab/export`}
                  unduhan
                  labelSibuk="Menyiapkan Excel…"
                  variant="secondary"
                  size="sm"
                >
                  <Download aria-hidden className="size-4" />
                  Unduh Excel
                </ButtonLink>
              ) : null}
              {canManage ? (
                <>
                  <ButtonLink href={`/lokasi/${slug}/rab/adendum`} variant="secondary" size="sm">
                    <FilePen aria-hidden className="size-4" />
                    Adendum
                  </ButtonLink>
                  <ButtonLink href={`/lokasi/${slug}/rab/import`} variant="primary" size="sm">
                    <Upload aria-hidden className="size-4" />
                    Impor
                  </ButtonLink>
                </>
              ) : null}
            </span>
          }
        />

        <SubTabs
          label="Bagian Rencana & RAB"
          active={bagian}
          items={[
            { key: "rab", label: "RAB Aktif", labelPendek: "RAB", href: href("rab") },
            { key: "rencana", label: "Rencana Mingguan", labelPendek: "Rencana", href: href("rencana") },
            {
              key: "revisi",
              label: "Revisi & Adendum",
              labelPendek: "Revisi",
              href: href("revisi"),
              // Angkanya muncul HANYA saat ada yang menunggu dikerjakan.
              badge: draft ? 1 : undefined,
            },
          ]}
        />

        <CardBody>
          {bagian === "rab" ? (
            active ? (
              <RabTree
                nodes={nodeRows}
                grandTotal={grand.toString()}
                ppnPercent={ppnPercent}
                ppnValue={ppnValue.toString()}
                totalWithPpn={totalWithPpn.toString()}
                canEdit={canManage}
              />
            ) : (
              <p className="text-sm text-ink-muted">
                Belum ada revisi RAB aktif. Impor HPS terlebih dahulu.
              </p>
            )
          ) : null}

          {bagian === "rencana" ? (
            active ? (
              <WeeklyPlanSection
                locationId={location.id}
                weekNumber={weekNumber}
                currentWeek={progress.weekNumber}
                totalWeeks={progress.totalWeeks}
                weekPeriod={weekPeriod}
                items={planItems}
                options={leafOptions}
                ringkas={ringkas}
                canManage={canPlan}
              />
            ) : (
              <p className="text-sm text-ink-muted">
                Rencana mingguan butuh revisi RAB aktif. Impor HPS terlebih dahulu.
              </p>
            )
          ) : null}

          {bagian === "revisi" ? (
            <div className="space-y-3">
              <p className="text-[13px] text-ink-muted">
                Aktifkan draft untuk menggantikan revisi aktif – realisasi tersambung otomatis via
                lineage, dan revisi lama tetap disimpan sebagai histori.
              </p>
              <RevisionList revisions={revisionRows} canManage={canManage} />
            </div>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
