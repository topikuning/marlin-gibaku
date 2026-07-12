/**
 * KNMP Monitor · Database Seed
 *
 * Loads:
 *   1. Default organization
 *   2. Admin user (super_admin)
 *   3. Seven KNMP locations from HPS Excel (via seed-data/*.json)
 *   4. Contracts + RAB tree per location
 *   5. Scheduled milestones via S-curve algorithm
 *
 * Idempotent — safe to run multiple times (upserts by unique keys).
 *
 * Usage:
 *   pnpm db:seed
 */

import { PrismaClient, type UserRole } from "@prisma/client";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { hashPassword } from "../src/lib/password";
import { generateScurve } from "../src/lib/scurve";

const prisma = new PrismaClient();

const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";
const SEED_DIR = join(process.cwd(), "seed-data");

interface RabItemJson {
  code: string;
  name: string;
  volume: number | null;
  unit: string | null;
  unit_price: number | null;
  total_price: number | null;
  tkdn_ratio: number | null;
  parent_code: string | null;
  children?: RabItemJson[];
}

interface LocationSeedJson {
  meta: {
    slug: string;
    village: string;
    regency: string;
    province: string;
    gps_lat: number;
    gps_lng: number;
    contract_number: string;
    contractor: string;
    start_date: string;
    end_date: string;
  };
  project: string;
  location_name_raw: string;
  province_raw: string;
  year: number;
  total: number;
  categories: Array<{
    roman: string;
    name: string;
    total_value: number;
    subcategories: Array<{
      code: string;
      name: string;
      total_value: number;
      items: RabItemJson[];
    }>;
    direct_items: RabItemJson[];
  }>;
}

async function seedOrganization() {
  return prisma.organization.upsert({
    where: { id: DEFAULT_ORG_ID },
    update: {},
    create: {
      id: DEFAULT_ORG_ID,
      name: "KNMP Program (Default)",
      slug: "knmp-default",
    },
  });
}

/**
 * Contractor = tabel terpisah (DECISIONS 017). 1 kontraktor bisa punya N kontrak.
 * Nama diambil distinct dari meta.contractor tiap file seed.
 */
async function seedContractor(name: string) {
  return prisma.contractor.upsert({
    where: { orgId_name: { orgId: DEFAULT_ORG_ID, name } },
    update: {},
    create: { orgId: DEFAULT_ORG_ID, name },
  });
}

