import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: async () => ({ id: "00000000-0000-4000-8000-000000000001", orgId: "00000000-0000-4000-8000-000000000002", mustChangePassword: true,
    get role() { throw new Error("Izin dibaca sebelum password sementara diganti"); } }),
  accessibleLocationIds: async () => null,
  hasLocationAccess: async () => true,
}));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get() { throw new Error("Data diakses sebelum password sementara diganti"); } }) }));

const routes = [
  { path: "documents/[id]", load: () => import("../../src/app/api/documents/[id]/route") },
  { path: "foto-asli/[id]", load: () => import("../../src/app/api/foto-asli/[id]/route") },
  { path: "ai-artifact/[id]/excel", load: () => import("../../src/app/api/ai-artifact/[id]/excel/route") },
  { path: "paparan/[id]/pdf", load: () => import("../../src/app/api/paparan/[id]/pdf/route") },
  { path: "gdrive/auth", load: () => import("../../src/app/api/gdrive/auth/route") },
  { path: "gdrive/callback", load: () => import("../../src/app/api/gdrive/callback/route") },
  { path: "kegiatan/[id]/pdf", load: () => import("../../src/app/api/kegiatan/[id]/pdf/route") },
  { path: "kegiatan/lampiran/[id]", load: () => import("../../src/app/api/kegiatan/lampiran/[id]/route") },
  { path: "kesiapan/pdf", load: () => import("../../src/app/api/kesiapan/pdf/route") },
  { path: "lokasi/[slug]/laporan-lengkap", load: () => import("../../src/app/api/lokasi/[slug]/laporan-lengkap/route") },
  { path: "laporan/harian/[slug]/[date]/pdf", load: () => import("../../src/app/api/laporan/harian/[slug]/[date]/pdf/route") },
  { path: "laporan/harian/[slug]/[date]/ringkas", load: () => import("../../src/app/api/laporan/harian/[slug]/[date]/ringkas/route") },
  { path: "laporan/mingguan/[slug]/[minggu]/pdf", load: () => import("../../src/app/api/laporan/mingguan/[slug]/[minggu]/pdf/route") },
  { path: "laporan/periodik/[slug]/[kind]/[n]/pdf", load: () => import("../../src/app/api/laporan/periodik/[slug]/[kind]/[n]/pdf/route") },
  { path: "peta/[id]", load: () => import("../../src/app/api/peta/[id]/route") },
  { path: "peta/basemap", load: () => import("../../src/app/api/peta/basemap/route") },
  { path: "surat/[id]/berkas", load: () => import("../../src/app/api/surat/[id]/berkas/route") },
  { path: "temuan/pdf", load: () => import("../../src/app/api/temuan/pdf/route") },
  { path: "temuan/xlsx", load: () => import("../../src/app/api/temuan/xlsx/route") },
  { path: "waha/lampiran/[id]", load: () => import("../../src/app/api/waha/lampiran/[id]/route") },
];

describe("sesi password sementara tidak boleh melewati API langsung", () => {
  for (const {path,load} of routes) it(path, async () => {
    const route = await load();
    const response = await route.GET(new NextRequest("https://marlin.test/api/"+path), {params:Promise.resolve({id:"00000000-0000-4000-8000-000000000003",slug:"lokasi",date:"2026-09-01",minggu:"1",kind:"mingguan",n:"1"})});
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({error:"Ganti password terlebih dahulu."});
  });
});
