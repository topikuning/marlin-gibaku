import { describe, expect, it } from "vitest";
import { simpulNol } from "@/lib/rab/pohon-nol";

const n = (id: string, parentId: string | null, volume: number | null, amount = 0) => ({ id, parentId, volume, amount: String(amount) });

describe("simpul RAB bervolume 0 (DECISIONS 788)", () => {
  it("kategori yang seluruh itemnya 0 ikut nol; kategori campuran hanya daunnya yang nol", () => {
    const r = simpulNol([
      n("III", null, null),
      n("III.1", "III", null),
      n("a", "III.1", 0),
      n("b", "III.1", 0),
      n("IV", null, null, 500),
      n("IV.1", "IV", null, 500),
      n("c", "IV.1", 5, 500),
      n("d", "IV.1", 0),
    ]);
    expect([...r.nol].sort()).toEqual(["III", "III.1", "a", "b", "d"]);
    expect(r.daunNol).toBe(3);
  });

  it("daun bervolume 0 tetapi masih bernilai (harga lumpsum) tidak dianggap nol", () => {
    expect(simpulNol([n("x", null, 0, 100)]).nol.size).toBe(0);
  });
});
