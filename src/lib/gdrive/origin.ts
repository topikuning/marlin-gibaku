import "server-only";
import { driveRedirectUri, publicOrigin, type OriginSources } from "./parse";

/**
 * Sumber origin publik untuk OAuth Google. Urutan: APP_PUBLIC_URL (override
 * operator) → RAILWAY_PUBLIC_DOMAIN (otomatis dari Railway) → header
 * x-forwarded-host → host. Header saja tidak cukup: pada deploy Railway,
 * `host` bisa berisi alamat bind container (`0.0.0.0:8080`) dan
 * `x-forwarded-host` tidak selalu ada. DECISIONS 142.
 */
export function originSources(headers: Headers): OriginSources {
  return {
    envUrl: process.env.APP_PUBLIC_URL ?? null,
    railwayDomain: process.env.RAILWAY_PUBLIC_DOMAIN ?? null,
    forwardedHost: headers.get("x-forwarded-host"),
    host: headers.get("host"),
    forwardedProto: headers.get("x-forwarded-proto"),
  };
}

export function driveRedirectUriFrom(headers: Headers): string | null {
  return driveRedirectUri(originSources(headers));
}

export function publicOriginFrom(headers: Headers): string | null {
  return publicOrigin(originSources(headers));
}

/**
 * Origin publik TANPA request — untuk pekerjaan LATAR (penjadwal, antrean
 * unggah) yang tidak punya header sama sekali. Hanya bersandar pada env, jadi
 * bisa null di deploy yang belum mengisi `APP_PUBLIC_URL`; pemanggil harus
 * memperlakukan null sebagai "tak tahu alamat sendiri", bukan menebak.
 */
export function publicOriginFromEnv(): string | null {
  return publicOrigin({
    envUrl: process.env.APP_PUBLIC_URL ?? null,
    railwayDomain: process.env.RAILWAY_PUBLIC_DOMAIN ?? null,
  });
}

/**
 * URL absolut ke halaman MARLIN untuk redirect balik dari OAuth. WAJIB memakai
 * origin publik: `request.nextUrl.origin` di container berisi alamat bind
 * (`http://0.0.0.0:8080`) sehingga browser pengguna tidak bisa membukanya.
 */
export function appUrl(path: string, headers: Headers, fallbackOrigin: string): URL {
  return new URL(path, publicOriginFrom(headers) ?? fallbackOrigin);
}
