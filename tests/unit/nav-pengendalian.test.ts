// Navigasi pengendalian terpadu (DECISIONS 426): menu baru tampil untuk peran
// yang tepat, dan Wakil PPK mendapat baris mobile khusus pekerjaan memeriksa.
import { describe, expect, it } from "vitest";
import { filterNav, MOBILE_NAV } from "@/components/shell/nav-config";

const hrefs = (role: Parameters<typeof filterNav>[0]) => filterNav(role).map((i) => i.href);

describe("menu pengendalian terpadu", () => {
  it("Wakil PPK melihat Temuan, Verifikasi, Perlu Tindakan, Kesiapan", () => {
    const h = hrefs("wakil_ppk");
    for (const menu of ["/temuan", "/verifikasi", "/perlu-tindakan", "/kesiapan"]) {
      expect(h, menu).toContain(menu);
    }
    // Tetap TANPA AI dan tanpa menu lapangan pelaksana.
    expect(h).not.toContain("/ai");
    expect(h).not.toContain("/hari-ini");
    expect(h).not.toContain("/foto-cepat");
  });

  it("Mandor melihat Temuan (papan terbuka) tapi TIDAK melihat Verifikasi/EWS", () => {
    const h = hrefs("field_supervisor");
    expect(h).toContain("/temuan");
    expect(h).not.toContain("/verifikasi");
    expect(h).not.toContain("/perlu-tindakan");
  });

  it("Site Manager tidak melihat workspace Verifikasi (bukan pemeriksa)", () => {
    expect(hrefs("site_manager")).not.toContain("/verifikasi");
  });

  it("mobile Wakil PPK: Beranda / Verifikasi / Temuan / Lokasi", () => {
    expect(MOBILE_NAV("wakil_ppk").map((i) => i.href)).toEqual(["/", "/verifikasi", "/temuan", "/lokasi"]);
  });

  it("mobile peran lain tidak berubah bentuk (maks 4 item)", () => {
    for (const role of ["site_manager", "field_supervisor", "project_manager", "program_director"] as const) {
      expect(MOBILE_NAV(role).length).toBeLessThanOrEqual(4);
    }
  });
});
