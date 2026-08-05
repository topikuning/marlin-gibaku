import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ADMINISTRASI_TABS, NAV_GROUPS, filterNavGroups } from "@/components/shell/nav-config";
import { ALL_ROLES } from "@/lib/authz";

/**
 * SETIAP TAUTAN MENU HARUS MENDARAT DI HALAMAN YANG ADA.
 *
 * Menu mati adalah 404 yang tidak berbunyi: ia hanya terlihat oleh peran yang
 * kebetulan punya capability-nya, dan cuma saat diklik. Migrasi keluarga route
 * (DECISIONS 252) memindahkan hampir semua halaman sekaligus — persis keadaan
 * yang membuat satu href tertinggal tanpa ada yang sadar.
 *
 * Yang diperiksa: href menu ⇒ ada `page.tsx` di `src/app` pada jalur itu,
 * sesudah segmen route group `(…)` diabaikan (segmen itu tidak muncul di URL).
 */

const APP_DIR = join(process.cwd(), "src", "app");

/** Semua rute statis yang benar-benar punya `page.tsx`. */
function pindaiRute(): Set<string> {
  const hasil = new Set<string>();
  const telusur = (dir: string, url: string) => {
    for (const entry of readdirSync(dir)) {
      const penuh = join(dir, entry);
      if (!statSync(penuh).isDirectory()) {
        if (entry === "page.tsx" || entry === "page.ts") hasil.add(url === "" ? "/" : url);
        continue;
      }
      // `(grup)` tidak muncul di URL; `_privat` bukan route sama sekali.
      if (entry.startsWith("_")) continue;
      const potongan = entry.startsWith("(") && entry.endsWith(")") ? "" : `/${entry}`;
      telusur(penuh, url + potongan);
    }
  };
  telusur(APP_DIR, "");
  return hasil;
}

const RUTE = pindaiRute();

describe("tautan navigasi", () => {
  const semuaItem = NAV_GROUPS.flatMap((g) => g.items);

  it("pindaian rute menemukan halaman yang jelas ada (uji terhadap dirinya sendiri)", () => {
    // Tanpa ini, pindaian yang rusak akan membuat SELURUH uji di bawah lulus
    // dengan himpunan kosong — gagal yang paling menyesatkan.
    expect(RUTE.size).toBeGreaterThan(20);
    expect(RUTE).toContain("/");
    expect(RUTE).toContain("/administrasi/pengguna");
  });

  it("setiap href menu punya halaman", () => {
    const mati = semuaItem.filter((i) => !RUTE.has(i.href)).map((i) => `${i.label} → ${i.href}`);
    expect(mati, `Menu menunjuk halaman yang tidak ada:\n${mati.join("\n")}`).toEqual([]);
  });

  it("setiap tab Administrasi punya halaman", () => {
    const mati = ADMINISTRASI_TABS.filter((t) => !RUTE.has(t.href)).map((t) => t.href);
    expect(mati, `Tab Administrasi tanpa halaman:\n${mati.join("\n")}`).toEqual([]);
  });

  it("tidak ada href menu yang ganda", () => {
    const href = semuaItem.map((i) => i.href);
    const ganda = href.filter((h, i) => href.indexOf(h) !== i);
    expect(ganda, "href muncul di lebih dari satu butir menu").toEqual([]);
  });

  it("setiap peran melihat setidaknya satu menu", () => {
    // Peran yang seluruh menunya tersaring habis mendarat di shell kosong —
    // gagal yang tampak seperti aplikasi rusak, bukan seperti hak akses.
    for (const role of ALL_ROLES) {
      const grup = filterNavGroups(role);
      expect(grup.flatMap((g) => g.items).length, `${role} tidak punya menu apa pun`).toBeGreaterThan(0);
    }
  });

  it("urutan tab Administrasi = urutan butir Administrasi di sidebar", () => {
    // Keduanya diturunkan dari daftar yang sama; uji ini yang menahan kalau
    // suatu saat ada yang menyalinnya kembali jadi dua daftar terpisah.
    const grup = NAV_GROUPS.find((g) => g.label === "Administrasi");
    expect(grup?.items.map((i) => i.href)).toEqual(ADMINISTRASI_TABS.map((t) => t.href));
  });
});
