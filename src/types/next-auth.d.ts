import type { UserRole } from "@prisma/client";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: UserRole;
    } & DefaultSession["user"];
  }

  interface User {
    role: UserRole;
  }
}

// Catatan: augmentasi JWT via "next-auth/jwt" tidak merge (re-export dari
// @auth/core/jwt yang tidak resolvable di pnpm strict). Field custom token
// (uid/role/absExp) dibaca dengan narrowing di src/auth.config.ts.
