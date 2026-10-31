import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `ensureFolderPath` – jalur yang dipakai SETIAP unggahan otomatis ke Drive
 * KKP (DECISIONS 715). Folder buatan orang tidak boleh dikembari hanya karena
 * ejaannya beda tanda baca, dan folder 2 lama ("2. PCM") tetap dipakai.
 *
 * API Drive ditiru lewat `fetch`: pencarian nama persis, daftar sub-folder,
 * dan pembuatan folder.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/gdrive/config", () => ({
  getGDriveAuth: async () => ({ clientId: "c", clientSecret: "s", refreshToken: "r" }),
}));

const folder = new Map<string, { name: string; parent: string }>();
let dibuat: string[] = [];
let urut = 0;

function q(url: string): string {
  return decodeURIComponent(new URL(url).searchParams.get("q") ?? "");
}

beforeEach(() => {
  folder.clear();
  dibuat = [];
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const url = String(input);
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (url.includes("oauth2")) return json({ access_token: "t", expires_in: 3600 });
    if (init?.method === "POST") {
      const b = JSON.parse(String(init.body)) as { name: string; parents: string[] };
      const id = `baru${++urut}`;
      folder.set(id, { name: b.name, parent: b.parents[0] });
      dibuat.push(b.name);
      return json({ id });
    }
    const kueri = q(url);
    const induk = /'([^']+)' in parents/.exec(kueri)?.[1] ?? "";
    const persis = /name = '((?:[^'\\]|\\.)*)'/.exec(kueri)?.[1]?.replace(/\\'/g, "'");
    const files = [...folder.entries()]
      .filter(([, f]) => f.parent === induk && (persis === undefined || f.name === persis))
      .map(([id, f]) => ({ id, name: f.name }));
    return json({ files });
  });
});

afterEach(() => vi.unstubAllGlobals());

const { ensureFolderPath } = await import("@/lib/gdrive/client");

describe("ensureFolderPath", () => {
  it("folder 2 lama \"2. PCM\" dipakai untuk nama barunya – tidak ada kembaran di akar", async () => {
    folder.set("lama2", { name: "2. PCM", parent: "akar1" });
    const id = await ensureFolderPath("akar1", ["2. Peninjauan Lokasi, PCM, MC-0", "2. PCM", "Muarareja"]);
    expect(dibuat).toEqual(["2. PCM", "Muarareja"]);
    expect(folder.get(id)?.name).toBe("Muarareja");
    expect([...folder.values()].filter((f) => f.parent === "akar1").map((f) => f.name)).toEqual(["2. PCM"]);
  });

  it("nama baru menang bila nama lama dan baru sama-sama ada", async () => {
    folder.set("lama", { name: "2. PCM", parent: "akar2" });
    folder.set("baru", { name: "2. Peninjauan Lokasi, PCM, MC-0", parent: "akar2" });
    expect(await ensureFolderPath("akar2", ["2. Peninjauan Lokasi, PCM, MC-0"])).toBe("baru");
  });

  it("beda huruf besar/tanda baca dianggap folder yang sama", async () => {
    folder.set("lap", { name: "3. laporan harian", parent: "akar3" });
    folder.set("lok", { name: "Muarareja ", parent: "lap" });
    expect(await ensureFolderPath("akar3", ["3. LAPORAN HARIAN", "Muarareja"])).toBe("lok");
    expect(dibuat).toEqual([]);
  });

  it("alias hanya untuk folder akar – \"2. PCM\" di bawah folder lain tetap folder biasa", async () => {
    folder.set("t", { name: "7. BERKAS TERMIN", parent: "akar4" });
    folder.set("pcm", { name: "2. PCM", parent: "t" });
    await ensureFolderPath("akar4", ["7. BERKAS TERMIN", "2. Peninjauan Lokasi, PCM, MC-0"]);
    expect(dibuat).toEqual(["2. Peninjauan Lokasi, PCM, MC-0"]);
  });
});
