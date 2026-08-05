import type { BadgeTone } from "@/components/ui";
import type {
  ApprovalStatus,
  BillingStatus,
  CommitmentType,
  CostCategory,
  InvoiceStatus,
} from "@/generated/prisma/enums";

/** Label & tone UI modul keuangan — dipakai halaman portfolio dan lokasi. */

export const COST_CATEGORIES = [
  "material",
  "upah",
  "alat",
  "subkon",
  "overhead",
  "transport",
  "lain",
] as const satisfies readonly CostCategory[];

export const CATEGORY_LABEL: Record<CostCategory, string> = {
  material: "Material",
  upah: "Upah",
  alat: "Alat",
  subkon: "Subkontraktor",
  overhead: "Overhead",
  transport: "Transport",
  lain: "Lain-lain",
};

export const COMMITMENT_TYPES = ["po", "kontrak_vendor", "kasbon"] as const satisfies readonly CommitmentType[];

export const COMMITMENT_TYPE_LABEL: Record<CommitmentType, string> = {
  po: "PO",
  kontrak_vendor: "Kontrak Vendor",
  kasbon: "Kasbon",
};

export const APPROVAL_STATUS_LABEL: Record<ApprovalStatus, string> = {
  draft: "Draft",
  diajukan: "Diajukan",
  disetujui: "Disetujui",
  ditolak: "Ditolak",
  batal: "Batal",
};

export const APPROVAL_STATUS_TONE: Record<ApprovalStatus, BadgeTone> = {
  draft: "neutral",
  diajukan: "warning",
  disetujui: "success",
  ditolak: "danger",
  batal: "neutral",
};

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  diajukan: "Diajukan",
  disetujui: "Disetujui",
  ditolak: "Ditolak",
  dibayar_sebagian: "Dibayar sebagian",
  lunas: "Lunas",
};

export const INVOICE_STATUS_TONE: Record<InvoiceStatus, BadgeTone> = {
  diajukan: "warning",
  disetujui: "info",
  ditolak: "danger",
  dibayar_sebagian: "warning",
  lunas: "success",
};

export const BILLING_STATUS_LABEL: Record<BillingStatus, string> = {
  draft: "Draft",
  diajukan: "Diajukan",
  disetujui: "Disetujui",
  cair_sebagian: "Cair sebagian",
  cair: "Cair",
  ditolak: "Ditolak",
};

export const BILLING_STATUS_TONE: Record<BillingStatus, BadgeTone> = {
  draft: "neutral",
  diajukan: "warning",
  disetujui: "info",
  cair_sebagian: "warning",
  cair: "success",
  ditolak: "danger",
};
