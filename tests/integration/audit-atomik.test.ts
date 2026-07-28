// AUDIT-01 — audit log SEHIDUP-SEMATI dengan mutasi uang/status.
//
// Sebelumnya `audit()` dipanggil SESUDAH transaksi commit dan kegagalannya
// ditelan (`catch → console.error`), jadi uang bisa berpindah atau status
// berubah TANPA jejak. Uji ini memaksa penulisan audit gagal di tengah
// transaksi dan menuntut mutasinya ikut batal — dan sebaliknya, transaksi yang
// batal tidak boleh meninggalkan baris audit.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
// `auditIn` membaca IP lewat next/headers bila tidak dilewatkan pemanggil.
vi.mock("@/lib/auth/session", async () => ({ requestIp: async () => null }));

const { db } = await import("@/lib/db");
const { auditIn } = await import("@/lib/audit");
const { applyPaymentTx } = await import("@/lib/finance/apply");

const suffix = `aa${Date.now().toString(36)}`;
let userId: string;
let invoiceId: string;

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org AA ${suffix}`, slug: `org-${suffix}` } });
  const user = await db.user.create({
    data: { orgId: org.id, username: `aa-${suffix}`, fullName: "Tester", passwordHash: "x", role: "super_admin" },
  });
  userId = user.id;
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket AA ${suffix}` } });
  const loc = await db.location.create({
    data: {
      packageId: pkg.id,
      name: "Lokasi AA",
      slug: `lokasi-${suffix}`,
      village: "Desa",
      regency: "Kab",
      province: "Prov",
    },
  });
  const inv = await db.invoice.create({
    data: {
      locationId: loc.id,
      number: `INV-${suffix}`,
      amount: 100_000_000n,
      invoiceDate: new Date("2026-03-01T00:00:00Z"),
      status: "disetujui",
      createdById: userId,
    },
  });
  invoiceId = inv.id;
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

/** Jumlah pembayaran + jumlah baris audit untuk invoice ini. */
async function keadaan() {
  const [pembayaran, jejak, inv] = await Promise.all([
    db.paymentOut.count({ where: { invoiceId } }),
    db.auditLog.count({ where: { action: "finance.payment.add", resourceId: { not: null } } }),
    db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { status: true } }),
  ]);
  return { pembayaran, jejak, status: inv.status };
}

describe("AUDIT-01 — mutasi uang dan auditnya satu transaksi", () => {
  it("audit GAGAL ⇒ pembayaran ikut batal (tidak ada uang tanpa jejak)", async () => {
    const awal = await keadaan();

    // userId palsu → FK audit_logs.user_id gagal DI DALAM transaksi.
    const palsu = "00000000-0000-0000-0000-0000000000ff";
    await expect(
      db.$transaction(async (tx) => {
        await applyPaymentTx(tx, {
          invoiceId,
          amount: 40_000_000n,
          paidDate: new Date("2026-03-05T00:00:00Z"),
          note: null,
          createdById: userId,
        });
        await auditIn(tx, palsu, "finance.payment.add", "payment_out", invoiceId, { amount: 40_000_000n }, null);
      }),
    ).rejects.toThrow();

    const akhir = await keadaan();
    expect(akhir.pembayaran, "pembayaran tidak boleh tersimpan").toBe(awal.pembayaran);
    expect(akhir.jejak, "audit juga tidak tersimpan").toBe(awal.jejak);
    expect(akhir.status, "status invoice tidak berubah").toBe(awal.status);
  });

  it("mutasi GAGAL ⇒ tidak ada baris audit yatim", async () => {
    const awal = await keadaan();

    await expect(
      db.$transaction(async (tx) => {
        // Melebihi nilai invoice → guard applyPaymentTx melempar.
        await applyPaymentTx(tx, {
          invoiceId,
          amount: 500_000_000n,
          paidDate: new Date("2026-03-06T00:00:00Z"),
          note: null,
          createdById: userId,
        });
        await auditIn(tx, userId, "finance.payment.add", "payment_out", invoiceId, {}, null);
      }),
    ).rejects.toThrow();

    const akhir = await keadaan();
    expect(akhir.pembayaran).toBe(awal.pembayaran);
    expect(akhir.jejak, "audit tidak boleh ditulis untuk mutasi yang batal").toBe(awal.jejak);
  });

  it("jalur sah tetap normal: pembayaran DAN auditnya sama-sama tersimpan", async () => {
    const awal = await keadaan();

    const hasil = await db.$transaction(async (tx) => {
      const r = await applyPaymentTx(tx, {
        invoiceId,
        amount: 60_000_000n,
        paidDate: new Date("2026-03-07T00:00:00Z"),
        note: null,
        createdById: userId,
      });
      await auditIn(tx, userId, "finance.payment.add", "payment_out", r.payment.id, { amount: 60_000_000n }, null);
      return r;
    });

    const akhir = await keadaan();
    expect(akhir.pembayaran).toBe(awal.pembayaran + 1);
    expect(akhir.jejak).toBe(awal.jejak + 1);
    expect(hasil.newStatus).toBe("dibayar_sebagian");
  });
});
