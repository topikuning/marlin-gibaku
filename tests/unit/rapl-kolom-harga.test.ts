// Kolom "Kebutuhan & harga" harus menaruh KEPUTUSAN yang sedang diminta di
// dalam lebar layar.
//
// Versi sebelumnya memasang sebelas kolom tetap dengan lebar minimum ±1.810px.
// Di laptop mana pun itu berarti gulir mendatar, dan tiga kolom draf AI —
// Usulan AI, Keyakinan, Dasar usulan — duduk di seberang tepi kanan. Sementara
// tanpa draf pun ketiganya tetap memakan ±520px untuk memajang sel kosong.
//
// Yang dikunci berkas ini: (1) kolom AI tidak ada saat tidak ada draf,
// (2) begitu draf datang, "Usulan AI" berada di sepertiga kiri tabel, bukan di
// ujung kanan, (3) tidak ada kolom yang HILANG karena adanya draf — yang
// berubah hanya urutannya.
import { describe, expect, it } from "vitest";
import { kolomHarga } from "@/app/(app)/lokasi/[slug]/rapl/harga-kolom";

const ids = (k: { field?: unknown; colId?: string }[]) => k.map((c) => String(c.colId ?? c.field));

/** Lebar minimum kumulatif sampai sebuah kolom SELESAI, termasuk kotak centang. */
const tepiKanan = (kolom: { field?: unknown; colId?: string; width?: number; minWidth?: number }[], id: string) => {
  let x = 48; // kolom kotak centang AG Grid
  for (const k of kolom) {
    x += k.width ?? k.minWidth ?? 200;
    if (String(k.colId ?? k.field) === id) return x;
  }
  return Number.POSITIVE_INFINITY;
};

describe("kolomHarga", () => {
  it("tidak memajang kolom AI saat tidak ada draf", () => {
    const k = ids(kolomHarga({ canInput: true, adaDraf: false }));
    expect(k).not.toContain("usulanAiNum");
    expect(k).not.toContain("keyakinanAi");
    expect(k).not.toContain("alasanAi");
    expect(k).toContain("hargaNum");
  });

  it("menaruh Usulan AI di dalam 1.000px pertama begitu drafnya ada", () => {
    const kolom = kolomHarga({ canInput: true, adaDraf: true });
    expect(ids(kolom)).toContain("usulanAiNum");
    expect(tepiKanan(kolom, "usulanAiNum")).toBeLessThanOrEqual(1000);
  });

  it("tidak menghilangkan satu kolom pun saat draf datang", () => {
    const tanpa = ids(kolomHarga({ canInput: true, adaDraf: false }));
    const dengan = ids(kolomHarga({ canInput: true, adaDraf: true }));
    for (const id of tanpa) expect(dengan).toContain(id);
  });

  it("hanya Harga satuan yang boleh diedit, dan hanya bila berhak", () => {
    const bisa = kolomHarga({ canInput: true, adaDraf: true }).filter((k) => k.editable);
    expect(ids(bisa)).toEqual(["hargaNum"]);
    expect(kolomHarga({ canInput: false, adaDraf: true }).filter((k) => k.editable)).toHaveLength(0);
  });

  it("kolom usulan AI ditandai – angkanya belum jadi milik siapa pun", () => {
    const usulan = kolomHarga({ canInput: true, adaDraf: true }).find(
      (k) => String(k.colId ?? k.field) === "usulanAiNum",
    );
    expect(String(usulan?.cellClass)).toContain("soft");
  });
});
