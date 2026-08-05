"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { can } from "@/lib/authz";
import { ForbiddenError, requireCapability } from "@/lib/auth/session";
import { normalizeWaTarget } from "./model";

/**
 * Server action Manajemen Kontak (DECISIONS 150). Semua bermuara di satu
 * halaman `/administrasi/kontak`.
 *
 * Aturan kepemilikan yang dipaksakan tiap action:
 * - Kontak tujuan: menambah SELALU untuk diri sendiri; menyunting/menghapus
 *   milik orang lain hanya boleh dengan `contact.view_all` (super_admin), dan
 *   selalu diaudit dengan pemiliknya.
 * - Nama pengirim grup: milik organisasi — siapa pun yang boleh membuka
 *   halaman ini boleh memperbaikinya, tetapi tidak bisa menyentuh organisasi
 *   lain.
 */

export type ContactState = { error?: string; success?: string } | undefined;

function fail(err: unknown): ContactState {
  if (err instanceof ForbiddenError) return { error: err.message };
  return { error: err instanceof Error ? err.message : "Terjadi kesalahan." };
}

/** Halaman yang menampilkan kontak — semuanya perlu disegarkan. */
function revalidateContacts() {
  revalidatePath("/administrasi/kontak");
  revalidatePath("/dokumen-laporan/distribusi");
}

/* ── Kontak tujuan kirim ─────────────────────────────────────────────────── */

const contactSchema = z.object({
  name: z.string().trim().min(1, "Nama kontak wajib diisi").max(120),
  chatId: z.string().trim().min(3, "Tujuan WA wajib diisi").max(120),
  note: z.string().trim().max(200).optional(),
});

