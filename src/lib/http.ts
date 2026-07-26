import "server-only";
import { headers } from "next/headers";

/**
 * Origin publik MARLIN dari header request (proxy Railway meneruskan
 * x-forwarded-*). Dipakai untuk menyusun URL absolut (mis. link foto di PDF yang
 * dikirim ke WA). Mengembalikan null bila host tak diketahui.
 */
export async function getRequestOrigin(): Promise<string | null> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return null;
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}
