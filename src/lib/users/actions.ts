"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { hashPassword } from "@/lib/auth/password";
import {
  requireCapability,
  revokeAllSessions,
  accessibleLocationIds,
  ForbiddenError,
  type SessionUser,
} from "@/lib/auth/session";
import { ADMIN_ROLES, ALL_ROLES, ROLE_LABEL, can, canCreateRole, outranks } from "@/lib/authz";
import { adalahAkar, parseAkar } from "@/lib/akar";
import { env } from "@/lib/env";
import { normalizeWaTarget } from "@/lib/contacts/model";
import type { UserRole } from "@/generated/prisma/enums";

/**
 * Rapikan ID `…@lid` yang DISALIN TANGAN dari log (DECISIONS 347).
 *
 * Yang disimpan angkanya saja: admin menyalinnya dari layar, dan salinan
 * manusia datang dengan/tanpa sufiks, kadang berspasi. Menyimpan apa adanya
 * lalu membandingkan sebagai teks akan mengulang persis cacat nomor telepon di
 * DECISIONS 345 — `6281234757999@c.us` yang tidak pernah cocok dengan
 * `6281234757999`.
 */
function rapikanLid(raw: string | undefined | null): string | null {
  const d = (raw ?? "").trim().toLowerCase().replace(/@lid$/, "").replace(/[^0-9]/g, "");
  return d.length >= 6 ? d : null;
}

const createUserSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, "Username minimal 3 karakter")
    .max(50)
    .regex(/^[a-z0-9._-]+$/, "Username: huruf kecil, angka, titik, strip"),
  fullName: z.string().trim().min(2, "Nama lengkap wajib").max(120),
  email: z.union([z.email("Email tidak valid"), z.literal("")]).optional(),
  waNumber: z.string().optional(),
  waLid: z.string().optional(),
  role: z.enum(ALL_ROLES as [string, ...string[]]),
  password: z.string().min(8, "Password minimal 8 karakter").max(255),
  locationIds: z.array(z.uuid()).optional(),
});

export type UserActionState = { error?: string; success?: string } | undefined;

/**
 * Jalankan mutasi akun dan ubah PENOLAKAN IZIN jadi pesan, bukan halaman error.
 *
 * Laporan produksi 2026-08-15: super admin menonaktifkan / mereset password
 * super admin LAIN dan mendapat layar "An error occurred in the Server
 * Components render". Pagarnya benar dan memang disengaja (`outranks` menolak
 * akun SETINGKAT, DECISIONS 165) — yang salah cara menolaknya: `ForbiddenError`
 * dilempar dari server action yang tidak menangkapnya, jadi Next melemparnya ke
 * error boundary.
 *
 * Bedanya besar bagi yang memakai. "Tidak boleh, ini alasannya" bisa
 * ditindaklanjuti; layar error tidak bisa dibedakan dari sistem yang rusak —
 * orang akan mengulanginya, lalu melapor bahwa aplikasinya error, dan tidak ada
 * satu pun petunjuk bahwa yang terjadi justru pengamanan bekerja.
 *
 * HANYA `ForbiddenError` yang diterjemahkan. Galat lain tetap dilempar: kalau
 * database yang bermasalah, menampilkannya sebagai banner sopan di formulir
 * akan menyembunyikan kegagalan nyata.
 */
async function tolakDenganPesan(fn: () => Promise<UserActionState>): Promise<UserActionState> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    throw err;
  }
}