async function seedLocation(payload: LocationSeedJson) {
  const { meta } = payload;
  console.log(`  · ${meta.slug} (${meta.village}, ${meta.regency})`);

  // 1. Contractor + Contract (1 kontrak boleh mencakup >1 lokasi — DECISIONS 016)
  const contractor = await seedContractor(meta.contractor);
  const contract = await prisma.contract.upsert({
    where: { contractNumber: meta.contract_number },
    update: {},
    create: {
      orgId: DEFAULT_ORG_ID,
      contractorId: contractor.id,
      contractNumber: meta.contract_number,
      contractValue: BigInt(Math.round(payload.total)),
      signedDate: new Date(meta.start_date),
      startDate: new Date(meta.start_date),
      endDate: new Date(meta.end_date),
    },
  });

  // 2. Location
  const location = await prisma.location.upsert({
    where: { slug: meta.slug },
    update: {},
    create: {
      orgId: DEFAULT_ORG_ID,
      contractId: contract.id,
      name: meta.village,
      slug: meta.slug,
      village: meta.village,
      regency: meta.regency,
      province: meta.province,
      gpsLat: meta.gps_lat,
      gpsLng: meta.gps_lng,
      geofenceRadiusM: 500,
      status: "in_progress",
    },
  });

  // 3. Delete existing RAB tree for this location (clean re-seed).
  // Hapus dulu data laporan yang menunjuk rab_items lokasi ini, kalau tidak
  // rabItem.deleteMany kena FK (daily_report_items.rab_item_id) dan seluruh
  // release gagal (set -e). Aman kalau belum ada laporan (no-op).
  const rabItemIds = (
    await prisma.rabItem.findMany({
      where: {
        OR: [
          { directCategory: { locationId: location.id } },
          { subcategory: { category: { locationId: location.id } } },
        ],
      },
      select: { id: true },
    })
  ).map((r) => r.id);
  if (rabItemIds.length > 0) {
    const reportItems = await prisma.dailyReportItem.findMany({
      where: { rabItemId: { in: rabItemIds } },
      select: { id: true, dailyReportId: true },
    });
    const reportItemIds = reportItems.map((r) => r.id);
    const reportIds = [
      ...new Set(reportItems.map((r) => r.dailyReportId).filter((x): x is string => !!x)),
    ];
    await prisma.photo.deleteMany({
      where: {
        OR: [
          { reportItemId: { in: reportItemIds } },
          ...(reportIds.length ? [{ dailyReportId: { in: reportIds } }] : []),
        ],
      },
    });
    await prisma.dailyReportItem.deleteMany({ where: { id: { in: reportItemIds } } });
    if (reportIds.length) {
      await prisma.costEntry.deleteMany({ where: { dailyReportId: { in: reportIds } } });
      await prisma.dailyReport.deleteMany({ where: { id: { in: reportIds } } });
    }
  }
  await prisma.rabItem.deleteMany({
    where: {
      OR: [
        { directCategory: { locationId: location.id } },
        { subcategory: { category: { locationId: location.id } } },
      ],
    },
  });
  await prisma.rabSubcategory.deleteMany({
    where: { category: { locationId: location.id } },
  });
  await prisma.rabRevision.deleteMany({ where: { locationId: location.id } });
  await prisma.rabCategory.deleteMany({ where: { locationId: location.id } });

  // 3b. Revisi RAB awal (initial_hps, active) — DECISIONS 023 Model A
  const revision = await prisma.rabRevision.create({
    data: {
      locationId: location.id,
      revisionNo: 1,
      source: "initial_hps",
      status: "active",
      totalValue: BigInt(Math.round(payload.total)),
    },
  });

  // 4. RAB categories + subcategories + items
  let catSortOrder = 0;
  for (const cat of payload.categories) {
    if (cat.total_value <= 0) continue;

    const category = await prisma.rabCategory.create({
      data: {
        locationId: location.id,
        revisionId: revision.id,
        romanNumeral: cat.roman,
        name: cat.name,
        totalValue: BigInt(Math.round(cat.total_value)),
        sortOrder: catSortOrder++,
      },
    });

    // Direct items (no subcategory)
    let itemSortOrder = 0;
    for (const item of cat.direct_items) {
      await seedRabItem(item, {
        categoryId: category.id,
        sortOrder: itemSortOrder++,
      });
    }

    // Subcategories + their items
    // NOTE: parser HPS kadang hasilkan kode subkategori duplikat dalam 1 kategori
    // (lihat OPEN_ISSUES). Disambiguasi di sini supaya tidak langgar @@unique.
    let subSortOrder = 0;
    const seenSubCodes = new Map<string, number>();
    for (const sub of cat.subcategories) {
      const seenCount = seenSubCodes.get(sub.code) ?? 0;
      seenSubCodes.set(sub.code, seenCount + 1);
      const uniqueCode = seenCount === 0 ? sub.code : `${sub.code}#${seenCount + 1}`;
      const subcategory = await prisma.rabSubcategory.create({
        data: {
          categoryId: category.id,
          code: uniqueCode,
          name: sub.name,
          totalValue: BigInt(Math.round(sub.total_value)),
          sortOrder: subSortOrder++,
        },
      });
      let subItemOrder = 0;
      for (const item of sub.items) {
        await seedRabItem(item, {
          subcategoryId: subcategory.id,
          sortOrder: subItemOrder++,
        });
      }
    }
  }

  // 5. Budget lines (default allocation from HPS estimation)
  const budgetSplit = {
    material: 0.55,
    upah: 0.25,
    alat: 0.1,
    overhead: 0.05,
    transport: 0.03,
    lain: 0.02,
  } as const;
  for (const [category, ratio] of Object.entries(budgetSplit)) {
    await prisma.budgetLine.upsert({
      where: {
        locationId_category: {
          locationId: location.id,
          category: category as keyof typeof budgetSplit,
        },
      },
      update: {},
      create: {
        locationId: location.id,
        category: category as keyof typeof budgetSplit,
        allocated: BigInt(Math.round(payload.total * ratio)),
      },
    });
  }

  // 6. Scheduled milestones from S-curve
  await prisma.scheduledMilestone.deleteMany({
    where: { locationId: location.id },
  });
  const contractDays = Math.max(
    30,
    Math.round(
      (new Date(meta.end_date).getTime() -
        new Date(meta.start_date).getTime()) /
        (1000 * 60 * 60 * 24)
    )
  );
  const scurve = generateScurve(payload, contractDays);
  for (let w = 0; w < scurve.totalWeeks; w++) {
    await prisma.scheduledMilestone.create({
      data: {
        locationId: location.id,
        rabItemId: null, // location-level milestone
        weekNumber: w + 1,
        targetProgressPct: scurve.cumulativePct[w],
        targetValue: BigInt(
          Math.round((scurve.cumulativePct[w] / 100) * payload.total)
        ),
      },
    });
  }

  // 7. Plan kurva-S ber-versi (DECISIONS 027) — plan awal auto, aktif.
  await prisma.scurvePlan.deleteMany({ where: { locationId: location.id } });
  const scurvePlan = await prisma.scurvePlan.create({
    data: {
      locationId: location.id,
      planNo: 1,
      source: "auto",
      status: "active",
      basedOnRevisionId: revision.id,
      contractDays,
    },
  });
  await prisma.scurveMilestone.createMany({
    data: scurve.cumulativePct.map((pct, w) => ({
      planId: scurvePlan.id,
      weekNumber: w + 1,
      targetProgressPct: pct,
    })),
  });

  return location;
}

