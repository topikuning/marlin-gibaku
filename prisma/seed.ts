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

import { PrismaClient } from "@prisma/client";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { hash } from "@node-rs/argon2";
import { generateScurve, DEFAULT_CONTRACT_DAYS } from "../src/lib/scurve";

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

async function seedAdminUser() {
  const pinHash = await hash("123456"); // dev only; ganti di production
  return prisma.user.upsert({
    where: { phoneE164: "+6281234567890" },
    update: {},
    create: {
      orgId: DEFAULT_ORG_ID,
      phoneE164: "+6281234567890",
      fullName: "Admin KNMP",
      email: "admin@knmp.dev",
      pinHash,
      role: "super_admin",
      isActive: true,
    },
  });
}

async function seedLocation(payload: LocationSeedJson) {
  const { meta } = payload;
  console.log(`  · ${meta.slug} (${meta.village}, ${meta.regency})`);

  // 1. Contract
  const contract = await prisma.contract.upsert({
    where: { contractNumber: meta.contract_number },
    update: {},
    create: {
      orgId: DEFAULT_ORG_ID,
      contractNumber: meta.contract_number,
      contractorName: meta.contractor,
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

  // 3. Delete existing RAB tree for this location (clean re-seed)
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
  await prisma.rabCategory.deleteMany({ where: { locationId: location.id } });

  // 4. RAB categories + subcategories + items
  let catSortOrder = 0;
  for (const cat of payload.categories) {
    if (cat.total_value <= 0) continue;

    const category = await prisma.rabCategory.create({
      data: {
        locationId: location.id,
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
    let subSortOrder = 0;
    for (const sub of cat.subcategories) {
      const subcategory = await prisma.rabSubcategory.create({
        data: {
          categoryId: category.id,
          code: sub.code,
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

  console.log("→ Seeding admin user (PIN: 123456 — DEV ONLY)...");
  await seedAdminUser();

  console.log("→ Seeding locations from seed-data/*.json:");
  const files = readdirSync(SEED_DIR).filter(
    (f) => f.endsWith(".json") && f !== "manifest.json"
  );
  for (const file of files) {
    const payload = JSON.parse(
      readFileSync(join(SEED_DIR, file), "utf-8")
    ) as LocationSeedJson;
    await seedLocation(payload);
  }

  const locCount = await prisma.location.count();
  const rabItemCount = await prisma.rabItem.count();
  const milestoneCount = await prisma.scheduledMilestone.count();

  console.log("\n✓ Seed complete");
  console.log(`  Locations:            ${locCount}`);
  console.log(`  RAB items (all lvls): ${rabItemCount}`);
  console.log(`  Scheduled milestones: ${milestoneCount}`);
  console.log(`\n  Login dev: +6281234567890 / PIN 123456`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
