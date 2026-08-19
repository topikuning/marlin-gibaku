"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { applyDisbursementTx, applyPaymentTx, FinanceGuardError } from "./apply";
import { auditIn } from "@/lib/audit";
import {
  requireCapability,
  requireLocationAccess,
  hasLocationAccess,
  requestIp,
  ForbiddenError,
  type SessionUser,
} from "@/lib/auth/session";
import { formatRupiah, jakartaToday, parseDateKey } from "@/lib/format";
import { Prisma } from "@/generated/prisma/client";

/**
 * Server actions modul KEUANGAN — transaction-based.
 * Aturan lintas aksi:
 * - Setiap aksi: capability check + scope lokasi + zod + audit + revalidatePath.
 * - Approval flow: diajukan → disetujui | ditolak; hanya finance.approve yang memutus.
 * - Angka agregat (available budget, outstanding, dst.) TIDAK PERNAH diedit langsung —
 *   selalu derived di calc layer dari transaksi.
 */

export type FinanceActionState = { error?: string; success?: string } | undefined;

// ── Helper umum ──────────────────────────────────────────────

/** Error guard bisnis: pesan aman ditampilkan ke user, membatalkan $transaction. */
class GuardError extends Error {}

/**
 * Four-eyes (audit 2026-07-27, B15): transaksi tidak boleh disetujui oleh
 * orang yang mengajukannya sendiri. super_admin dikecualikan sebagai
 * break-glass (organisasi kecil sering satu admin) — tapi self-approve-nya
 * DIAUDIT eksplisit supaya terlihat di jejak.
 */
function assertFourEyes(actor: SessionUser, createdById: string | null): { selfApprove: boolean } {
  if (createdById !== null && createdById === actor.id) {
    if (actor.role !== "super_admin") {
      throw new GuardError(
        "Empat mata: transaksi yang Anda ajukan sendiri harus disetujui orang lain.",
      );
    }
    return { selfApprove: true };
  }
  return { selfApprove: false };
}

function isNextRedirect(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "digest" in e &&
    String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")
  );
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

async function run(fn: () => Promise<FinanceActionState>): Promise<FinanceActionState> {
  try {
    return await fn();
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    if (e instanceof ForbiddenError || e instanceof GuardError || e instanceof FinanceGuardError) {
      return { error: e.message };
    }
    console.error("[finance] aksi gagal:", e);
    return { error: "Terjadi kesalahan tak terduga. Coba lagi." };
  }
}

const COST_CATEGORIES = ["material", "upah", "alat", "subkon", "overhead", "transport", "lain"] as const;
const COMMITMENT_TYPES = ["po", "kontrak_vendor", "kasbon"] as const;

/** Rupiah bulat > 0. Menerima pemisah ribuan titik/koma/spasi. */
const amountSchema = z
  .string("Jumlah wajib diisi")
  .trim()
  .min(1, "Jumlah wajib diisi")
  .transform((s) => s.replace(/[.,\s]/g, ""))
  .pipe(z.string().regex(/^\d+$/, "Jumlah harus angka rupiah bulat"))
  .transform((s) => BigInt(s))
  .refine((v) => v > 0n, "Jumlah harus lebih dari 0");

/** Rupiah bulat ≥ 0 (retensi boleh 0). */
const amountZeroSchema = z
  .string()
  .trim()
  .transform((s) => (s === "" ? "0" : s.replace(/[.,\s]/g, "")))
  .pipe(z.string().regex(/^\d+$/, "Jumlah harus angka rupiah bulat"))
  .transform((s) => BigInt(s));

const dateSchema = z
  .string("Tanggal wajib diisi")
  .trim()
  .min(1, "Tanggal wajib diisi")
  .transform((s, ctx) => {
    const d = parseDateKey(s);
    if (!d) {
      ctx.addIssue({ code: "custom", message: "Tanggal tidak valid (format YYYY-MM-DD)" });
      return z.NEVER;
    }
    return d;
  });

const optionalDateSchema = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  dateSchema.optional(),
);

const optionalUuidSchema = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.uuid("ID tidak valid").optional(),
);

const reasonSchema = z.string("Alasan wajib diisi").trim().min(3, "Alasan penolakan wajib diisi (min 3 karakter)").max(500);

function firstError(error: z.ZodError): FinanceActionState {
  return { error: error.issues[0].message };
}

