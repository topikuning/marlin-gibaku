import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

/**
 * Route protection berbasis login (edge). Callback `authorized` di authConfig
 * yang tentukan path publik vs terproteksi + redirect ke /masuk.
 */
export default NextAuth(authConfig).auth;

export const config = {
  // Jalankan di semua route kecuali asset statis + file dengan ekstensi.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
