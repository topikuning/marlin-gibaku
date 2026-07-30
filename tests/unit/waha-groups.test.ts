import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// config.ts menyentuh DB — fungsi yang diuji di sini murni, DB tidak dipakai.
vi.mock("@/lib/db", () => ({ db: {} }));

const { parseGroupsResponse, terjemahkanWahaError, normalizeGroupChatId } = await import(
  "../../src/lib/waha/client"
);
const { normalizeWahaBaseUrl, isInternalHost } = await import("../../src/lib/waha/config");

/**
 * Penarikan grup dari WAHA gagal di lapangan (laporan user 2026-07-30). Dua akar
 * yang bisa dipastikan dari kode dikunci di sini: (1) URL internal Railway
 * dipaksa https padahal private networking tanpa TLS; (2) error khas engine
 * (store NOWEB mati, sesi tak dikenal) tampil mentah tanpa instruksi. Plus
 * parser respons /groups lintas engine/versi.
 */

describe("normalizeWahaBaseUrl — skema default", () => {
  it("host internal Railway tanpa skema → http (private networking tanpa TLS)", () => {
    expect(normalizeWahaBaseUrl("waha.railway.internal:3000")).toBe("http://waha.railway.internal:3000");
    expect(normalizeWahaBaseUrl("localhost:3000")).toBe("http://localhost:3000");
    expect(normalizeWahaBaseUrl("192.168.1.10:3000")).toBe("http://192.168.1.10:3000");
  });

  it("host publik tanpa skema tetap → https", () => {
    expect(normalizeWahaBaseUrl("waha.contoh.app")).toBe("https://waha.contoh.app");
  });

  it("skema yang ditulis eksplisit TIDAK diubah", () => {
    expect(normalizeWahaBaseUrl("https://waha.railway.internal:3000")).toBe(
      "https://waha.railway.internal:3000",
    );
    expect(normalizeWahaBaseUrl("http://waha.contoh.app")).toBe("http://waha.contoh.app");
  });

  it("trailing slash & path /api tetap dibuang", () => {
    expect(normalizeWahaBaseUrl("waha.railway.internal:3000/api/")).toBe(
      "http://waha.railway.internal:3000",
    );
  });

  it("isInternalHost mengenali rentang IP privat & .internal", () => {
    for (const h of ["a.railway.internal", "x.internal", "localhost", "127.0.0.1", "10.0.0.5", "172.16.0.1"])
      expect(isInternalHost(h), h).toBe(true);
    for (const h of ["waha.contoh.app", "172.32.0.1", "11.0.0.1"]) expect(isInternalHost(h), h).toBe(false);
  });
});

describe("terjemahkanWahaError — error engine jadi instruksi", () => {
  it("store NOWEB mati → sebut env yang harus diset + jalan keluar (link undangan)", () => {
    const msg = terjemahkanWahaError(
      500,
      '{"message":"Enable NOWEB store to use this feature: config.noweb.store.enabled=true"}',
    );
    expect(msg).toMatch(/WAHA_NOWEB_STORE_ENABLED=true/);
    expect(msg).toMatch(/link undangan/i);
  });

  it("sesi tak dikenal (404) → suruh periksa NAMA sesi", () => {
    const msg = terjemahkanWahaError(404, '{"message":"Session not found"}');
    expect(msg).toMatch(/nama sesi/i);
  });

  it("401/403 → API key", () => {
    expect(terjemahkanWahaError(401, "")).toMatch(/API key/);
    expect(terjemahkanWahaError(403, "denied")).toMatch(/API key/);
  });

  it("yang tidak dikenal → null (biar pesan mentah tampil apa adanya)", () => {
    expect(terjemahkanWahaError(500, "boom")).toBeNull();
  });
});

describe("parseGroupsResponse — lintas engine/versi WAHA", () => {
  const ID1 = "120363011111111111@g.us";
  const ID2 = "120363022222222222@g.us";

  it("WEBJS: array chat dengan id._serialized + name", () => {
    const out = parseGroupsResponse([
      { id: { _serialized: ID1, user: "1", server: "g.us" }, name: "Grup A" },
      { id: { _serialized: "628123@c.us" }, name: "Kontak personal" },
    ]);
    expect(out).toEqual([{ id: ID1, name: "Grup A" }]);
  });

  it("NOWEB store: array metadata dengan id string + subject", () => {
    const out = parseGroupsResponse([{ id: ID1, subject: "Grup B" }]);
    expect(out).toEqual([{ id: ID1, name: "Grup B" }]);
  });

  it("GOWS: JID + Name", () => {
    const out = parseGroupsResponse([{ JID: ID1, Name: "Grup C" }]);
    expect(out).toEqual([{ id: ID1, name: "Grup C" }]);
  });

  it("respons terbungkus {data|groups|chats}", () => {
    for (const k of ["data", "groups", "chats"]) {
      expect(parseGroupsResponse({ [k]: [{ id: ID1, subject: "G" }] })).toHaveLength(1);
    }
  });

  it("peta objek ber-key JID (store NOWEB lama)", () => {
    const out = parseGroupsResponse({ [ID1]: { subject: "Grup D" }, [ID2]: { subject: "Grup E" } });
    expect(out.map((g) => g.id).sort()).toEqual([ID1, ID2]);
    expect(out.find((g) => g.id === ID1)?.name).toBe("Grup D");
  });

  it("tanpa nama → pakai id sebagai nama; bentuk asing → kosong tanpa melempar", () => {
    expect(parseGroupsResponse([{ id: ID1 }])).toEqual([{ id: ID1, name: ID1 }]);
    expect(parseGroupsResponse("aneh")).toEqual([]);
    expect(parseGroupsResponse(null)).toEqual([]);
  });
});

describe("normalizeGroupChatId", () => {
  it("angka polos → tambah @g.us; id lengkap dibiarkan", () => {
    expect(normalizeGroupChatId("120363011111111111")).toBe("120363011111111111@g.us");
    expect(normalizeGroupChatId("120363011111111111@g.us")).toBe("120363011111111111@g.us");
  });
});