/** Revalidate halaman portfolio + halaman keuangan lokasi terkait. */
/**
 * Mutasi UANG/STATUS + auditnya dalam SATU transaksi (AUDIT-01).
 *
 * Sebelumnya audit ditulis SETELAH mutasi commit dan kegagalannya ditelan, jadi
 * perubahan uang bisa berhasil tanpa jejak. Di sini keduanya sehidup-semati:
 * `fn` gagal (mis. GuardError karena transisi tidak sah) ⇒ tidak ada audit;
 * penulisan audit gagal ⇒ mutasinya ikut dibatalkan.
 *
 * IP dibaca SEBELUM transaksi dibuka supaya tidak ada pembacaan header di
 * tengah transaksi. `jejak` menerima hasil `fn` karena untuk pembuatan data
 * baru id-nya baru ada setelah row-nya jadi.
 */
async function mutasiBerjejak<T>(
  actorId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  jejak: (hasil: T) => {
    action: string;
    resourceType: string;
    resourceId: string;
    payload?: Record<string, unknown>;
  },
): Promise<T> {
  const ip = (await requestIp()) ?? null;
  return db.$transaction(async (tx) => {
    const hasil = await fn(tx);
    const j = jejak(hasil);
    await auditIn(tx, actorId, j.action, j.resourceType, j.resourceId, j.payload, ip);
    return hasil;
  });
}

async function revalidateFinance(locationIds: string[]): Promise<void> {
  revalidatePath("/keuangan");
  if (locationIds.length === 0) return;
  const locs = await db.location.findMany({
    where: { id: { in: locationIds } },
    select: { slug: true },
  });
  for (const l of locs) revalidatePath(`/lokasi/${l.slug}/keuangan`);
}

/** Helper internal: vendor by name (case-preserving), buat kalau belum ada. */
async function getOrCreateVendorByName(orgId: string, name: string) {
  const trimmed = name.trim();
  return db.vendor.upsert({
    where: { orgId_name: { orgId, name: trimmed } },
    update: {},
    create: { orgId, name: trimmed },
  });
}

/** Scope kontrak: user harus punya akses ke minimal satu lokasi paket kontrak. */
async function requireContractAccess(actor: SessionUser, contractId: string) {
  const contract = await db.contract.findUnique({
    where: { id: contractId },
    select: {
      id: true,
      contractNumber: true,
      contractValue: true,
      retentionPercent: true,
      package: { select: { locations: { select: { id: true } } } },
    },
  });
  if (!contract) throw new GuardError("Kontrak tidak ditemukan.");
  for (const loc of contract.package.locations) {
    if (await hasLocationAccess(actor, loc.id)) return contract;
  }
  throw new ForbiddenError("Tidak punya akses ke lokasi kontrak ini");
}

// ── Budget per kategori ──────────────────────────────────────

const budgetSchema = z.object({
  locationId: z.uuid(),
  category: z.enum(COST_CATEGORIES, "Kategori tidak valid"),
  amount: amountSchema,
  note: z.string().trim().max(500).optional(),
});

/**
 * Set nilai budget berlaku untuk satu kategori. Hanya finance.approve.
 * Membuat row BARU status disetujui; row disetujui lama untuk kategori itu
 * dipindah ke status "batal" (riwayat tetap tersimpan, agregat calc layer
 * Σ disetujui = nilai berlaku).
 */
export async function setBudgetLine(_prev: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  return run(async () => {
    const actor = await requireCapability("finance.approve");
    const parsed = budgetSchema.safeParse({
      locationId: formData.get("locationId"),
      category: formData.get("category"),
      amount: formData.get("amount"),
      note: formData.get("note") ?? "",
    });
    if (!parsed.success) return firstError(parsed.error);
    const d = parsed.data;
    await requireLocationAccess(actor, d.locationId);

    const row = await mutasiBerjejak(
      actor.id,
      async (tx) => {
      await tx.budgetLine.updateMany({
        where: { locationId: d.locationId, category: d.category, status: "disetujui" },
        data: { status: "batal" },
      });
      return tx.budgetLine.create({
        data: {
          locationId: d.locationId,
          category: d.category,
          amount: d.amount,
          note: d.note || null,
          status: "disetujui",
          createdById: actor.id,
          approvedById: actor.id,
        },
      });
      },
      (row) => ({
        action: "finance.budget.set",
        resourceType: "budget_line",
        resourceId: row.id,
        payload: { locationId: d.locationId, category: d.category, amount: d.amount },
      }),
    );
    void row;
    await revalidateFinance([d.locationId]);
    return { success: `Budget kategori ${d.category} diperbarui.` };
  });
}

