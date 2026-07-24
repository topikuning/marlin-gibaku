import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "@/generated/prisma/client";
import { hashPassword } from "@/lib/auth/password";
import { flattenParsedRab, grandTotal, type FlatNode } from "@/lib/rab/flatten";
import type { ParsedRab } from "@/lib/rab/parsed";
import { scheduleBySequence } from "@/lib/scurve/sequencing";
import { LOKASI_MILESTONES, PAKET_MILESTONES, type AdminMilestone } from "@/lib/milestones/template";
import { withPpn, valueDone as calcValueDone } from "@/lib/money";
import { seedMasterLocations } from "@/lib/seed/master-location";

/** Folder seed-data: repo root (dev) atau /app (container standalone). */
function seedDataDir(): string {
  const candidates = [
    join(process.cwd(), "seed-data"),
    join(process.cwd(), "..", "..", "seed-data"), // .next/standalone saat run lokal
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error(`Folder seed-data tidak ditemukan (dicari: ${candidates.join(", ")})`);
}

const DAY = 24 * 3600 * 1000;
const dateOnly = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const daysAgo = (n: number) => {
  const key = new Date(Date.now() - n * DAY).toISOString().slice(0, 10);
  return dateOnly(key);
};

type SeedFile = ParsedRab & {
  meta: {
    slug: string;
    village: string;
    regency: string;
    province: string;
    gps_lat: number | null;
    gps_lng: number | null;
    contract_number: string;
    contractor: string;
    start_date: string;
    end_date: string;
  };
  total: number;
};

// Paket: grup lokasi per kontrak. BGK = satu kontrak dua lokasi (multi-lokasi).
const PACKAGES: { name: string; number: string; slugs: string[]; contractNumber: string }[] = [
  { name: "Paket KNMP Demak — Kedungmutih", number: "PKT-2026-001", slugs: ["kedungmutih"], contractNumber: "SPK-KNMP-2026-KDM-001" },
  { name: "Paket KNMP Purworejo", number: "PKT-2026-002", slugs: ["purworejo"], contractNumber: "SPK-KNMP-2026-PWJ-002" },
  { name: "Paket KNMP Jepara — Ujungwatu", number: "PKT-2026-003", slugs: ["ujungwatu"], contractNumber: "SPK-KNMP-2026-JPR-003" },
  { name: "Paket KNMP Jepara — Karanggondang", number: "PKT-2026-004", slugs: ["karanggondang"], contractNumber: "SPK-KNMP-2026-JPR-004" },
  { name: "Paket KNMP Bangkalan (2 lokasi)", number: "PKT-2026-005", slugs: ["batah-timur", "tengket"], contractNumber: "SPK-KNMP-2026-BGK-005" },
  { name: "Paket KNMP Lamongan — Kemantren", number: "PKT-2026-006", slugs: ["kemantren"], contractNumber: "SPK-KNMP-2026-LMG-007" },
];

/**
 * Muat data demo (idempotent). Dipanggil dari:
 *  - prisma/seed.ts (dev: pnpm db:seed)
 *  - instrumentation.ts saat BOOTSTRAP_DEMO_DATA=true (deploy uji coba, mis. Railway)
 */
export async function runDemoSeed(db: PrismaClient): Promise<void> {
  console.log("Seeding MARLIN…");

  const org = await db.organization.upsert({
    where: { slug: "gibaku" },
    update: {},
    create: { name: "PT Gibaku Bangun Persada", slug: "gibaku" },
  });

  // Master data awal (katalog lokasi + vendor) dari impor lokasi_awal.xlsx.
  await seedMasterLocations(db, org.id);

  // ── Users (password dev: marlin123) ─────────────────────────
  const password = await hashPassword("marlin123");
  const users: { username: string; fullName: string; role: "super_admin" | "program_director" | "regional_manager" | "project_manager" | "site_manager" | "field_supervisor" | "exec_viewer"; mustChange?: boolean }[] = [
    { username: "admin", fullName: "Administrator Sistem", role: "super_admin" },
    { username: "hery", fullName: "Hery Purnomo", role: "program_director" },
    { username: "am-jateng", fullName: "Rina Widyastuti", role: "regional_manager" },
    { username: "pm-01", fullName: "Bagus Prakoso", role: "project_manager" },
    { username: "sm-01", fullName: "Slamet Riyadi", role: "site_manager" },
    { username: "sm-02", fullName: "Dewi Anggraini", role: "site_manager", mustChange: true },
    { username: "mandor-01", fullName: "Paijo Sutrisno", role: "field_supervisor" },
    { username: "kkp-viewer", fullName: "Pengawas KKP", role: "exec_viewer" },
  ];
  const userByName = new Map<string, string>();
  for (const u of users) {
    const row = await db.user.upsert({
      where: { username: u.username },
      update: { role: u.role, isActive: true },
      create: {
        orgId: org.id,
        username: u.username,
        fullName: u.fullName,
        passwordHash: password,
        role: u.role,
        // Di production (URL publik) semua user demo WAJIB ganti password 'marlin123'.
        mustChangePassword: u.mustChange ?? process.env.APP_ENV === "production",
      },
    });
    userByName.set(u.username, row.id);
  }
  const adminId = userByName.get("admin")!;
  const smId = userByName.get("sm-01")!;
  const mandorId = userByName.get("mandor-01")!;
  console.log(`  users: ${users.length}`);

  // ── Paket ber-kontrak + lokasi + RAB + baseline ─────────────
  const files = new Map<string, SeedFile>();
  for (const p of PACKAGES) {
    for (const slug of p.slugs) {
      files.set(slug, JSON.parse(readFileSync(join(seedDataDir(), `${slug}.json`), "utf8")) as SeedFile);
    }
  }

  // Catatan kualitas data: total_value kategori di JSON lama korup (bug parser python —
  // roman ganda, kategori hilang). Basis angka yang konsisten = Σ amount leaf (grandTotal
  // dari flatten, semantik sumLeaves lama). Semua angka seed diturunkan dari basis itu.
  const nodesBySlug = new Map<string, FlatNode[]>();
  const totalBySlug = new Map<string, bigint>();
  for (const [slug, data] of files) {
    const nodes = flattenParsedRab(data);
    nodesBySlug.set(slug, nodes);
    totalBySlug.set(slug, grandTotal(nodes));
  }

  for (const p of PACKAGES) {
    const metas = p.slugs.map((s) => files.get(s)!);
    const first = metas[0];
    const vendor = await db.vendor.upsert({
      where: { orgId_name: { orgId: org.id, name: first.meta.contractor } },
      update: {},
      create: { orgId: org.id, name: first.meta.contractor },
    });

    const hpsTotal = p.slugs.reduce((acc, s) => acc + totalBySlug.get(s)!, 0n);
    let pkg = await db.package.findFirst({ where: { orgId: org.id, packageNumber: p.number } });
    if (!pkg) {
      pkg = await db.package.create({
        data: {
          orgId: org.id,
          name: p.name,
          packageNumber: p.number,
          hpsValue: hpsTotal,
          stage: "pelaksanaan",
          province: first.meta.province,
        },
      });
      for (const [i, stage] of (["prospek", "tender", "penetapan", "kontrak", "pelaksanaan"] as const).entries()) {
        await db.packageStageHistory.create({
          data: {
            packageId: pkg.id,
            fromStage: i === 0 ? null : (["prospek", "tender", "penetapan", "kontrak"] as const)[i - 1],
            toStage: stage,
            changedById: adminId,
            changedAt: new Date(dateOnly(first.meta.start_date).getTime() - (5 - i) * 7 * DAY),
          },
        });
      }
    }

    const contractValue = withPpn(hpsTotal, 11);
    await db.contract.upsert({
      where: { contractNumber: p.contractNumber },
      update: {},
      create: {
        packageId: pkg.id,
        vendorId: vendor.id,
        contractNumber: p.contractNumber,
        contractValue,
        ppnPercent: 11,
        signedDate: new Date(dateOnly(first.meta.start_date).getTime() - 7 * DAY),
        // Demo: lokasi sudah pelaksanaan → SPMK sudah terbit (start/end terisi).
        durationDays: Math.max(
          1,
          Math.round((dateOnly(first.meta.end_date).getTime() - dateOnly(first.meta.start_date).getTime()) / DAY),
        ),
        startDate: dateOnly(first.meta.start_date),
        endDate: dateOnly(first.meta.end_date),
        ppkName: "Ir. Bagus Setiawan, M.T.",
        ppkNip: "19750812 200212 1 003",
        supervisorName: "Dedi Kurniawan, S.T.",
        supervisorFirm: "CV Konsultan Bahari Nusantara",
        contractorSignerName: "Hendra Gunawan",
        contractorSignerTitle: "Direktur Utama",
      },
    });

    for (const slug of p.slugs) {
      const data = files.get(slug)!;
      const m = data.meta;
      const location = await db.location.upsert({
        where: { slug },
        update: { packageId: pkg.id },
        create: {
          packageId: pkg.id,
          name: `KNMP ${m.village}`,
          slug,
          village: m.village,
          regency: m.regency,
          province: m.province,
          gpsLat: m.gps_lat,
          gpsLng: m.gps_lng,
          status: "berjalan",
          isActive: true,
        },
      });
      const histCount = await db.locationStatusHistory.count({ where: { locationId: location.id } });
      if (histCount === 0) {
        await db.locationStatusHistory.create({
          data: { locationId: location.id, fromStatus: null, toStatus: "persiapan", changedById: adminId, changedAt: dateOnly(m.start_date) },
        });
        await db.locationStatusHistory.create({
          data: { locationId: location.id, fromStatus: "persiapan", toStatus: "berjalan", changedById: adminId, changedAt: new Date(dateOnly(m.start_date).getTime() + 7 * DAY) },
        });
      }

      // RAB revisi 1 (hanya bila belum ada)
      let revision = await db.rabRevision.findUnique({
        where: { locationId_revisionNo: { locationId: location.id, revisionNo: 1 } },
      });
      const nodes = nodesBySlug.get(slug)!;
      if (!revision) {
        revision = await db.rabRevision.create({
          data: {
            locationId: location.id,
            revisionNo: 1,
            source: "hps_awal",
            status: "aktif",
            totalValue: grandTotal(nodes),
            createdById: adminId,
          },
        });
        // insert per-level agar parentId terisi
        const idByKey = new Map<string, string>();
        const pending = [...nodes];
        while (pending.length > 0) {
          const batch = pending.filter((n) => n.parentLineageKey === null || idByKey.has(n.parentLineageKey));
          if (batch.length === 0) throw new Error(`Orphan RAB nodes di ${slug}`);
          const created = await db.rabNode.createManyAndReturn({
            data: batch.map((n) => ({
              revisionId: revision!.id,
              parentId: n.parentLineageKey ? idByKey.get(n.parentLineageKey)! : null,
              kind: n.kind,
              code: n.code,
              name: n.name,
              volume: n.volume,
              unit: n.unit,
              unitPrice: n.unitPrice,
              amount: n.amount,
              lineageKey: n.lineageKey,
              sortOrder: n.sortOrder,
            })),
            select: { id: true, lineageKey: true },
          });
          for (const c of created) idByKey.set(c.lineageKey, c.id);
          for (const b of batch) pending.splice(pending.indexOf(b), 1);
        }
        console.log(`  ${slug}: RAB ${nodes.length} node`);
      }

      // Baseline auto (hanya bila belum ada)
      const hasBaseline = await db.baseline.findUnique({
        where: { locationId_baselineNo: { locationId: location.id, baselineNo: 1 } },
      });
      if (!hasBaseline) {
        const contractDays = Math.round((dateOnly(m.end_date).getTime() - dateOnly(m.start_date).getTime()) / DAY);
        // leaf items utk penjadwalan per-trade; nama kategori = segmen pertama lineage
        const catByRoman = new Map(nodes.filter((n) => n.kind === "kategori").map((n) => [n.lineageKey, n.name]));
        const items = nodes
          .filter((n) => n.kind === "item" && n.amount > 0n)
          .map((n) => ({
            name: n.name,
            categoryName: catByRoman.get(n.lineageKey.split("#")[0]) ?? "",
            amount: n.amount,
          }));
        const weekly = scheduleBySequence(items, contractDays);
        const baseline = await db.baseline.create({
          data: {
            locationId: location.id,
            baselineNo: 1,
            source: "auto",
            status: "aktif",
            rabRevisionId: revision.id,
            contractDays,
            createdById: adminId,
          },
        });
        await db.baselinePoint.createMany({
          data: weekly.map((pctVal, i) => ({ baselineId: baseline.id, weekNumber: i + 1, plannedPct: pctVal })),
        });
      }

      // Budget internal per kategori biaya (sekali)
      const hasBudget = await db.budgetLine.count({ where: { locationId: location.id } });
      if (hasBudget === 0) {
        const total = totalBySlug.get(slug)!;
        const split: [string, bigint][] = [
          ["material", (total * 55n) / 100n],
          ["upah", (total * 25n) / 100n],
          ["alat", (total * 10n) / 100n],
          ["overhead", (total * 5n) / 100n],
          ["transport", (total * 3n) / 100n],
          ["lain", (total * 2n) / 100n],
        ];
        for (const [category, amount] of split) {
          await db.budgetLine.create({
            data: { locationId: location.id, category: category as never, amount, status: "disetujui", createdById: adminId, approvedById: adminId },
          });
        }
      }

      // Milestone administrasi: INDUK (paket, sekali) + LOKASI (per lokasi). DECISIONS 078.
      const doneUntil = 20; // sebagian besar administrasi awal selesai (by sortOrder)
      const statusFor = (so: number): "selesai" | "berjalan" | "belum_dimulai" =>
        so <= doneUntil ? "selesai" : so <= doneUntil + 3 ? "berjalan" : "belum_dimulai";
      const rowFor = (t: AdminMilestone, locId: string | null) => ({
        packageId: pkg!.id,
        locationId: locId,
        templateKey: t.key,
        name: t.name,
        phase: t.phase,
        sortOrder: t.sortOrder,
        requiresVerification: t.requiresVerification,
        status: statusFor(t.sortOrder),
        completedAt: t.sortOrder <= doneUntil ? new Date(dateOnly(m.start_date).getTime() + t.sortOrder * 2 * DAY) : null,
        verifiedById: t.sortOrder <= doneUntil && t.requiresVerification ? adminId : null,
      });
      const hasInduk = await db.adminMilestone.count({ where: { packageId: pkg.id, locationId: null } });
      if (hasInduk === 0) {
        await db.adminMilestone.createMany({ data: PAKET_MILESTONES.map((t) => rowFor(t, null)) });
      }
      const hasLok = await db.adminMilestone.count({ where: { packageId: pkg.id, locationId: location.id } });
      if (hasLok === 0) {
        await db.adminMilestone.createMany({ data: LOKASI_MILESTONES.map((t) => rowFor(t, location.id)) });
      }
    }
  }

  // Penugasan
  const assign = async (username: string, slug: string) => {
    const uid = userByName.get(username)!;
    const loc = await db.location.findUniqueOrThrow({ where: { slug } });
    await db.locationAssignment.upsert({
      where: { userId_locationId: { userId: uid, locationId: loc.id } },
      update: { unassignedAt: null },
      create: { userId: uid, locationId: loc.id },
    });
  };
  await assign("sm-01", "kedungmutih");
  await assign("sm-02", "purworejo");
  await assign("mandor-01", "kedungmutih");
  await assign("mandor-01", "purworejo"); // mandor multi-lokasi
  await assign("pm-01", "kedungmutih");
  await assign("pm-01", "purworejo");
  await assign("pm-01", "batah-timur");
  await assign("pm-01", "tengket");
  await assign("am-jateng", "kedungmutih");
  await assign("am-jateng", "purworejo");

  // ── Paket non-kontrak: prospek / tender / batal ─────────────
  const extraPkgs = [
    { number: "PKT-2027-001", name: "Paket KNMP Tahap II — Sulawesi Selatan", stage: "prospek" as const, hps: 12_500_000_000n },
    { number: "PKT-2027-002", name: "Paket KNMP Tahap II — Maluku", stage: "tender" as const, hps: 9_800_000_000n, candidate: "PT Bahari Jaya Mandiri" },
    { number: "PKT-2026-X01", name: "Paket KNMP Aceh (batal)", stage: "batal" as const, hps: 6_000_000_000n, cancel: "Anggaran dialihkan ke TA 2027" },
  ];
  for (const e of extraPkgs) {
    const exist = await db.package.findFirst({ where: { orgId: org.id, packageNumber: e.number } });
    if (!exist) {
      const pkg = await db.package.create({
        data: {
          orgId: org.id,
          name: e.name,
          packageNumber: e.number,
          hpsValue: e.hps,
          stage: e.stage,
          candidateVendorName: "candidate" in e ? e.candidate : null,
          cancelReason: "cancel" in e ? e.cancel : null,
          createdById: adminId,
        },
      });
      await db.packageStageHistory.create({
        data: { packageId: pkg.id, fromStage: null, toStage: "prospek", changedById: adminId },
      });
      if (e.stage !== "prospek") {
        await db.packageStageHistory.create({
          data: { packageId: pkg.id, fromStage: "prospek", toStage: e.stage === "batal" ? "batal" : "tender", changedById: adminId, note: "cancel" in e ? e.cancel : null },
        });
      }
    }
  }

  // ── Laporan harian demo di kedungmutih (status beragam) ─────
  const kdm = await db.location.findUniqueOrThrow({ where: { slug: "kedungmutih" } });
  const kdmRev = await db.rabRevision.findFirstOrThrow({ where: { locationId: kdm.id, status: "aktif" } });
  const workNodes = await db.rabNode.findMany({
    where: { revisionId: kdmRev.id, kind: "item", amount: { gt: 0 }, volume: { gt: 0 } },
    orderBy: { sortOrder: "asc" },
    take: 6,
  });

  const mkReport = async (
    day: number,
    status: "draft" | "dikirim" | "disetujui" | "final" | "perlu_koreksi",
    itemCount: number,
  ) => {
    const reportDate = daysAgo(day);
    const exist = await db.dailyReport.findUnique({
      where: { locationId_reportDate: { locationId: kdm.id, reportDate } },
    });
    if (exist) return;
    const report = await db.dailyReport.create({
      data: {
        locationId: kdm.id,
        reportDate,
        status,
        weather: "cerah",
        workStart: "07:30",
        workEnd: "16:30",
        createdById: mandorId,
        submittedById: status === "draft" ? null : mandorId,
        submittedAt: status === "draft" ? null : new Date(reportDate.getTime() + 10 * 3600 * 1000),
        verifiedById: ["disetujui", "final"].includes(status) ? smId : null,
        verifiedAt: ["disetujui", "final"].includes(status) ? new Date(reportDate.getTime() + 12 * 3600 * 1000) : null,
        finalizedById: status === "final" ? smId : null,
        finalizedAt: status === "final" ? new Date(reportDate.getTime() + 13 * 3600 * 1000) : null,
      },
    });
    for (const node of workNodes.slice(0, itemCount)) {
      // Patuh guard bisnis: kumulatif tidak boleh melebihi volume RAB.
      const prior = await db.dailyReportItem.aggregate({
        where: { lineageKey: node.lineageKey, report: { locationId: kdm.id } },
        _sum: { volumeDone: true },
      });
      const remaining = Number(node.volume) - Number(prior._sum.volumeDone ?? 0);
      const vol = Math.min(remaining, Math.max(0.5, Number(node.volume) * 0.02));
      if (vol <= 0) continue;
      await db.dailyReportItem.create({
        data: {
          reportId: report.id,
          rabNodeId: node.id,
          lineageKey: node.lineageKey,
          volumeDone: vol,
          valueDone: calcValueDone(vol, Number(node.unitPrice ?? 0)),
          reportedById: mandorId,
        },
      });
    }
    await db.dailyReportWorker.createMany({
      data: [
        { reportId: report.id, role: "mandor" as const, count: 1 },
        { reportId: report.id, role: "tukang_batu" as const, count: 4 },
        { reportId: report.id, role: "tenaga" as const, count: 6 },
      ],
    });
    await db.dailyReportMaterial.create({
      data: { reportId: report.id, name: "Semen PCC 50kg", unit: "zak", qtyReceived: 40 },
    });
    await db.dailyReportEquipment.create({ data: { reportId: report.id, name: "Concrete mixer", count: 1 } });
    const flow: [string | null, string][] = { draft: [], dikirim: [[null, "dikirim"]], perlu_koreksi: [[null, "dikirim"], ["dikirim", "perlu_koreksi"]], disetujui: [[null, "dikirim"], ["dikirim", "disetujui"]], final: [[null, "dikirim"], ["dikirim", "disetujui"], ["disetujui", "final"]] }[status] as [string | null, string][];
    for (const [from, to] of flow) {
      await db.dailyReportStatusHistory.create({
        data: {
          reportId: report.id,
          fromStatus: (from ?? undefined) as never,
          toStatus: to as never,
          changedById: to === "dikirim" ? mandorId : smId,
          reason: to === "perlu_koreksi" ? "Volume pasangan batu tidak sesuai foto — mohon cek ulang" : null,
        },
      });
    }
  };
  await mkReport(4, "final", 3);
  await mkReport(3, "disetujui", 3);
  await mkReport(2, "perlu_koreksi", 2);
  await mkReport(1, "dikirim", 3);
  await mkReport(0, "draft", 1);

  // Kendala + pemulihan
  const hasIssue = await db.issue.count({ where: { locationId: kdm.id } });
  if (hasIssue === 0) {
    const issue = await db.issue.create({
      data: {
        locationId: kdm.id,
        title: "Pasang surut menghambat pemancangan",
        description: "Area kerja tergenang saat pasang; efektif kerja hanya 5 jam/hari.",
        severity: "tinggi",
        status: "terbuka",
        raisedById: smId,
      },
    });
    await db.recoveryAction.create({
      data: {
        issueId: issue.id,
        description: "Tambah shift malam saat surut + sewa pompa 2 unit",
        picUserId: smId,
        dueDate: daysAgo(-7),
        status: "berjalan",
        createdById: smId,
      },
    });
  }

  // ── Keuangan demo kedungmutih: commitment → expense → invoice → pembayaran parsial ──
  const hasCommit = await db.commitment.count({ where: { locationId: kdm.id } });
  if (hasCommit === 0) {
    const vendorMaterial = await db.vendor.upsert({
      where: { orgId_name: { orgId: org.id, name: "CV Sumber Material Jaya" } },
      update: {},
      create: { orgId: org.id, name: "CV Sumber Material Jaya" },
    });
    const po = await db.commitment.create({
      data: {
        locationId: kdm.id,
        vendorId: vendorMaterial.id,
        type: "po",
        number: "PO-KDM-2026-001",
        description: "Pengadaan semen + besi beton tahap 1",
        category: "material",
        amount: 350_000_000n,
        dueDate: daysAgo(-14),
        status: "disetujui",
        createdById: smId,
        approvedById: userByName.get("am-jateng")!,
        approvedAt: daysAgo(20),
      },
    });
    await db.expense.create({
      data: {
        locationId: kdm.id,
        commitmentId: po.id,
        category: "material",
        amount: 180_000_000n,
        txDate: daysAgo(10),
        description: "Terima material batch 1 (semen 400 zak, besi 12 ton)",
        status: "disetujui",
        createdById: smId,
        approvedById: userByName.get("am-jateng")!,
        approvedAt: daysAgo(9),
      },
    });
    const inv = await db.invoice.create({
      data: {
        locationId: kdm.id,
        commitmentId: po.id,
        number: "INV-SMJ-0042",
        amount: 180_000_000n,
        invoiceDate: daysAgo(8),
        dueDate: daysAgo(-22),
        status: "dibayar_sebagian",
        createdById: smId,
        approvedById: userByName.get("am-jateng")!,
      },
    });
    await db.paymentOut.create({
      data: { invoiceId: inv.id, amount: 90_000_000n, paidDate: daysAgo(3), createdById: adminId },
    });
    const kasbon = await db.commitment.create({
      data: {
        locationId: kdm.id,
        type: "kasbon",
        number: "KSB-KDM-2026-003",
        description: "Kasbon operasional mingguan SM",
        category: "overhead",
        amount: 15_000_000n,
        status: "diajukan",
        createdById: smId,
      },
    });
    void kasbon;
    // Owner billing termin 1 + pencairan
    const kdmContract = await db.contract.findUniqueOrThrow({ where: { contractNumber: "SPK-KNMP-2026-KDM-001" } });
    const billing = await db.ownerBilling.create({
      data: {
        contractId: kdmContract.id,
        terminNo: 1,
        description: "Uang muka 20%",
        amount: (kdmContract.contractValue * 20n) / 100n,
        billedDate: daysAgo(60),
        status: "cair",
        createdById: adminId,
      },
    });
    await db.disbursement.create({
      data: { ownerBillingId: billing.id, amount: billing.amount, receivedDate: daysAgo(50), createdById: adminId },
    });
  }

  // Setting default
  await db.appSetting.upsert({
    where: { key_effectiveFrom: { key: "ppn_percent", effectiveFrom: dateOnly("2022-04-01") } },
    update: {},
    create: { key: "ppn_percent", value: "11", effectiveFrom: dateOnly("2022-04-01") },
  });

  console.log("Seed selesai.");
}