export async function createUser(_prev: UserActionState, formData: FormData): Promise<UserActionState> {
  // Pembuatan user berjenjang (PM → SM/Pelaksana, SM → Pelaksana). Peran manajemen
  // penuh (user.manage) juga punya user.create.
  const actor = await requireCapability("user.create");
  const parsed = createUserSchema.safeParse({
    username: formData.get("username"),
    fullName: formData.get("fullName"),
    email: formData.get("email") ?? "",
    waNumber: formData.get("waNumber") ?? "",
    waLid: formData.get("waLid") ?? "",
    role: formData.get("role"),
    password: formData.get("password"),
    locationIds: formData.getAll("locationIds").map(String).filter(Boolean),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  // Hanya boleh membuat peran di bawahnya (server-side, bukan sekadar UI).
  const targetRole = d.role as UserRole;
  if (!canCreateRole(actor.role, targetRole)) {
    return { error: `Anda tidak berwenang membuat akun peran ${ROLE_LABEL[targetRole]}.` };
  }

  /*
   * AKAR TIDAK BOLEH DICETAK DARI DALAM APLIKASI (DECISIONS 315).
   *
   * `SUPER_ADMIN_UTAMA` bisa memuat username yang akunnya BELUM ADA — salah
   * ketik, atau nama yang disiapkan lebih dulu. Tanpa pagar ini, super admin
   * mana pun tinggal membuat akun dengan username itu dan langsung jadi akar:
   * seluruh gagasan "akarnya ditetapkan dari luar database" batal oleh satu
   * formulir. Hanya akar yang boleh mengisi kursi yang namanya sudah tercantum.
   */
  const daftar = daftarAkar();
  if (adalahAkar({ username: d.username, role: targetRole }, daftar) && !adalahAkar(actor, daftar)) {
    return {
      error: "Username itu terdaftar sebagai super admin utama — hanya super admin utama yang boleh membuat akunnya.",
    };
  }

  // Pembuat terbatas (bukan user.manage): hanya boleh menugaskan lokasi yang
  // dia akses sendiri. Peran manajemen penuh boleh lokasi mana pun.
  let locationIds = d.locationIds ?? [];
  if (!can(actor.role, "user.manage")) {
    const own = await accessibleLocationIds(actor); // null = akses semua
    if (own !== null) {
      const allowed = new Set(own);
      locationIds = locationIds.filter((id) => allowed.has(id));
    }
  }

  const exists = await db.user.findFirst({
    where: { OR: [{ username: d.username }, ...(d.email ? [{ email: d.email.toLowerCase() }] : [])] },
  });
  if (exists) return { error: "Username/email sudah dipakai." };

  const user = await db.user.create({
    data: {
      orgId: actor.orgId,
      username: d.username,
      email: d.email ? d.email.toLowerCase() : null,
      fullName: d.fullName,
      role: targetRole,
      passwordHash: await hashPassword(d.password),
      // Dinormalkan sekali di sini (62xxxx) supaya pengirim pengingat tidak
      // perlu menebak format yang diketik admin (DECISIONS 202).
      waNumber: d.waNumber?.trim() ? normalizeWaTarget(d.waNumber) : null,
      waLid: rapikanLid(d.waLid),
      mustChangePassword: true,
      createdById: actor.id,
    },
  });
  if (locationIds.length) {
    await db.locationAssignment.createMany({
      data: locationIds.map((locationId) => ({ userId: user.id, locationId })),
      skipDuplicates: true,
    });
  }
  await audit(actor.id, "user.create", "user", user.id, { role: targetRole, locations: locationIds.length });
  revalidatePath("/master/pengguna");
  return { success: `Pengguna ${d.username} (${ROLE_LABEL[targetRole]}) dibuat. Password harus diganti saat login pertama.` };
}

const updateProfileSchema = z.object({
  userId: z.uuid(),
  fullName: z.string().trim().min(2, "Nama lengkap wajib").max(120),
  email: z.union([z.email("Email tidak valid"), z.literal("")]).optional(),
  waNumber: z.string().optional(),
  waLid: z.string().optional(),
});

/**
 * Ubah nama (& email) pengguna. Username & peran tidak diubah di sini.
 *
 * Ikut dijaga `requireOutranks` seperti reset password & nonaktifkan, dan itu
 * BUKAN kehati-hatian berlebih: login menerima username ATAU email
 * (`auth/actions.ts`). Tanpa pagar ini, admin yang dilarang mereset password
 * seorang peer tetap bisa mengganti email peer itu — mencabut satu jalan masuk
 * ke akun yang tidak boleh ia sentuh, lewat pintu yang kebetulan tidak dijaga.
 * Pagar yang bisa diputari lewat pintu sebelah bukan pagar (DECISIONS 165).
 * Akun sendiri tetap boleh diubah — `requireOutranks` mengecualikannya.
 */
export async function updateUserProfile(_prev: UserActionState, formData: FormData): Promise<UserActionState> {
  const parsed = updateProfileSchema.safeParse({
    userId: formData.get("userId"),
    fullName: formData.get("fullName"),
    email: formData.get("email") ?? "",
    waNumber: formData.get("waNumber") ?? "",
    waLid: formData.get("waLid") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  return tolakDenganPesan(async () => {
    const actor = await requireCapability("user.manage");
    const target = await requireSameOrgUser(actor, d.userId);
    requireOutranks(actor, target, "mengubah data");

    const email = d.email ? d.email.toLowerCase() : null;
    if (email) {
      const clash = await db.user.findFirst({
        where: { email, id: { not: d.userId } },
        select: { id: true },
      });
      if (clash) return { error: "Email sudah dipakai pengguna lain." };
    }

    const waNumber = d.waNumber?.trim() ? normalizeWaTarget(d.waNumber) : null;
    const waLid = rapikanLid(d.waLid);
    await db.user.update({
      where: { id: d.userId },
      data: { fullName: d.fullName, email, waNumber, waLid },
    });
    await audit(actor.id, "user.update_profile", "user", d.userId, {
      fullName: d.fullName,
      waDiisi: !!waNumber,
      lidDiisi: !!waLid,
    });
    revalidatePath("/master/pengguna");
    return { success: "Data pengguna diperbarui." };
  });
}

/**
 * Pastikan user target berada di organisasi aktor. Dipakai SEMUA mutasi akun —
 * capability menjawab "boleh mengelola pengguna", bukan "pengguna organisasi
 * mana" (audit Codex 2026-07-28, AUTH-03). Server action bisa dipanggil
 * langsung, jadi menyembunyikan tombol bukan kontrol.
 */
async function requireSameOrgUser(actor: SessionUser, targetId: string) {
  const target = await db.user.findFirst({
    where: { id: targetId, orgId: actor.orgId },
    select: { id: true, role: true, isActive: true, fullName: true, username: true },
  });
  // Pesan "tidak ditemukan" disengaja: jangan bocorkan keberadaan akun tenant lain.
  if (!target) throw new ForbiddenError("Pengguna tidak ditemukan.");
  return target;
}

/** Daftar username super admin utama dari env (lihat `lib/akar.ts`). */
function daftarAkar(): string[] {
  return parseAkar(env.SUPER_ADMIN_UTAMA);
}

/**
 * Larang menyentuh akun yang SETINGKAT atau LEBIH TINGGI. Tanpa ini, satu akun
 * admin yang bocor bisa mereset password seluruh admin lain dan mengunci
 * pemilik sistem dari sistemnya sendiri (DECISIONS 165). Akun sendiri
 * dikecualikan — mengganti password sendiri memang haknya.
 *
 * SUPER ADMIN UTAMA (DECISIONS 315) menambahkan dua aturan di atasnya, dan
 * URUTANNYA penting:
 *
 * 1. Akun akar TIDAK BISA disentuh siapa pun — termasuk akar lain. Daftarnya
 *    ada di env, jadi cara mencabut kewenangan seorang akar adalah mengeluarkan
 *    namanya dari sana lalu redeploy; sesudah itu ia jadi super admin biasa dan
 *    bisa ditangani lewat jalur normal. Membiarkan sesama akar saling mematikan
 *    berarti pemenangnya ditentukan siapa yang menekan tombol lebih dulu.
 * 2. Akar mengungguli akun lain APA PUN perannya. Inilah yang membuka jalan
 *    keluar dari pintu satu arah: super admin biasa akhirnya bisa dinonaktifkan
 *    atau diturunkan — oleh akar, bukan oleh sesamanya.
 */
function requireOutranks(
  actor: SessionUser,
  target: { id: string; role: UserRole; username: string | null },
  aksi: string,
): void {
  if (target.id === actor.id) return;
  const daftar = daftarAkar();
  if (adalahAkar(target, daftar)) {
    throw new ForbiddenError(
      `Tidak bisa ${aksi} akun super admin utama — keluarkan namanya dari SUPER_ADMIN_UTAMA lebih dulu.`,
    );
  }
  if (adalahAkar(actor, daftar)) return;
  if (!outranks(actor.role, target.role)) {
    throw new ForbiddenError(`Tidak bisa ${aksi} akun dengan peran setingkat atau lebih tinggi.`);
  }
}

/**
 * Proteksi "admin aktif terakhir": menonaktifkan admin terakhir yang masih
 * aktif akan mengunci organisasi dari sistemnya sendiri — tidak ada lagi yang
 * bisa mengaktifkan user, membuat akun, atau mereset password, dan pemulihannya
 * harus lewat SQL langsung ke database produksi (DECISIONS 165).
 */
async function assertBukanAdminTerakhir(actor: SessionUser, targetId: string): Promise<void> {
  const adminAktif = await db.user.count({
    where: { orgId: actor.orgId, isActive: true, role: { in: ADMIN_ROLES }, id: { not: targetId } },
  });
  if (adminAktif === 0) {
    throw new ForbiddenError(
      "Ini admin aktif terakhir di organisasi — angkat admin lain dulu sebelum menonaktifkannya.",
    );
  }
}

/**
 * Nonaktifkan / aktifkan akun.
 *
 * MENGAKTIFKAN sengaja tidak menuntut peringkat: memulihkan akses orang bukan
 * menyerangnya, dan menuntut peringkat di sini berarti akun setingkat yang
 * terlanjur nonaktif tidak bisa dihidupkan siapa pun.
 */
export async function setUserActive(userId: string, isActive: boolean): Promise<UserActionState> {
  return tolakDenganPesan(async () => {
    const actor = await requireCapability("user.manage");
    if (actor.id === userId && !isActive) {
      throw new ForbiddenError("Tidak bisa menonaktifkan akun sendiri.");
    }
    const target = await requireSameOrgUser(actor, userId);
    if (!isActive) {
      requireOutranks(actor, target, "menonaktifkan");
      if (ADMIN_ROLES.includes(target.role)) await assertBukanAdminTerakhir(actor, userId);
    }
    await db.user.update({ where: { id: userId }, data: { isActive } });
    if (!isActive) await revokeAllSessions(userId); // sesi langsung mati
    await audit(actor.id, isActive ? "user.activate" : "user.deactivate", "user", userId);
    revalidatePath("/master/pengguna");
    return {
      success: isActive
        ? `${target.fullName} diaktifkan kembali.`
        : `${target.fullName} dinonaktifkan — sesinya langsung dicabut.`,
    };
  });
}

export async function resetUserPassword(_prev: UserActionState, formData: FormData): Promise<UserActionState> {
  const id = z.uuid().safeParse(formData.get("userId"));
  if (!id.success) return { error: "Pengguna tidak dikenali." };
  const userId = id.data;
  return tolakDenganPesan(async () => {
    const actor = await requireCapability("user.manage");
    const target = await requireSameOrgUser(actor, userId);
    requireOutranks(actor, target, "mereset password");
    const password = z.string().min(8, "Password minimal 8 karakter").safeParse(formData.get("password"));
    if (!password.success) return { error: password.error.issues[0].message };
    await db.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(password.data), mustChangePassword: true },
    });
    await revokeAllSessions(userId);
    await audit(actor.id, "user.reset_password", "user", userId);
    revalidatePath("/master/pengguna");
    return { success: "Password direset. Pengguna wajib menggantinya saat login." };
  });
}

export async function setAssignments(_prev: UserActionState, formData: FormData): Promise<UserActionState> {
  const id = z.uuid().safeParse(formData.get("userId"));
  if (!id.success) return { error: "Pengguna tidak dikenali." };
  const userId = id.data;
  return tolakDenganPesan(async () => {
    const actor = await requireCapability("user.manage");
    await requireSameOrgUser(actor, userId);
    const locationIds = formData.getAll("locationIds").map(String).filter(Boolean);
    // Lokasi tujuan juga wajib satu organisasi — tanpa ini, user organisasi A
    // bisa ditugaskan ke lokasi organisasi B (AUTH-03).
    if (locationIds.length > 0) {
      const sah = await db.location.count({
        where: { id: { in: locationIds }, package: { orgId: actor.orgId } },
      });
      if (sah !== locationIds.length) {
        return { error: "Ada lokasi yang tidak ditemukan di organisasi ini." };
      }
    }
    const now = new Date();
    await db.$transaction(async (tx) => {
      await tx.locationAssignment.updateMany({
        where: { userId, unassignedAt: null, locationId: { notIn: locationIds } },
        data: { unassignedAt: now },
      });
      for (const locationId of locationIds) {
        await tx.locationAssignment.upsert({
          where: { userId_locationId: { userId, locationId } },
          update: { unassignedAt: null },
          create: { userId, locationId },
        });
      }
    });
    await audit(actor.id, "user.set_assignments", "user", userId, { count: locationIds.length });
    revalidatePath("/master/pengguna");
    return { success: "Penugasan lokasi diperbarui." };
  });
}

/**
 * Ganti PERAN akun (mis. Pelaksana → Site Manager) — DECISIONS 200.
 *
 * Ini mutasi paling berbahaya di modul pengguna: satu langkah bisa menaikkan
 * seseorang ke wewenang yang tidak dimaksudkan. Pagar-pagarnya sengaja
 * bertumpuk, dan semuanya di SERVER (tombol yang disembunyikan bukan kontrol):
 *
 * 1. `user.manage` + satu organisasi (AUTH-03).
 * 2. TIDAK boleh mengganti peran akun sendiri — kalau boleh, seorang admin bisa
 *    menaikkan dirinya sendiri dan seluruh hierarki jadi hiasan.
 * 3. Hanya boleh menyentuh akun yang peringkatnya DI BAWAH aktor (DECISIONS 165,
 *    sama seperti reset password & nonaktifkan).
 * 4. Peran TUJUAN dibatasi `canCreateRole` — aktor tidak bisa memberikan peran
 *    yang dia sendiri tidak boleh membuatnya (PM tidak bisa mengangkat PD).
 * 5. Menurunkan admin aktif terakhir DITOLAK — sama seperti menonaktifkannya,
 *    hasilnya organisasi terkunci dari sistemnya sendiri.
 * 6. MENGANGKAT seseorang menjadi akar hanya boleh oleh akar (DECISIONS 315) —
 *    kalau tidak, promosi jadi jalan memutar untuk mencetak akar dari dalam
 *    aplikasi, persis yang ditutup di `createUser`.
 *
 * Setelah peran berubah, SEMUA sesi akun itu dicabut: sesi lama membawa role
 * lama, dan capability dibaca dari sesi. Tanpa pencabutan, penurunan peran baru
 * berlaku setelah sesinya kedaluwarsa — jendela yang tidak boleh ada.
 */
export async function setUserRole(_prev: UserActionState, formData: FormData): Promise<UserActionState> {
  const parsed = z
    .object({ userId: z.uuid(), role: z.enum(ALL_ROLES as [string, ...string[]]) })
    .safeParse({ userId: formData.get("userId"), role: formData.get("role") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { userId } = parsed.data;
  const role = parsed.data.role as UserRole;

  try {
    // Di DALAM try: kegagalan izin harus muncul sebagai Banner di formnya,
    // bukan melempar ke error boundary (form ini dipakai lewat useActionState).
    const actor = await requireCapability("user.manage");
    if (actor.id === userId) return { error: "Tidak bisa mengganti peran akun sendiri." };
    const target = await requireSameOrgUser(actor, userId);
    if (target.role === role) return { error: `Peran akun ini memang sudah ${ROLE_LABEL[role]}.` };
    requireOutranks(actor, target, "mengganti peran");
    if (!canCreateRole(actor.role, role)) {
      return { error: `Anda tidak berwenang memberikan peran ${ROLE_LABEL[role]}.` };
    }
    // Peran BARU akan menjadikannya akar? Hanya akar yang boleh — tanpa ini,
    // promosi adalah jalan memutar ke kursi yang sengaja ditaruh di luar
    // database (DECISIONS 315).
    const daftar = daftarAkar();
    if (adalahAkar({ username: target.username, role }, daftar) && !adalahAkar(actor, daftar)) {
      return {
        error: "Akun itu terdaftar sebagai super admin utama — hanya super admin utama yang boleh mengangkatnya.",
      };
    }
    // Turun dari admin → pastikan masih ada admin lain yang aktif.
    if (ADMIN_ROLES.includes(target.role) && !ADMIN_ROLES.includes(role)) {
      await assertBukanAdminTerakhir(actor, userId);
    }

    await db.user.update({ where: { id: userId }, data: { role } });
    await revokeAllSessions(userId);
    await audit(actor.id, "user.set_role", "user", userId, {
      dari: target.role,
      ke: role,
      nama: target.fullName,
    });
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    throw err;
  }

  revalidatePath("/master/pengguna");
  revalidatePath("/pengguna");
  // Penugasan lokasi TIDAK ikut dihapus: peran menentukan APA yang boleh
  // dilakukan, penugasan menentukan DI MANA. Kalau peran barunya lintas-lokasi
  // (super_admin/program_director), penugasan lamanya cuma tidak terpakai —
  // dan kembali berlaku bila suatu saat diturunkan lagi.
  return {
    success: `Peran diganti menjadi ${ROLE_LABEL[role]}. Sesi lamanya dicabut — pengguna harus masuk ulang.`,
  };
}