// ── Komitmen (PO / kontrak vendor / kasbon) ──────────────────

const commitmentSchema = z.object({
  locationId: z.uuid(),
  vendorName: z.string().trim().max(200).optional(),
  type: z.enum(COMMITMENT_TYPES, "Jenis komitmen tidak valid"),
  number: z.string("Nomor wajib diisi").trim().min(1, "Nomor wajib diisi").max(100),
  description: z.string("Deskripsi wajib diisi").trim().min(3, "Deskripsi wajib diisi").max(500),
  category: z.enum(COST_CATEGORIES, "Kategori tidak valid"),
  amount: amountSchema,
  dueDate: optionalDateSchema,
});

/** Buat komitmen — langsung status "diajukan" (tanpa draft). finance.input. */
export async function createCommitment(_prev: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  return run(async () => {
    const actor = await requireCapability("finance.input");
    const parsed = commitmentSchema.safeParse({
      locationId: formData.get("locationId"),
      vendorName: formData.get("vendorName") ?? "",
      type: formData.get("type"),
      number: formData.get("number"),
      description: formData.get("description"),
      category: formData.get("category"),
      amount: formData.get("amount"),
      dueDate: formData.get("dueDate") ?? "",
    });
    if (!parsed.success) return firstError(parsed.error);
    const d = parsed.data;
    await requireLocationAccess(actor, d.locationId);

    let vendorId: string | null = null;
    if (d.vendorName) {
      vendorId = (await getOrCreateVendorByName(actor.orgId, d.vendorName)).id;
    } else if (d.type !== "kasbon") {
      return { error: "Vendor wajib diisi untuk PO / kontrak vendor." };
    }

    try {
      await mutasiBerjejak(
        actor.id,
        (tx) =>
          tx.commitment.create({
            data: {
              locationId: d.locationId,
              vendorId,
              type: d.type,
              number: d.number,
              description: d.description,
              category: d.category,
              amount: d.amount,
              dueDate: d.dueDate ?? null,
              status: "diajukan",
              createdById: actor.id,
            },
          }),
        (commitment) => ({
          action: "finance.commitment.create",
          resourceType: "commitment",
          resourceId: commitment.id,
          payload: { locationId: d.locationId, type: d.type, number: d.number, amount: d.amount },
        }),
      );
    } catch (e) {
      if (isUniqueViolation(e)) return { error: `Nomor ${d.number} sudah dipakai di lokasi ini.` };
      throw e;
    }
    await revalidateFinance([d.locationId]);
    return { success: `Komitmen ${d.number} diajukan.` };
  });
}

const idSchema = z.object({ id: z.uuid() });
const idReasonSchema = z.object({ id: z.uuid(), reason: reasonSchema });

async function loadCommitmentScoped(actor: SessionUser, id: string) {
  const c = await db.commitment.findUnique({
    where: { id },
    select: { id: true, locationId: true, number: true, status: true, closedAt: true, createdById: true },
  });
  if (!c) throw new GuardError("Komitmen tidak ditemukan.");
  await requireLocationAccess(actor, c.locationId);
  return c;
}

export async function approveCommitment(_prev: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  return run(async () => {
    const actor = await requireCapability("finance.approve");
    const parsed = idSchema.safeParse({ id: formData.get("id") });
    if (!parsed.success) return firstError(parsed.error);
    const c = await loadCommitmentScoped(actor, parsed.data.id);
    const eyes = assertFourEyes(actor, c.createdById);
    // updateMany dgn syarat status: race-safe — hanya dari "diajukan"
    await mutasiBerjejak(
      actor.id,
      async (tx) => {
        const res = await tx.commitment.updateMany({
          where: { id: c.id, status: "diajukan" },
          data: { status: "disetujui", approvedById: actor.id, approvedAt: new Date() },
        });
        if (res.count === 0) throw new GuardError("Hanya komitmen berstatus diajukan yang bisa disetujui.");
      },
      () => ({
        action: "finance.commitment.approve",
        resourceType: "commitment",
        resourceId: c.id,
        payload: { number: c.number, ...eyes },
      }),
    );
    await revalidateFinance([c.locationId]);
    return { success: `Komitmen ${c.number} disetujui.` };
  });
}

