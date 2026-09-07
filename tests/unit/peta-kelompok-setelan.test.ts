// SETELAN BAWAAN PENANDA HARUS SAMPAI KE PETA, DAN HANYA BOLEH DIUBAH ADMIN.
//
// Permintaan user 2026-09-06: *"bagaimana supaya aku bisa atur default kelompok
// atau per titik langsung"*.
//
// Setelan yang tersimpan rapi di DB tapi tidak pernah dibaca komponennya adalah
// tombol palsu: ditekan, berhasil, dan tidak mengubah apa pun di layar. Rantai
// itulah yang dijaga di sini — dari aksi server sampai keadaan awal peta.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const baca = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const aksi = baca("src/lib/peta/actions.ts");
const petaMap = baca("src/app/(app)/peta/peta-map.tsx");

describe("aksi setelan", () => {
  it("dijaga capability + audit, seperti mutasi lain", () => {
    const fn = /export async function setKelompokPetaAction[\s\S]*?\n\}/.exec(aksi)?.[0] ?? "";
    expect(fn, "aksi tidak ketemu").not.toBe("");
    expect(fn).toContain('requireCapability("system.manage")');
    expect(fn).toContain('audit(aktor.id, "peta.kelompok_bawaan"');
  });

  it("menyegarkan layar yang memuat peta – kalau tidak, perubahannya tak terlihat", () => {
    const fn = /export async function setKelompokPetaAction[\s\S]*?\n\}/.exec(aksi)?.[0] ?? "";
    for (const jalur of ['"/peta"', '"/aktivitas"', '"/"']) {
      expect(fn, `revalidatePath(${jalur})`).toContain(`revalidatePath(${jalur})`);
    }
  });
});

describe("setelan sampai ke peta", () => {
  it("keadaan awal tombol kelompok datang dari setelan, bukan dipaku", () => {
    expect(petaMap).toContain("useState(kelompokAwal)");
    // Sumber GeoJSON dibuat dengan nilai yang SAMA — kalau dipaku `true` di
    // sini, peta terbuka berkelompok lalu berkedip jadi satu per satu.
    expect(petaMap).toContain("...KELOMPOK_OPSI(kelompok)");
    expect(petaMap).not.toContain("KELOMPOK_OPSI(true)");
  });

  it("kedua peta menerimanya dari server", () => {
    expect(baca("src/app/(app)/peta/page.tsx")).toContain("kelompokAwal={kelompokAwal}");
    expect(baca("src/app/(app)/aktivitas/executive-dashboard.tsx")).toContain(
      "kelompokAwal={kelompokPeta}",
    );
    expect(baca("src/app/(app)/peta/peta-client.tsx")).toContain("kelompokAwal={kelompokAwal}");
    expect(baca("src/app/(app)/aktivitas/dashboard-map.tsx")).toContain(
      "kelompokAwal={kelompokAwal}",
    );
  });

  it("layar Sistem menyediakan sakelarnya", () => {
    const panel = baca("src/app/(app)/sistem/peta-panel.tsx");
    expect(panel).toContain("setKelompokPetaAction");
    expect(panel).toContain("Ubah ke satu per satu");
    expect(panel).toContain("Ubah ke berkelompok");
  });
});
