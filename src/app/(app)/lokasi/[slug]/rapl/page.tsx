import type { Metadata } from "next";
import Link from "next/link";
import { Banner, Card, CardBody, CardHeader, KpiCard } from "@/components/ui";
import { can } from "@/lib/authz";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { formatPct, formatRupiah, formatRupiahShort } from "@/lib/format";
import { ringkasAhsp } from "@/lib/ahsp/import";
import { keadaanPadanan } from "@/lib/ahsp/padanan";
import { requireLocationPage } from "../get-location";
import { PadananPanel, type BarisPadananRow } from "./padanan-panel";

export const metadata: Metadata = { title: "RAPL" };
export const dynamic = "force-dynamic";

/**
 * RAPL — langkah pertama: PEMETAAN RAB → analisa AHSP (DECISIONS 319).
 *
 * Halaman ini sengaja menampilkan cakupan lebih dulu, sebelum angka kebutuhan
 * bahan apa pun. Alasannya: perkiraan biaya pelaksanaan hanya sekuat bagian RAB
 * yang benar-benar punya analisa. Tabel kebutuhan bahan yang terisi penuh tapi
 * separuhnya dari padanan asal-asalan lebih berbahaya daripada tabel yang
 * mengaku bolong — yang pertama dipakai orang untuk memutuskan uang.
 */
export default async function RaplPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { user, location } = await requireLocationPage(slug);
  requireCapabilityPage(user.role, "rab.view");
  const canManage = can(user.role, "rab.manage");

  const [basis, { baris, cakupan }] = await Promise.all([
    ringkasAhsp(),
    keadaanPadanan(location.id),
  ]);

  const pctItem = cakupan.item > 0 ? (cakupan.terpetakan / cakupan.item) * 100 : 0;
  const pctNilai =
    cakupan.nilaiTotal > 0n
      ? (Number(cakupan.nilaiTerpetakan) / Number(cakupan.nilaiTotal)) * 100
      : 0;

  const rows: BarisPadananRow[] = baris.map((b) => ({
    lineageKey: b.lineageKey,
    code: b.code,
    uraian: b.uraian,
    unit: b.unit,
    volume: b.volume,
    amount: b.amount.toString(),
    tanda: b.tanda,
    ahspKode: b.ahsp?.kode ?? null,
    ahspUraian: b.ahsp?.uraian ?? null,
    ahspSatuan: b.ahsp?.satuan ?? null,
    ahspTanpaKomponen: b.ahsp ? b.ahsp.jumlahKomponen === 0 : false,
    ahspPerluVerifikasi: b.ahsp?.perluVerifikasi ?? false,
    keadaan: b.keadaan,
    skor: b.skor,
    meyakinkan: b.meyakinkan,
    catatan: b.catatan,
  }));

  return (
    <div className="space-y-4">
      {!basis ? (
        <Banner
          tone="warning"
          title="Basis analisa AHSP belum dimuat"
          description="Tanpa basis AHSP, RAB tidak bisa diturunkan jadi kebutuhan bahan/upah. Muat dulu di halaman Sistem."
        />
      ) : null}

      {cakupan.item === 0 ? (
        <Banner
          tone="info"
          title="Belum ada revisi RAB aktif"
          description="RAPL bekerja dari RAB yang berlaku. Aktifkan revisi RAB lokasi ini lebih dulu."
        />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Item RAB terpetakan"
          value={formatPct(pctItem, 1)}
          sub={`${cakupan.terpetakan} dari ${cakupan.item} baris`}
          tone={pctItem >= 80 ? "success" : pctItem >= 50 ? "warning" : "danger"}
        />
        <KpiCard
          label="Nilai RAB terpetakan"
          value={formatPct(pctNilai, 1)}
          sub={`${formatRupiahShort(cakupan.nilaiTerpetakan)} dari ${formatRupiahShort(cakupan.nilaiTotal)}`}
          tone={pctNilai >= 80 ? "success" : pctNilai >= 50 ? "warning" : "danger"}
        />
        <KpiCard
          label="Perlu diperiksa"
          value={cakupan.perluDiperiksa}
          sub="padanan mesin yang beda tipis dengan kandidat lain"
          tone={cakupan.perluDiperiksa > 0 ? "warning" : "success"}
        />
        <KpiCard
          label="Belum ada padanan"
          value={cakupan.belum}
          sub={`senilai ${formatRupiah(cakupan.nilaiBelum)}`}
          tone={cakupan.belum > 0 ? "danger" : "success"}
        />
      </div>

      <Card>
        <CardHeader
          title="Pemetaan RAB → analisa AHSP"
          subtitle="Mesin memetakan otomatis dan mengaku saat ragu; kamu memperbaiki yang salah. Satu koreksi berlaku untuk semua lokasi yang uraiannya persis sama."
        />
        <CardBody>
          {cakupan.dinyatakanTidakAda > 0 ? (
            <p className="mb-3 text-[13px] text-ink-muted">
              {cakupan.dinyatakanTidakAda} baris sudah dinyatakan memang tidak punya analisa AHSP —
              itu bukan lubang, tapi keputusan yang tercatat.
            </p>
          ) : null}
          <PadananPanel
            locationId={location.id}
            slug={slug}
            rows={rows}
            canManage={canManage}
            basisAda={basis !== null}
          />
        </CardBody>
      </Card>

      <p className="text-[13px] text-ink-muted">
        Sumber analisa:{" "}
        <Link className="underline" href="/sistem">
          {basis ? basis.name : "belum dimuat"}
        </Link>
        . Kebutuhan bahan/upah dan perbandingannya dengan nilai kontrak dibangun di atas pemetaan
        ini — jadi angkanya baru bisa dipercaya sejauh cakupan di atas.
      </p>
    </div>
  );
}