export async function rejectCommitment(_prev: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  return run(async () => {
    const actor = await requireCapability("finance.approve");
    const parsed = idReasonSchema.safeParse({ id: formData.get("id"), reason: formData.get("reason") });
    if (!parsed.success) return firstError(parsed.error);
    const c = await loadCommitmentScoped(actor, parsed.data.id);
    await mutasiBerjejak(
      actor.id,
      async (tx) => {
        const res = await tx.commitment.updateMany({
          where: { id: c.id, status: "diajukan" },
          data: { status: "ditolak", approvedById: actor.id, approvedAt: new Date() },
        });
        if (res.count === 0) throw new GuardError("Hanya komitmen berstatus diajukan yang bisa ditolak.");
      },
      () => ({
        action: "finance.commitment.reject",
        resourceType: "commitment",
        resourceId: c.id,
        payload: { number: c.number, reason: parsed.data.reason },
      }),
    );
    await revalidateFinance([c.locationId]);
    return { success: `Komitmen ${c.number} ditolak.` };
  });
}

/** Tutup komitmen disetujui (selesai/tidak dipakai lagi) — berhenti membebani available budget. */
export async function closeCommitment(_prev: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  return run(async () => {
    const actor = await requireCapability("finance.approve");
    const parsed = idSchema.safeParse({ id: formData.get("id") });
    if (!parsed.success) return firstError(parsed.error);
    const c = await loadCommitmentScoped(actor, parsed.data.id);
    await mutasiBerjejak(
      actor.id,
      async (tx) => {
        const res = await tx.commitment.updateMany({
          where: { id: c.id, status: "disetujui", closedAt: null },
          data: { closedAt: new Date() },
        });
        if (res.count === 0) throw new GuardError("Hanya komitmen disetujui yang belum ditutup yang bisa ditutup.");
      },
      () => ({
        action: "finance.commitment.close",
        resourceType: "commitment",
        resourceId: c.id,
        payload: { number: c.number },
      }),
    );
    await revalidateFinance([c.locationId]);
    return { success: `Komitmen ${c.number} ditutup.` };
  });
}

// ── Realisasi (expense, termasuk settlement kasbon) ──────────

const expenseSchema = z.object({
  locationId: z.uuid(),
  commitmentId: optionalUuidSchema,
  category: z.enum(COST_CATEGORIES, "Kategori tidak valid"),
  amount: amountSchema,
  txDate: dateSchema,
  description: z.string("Deskripsi wajib diisi").trim().min(3, "Deskripsi wajib diisi").max(500),
});

/**
 * Catat realisasi. finance.input. GUARD settlement: bila menempel komitmen,
 * Σ expense non-ditolak komitmen itu (termasuk yang ini) ≤ nilai komitmen.
 */
export async function createExpense(_prev: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  return run(async () => {
    const actor = await requireCapability("finance.input");
    const parsed = expenseSchema.safeParse({
      locationId: formData.get("locationId"),
      commitmentId: formData.get("commitmentId") ?? "",
      category: formData.get("category"),
      amount: formData.get("amount"),
      txDate: formData.get("txDate"),
      description: formData.get("description"),
    });
    if (!parsed.success) return firstError(parsed.error);
    const d = parsed.data;
    await requireLocationAccess(actor, d.locationId);

    await mutasiBerjejak(
      actor.id,
      async (tx) => {
      if (d.commitmentId) {
        // Row lock — dua realisasi paralel atas komitmen yang sama tidak boleh
        // sama-sama lolos guard sisa (B6, pola sama dengan applyPaymentTx).
        await tx.$queryRaw`SELECT id FROM "commitments" WHERE id = ${d.commitmentId}::uuid FOR UPDATE`;
        const commitment = await tx.commitment.findUnique({
          where: { id: d.commitmentId },
          select: { id: true, locationId: true, status: true, closedAt: true, amount: true, number: true },
        });
        if (!commitment || commitment.locationId !== d.locationId) {
          throw new GuardError("Komitmen tidak ditemukan di lokasi ini.");
        }
        if (commitment.status !== "disetujui" || commitment.closedAt !== null) {
          throw new GuardError("Realisasi hanya bisa menempel ke komitmen disetujui yang masih terbuka.");
        }
        const agg = await tx.expense.aggregate({
          where: { commitmentId: commitment.id, status: { not: "ditolak" } },
          _sum: { amount: true },
        });
        const settled = agg._sum.amount ?? 0n;
        const remaining = commitment.amount - settled;
        if (d.amount > remaining) {
          throw new GuardError(
            `Melebihi sisa komitmen ${commitment.number}: sisa ${formatRupiah(remaining > 0n ? remaining : 0n)}.`,
          );
        }
      }
      return tx.expense.create({
        data: {
          locationId: d.locationId,
          commitmentId: d.commitmentId ?? null,
          category: d.category,
          amount: d.amount,
          txDate: d.txDate,
          description: d.description,
          status: "diajukan",
          createdById: actor.id,
        },
      });
      },
      (expense) => ({
        action: "finance.expense.create",
        resourceType: "expense",
        resourceId: expense.id,
        payload: { locationId: d.locationId, commitmentId: d.commitmentId ?? null, amount: d.amount },
      }),
    );
    await revalidateFinance([d.locationId]);
    return { success: "Realisasi diajukan." };
  });
}

