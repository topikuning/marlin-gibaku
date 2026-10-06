/*
 * FOLDER KEMBAR DI CADANGAN GOOGLE DRIVE (DECISIONS 650, susulan).
 *
 * Tangkapan layar user 2026-10-05: tiga folder "berkas" di "MARLIN Cadangan".
 * Penyebabnya: tiga berkas disalin bersamaan, ketiganya mencari folder yang
 * belum ada pada saat yang sama, lalu masing-masing membuatnya.
 *
 * Yang dijaga:
 *   1. pencarian/pembuatan folder yang bersamaan menghasilkan SATU folder
 *   2. folder kembar yang sudah terlanjur ada digabung: isinya pindah ke folder
 *      tertua (subfolder senama ikut digabung), folder kembar yang kosong dihapus
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/cadangan/akun", () => ({
  tokenCadangan: async () => "token-uji",
  simpanFolderCadangan: async () => {},
  tampilanAkunCadangan: async () => ({ folderId: null }),
  CadanganError: class extends Error {
    status: number | null;
    constructor(m: string, s: number | null = null) {
      super(m);
      this.status = s;
    }
  },
}));

/* ── Google Drive tiruan: cukup untuk folder, pindah induk, hapus ── */
type Item = { id: string; name: string; folder: boolean; parent: string; dibuat: number };
let drive: Map<string, Item>;
let nomor = 0;
const FOLDER = "application/vnd.google-apps.folder";

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input));
  const metode = init?.method ?? "GET";
  // Jeda kecil supaya panggilan bersamaan benar-benar saling menyalip.
  await new Promise((r) => setTimeout(r, 5));
  const m = /\/drive\/v3\/files\/([^/?]+)$/.exec(url.pathname);
  if (metode === "GET" && url.pathname.endsWith("/files")) {
    const q = url.searchParams.get("q") ?? "";
    const nama = /name = '([^']+)'/.exec(q)?.[1];
    const induk = /'([^']+)' in parents/.exec(q)![1]!;
    const hanyaFolder = q.includes(`mimeType = '${FOLDER}'`);
    const hasil = [...drive.values()]
      .filter((i) => i.parent === induk && (!nama || i.name === nama) && (!hanyaFolder || i.folder))
      .sort((a, b) => a.dibuat - b.dibuat)
      .map((i) => ({ id: i.id, name: i.name, mimeType: i.folder ? FOLDER : "application/octet-stream" }));
    return json({ files: hasil });
  }
  if (metode === "POST" && url.pathname.endsWith("/files")) {
    const b = JSON.parse(String(init!.body)) as { name: string; parents: string[]; mimeType: string };
    const id = `id${++nomor}`;
    drive.set(id, { id, name: b.name, folder: b.mimeType === FOLDER, parent: b.parents[0]!, dibuat: nomor });
    return json({ id });
  }
  if (metode === "PATCH" && m) {
    const it = drive.get(m[1]!)!;
    expect(url.searchParams.get("removeParents")).toBe(it.parent);
    it.parent = url.searchParams.get("addParents")!;
    return json({ id: it.id });
  }
  if (metode === "DELETE" && m) {
    drive.delete(m[1]!);
    return new Response(null, { status: 204 });
  }
  throw new Error(`Drive tiruan: ${metode} ${url} tidak dikenal`);
}) as typeof fetch;

const isi = (parent: string, folder = false) => [...drive.values()].filter((i) => i.parent === parent && (folder ? i.folder : true));
const tambah = (name: string, parent: string, folder: boolean) => {
  const id = `id${++nomor}`;
  drive.set(id, { id, name, folder, parent, dibuat: nomor });
  return id;
};

beforeEach(() => {
  drive = new Map();
  nomor = 0;
  vi.resetModules();
});

describe("folder cadangan tidak boleh kembar", () => {
  it("tiga pemanggilan bersamaan menghasilkan SATU folder", async () => {
    const { pastikanFolder } = await import("@/lib/cadangan/drive");
    const id = await Promise.all([1, 2, 3].map(() => pastikanFolder("akar", "berkas")));
    expect(new Set(id).size).toBe(1);
    expect(isi("akar", true).filter((i) => i.name === "berkas")).toHaveLength(1);
  });

  it("jalur berjenjang bersamaan juga tidak kembar", async () => {
    const { pastikanFolder } = await import("@/lib/cadangan/drive");
    await Promise.all(
      [1, 2, 3].map(async () => {
        const b = await pastikanFolder("akar", "berkas");
        const k = await pastikanFolder(b, "foto-asli");
        return pastikanFolder(k, "2026-10");
      }),
    );
    expect([...drive.values()].filter((i) => i.folder)).toHaveLength(3);
  });

  it("folder kembar yang sudah ada digabung ke yang tertua, isinya tidak hilang", async () => {
    const tua = tambah("berkas", "akar", true);
    const kembar1 = tambah("berkas", "akar", true);
    const kembar2 = tambah("berkas", "akar", true);
    // foto-asli ada di dua folder kembar – harus jadi satu
    const fa1 = tambah("foto-asli", tua, true);
    tambah("a.jpg", fa1, false);
    const fa2 = tambah("foto-asli", kembar1, true);
    tambah("b.jpg", fa2, false);
    tambah("dokumen", kembar2, true);
    tambah("lepas.pdf", kembar2, false);

    const { pastikanFolder } = await import("@/lib/cadangan/drive");
    expect(await pastikanFolder("akar", "berkas")).toBe(tua);

    expect(isi("akar").map((i) => i.id)).toEqual([tua]);
    expect(isi(tua).map((i) => i.name).sort()).toEqual(["dokumen", "foto-asli", "lepas.pdf"]);
    expect(isi(fa1).map((i) => i.name).sort()).toEqual(["a.jpg", "b.jpg"]);
    expect(drive.has(kembar1) || drive.has(kembar2) || drive.has(fa2)).toBe(false);
    expect([...drive.values()].filter((i) => !i.folder)).toHaveLength(3);
  });

  it("penyapuan merapikan kembar di SEMUA tingkat, juga yang tidak dilewati salinan baru", async () => {
    const berkas = tambah("berkas", "akar", true);
    const foto1 = tambah("foto", berkas, true);
    const foto2 = tambah("foto", berkas, true);
    const bln1 = tambah("2026-09", foto1, true);
    tambah("x.jpg", bln1, false);
    const bln2 = tambah("2026-09", foto2, true);
    tambah("y.jpg", bln2, false);
    tambah("dokumen", berkas, true);

    const { rapikanFolderKembar } = await import("@/lib/cadangan/drive");
    const n = await rapikanFolderKembar("akar");
    expect(n).toBe(2); // foto kembar + 2026-09 kembar
    expect(isi(berkas, true).map((i) => i.name).sort()).toEqual(["dokumen", "foto"]);
    expect(isi(foto1, true).map((i) => i.name)).toEqual(["2026-09"]);
    expect(isi(bln1).map((i) => i.name).sort()).toEqual(["x.jpg", "y.jpg"]);
  });
});
