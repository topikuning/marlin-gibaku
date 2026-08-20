// Uji race pembayaran/pencairan (audit 2026-07-27, B6) terhadap Postgres nyata.
//
// Pola lama aggregate→guard→create pada READ COMMITTED: dua request paralel
// sama-sama membaca "sisa Rp X", sama-sama lolos guard, invoice terbayar dobel
// TANPA error — dan clamp 0n di calc.ts menyembunyikannya dari dashboard.
// `applyPaymentTx`/`applyDisbursementTx` menutupnya dengan SELECT … FOR UPDATE;
// uji ini menjalankan dua transaksi BERSAMAAN dan menuntut tepat satu gagal.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { applyPaymentTx, applyDisbursementTx, FinanceGuardError } = await import("@/lib/finance/apply");

const suffix = `fr${Date.now().toString(36)}`;
let userId: string;
let locationId: string;
let contractId: string;

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org FR ${suffix}`, slug: `org-${suffix}` } });
  const user = await db.user.create({
    data: { orgId: org.id, username: `fr-${suffix}`, fullName: "Tester", passwordHash: "x", role: "super_admin" },
  });
  userId = user.id;
  const vendor = await db.vendor.create({ data: { orgId: org.id, name: `PT FR ${suffix}` } });
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket FR ${suffix}` } });
  const contract = await db.contract.create({
    data: {
      packageId: pkg.id,
      vendorId: vendor.id,
      contractNumber: `KTR-${suffix}`,
      contractValue: 1_000_000_000n,
      signedDate: new Date("2026-01-05T00:00:00Z"),
      durationDays: 56,
    },
  });
  contractId = contract.id;
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: "Lokasi FR",
      slug: `lokasi-${suffix}`,
      village: "Desa",
      regency: "Kab",
      province: "Prov",
    },
  });
  locationId = loc.id;
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("B6 – pembayaran invoice tidak bisa dobel", () => {
  it("dua pembayaran PARALEL 60jt atas invoice 100jt → tepat satu ditolak", async () => {
    const invoice = await db.invoice.create({
      data: {
        locationId,
        number: `INV-${suffix}-1`,
        amount: 100_000_000n,
        invoiceDate: new Date("2026-02-01T00:00:00Z"),
        status: "disetujui",
        createdById: userId,
      },
    });
    const pay = () =>
      db.$transaction((tx) =>
        applyPaymentTx(tx, {
          invoiceId: invoice.id,
          amount: 60_000_000n,
          paidDate: new Date("2026-02-10T00:00:00Z"),
          note: null,
          createdById: userId,
        }),
      );
    const results = await Promise.allSettled([pay(), pay()]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as PromiseRejectedResult).reason).toBeInstanceOf(FinanceGuardError);

    const agg = await db.paymentOut.aggregate({ where: { invoiceId: invoice.id }, _sum: { amount: true } });
    expect(agg._sum.amount).toBe(60_000_000n); // TIDAK pernah melampaui tagihan
    const inv = await db.invoice.findUniqueOrThrow({ where: { id: invoice.id }, select: { status: true } });
    expect(inv.status).toBe("dibayar_sebagian");
  });

  it("pelunasan sisa berjalan normal setelahnya (lock tidak mengunci jalur sah)", async () => {
    const invoice = await db.invoice.findFirstOrThrow({
      where: { number: `INV-${suffix}-1` },
      select: { id: true },
    });
    const r = await db.$transaction((tx) =>
      applyPaymentTx(tx, {
        invoiceId: invoice.id,
        amount: 40_000_000n,
        paidDate: new Date("2026-02-20T00:00:00Z"),
        note: null,
        createdById: userId,
      }),
    );
    expect(r.newStatus).toBe("lunas");
  });
});

describe("B6 – pencairan termin tidak bisa dobel", () => {
  it("dua pencairan PARALEL 80jt atas termin 100jt → tepat satu ditolak", async () => {
    const billing = await db.ownerBilling.create({
      data: {
        contractId,
        terminNo: 1,
        amount: 100_000_000n,
        status: "disetujui",
        createdById: userId,
      },
    });
    const cair = () =>
      db.$transaction((tx) =>
        applyDisbursementTx(tx, {
          billingId: billing.id,
          amount: 80_000_000n,
          receivedDate: new Date("2026-03-01T00:00:00Z"),
          note: null,
          createdById: userId,
        }),
      );
    const results = await Promise.allSettled([cair(), cair()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);

    const agg = await db.disbursement.aggregate({
      where: { ownerBillingId: billing.id },
      _sum: { amount: true },
    });
    expect(agg._sum.amount).toBe(80_000_000n);
  });
});