async function loadExpenseScoped(actor: SessionUser, id: string) {
  const e = await db.expense.findUnique({
    where: { id },
    select: { id: true, locationId: true, description: true, status: true, createdById: true },
  });
  if (!e) throw new GuardError("Realisasi tidak ditemukan.");
  await requireLocationAccess(actor, e.locationId);
  return e;
}

export async function approveExpense(_prev: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  return run(async () => {
    const actor = await requireCapability("finance.approve");
    const parsed = idSchema.safeParse({ id: formData.get("id") });
    if (!parsed.success) return firstError(parsed.error);
    const e = await loadExpenseScoped(actor, parsed.data.id);
    const eyes = assertFourEyes(actor, e.createdById);
    await mutasiBerjejak(
      actor.id,
      async (tx) => {
        const res = await tx.expense.updateMany({
          where: { id: e.id, status: "diajukan" },
          data: { status: "disetujui", approvedById: actor.id, approvedAt: new Date() },
        });
        if (res.count === 0) throw new GuardError("Hanya realisasi berstatus diajukan yang bisa disetujui.");
      },
      () => ({
        action: "finance.expense.approve",
        resourceType: "expense",
        resourceId: e.id,
        payload: eyes,
      }),
    );
    await revalidateFinance([e.locationId]);
    return { success: "Realisasi disetujui." };
  });
}

export async function rejectExpense(_prev: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  return run(async () => {
    const actor = await requireCapability("finance.approve");
    const parsed = idReasonSchema.safeParse({ id: formData.get("id"), reason: formData.get("reason") });
    if (!parsed.success) return firstError(parsed.error);
    const e = await loadExpenseScoped(actor, parsed.data.id);
    await mutasiBerjejak(
      actor.id,
      async (tx) => {
        const res = await tx.expense.updateMany({
          where: { id: e.id, status: "diajukan" },
          data: { status: "ditolak", approvedById: actor.id, approvedAt: new Date() },
        });
        if (res.count === 0) throw new GuardError("Hanya realisasi berstatus diajukan yang bisa ditolak.");
      },
      () => ({
        action: "finance.expense.reject",
        resourceType: "expense",
        resourceId: e.id,
        payload: { reason: parsed.data.reason },
      }),
    );
    await revalidateFinance([e.locationId]);
    return { success: "Realisasi ditolak." };
  });
}

// ── Invoice vendor + pembayaran keluar ───────────────────────

const invoiceSchema = z.object({
  locationId: z.uuid(),
  commitmentId: optionalUuidSchema,
  number: z.string("Nomor wajib diisi").trim().min(1, "Nomor wajib diisi").max(100),
  amount: amountSchema,
  invoiceDate: dateSchema,
  dueDate: optionalDateSchema,
});

export async function createInvoice(_prev: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  return run(async () => {
    const actor = await requireCapability("finance.input");
    const parsed = invoiceSchema.safeParse({
      locationId: formData.get("locationId"),
      commitmentId: formData.get("commitmentId") ?? "",
      number: formData.get("number"),
      amount: formData.get("amount"),
      invoiceDate: formData.get("invoiceDate"),
      dueDate: formData.get("dueDate") ?? "",
    });
    if (!parsed.success) return firstError(parsed.error);
    const d = parsed.data;
    await requireLocationAccess(actor, d.locationId);

    if (d.commitmentId) {
      const commitment = await db.commitment.findUnique({
        where: { id: d.commitmentId },
        select: { locationId: true },
      });
      if (!commitment || commitment.locationId !== d.locationId) {
        return { error: "Komitmen tidak ditemukan di lokasi ini." };
      }
    }

    try {
      await mutasiBerjejak(
        actor.id,
        (tx) =>
          tx.invoice.create({
            data: {
              locationId: d.locationId,
              commitmentId: d.commitmentId ?? null,
              number: d.number,
              amount: d.amount,
              invoiceDate: d.invoiceDate,
              dueDate: d.dueDate ?? null,
              status: "diajukan",
              createdById: actor.id,
            },
          }),
        (invoice) => ({
          action: "finance.invoice.create",
          resourceType: "invoice",
          resourceId: invoice.id,
          payload: { locationId: d.locationId, number: d.number, amount: d.amount },
        }),
      );
    } catch (e) {
      if (isUniqueViolation(e)) return { error: `Nomor invoice ${d.number} sudah dipakai di lokasi ini.` };
      throw e;
    }
    await revalidateFinance([d.locationId]);
    return { success: `Invoice ${d.number} diajukan.` };
  });
}

