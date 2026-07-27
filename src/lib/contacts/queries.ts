import "server-only";
import { db } from "@/lib/db";
import { can } from "@/lib/authz";
import type { SessionUser } from "@/lib/auth/session";

/**
 * Pembacaan data halaman Manajemen Kontak (DECISIONS 150).
 *
 * Aturan cakupan, dipaksakan DI SINI supaya tidak ada halaman yang lupa:
 * - Kontak tujuan milik akun sendiri → selalu terlihat.
 * - Kontak akun lain → HANYA bila punya capability `contact.view_all`
 *   (super_admin), dan tetap dibatasi organisasi yang sama.
 * - Nama pengirim grup → milik organisasi, terlihat semua yang boleh membuka
 *   halaman ini.
 */

export type ContactRow = {
  id: string;
  name: string;
  chatId: string;
  note: string | null;
  ownerId: string;
  ownerName: string;
  ownerRole: string;
  mine: boolean;
  createdAt: Date;
};

export type AliasRow = {
  id: string;
  senderKey: string;
  displayName: string;
  role: string | null;
  note: string | null;
  createdByName: string | null;
  updatedAt: Date;
};

export type ContactsView = {
  /** Kontak tujuan milik akun yang sedang login. */
  mine: ContactRow[];
  /** Kontak milik akun LAIN — kosong bila tidak punya contact.view_all. */
  others: ContactRow[];
  /** Nama pengirim grup, milik organisasi. */
  aliases: AliasRow[];
  canViewAll: boolean;
};

export async function getContactsView(user: SessionUser): Promise<ContactsView> {
  const canViewAll = can(user.role, "contact.view_all");

  const [contacts, aliases] = await Promise.all([
    db.waContact.findMany({
      where: canViewAll ? { owner: { orgId: user.orgId } } : { ownerId: user.id },
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        name: true,
        chatId: true,
        note: true,
        ownerId: true,
        createdAt: true,
        owner: { select: { fullName: true, role: true } },
      },
    }),
    db.waSenderAlias.findMany({
      where: { orgId: user.orgId },
      orderBy: [{ displayName: "asc" }],
      select: {
        id: true,
        senderKey: true,
        displayName: true,
        role: true,
        note: true,
        updatedAt: true,
        createdBy: { select: { fullName: true } },
      },
    }),
  ]);

  const rows: ContactRow[] = contacts.map((c) => ({
    id: c.id,
    name: c.name,
    chatId: c.chatId,
    note: c.note,
    ownerId: c.ownerId,
    ownerName: c.owner.fullName,
    ownerRole: c.owner.role,
    mine: c.ownerId === user.id,
    createdAt: c.createdAt,
  }));

  return {
    mine: rows.filter((r) => r.mine),
    others: rows.filter((r) => !r.mine),
    aliases: aliases.map((a) => ({
      id: a.id,
      senderKey: a.senderKey,
      displayName: a.displayName,
      role: a.role,
      note: a.note,
      createdByName: a.createdBy?.fullName ?? null,
      updatedAt: a.updatedAt,
    })),
    canViewAll,
  };
}

/**
 * Kontak yang boleh dipakai sebagai TUJUAN KIRIM oleh seorang user — selalu
 * miliknya sendiri, tidak pernah milik orang lain (walau super admin bisa
 * melihatnya di halaman kontak). Dipakai semua pemilih tujuan.
 */
export async function listSendableContacts(userId: string) {
  return db.waContact.findMany({
    where: { ownerId: userId },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}
