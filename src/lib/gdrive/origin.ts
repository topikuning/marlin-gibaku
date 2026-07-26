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