async function loadInvoiceScoped(actor: SessionUser, id: string) {
  const inv = await db.invoice.findUnique({
    where: { id },
    select: { id: true, locationId: true, number: true, amount: true, status: true, createdById: true },
  });
  if (!inv) throw new GuardError("Invoice tidak ditemukan.");
  await requireLocationAccess(actor, inv.locationId);
  return inv;
}

export async function approveInvoice(_prev: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  return run(async () => {
    const actor = await requireCapability("finance.approve");
    const parsed = idSchema.safeParse({ id: formData.get("id") });
    if (!parsed.success) return firstError(parsed.error);
    const inv = await loadInvoiceScoped(actor, parsed.data.id);
    const eyes = assertFourEyes(actor, inv.createdById);
    await mutasiBerjejak(
      actor.id,
      async (tx) => {
        const res = await tx.invoice.updateMany({
          where: { id: inv.id, status: "diajukan" },
          data: { status: "disetujui", approvedById: actor.id },
        });
        if (res.count === 0) throw new GuardError("Hanya invoice berstatus diajukan yang bisa disetujui.");
      },
      () => ({
        action: "finance.invoice.approve",
        resourceType: "invoice",
        resourceId: inv.id,
        payload: { number: inv.number, ...eyes },
      }),
    );
    await revalidateFinance([inv.locationId]);
    return { success: `Invoice ${inv.number} disetujui.` };
  });
}

export async function rejectInvoice(_prev: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  return run(async () => {
    const actor = await requireCapability("finance.approve");
    const parsed = idReasonSchema.safeParse({ id: formData.get("id"), reason: formData.get("reason") });
    if (!parsed.success) return firstError(parsed.error);
    const inv = await loadInvoiceScoped(actor, parsed.data.id);
    await mutasiBerjejak(
      actor.id,
      async (tx) => {
        const res = await tx.invoice.updateMany({
          where: { id: inv.id, status: "diajukan" },
          data: { status: "ditolak", approvedById: actor.id },
        });
        if (res.count === 0) throw new GuardError("Hanya invoice berstatus diajukan yang bisa ditolak.");
      },
      () => ({
        action: "finance.invoice.reject",
        resourceType: "invoice",
        resourceId: inv.id,
        payload: { number: inv.number, reason: parsed.data.reason },
      }),
    );
    await revalidateFinance([inv.locationId]);
    return { success: `Invoice ${inv.number} ditolak.` };
  });
}

const paymentSchema = z.object({
  invoiceId: z.uuid(),
  amount: amountSchema,
  paidDate: dateSchema,
  note: z.string().trim().max(500).optional(),
});

/**
 * Catat pembayaran keluar (bisa parsial). finance.input.
 * Guard di dalam $transaction: Σ payment ≤ invoice.amount.
 * Auto-status: lunas bila terbayar penuh, selain itu dibayar_sebagian.
 */
