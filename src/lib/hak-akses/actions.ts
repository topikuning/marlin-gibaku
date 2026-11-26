"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { auditIn } from "@/lib/audit";
import { ForbiddenError, requireCapability } from "@/lib/auth/session";
import { ALL_ROLES, CAPABILITIES, ROLE_LABEL, type Capability } from "@/lib/authz";
import { bacaPenggantiHakAkses, segarkanHakAkses } from "./muat";
import { HakAksesTerkunci, rencanaUbahHakAkses } from "./rencana";
import { LABEL_KEWENANGAN } from "./label";
import type { UserRole } from "@/generated/prisma/enums";

export type HakAksesState = { error?: string; success?: string } | undefined;

/**
 * Hanya Super Admin (DECISIONS 793) – permintaan user: *"melalui login super
 * admin"*. `system.manage` terkunci untuk Super Admin saja, tapi peran diperiksa
 * juga di sini supaya pengaturan ini tidak bisa membuka dirinya sendiri.
 */
async function superAdmin() {
  const user = await requireCapability("system.manage");
  if (user.role !== "super_admin") throw new ForbiddenError("Hak akses hanya bisa diatur Super Admin.");
  return user;
}

const ubahSchema = z.object({
  role: z.enum(ALL_ROLES as [UserRole, ...UserRole[]]),
  capability: z.enum(CAPABILITIES as unknown as [Capability, ...Capability[]]),
  boleh: z.enum(["1", "0"]),
});

const daftarPeran = (rs: UserRole[]) => rs.map((r) => ROLE_LABEL[r]).join(", ");

/** Satu centang di matriks hak akses: beri atau cabut satu kewenangan dari satu peran. */
export async function ubahHakAksesAction(_prev: HakAksesState, formData: FormData): Promise<HakAksesState> {
  try {
    const user = await superAdmin();
    const parsed = ubahSchema.safeParse({
      role: formData.get("role"),
      capability: formData.get("capability"),
      boleh: formData.get("boleh"),
    });
    if (!parsed.success) return { error: "Pilihan hak akses tidak dikenal." };
    const { role, capability } = parsed.data;
    const boleh = parsed.data.boleh === "1";

    const rencana = await db.$transaction(async (tx) => {
      const r = rencanaUbahHakAkses(await bacaPenggantiHakAkses(), role, capability, boleh);
      for (const b of r.baris) {
        if (b.boleh === null) {
          await tx.hakAksesPeran.deleteMany({ where: { role: b.role, capability } });
        } else {
          await tx.hakAksesPeran.upsert({
            where: { role_capability: { role: b.role, capability } },
            create: { role: b.role, capability, boleh: b.boleh, diubahOlehId: user.id },
            update: { boleh: b.boleh, diubahOlehId: user.id, diubahPada: new Date() },
          });
        }
      }
      if (r.berubah.length > 0) {
        await auditIn(tx, user.id, "hak_akses.ubah", "hak_akses_peran", capability, {
          capability,
          label: LABEL_KEWENANGAN[capability],
          diminta: { role, boleh },
          berubah: r.berubah,
        });
      }
      return r;
    });

    await segarkanHakAkses();
    revalidatePath("/", "layout");
    const label = LABEL_KEWENANGAN[capability];
    if (rencana.berubah.length === 0) return { success: `Tidak ada yang berubah untuk "${label}".` };
    const diberi = rencana.berubah.filter((x) => x.ke).map((x) => x.role);
    const dicabut = rencana.berubah.filter((x) => !x.ke).map((x) => x.role);
    return {
      success:
        (diberi.length ? `"${label}" kini berlaku untuk ${daftarPeran(diberi)}.` : "") +
        (dicabut.length ? `${diberi.length ? " " : ""}"${label}" dicabut dari ${daftarPeran(dicabut)}.` : ""),
    };
  } catch (e) {
    if (e instanceof HakAksesTerkunci) return { error: e.message };
    if (e instanceof ForbiddenError) return { error: e.message };
    throw e;
  }
}

/** Kembalikan SEMUA pengaturan hak akses ke bawaan program. */
export async function kembalikanBawaanHakAksesAction(_prev: HakAksesState, _formData: FormData): Promise<HakAksesState> {
  try {
    const user = await superAdmin();
    const jumlah = await db.$transaction(async (tx) => {
      const lama = await tx.hakAksesPeran.findMany({ select: { role: true, capability: true, boleh: true } });
      if (lama.length === 0) return 0;
      await tx.hakAksesPeran.deleteMany({});
      await auditIn(tx, user.id, "hak_akses.kembali_bawaan", "hak_akses_peran", "semua", { dibuang: lama });
      return lama.length;
    });
    await segarkanHakAkses();
    revalidatePath("/", "layout");
    return { success: jumlah ? `${jumlah} pengaturan dibuang; semua hak akses kembali ke bawaan.` : "Semua hak akses sudah sama dengan bawaan." };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: e.message };
    throw e;
  }
}