const DEV_PASSWORD = "password123"; // DEV ONLY — enforce ganti saat first login production

/**
 * Demo user per role (DECISIONS 018 & 019).
 * Login pakai username + password (Argon2). Mandor (field_supervisor) di-assign
 * ke beberapa lokasi untuk membuktikan N:N user↔location.
 */
async function seedUsers(locationsBySlug: Map<string, string>) {
  const passwordHash = await hashPassword(DEV_PASSWORD);
  const loc = (slug: string) => {
    const id = locationsBySlug.get(slug);
    if (!id) throw new Error(`Seed user: lokasi '${slug}' tidak ditemukan`);
    return id;
  };

  const users: Array<{
    username: string;
    email: string;
    fullName: string;
    phoneE164: string;
    role: UserRole;
    locations: string[];
  }> = [
    { username: "admin", email: "admin@marlin.dev", fullName: "Admin MARLIN", phoneE164: "+6281100000001", role: "super_admin", locations: [] },
    { username: "direktur", email: "direktur@marlin.dev", fullName: "Program Director", phoneE164: "+6281100000002", role: "program_director", locations: [] },
    { username: "regional-jateng", email: "regional.jateng@marlin.dev", fullName: "Regional Manager Jateng", phoneE164: "+6281100000003", role: "regional_manager", locations: ["kedungmutih", "purworejo", "karanggondang", "ujungwatu", "kemantren"] },
    { username: "pm-nusantara", email: "pm.nusantara@marlin.dev", fullName: "PM Nusantara Bahari", phoneE164: "+6281100000004", role: "project_manager", locations: ["batah-timur", "tengket", "kemantren"] },
    { username: "sm-kedungmutih", email: "sm.kedungmutih@marlin.dev", fullName: "Site Manager Kedung Mutih", phoneE164: "+6281100000005", role: "site_manager", locations: ["kedungmutih"] },
    { username: "mandor-01", email: "mandor01@marlin.dev", fullName: "Mandor Suparno", phoneE164: "+6281100000006", role: "field_supervisor", locations: ["kedungmutih", "purworejo"] },
    { username: "exec-kkp", email: "exec.kkp@marlin.dev", fullName: "Exec Viewer KKP", phoneE164: "+6281100000007", role: "exec_viewer", locations: [] },
  ];

  for (const u of users) {
    const user = await prisma.user.upsert({
      where: { username: u.username },
      update: {},
      create: {
        orgId: DEFAULT_ORG_ID,
        username: u.username,
        email: u.email,
        phoneE164: u.phoneE164,
        fullName: u.fullName,
        passwordHash,
        role: u.role,
        isActive: true,
      },
    });
    for (const slug of u.locations) {
      const locationId = loc(slug);
      // assigned_at bagian dari unique key → cek manual biar idempotent
      const existing = await prisma.userLocationAssignment.findFirst({
        where: { userId: user.id, locationId, unassignedAt: null },
      });
      if (!existing) {
        await prisma.userLocationAssignment.create({
          data: { userId: user.id, locationId },
        });
      }
    }
    console.log(`  · ${u.username} (${u.role}) → ${u.locations.length} lokasi`);
  }
}