export async function addPayment(_prev: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  return run(async () => {
    const actor = await requireCapability("finance.input");
    const parsed = paymentSchema.safeParse({
      invoiceId: formData.get("invoiceId"),
      amount: formData.get("amount"),
      paidDate: formData.get("paidDate"),
      note: formData.get("note") ?? "",
    });
    if (!parsed.success) return firstError(parsed.error);
    const d = parsed.data;
    const scoped = await loadInvoiceScoped(actor, d.invoiceId);

    // Row-lock + guard + create dalam SATU jalur teruji (lib/finance/apply.ts)
    // — dua pembayaran paralel tidak lagi bisa sama-sama lolos guard (B6).
    const result = await mutasiBerjejak(
      actor.id,
      (tx) =>
        applyPaymentTx(tx, {
          invoiceId: d.invoiceId,
          amount: d.amount,
          paidDate: d.paidDate,
          note: d.note || null,
          createdById: actor.id,
        }),
      (r) => ({
        action: "finance.payment.add",
        resourceType: "payment_out",
        resourceId: r.payment.id,
        payload: { invoiceId: d.invoiceId, amount: d.amount, newStatus: r.newStatus },
      }),
    );
    await revalidateFinance([scoped.locationId]);
    return {
      success: result.newStatus === "lunas" ? "Pembayaran dicatat – invoice lunas." : "Pembayaran parsial dicatat.",
    };
  });
}

// ── Penagihan owner (termin per kontrak) + pencairan ─────────

const billingSchema = z.object({
  contractId: z.uuid(),
  terminNo: z.coerce.number("Nomor termin wajib angka").int("Nomor termin harus bulat").min(1, "Nomor termin minimal 1"),
  description: z.string().trim().max(500).optional(),
  amount: amountSchema,
  retentionHeld: amountZeroSchema,
});

/** Buat termin penagihan owner — status draft. finance.input. */
export async function createOwnerBilling(_prev: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  return run(async () => {
    const actor = await requireCapability("finance.input");
    const parsed = billingSchema.safeParse({
      contractId: formData.get("contractId"),
      terminNo: formData.get("terminNo"),
      description: formData.get("description") ?? "",
      amount: formData.get("amount"),
      retentionHeld: formData.get("retentionHeld") ?? "",
    });
    if (!parsed.success) return firstError(parsed.error);
    const d = parsed.data;
    const contract = await requireContractAccess(actor, d.contractId);
    if (d.retentionHeld > d.amount) return { error: "Retensi tidak boleh melebihi nilai termin." };
    // Validasi silang thd retensi kontrak (audit 2026-07-27, B14c): retensi
    // termin tidak boleh MELEBIHI persen retensi kontrak. Lebih kecil boleh —
    // kontrak KNMP mengizinkan retensi diganti jaminan pemeliharaan.
    if (contract.retentionPercent != null) {
      const pct = Number(contract.retentionPercent);
      const maxRetention = (d.amount * BigInt(Math.round(pct * 100)) + 9999n) / 10000n; // ceil(amount × pct%)
      if (pct >= 0 && d.retentionHeld > maxRetention) {
        return {
          error: `Retensi melebihi ketentuan kontrak (${pct}% dari nilai termin = maks ${formatRupiah(maxRetention)}).`,
        };
      }
    }

    try {
      await mutasiBerjejak(
        actor.id,
        (tx) =>
          tx.ownerBilling.create({
            data: {
              contractId: d.contractId,
              terminNo: d.terminNo,
              description: d.description || null,
              amount: d.amount,
              retentionHeld: d.retentionHeld,
              status: "draft",
              createdById: actor.id,
            },
          }),
        (billing) => ({
          action: "finance.billing.create",
          resourceType: "owner_billing",
          resourceId: billing.id,
          payload: { contractId: d.contractId, terminNo: d.terminNo, amount: d.amount },
        }),
      );
    } catch (e) {
      if (isUniqueViolation(e)) return { error: `Termin ${d.terminNo} sudah ada untuk kontrak ini.` };
      throw e;
    }
    await revalidateFinance(contract.package.locations.map((l) => l.id));
    return { success: `Termin ${d.terminNo} dibuat (draft).` };
  });
}

async function loadBillingScoped(actor: SessionUser, id: string) {
  const b = await db.ownerBilling.findUnique({
    where: { id },
    select: { id: true, contractId: true, terminNo: true, amount: true, status: true, createdById: true },
  });
  if (!b) throw new GuardError("Termin penagihan tidak ditemukan.");
  const contract = await requireContractAccess(actor, b.contractId);
  return { billing: b, locationIds: contract.package.locations.map((l) => l.id) };
}

