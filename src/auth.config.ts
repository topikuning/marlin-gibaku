import type { NextAuthConfig } from "next-auth";
import type { UserRole } from "@prisma/client";

/**
 * Durasi sesi per role (DECISIONS 012). field_supervisor (mandor) diperlakukan
 * seperti site_manager: user lapangan, sering pakai HP → 30 hari.
 */
export const ROLE_SESSION_SECONDS: Record<UserRole, number> = {
  site_manager: 60 * 60 * 24 * 30, // 30 hari
  field_supervisor: 60 * 60 * 24 * 30, // 30 hari
  project_manager: 60 * 60 * 24 * 7, // 7 hari
  regional_manager: 60 * 60 * 24 * 7, // 7 hari
  super_admin: 60 * 60 * 24, // 24 jam
  program_director: 60 * 60 * 24, // 24 jam
  exec_viewer: 60 * 60 * 24, // 24 jam
};

/** Path yang boleh diakses tanpa login. */
const PUBLIC_PATHS = ["/masuk"];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  if (pathname.startsWith("/api/auth")) return true;
  if (pathname === "/api/health") return true;
  return false;
}

/**
 * Config edge-safe (dipakai middleware). TIDAK boleh import Prisma / Argon2
 * (native / node-only). Provider Credentials ditambah di `src/auth.ts` (node).
 */
export const authConfig = {
  pages: { signIn: "/masuk" },
  session: {
    strategy: "jwt",
    // maxAge global = durasi role terpanjang; per-role di-enforce di jwt callback.
    maxAge: 60 * 60 * 24 * 30,
  },
  trustHost: true,
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      if (isPublicPath(pathname)) return true;
      return !!auth?.user;
    },
    jwt({ token, user }) {
      // Saat sign-in: simpan role + hitung absolute expiry per-role.
      if (user) {
        token.uid = user.id;
        token.role = user.role;
        const maxAge = ROLE_SESSION_SECONDS[user.role] ?? 60 * 60 * 24;
        token.absExp = Math.floor(Date.now() / 1000) + maxAge;
      }
      // Enforce per-role expiry: lewat batas → invalidate (force sign-out).
      const absExp = token.absExp as number | undefined;
      if (absExp && Date.now() / 1000 > absExp) {
        return null;
      }
      return token;
    },
    session({ session, token }) {
      if (typeof token.uid === "string") session.user.id = token.uid;
      if (token.role) session.user.role = token.role as UserRole;
      return session;
    },
  },
} satisfies NextAuthConfig;