async function seedRabItem(
  item: RabItemJson,
  parent: {
    categoryId?: string;
    subcategoryId?: string;
    parentItemId?: string;
    sortOrder: number;
  }
) {
  const created = await prisma.rabItem.create({
    data: {
      categoryId: parent.categoryId ?? null,
      subcategoryId: parent.subcategoryId ?? null,
      parentItemId: parent.parentItemId ?? null,
      code: item.code,
      name: item.name,
      volume: item.volume ?? null,
      unit: item.unit ?? null,
      unitPrice: item.unit_price ?? null,
      totalPrice: item.total_price ?? null,
      tkdnRatio: item.tkdn_ratio ?? null,
      isUnplanned: false,
      sortOrder: parent.sortOrder,
    },
  });
  // Recurse into children
  if (item.children && item.children.length > 0) {
    let childOrder = 0;
    for (const child of item.children) {
      await seedRabItem(child, {
        parentItemId: created.id,
        sortOrder: childOrder++,
      });
    }
  }
}

async function main() {
  console.log("→ Seeding organization...");
  await seedOrganization();

  console.log("→ Seeding locations from seed-data/*.json:");
  const files = readdirSync(SEED_DIR).filter(
    (f) => f.endsWith(".json") && f !== "manifest.json"
  );
  const locationsBySlug = new Map<string, string>();
  for (const file of files) {
    const payload = JSON.parse(
      readFileSync(join(SEED_DIR, file), "utf-8")
    ) as LocationSeedJson;
    const location = await seedLocation(payload);
    locationsBySlug.set(location.slug, location.id);
  }

  console.log("→ Seeding demo users (password: password123 — DEV ONLY):");
  await seedUsers(locationsBySlug);

  const contractorCount = await prisma.contractor.count();
  const locCount = await prisma.location.count();
  const rabItemCount = await prisma.rabItem.count();
  const milestoneCount = await prisma.scheduledMilestone.count();
  const userCount = await prisma.user.count();

  console.log("\n✓ Seed complete");
  console.log(`  Contractors:          ${contractorCount}`);
  console.log(`  Locations:            ${locCount}`);
  console.log(`  RAB items (all lvls): ${rabItemCount}`);
  console.log(`  Scheduled milestones: ${milestoneCount}`);
  console.log(`  Users:                ${userCount}`);
  console.log(`\n  Login dev: username 'admin' / password 'password123'`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