/** Ajukan termin: draft → diajukan (billedDate = hari ini). finance.input. */
export async function submitOwnerBilling(_prev: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  return run(async () => {
    const actor = await requireCapability("finance.input");
    const parsed = idSchema.safeParse({ id: formData.get("id") });
    if (!parsed.success) return firstError(parsed.error);
    const { billing, locationIds } = await loadBillingScoped(actor, parsed.data.id);
    await mutasiBerjejak(
      actor.id,
      async (tx) => {
        const res = await tx.ownerBilling.updateMany({
          where: { id: billing.id, status: "draft" },
          data: { status: "diajukan", billedDate: jakartaToday() },
        });
        if (res.count === 0) throw new GuardError("Hanya termin draft yang bisa diajukan.");
      },
      () => ({
        action: "finance.billing.submit",
        resourceType: "owner_billing",
        resourceId: billing.id,
        payload: { terminNo: billing.terminNo },
      }),
    );
    await revalidateFinance(locationIds);
    return { success: `Termin ${billing.terminNo} diajukan.` };
  });
}

export async function approveOwnerBilling(_prev: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  return run(async () => {
    const actor = await requireCapability("finance.approve");
    const parsed = idSchema.safeParse({ id: formData.get("id") });
    if (!parsed.success) return firstError(parsed.error);
    const { billing, locationIds } = await loadBillingScoped(actor, parsed.data.id);
    const eyes = assertFourEyes(actor, billing.createdById);
    await mutasiBerjejak(
      actor.id,
      async (tx) => {
        const res = await tx.ownerBilling.updateMany({
          where: { id: billing.id, status: "diajukan" },
          data: { status: "disetujui" },
        });
        if (res.count === 0) throw new GuardError("Hanya termin berstatus diajukan yang bisa disetujui.");
      },
      () => ({
        action: "finance.billing.approve",
        resourceType: "owner_billing",
        resourceId: billing.id,
        payload: { terminNo: billing.terminNo, ...eyes },
      }),
    );
    await revalidateFinance(locationIds);
    return { success: `Termin ${billing.terminNo} disetujui.` };
  });
}

export async function rejectOwnerBilling(_prev: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  return run(async () => {
    const actor = await requireCapability("finance.approve");
    const parsed = idReasonSchema.safeParse({ id: formData.get("id"), reason: formData.get("reason") });
    if (!parsed.success) return firstError(parsed.error);
    const { billing, locationIds } = await loadBillingScoped(actor, parsed.data.id);
    await mutasiBerjejak(
      actor.id,
      async (tx) => {
        const res = await tx.ownerBilling.updateMany({
          where: { id: billing.id, status: "diajukan" },
          data: { status: "ditolak" },
        });
        if (res.count === 0) throw new GuardError("Hanya termin berstatus diajukan yang bisa ditolak.");
      },
      () => ({
        action: "finance.billing.reject",
        resourceType: "owner_billing",
        resourceId: billing.id,
        payload: { terminNo: billing.terminNo, reason: parsed.data.reason },
      }),
    );
    await revalidateFinance(locationIds);
    return { success: `Termin ${billing.terminNo} ditolak.` };
  });
}

const disbursementSchema = z.object({
  billingId: z.uuid(),
  amount: amountSchema,
  receivedDate: dateSchema,
  note: z.string().trim().max(500).optional(),
});

/**
 * Catat pencairan dari owner (bisa parsial). finance.input.
 * Guard: Σ disbursement ≤ nilai termin. Auto-status: cair / cair_sebagian.
 */
export async function addDisbursement(_prev: FinanceActionState, formData: FormData): Promise<FinanceActionState> {
  return run(async () => {
    const actor = await requireCapability("finance.input");
    const parsed = disbursementSchema.safeParse({
      billingId: formData.get("billingId"),
      amount: formData.get("amount"),
      receivedDate: formData.get("receivedDate"),
      note: formData.get("note") ?? "",
    });
    if (!parsed.success) return firstError(parsed.error);
    const d = parsed.data;
    const { locationIds } = await loadBillingScoped(actor, d.billingId);

    // Lihat applyPaymentTx — pola lock yang sama untuk pencairan termin (B6).
    const result = await mutasiBerjejak(
      actor.id,
      (tx) =>
        applyDisbursementTx(tx, {
          billingId: d.billingId,
          amount: d.amount,
          receivedDate: d.receivedDate,
          note: d.note || null,
          createdById: actor.id,
        }),
      (r) => ({
        action: "finance.disbursement.add",
        resourceType: "disbursement",
        resourceId: r.disbursement.id,
        payload: { billingId: d.billingId, amount: d.amount, newStatus: r.newStatus },
      }),
    );
    await revalidateFinance(locationIds);
    return {
      success: result.newStatus === "cair" ? "Pencairan dicatat – termin cair penuh." : "Pencairan parsial dicatat.",
    };
  });
}
