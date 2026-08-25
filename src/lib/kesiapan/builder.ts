import "server-only";
import { accessibleLocationIds, type SessionUser } from "@/lib/auth/session";
import { packageScopeWhere } from "@/lib/auth/scope";
import { db } from "@/lib/db";
import { formatPct } from "@/lib/format";
import { jakartaToday } from "@/lib/format";
import { OPEN_FINDING_STATUSES } from "@/lib/lifecycle";
import { milestoneBoard, type MilestoneBoardItem } from "@/lib/milestones/queries";
import { weightedRealizedPct } from "@/lib/progress-calc";
import { getLocationsProgress } from "@/lib/progress";
import {
  ambangTerminBerikutnya,
  pctMencukupi,
  verdictDariSyarat,
  type KesiapanVerdict,
  type Syarat,
} from "./rules";

/**
 * PEMBANGUN KESIAPAN per paket (DECISIONS 426). Semua angka dari calculation
 * layer; modul ini hanya MENYUSUN syarat + verdict. Tidak ada AI di sini.
 */

export type KesiapanKartu = {
  jenis: "termin" | "pho" | "fho" | "close_out";
  judul: string;
  verdict: KesiapanVerdict;
  syarat: Syarat[];
};

export type KesiapanPaket = {
  packageId: string;
  packageName: string;
  stage: string;
  /** Progress agregat paket (tertimbang nilai RAB lokasi). */
  progressDilaporkanPct: number;
  progressTerverifikasiPct: number;
  kartu: KesiapanKartu[];
  lokasi: { id: string; name: string; slug: string; status: string }[];
};

function milestoneBelum(items: MilestoneBoardItem[], keys: string[]): MilestoneBoardItem[] {
  return items.filter(
    (m) => keys.includes(m.templateKey) && m.status !== "selesai" && m.status !== "tidak_berlaku",
  );
}

