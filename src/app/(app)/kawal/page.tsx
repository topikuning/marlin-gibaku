import type { Metadata } from "next";
import { Banner, ButtonLink, Card, CardBody, CardHeader, KpiCard, PageHeader } from "@/components/ui";
import { accessibleLocationIds, requireUser } from "@/lib/auth/session";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { formatPct, formatTanggalWaktu } from "@/lib/format";
import { idLokasiDiarsipkan } from "@/lib/package/lingkup-lokasi";
import { getLocationsProgress } from "@/lib/progress";
import { bandingkanProgres, formatSelisihPp, LABEL_ARAH, LABEL_TINGKAT, TONE_TINGKAT } from "@/lib/kawal/compare";
import { kawalUntukLokasi, ringkasSinkronKawal } from "@/lib/kawal/queries";
import { PerbandinganGrid, type BarisKawal } from "./perbandingan-grid";

export const metadata: Metadata = { title: "Kawal KNMP" };
export const dynamic = "force-dynamic";

/**
 * PORTOFOLIO PEMBANDING KAWAL KNMP (DECISIONS 691): semua lokasi yang boleh
 * dilihat, progres MARLIN saat ini vs progres Kawal dari tarikan terbaru,
 * diurut dari selisih terbesar. Data Kawal = rujukan, bukan angka resmi.
 */
export default async function KawalPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "kawal.view");
  const scope = await accessibleLocationIds(user);

  const lokasiSemua = await db.location.findMany({
    where: { package: { orgId: user.orgId }, ...(scope === null ? {} : { id: { in: scope } }) },
    select: { id: true, name: true, slug: true, regency: true, package: { select: { name: true } } },
    orderBy: { name: "asc" },
  });
  const arsip = can(user.role, "location_scope.archive")
    ? new Set<string>()
    : await idLokasiDiarsipkan(lokasiSemua.map((l) => l.id));
  const lokasi = lokasiSemua.filter((l) => !arsip.has(l.id));

  const [kawalPer, sinkron] = await Promise.all([kawalUntukLokasi(lokasi.map((l) => l.id)), ringkasSinkronKawal()]);
  const berpasangan = lokasi.filter((l) => kawalPer.has(l.id));
  const progresPer = await getLocationsProgress(berpasangan.map((l) => l.id));

  const rows: BarisKawal[] = berpasangan.map((l) => {
    const k = kawalPer.get(l.id)!;
    const p = progresPer.get(l.id);
    const b = bandingkanProgres(p?.realizedPct ?? null, k.actualPct, k.weekNo);
    return {
      slug: l.slug,
      lokasi: l.name,
      paket: l.package.name,
      kabupaten: l.regency,
      marlin: p ? formatPct(p.realizedPct, 2) : "–",
      kawal: k.actualPct != null ? formatPct(k.actualPct, 2) : "–",
      selisih: b.selisihPp != null ? formatSelisihPp(b.selisihPp) : "–",
      urutSelisih: b.tingkat === "tidak_dinilai" || b.selisihPp == null ? -1 : Math.abs(b.selisihPp),
      arah: b.tingkat === "tidak_dinilai" ? LABEL_TINGKAT.tidak_dinilai : b.arah ? LABEL_ARAH[b.arah] : "",
      tingkat: LABEL_TINGKAT[b.tingkat],
      tone: TONE_TINGKAT[b.tingkat],
      minggu:
        k.weekNo != null
          ? `ke-${k.weekNo}${k.lastActualWeek != null && k.lastActualWeek !== k.weekNo ? ` · isi s/d ${k.lastActualWeek}` : ""}`
          : "–",
      kontraktor: k.pelaksanaPct != null ? formatPct(k.pelaksanaPct, 2) : "–",
    };
  });
  rows.sort((a, b) => b.urutSelisih - a.urutSelisih || a.lokasi.localeCompare(b.lokasi));

  const kritis = rows.filter((r) => r.tone === "danger").length;
  const tinggi = rows.filter((r) => r.tone === "warning").length;
  const tanpaPasangan = lokasi.length - berpasangan.length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Kawal KNMP"
        description="Progres MARLIN dibandingkan dengan progres yang dicatat pengawas di Kawal KNMP. Pembanding, bukan angka resmi."
        actions={
          can(user.role, "kawal.manage") ? (
            <ButtonLink href="/kawal/pencocokan" variant="secondary">
              Pencocokan lokasi
            </ButtonLink>
          ) : undefined
        }
      />

      {!sinkron.berhasilTerakhir ? (
        <Banner
          tone="warning"
          title="Data Kawal belum pernah ditarik"
          description="Sinkron berjalan otomatis setiap pagi."
        />
      ) : null}

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <KpiCard label="Lokasi berpasangan" value={rows.length} sub={`dari ${lokasi.length} lokasi Anda`} />
        <KpiCard label="Selisih ≥ 10 pp" value={kritis} sub="perlu ditanyakan" tone={kritis ? "danger" : "default"} />
        <KpiCard
          label="Selisih 5–10 pp"
          value={tinggi}
          sub="perlu diperhatikan"
          tone={tinggi ? "warning" : "default"}
        />
        <KpiCard label="Belum berpasangan" value={tanpaPasangan} sub="belum ada padanannya di Kawal" />
      </div>

      <Card>
        <CardHeader
          title="Perbandingan per lokasi"
          subtitle={
            sinkron.berhasilTerakhir
              ? `Tarikan terakhir ${formatTanggalWaktu(sinkron.berhasilTerakhir)}. Selisih = MARLIN − Kawal, diurut dari yang terbesar.`
              : "Selisih = MARLIN − Kawal, diurut dari yang terbesar."
          }
        />
        <CardBody className="space-y-3">
          <PerbandinganGrid rows={rows} />
          <p className="text-[13px] text-ink-muted">
            <span className="text-ink">Kawal</span> = progres menurut pengawas KKP.{" "}
            <span className="text-ink">Isian kontraktor</span> = angka yang diisi kontraktor sendiri di Kawal. Selisih
            tidak selalu berarti salah lapor: Kawal membobot per sarana, MARLIN per item RAB. Jalur{" "}
            <span className="text-ink">Relatif (Wakil Sah / Penyuluh)</span> belum ditampilkan karena angkanya di data
            Kawal belum terbukti.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