export async function addContactAction(_prev: ContactState, formData: FormData): Promise<ContactState> {
  try {
    const user = await requireCapability("wa.chat");
    const parsed = contactSchema.safeParse({
      name: formData.get("name") ?? "",
      chatId: formData.get("chatId") ?? "",
      note: formData.get("note") ?? "",
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const chatId = normalizeWaTarget(parsed.data.chatId);

    // Duplikat dalam daftar sendiri tidak berguna — tolak dengan jelas.
    const dup = await db.waContact.findFirst({
      where: { ownerId: user.id, chatId },
      select: { name: true },
    });
    if (dup) return { error: `Tujuan itu sudah ada di daftar Anda sebagai "${dup.name}".` };

    const created = await db.waContact.create({
      data: { ownerId: user.id, name: parsed.data.name, chatId, note: parsed.data.note || null },
      select: { id: true },
    });
    await audit(user.id, "contact.tambah", "wa_contact", created.id, { name: parsed.data.name, chatId });
    revalidateContacts();
    return { success: `Kontak "${parsed.data.name}" disimpan.` };
  } catch (err) {
    return fail(err);
  }
}

const updateContactSchema = contactSchema.extend({ id: z.uuid("Kontak tidak valid") });

export async function updateContactAction(_prev: ContactState, formData: FormData): Promise<ContactState> {
  try {
    const user = await requireCapability("wa.chat");
    const parsed = updateContactSchema.safeParse({
      id: formData.get("id") ?? "",
      name: formData.get("name") ?? "",
      chatId: formData.get("chatId") ?? "",
      note: formData.get("note") ?? "",
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const target = await db.waContact.findFirst({
      where: { id: parsed.data.id, owner: { orgId: user.orgId } },
      select: { id: true, ownerId: true, owner: { select: { fullName: true } } },
    });
    if (!target) return { error: "Kontak tidak ditemukan." };
    const mine = target.ownerId === user.id;
    if (!mine && !can(user.role, "contact.view_all")) {
      return { error: "Kontak ini milik akun lain." };
    }

    const chatId = normalizeWaTarget(parsed.data.chatId);
    await db.waContact.update({
      where: { id: target.id },
      data: { name: parsed.data.name, chatId, note: parsed.data.note || null },
    });
    await audit(user.id, "contact.sunting", "wa_contact", target.id, {
      name: parsed.data.name,
      chatId,
      milikSendiri: mine,
      pemilik: mine ? null : target.owner.fullName,
    });
    revalidateContacts();
    return { success: `Kontak "${parsed.data.name}" diperbarui.` };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteContactAction(_prev: ContactState, formData: FormData): Promise<ContactState> {
  try {
    const user = await requireCapability("wa.chat");
    const id = String(formData.get("id") ?? "");
    if (!z.uuid().safeParse(id).success) return { error: "Kontak tidak valid." };

    const target = await db.waContact.findFirst({
      where: { id, owner: { orgId: user.orgId } },
      select: { id: true, name: true, ownerId: true, owner: { select: { fullName: true } } },
    });
    if (!target) return { error: "Kontak tidak ditemukan." };
    const mine = target.ownerId === user.id;
    if (!mine && !can(user.role, "contact.view_all")) {
      return { error: "Kontak ini milik akun lain." };
    }

    await db.waContact.delete({ where: { id: target.id } });
    await audit(user.id, "contact.hapus", "wa_contact", target.id, {
      name: target.name,
      milikSendiri: mine,
      pemilik: mine ? null : target.owner.fullName,
    });
    revalidateContacts();
    return {
      success: mine
        ? `Kontak "${target.name}" dihapus.`
        : `Kontak "${target.name}" milik ${target.owner.fullName} dihapus.`,
    };
  } catch (err) {
    return fail(err);
  }
}

/* ── Nama pengirim grup (alias, milik organisasi) ────────────────────────── */

const aliasSchema = z.object({
  id: z.uuid("Alias tidak valid"),
  displayName: z.string().trim().min(2, "Nama minimal 2 karakter").max(120),
  role: z.string().trim().max(60).optional(),
  note: z.string().trim().max(200).optional(),
});

export async function updateAliasAction(_prev: ContactState, formData: FormData): Promise<ContactState> {
  try {
    const user = await requireCapability("wa.chat");
    const parsed = aliasSchema.safeParse({
      id: formData.get("id") ?? "",
      displayName: formData.get("displayName") ?? "",
      role: formData.get("role") ?? "",
      note: formData.get("note") ?? "",
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    const target = await db.waSenderAlias.findFirst({
      where: { id: parsed.data.id, orgId: user.orgId },
      select: { id: true, senderKey: true, displayName: true },
    });
    if (!target) return { error: "Nama pengirim tidak ditemukan." };

    await db.waSenderAlias.update({
      where: { id: target.id },
      data: {
        displayName: parsed.data.displayName,
        role: parsed.data.role || null,
        note: parsed.data.note || null,
      },
    });
    await audit(user.id, "wa.sender_alias.sunting", "wa_sender_alias", target.id, {
      senderKey: target.senderKey,
      dari: target.displayName,
      ke: parsed.data.displayName,
    });
    revalidateContacts();
    return { success: `Nama pengirim diperbarui jadi "${parsed.data.displayName}".` };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteAliasAction(_prev: ContactState, formData: FormData): Promise<ContactState> {
  try {
    const user = await requireCapability("wa.chat");
    const id = String(formData.get("id") ?? "");
    if (!z.uuid().safeParse(id).success) return { error: "Alias tidak valid." };

    const target = await db.waSenderAlias.findFirst({
      where: { id, orgId: user.orgId },
      select: { id: true, senderKey: true, displayName: true },
    });
    if (!target) return { error: "Nama pengirim tidak ditemukan." };

    await db.waSenderAlias.delete({ where: { id: target.id } });
    await audit(user.id, "wa.sender_alias.hapus", "wa_sender_alias", target.id, {
      senderKey: target.senderKey,
      displayName: target.displayName,
    });
    revalidateContacts();
    return {
      success: `Nama "${target.displayName}" dilepas — pengirim itu kembali tampil sebagai nomor sampai dinamai lagi.`,
    };
  } catch (err) {
    return fail(err);
  }
}