export async function kesiapanPortofolio(user: SessionUser): Promise<KesiapanPaket[]> {
  const locIds = await accessibleLocationIds(user);
  const packages = await db.package.findMany({
    where: {
      ...packageScopeWhere(user, locIds),
      stage: { in: ["pelaksanaan", "serah_terima", "selesai"] },
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      stage: true,
      contract: { select: { id: true } },
      locations: { select: { id: true, name: true, slug: true, status: true } },
    },
  });
  if (packages.length === 0) return [];

  const allLocIds = packages.flatMap((p) => p.locations.map((l) => l.id));
  const today = jakartaToday();

  const [dilaporkan, terverifikasi, temuanTerbuka, kendalaKritis, dokKadaluarsa, billings] = await Promise.all([
    getLocationsProgress(allLocIds),
    getLocationsProgress(allLocIds, { statusLevel: "terverifikasi" }),
    db.finding.findMany({
      where: { locationId: { in: allLocIds }, status: { in: [...OPEN_FINDING_STATUSES] } },
      select: { id: true, locationId: true, severity: true, status: true },
    }),
    db.issue.findMany({
      where: { locationId: { in: allLocIds }, status: { in: ["terbuka", "ditangani"] }, severity: "kritis", mergedIntoId: null },
      select: { id: true, locationId: true },
    }),
    db.document.findMany({
      where: { packageId: { in: packages.map((p) => p.id) }, status: "aktif", expiryDate: { lt: today } },
      select: { id: true, packageId: true, title: true, type: true },
    }),
    db.ownerBilling.findMany({
      where: { contractId: { in: packages.map((p) => p.contract?.id ?? "").filter(Boolean) } },
      select: { contractId: true, terminNo: true, status: true },
    }),
  ]);

  const hasil: KesiapanPaket[] = [];
  for (const pkg of packages) {
    const ids = pkg.locations.map((l) => l.id);
    const rowsDilaporkan = ids.map((id) => dilaporkan.get(id)).filter((r) => r !== undefined);
    const rowsVerif = ids.map((id) => terverifikasi.get(id)).filter((r) => r !== undefined);
    const pctDilaporkan = weightedRealizedPct(rowsDilaporkan);
    const pctVerif = weightedRealizedPct(rowsVerif);

    const temuanPaket = temuanTerbuka.filter((t) => ids.includes(t.locationId));
    const temuanKritis = temuanPaket.filter((t) => t.severity === "kritis");
    const kendalaPaket = kendalaKritis.filter((k) => ids.includes(k.locationId));
    const dokLewat = dokKadaluarsa.filter((d) => d.packageId === pkg.id);

    const board = await milestoneBoard({ packageId: pkg.id });
    const semuaItem = board.phases.flatMap((p) => p.items);
    const fasePembayaran = board.phases.find((p) => p.phase === "pembayaran");

    const kartu: KesiapanKartu[] = [];

    /* ── TERMIN ─────────────────────────────────────────────── */
    {
      const terpakai = billings.filter(
        (b) => b.contractId === pkg.contract?.id && b.status !== "ditolak",
      ).length;
      const berikut = ambangTerminBerikutnya(terpakai);
      const syarat: Syarat[] = [];
      if (!pkg.contract) {
        syarat.push({ key: "kontrak", label: "Kontrak", status: "gagal", detail: "Paket belum punya data kontrak." });
      } else if (!berikut) {
        syarat.push({
          key: "termin_habis",
          label: "Termin",
          status: "lolos",
          detail: `Seluruh ${terpakai} termin sudah diajukan/cair.`,
        });
      } else {
        syarat.push({
          key: "progress",
          label: `Progress terverifikasi ≥ ${berikut.ambangPct}% (termin ke-${berikut.terminKe})`,
          status: pctMencukupi(pctVerif, berikut.ambangPct)
            ? "lolos"
            : pctMencukupi(pctDilaporkan, berikut.ambangPct)
              ? "peringatan"
              : "gagal",
          detail: pctMencukupi(pctVerif, berikut.ambangPct)
            ? `Progress terverifikasi ${formatPct(pctVerif)} mencapai ambang ${berikut.ambangPct}%.`
            : pctMencukupi(pctDilaporkan, berikut.ambangPct)
              ? `Progress dilaporkan ${formatPct(pctDilaporkan)} sudah mencapai ambang, tetapi yang terverifikasi baru ${formatPct(pctVerif)} – ada laporan terkirim yang belum disetujui.`
              : `Progress terverifikasi ${formatPct(pctVerif)} (dilaporkan ${formatPct(pctDilaporkan)}) belum mencapai ambang ${berikut.ambangPct}%.`,
          href: "/progress",
        });
      }
      if (fasePembayaran) {
        const belum = fasePembayaran.items.filter((m) => m.status !== "selesai" && m.status !== "tidak_berlaku");
        syarat.push({
          key: "dok_pembayaran",
          label: "Dokumen fase pembayaran",
          status: belum.length === 0 ? "lolos" : "peringatan",
          detail:
            belum.length === 0
              ? `Seluruh ${fasePembayaran.total} milestone pembayaran lengkap.`
              : `${belum.length} milestone belum lengkap: ${belum.map((m) => m.name).slice(0, 4).join(", ")}${belum.length > 4 ? "…" : ""}`,
          href: `/paket/${pkg.id}/dokumen`,
        });
      }
      syarat.push({
        key: "temuan_kritis",
        label: "Temuan kritis terbuka",
        status: temuanKritis.length === 0 ? "lolos" : "gagal",
        detail:
          temuanKritis.length === 0
            ? "Tidak ada temuan kritis terbuka."
            : `${temuanKritis.length} temuan kritis masih terbuka.`,
        href: "/temuan?status=terbuka&tingkat=kritis",
      });
      syarat.push({
        key: "kendala_kritis",
        label: "Kendala kritis terbuka",
        status: kendalaPaket.length === 0 ? "lolos" : "peringatan",
        detail:
          kendalaPaket.length === 0
            ? "Tidak ada kendala kritis terbuka."
            : `${kendalaPaket.length} kendala kritis masih terbuka.`,
        href: "/kendala?tingkat=kritis",
      });
      if (dokLewat.length > 0) {
        syarat.push({
          key: "dok_kadaluarsa",
          label: "Dokumen kadaluarsa",
          status: "peringatan",
          detail: `${dokLewat.length} dokumen aktif sudah lewat masa berlaku (mis. ${dokLewat[0].title}).`,
          href: "/dokumen",
        });
      }
      kartu.push({ jenis: "termin", judul: "Kesiapan Termin", verdict: verdictDariSyarat(syarat), syarat: syarat });
    }

    /* ── PHO ────────────────────────────────────────────────── */
    {
      const syarat: Syarat[] = [];
      syarat.push({
        key: "progress_100",
        label: "Progress fisik terverifikasi 100%",
        status: pctMencukupi(pctVerif, 100) ? "lolos" : "gagal",
        detail: pctMencukupi(pctVerif, 100)
          ? "Progress terverifikasi sudah 100%."
          : `Progress terverifikasi ${formatPct(pctVerif)} (dilaporkan ${formatPct(pctDilaporkan)}).`,
        href: "/progress",
      });
      const lokasiBelumSelesai = pkg.locations.filter(
        (l) => !["selesai", "pho", "pemeliharaan", "fho"].includes(l.status),
      );
      syarat.push({
        key: "status_lokasi",
        label: "Seluruh lokasi selesai fisik",
        status: lokasiBelumSelesai.length === 0 ? "lolos" : "gagal",
        detail:
          lokasiBelumSelesai.length === 0
            ? "Semua lokasi berstatus selesai fisik atau lebih lanjut."
            : `${lokasiBelumSelesai.length} lokasi belum selesai fisik: ${lokasiBelumSelesai.map((l) => l.name).slice(0, 3).join(", ")}${lokasiBelumSelesai.length > 3 ? "…" : ""}`,
      });
      syarat.push({
        key: "temuan",
        label: "Temuan terbuka",
        status: temuanKritis.length > 0 ? "gagal" : temuanPaket.length > 0 ? "peringatan" : "lolos",
        detail:
          temuanPaket.length === 0
            ? "Tidak ada temuan terbuka."
            : `${temuanPaket.length} temuan terbuka (${temuanKritis.length} kritis).`,
        href: "/temuan?status=terbuka",
      });
      const phoBelum = milestoneBelum(semuaItem, ["permohonan-pho", "bast-pho"]);
      syarat.push({
        key: "dok_pho",
        label: "Dokumen PHO (permohonan + BAST PHO)",
        status: phoBelum.length === 0 ? "lolos" : "gagal",
        detail:
          phoBelum.length === 0
            ? "Dokumen PHO lengkap."
            : `Belum lengkap: ${phoBelum.map((m) => m.name).join(", ")}.`,
        href: `/paket/${pkg.id}/dokumen`,
      });
      kartu.push({ jenis: "pho", judul: "Kesiapan PHO", verdict: verdictDariSyarat(syarat), syarat });
    }

    /* ── FHO ────────────────────────────────────────────────── */
    {
      const syarat: Syarat[] = [];
      const belumPho = pkg.locations.filter((l) => !["pho", "pemeliharaan", "fho"].includes(l.status));
      syarat.push({
        key: "pho_dulu",
        label: "PHO sudah dilalui",
        status: belumPho.length === 0 ? "lolos" : "gagal",
        detail:
          belumPho.length === 0
            ? "Semua lokasi sudah PHO / pemeliharaan."
            : `${belumPho.length} lokasi belum PHO.`,
      });
      syarat.push({
        key: "temuan_pemeliharaan",
        label: "Cacat/temuan masa pemeliharaan",
        status: temuanPaket.length === 0 ? "lolos" : "gagal",
        detail:
          temuanPaket.length === 0
            ? "Tidak ada temuan terbuka."
            : `${temuanPaket.length} temuan masih terbuka (${temuanPaket.filter((t) => t.status === "dibuka_kembali").length} dibuka kembali).`,
        href: "/temuan?status=terbuka",
      });
      const fhoBelum = milestoneBelum(semuaItem, ["bast-fho"]);
      syarat.push({
        key: "dok_fho",
        label: "BAST FHO",
        status: fhoBelum.length === 0 ? "lolos" : "gagal",
        detail: fhoBelum.length === 0 ? "BAST FHO lengkap." : "BAST FHO belum lengkap.",
        href: `/paket/${pkg.id}/dokumen`,
      });
      kartu.push({ jenis: "fho", judul: "Kesiapan FHO", verdict: verdictDariSyarat(syarat), syarat });
    }

    /* ── CLOSE-OUT ──────────────────────────────────────────── */
    {
      const syarat: Syarat[] = [];
      const belumFho = pkg.locations.filter((l) => l.status !== "fho");
      syarat.push({
        key: "fho_semua",
        label: "Seluruh lokasi FHO",
        status: belumFho.length === 0 ? "lolos" : "gagal",
        detail: belumFho.length === 0 ? "Semua lokasi sudah FHO." : `${belumFho.length} lokasi belum FHO.`,
      });
      syarat.push({
        key: "milestone_lengkap",
        label: "Kelengkapan administrasi paket",
        status: board.completenessPct >= 100 ? "lolos" : "peringatan",
        detail: `Milestone administrasi ${board.done}/${board.total} (${formatPct(board.completenessPct)}).`,
        href: `/paket/${pkg.id}/dokumen`,
      });
      const cair = billings.filter((b) => b.contractId === pkg.contract?.id && b.status === "cair").length;
      syarat.push({
        key: "keuangan",
        label: "Penyelesaian pembayaran owner",
        status: cair >= 4 ? "lolos" : "peringatan",
        detail: `${cair} dari ${billings.filter((b) => b.contractId === pkg.contract?.id).length || 0} termin berstatus cair.`,
      });
      kartu.push({ jenis: "close_out", judul: "Kesiapan Close-out", verdict: verdictDariSyarat(syarat), syarat });
    }

    hasil.push({
      packageId: pkg.id,
      packageName: pkg.name,
      stage: pkg.stage,
      progressDilaporkanPct: pctDilaporkan,
      progressTerverifikasiPct: pctVerif,
      kartu,
      lokasi: pkg.locations,
    });
  }
  return hasil;
}
