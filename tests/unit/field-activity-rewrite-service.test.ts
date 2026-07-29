import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/** Provider & guard di-mock: yang diuji adalah PERANGKAIANNYA, bukan modelnya. */
const aiCall = vi.fn();
const getActiveAiConfig = vi.fn();
const checkAiGuard = vi.fn();

vi.mock("@/lib/ai/client", () => ({ aiCall: (...a: unknown[]) => aiCall(...a) }));
vi.mock("@/lib/ai/config", () => ({ getActiveAiConfig: () => getActiveAiConfig() }));
vi.mock("@/lib/ai-hub/guard", () => ({
  checkAiGuard: (...a: unknown[]) => checkAiGuard(...a),
  AiGuardError: class AiGuardError extends Error {
    constructor(
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));

const { rewriteFieldText } = await import("@/lib/field-activity/rewrite-service");

const user = { id: "u1", orgId: "o1", role: "site_manager" } as never;
const ASLI = "hari ini pengecoran kolom 12 titik, berhenti jam 15 karena hujan";

beforeEach(() => {
  vi.clearAllMocks();
  getActiveAiConfig.mockResolvedValue({ provider: "claude" });
  checkAiGuard.mockResolvedValue({ enabled: true });
});

describe("rewriteFieldText", () => {
  it("usulan bersih → dikembalikan sebagai USULAN (tidak menyimpan apa pun)", async () => {
    aiCall.mockResolvedValue({
      ok: true,
      model: "uji-1",
      text: "Dilaksanakan pengecoran kolom sebanyak 12 titik. Pekerjaan dihentikan pukul 15 karena hujan.",
    });
    const res = await rewriteFieldText(user, { field: "notes", text: ASLI });
    expect(res).toMatchObject({ ok: true, model: "uji-1" });
    expect(res.ok && res.text).toMatch(/12 titik/);
  });

  it("model menyelundupkan angka baru → usulan DIBUANG, bukan ditampilkan dengan catatan", async () => {
    aiCall.mockResolvedValue({
      ok: true,
      model: "uji-1",
      text: "Pengecoran kolom 12 titik volume 8 m3, berhenti pukul 15 karena hujan.",
    });
    const res = await rewriteFieldText(user, { field: "notes", text: ASLI });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toMatch(/ditolak penjaga/i);
  });

  it("AI belum dikonfigurasi → pesan yang menunjuk jalan keluar, provider tidak dipanggil", async () => {
    getActiveAiConfig.mockResolvedValue(null);
    const res = await rewriteFieldText(user, { field: "notes", text: ASLI });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toMatch(/halaman Sistem/i);
    expect(aiCall).not.toHaveBeenCalled();
  });

  it("teks terlalu pendek → ditolak SEBELUM guard & provider dipanggil", async () => {
    const res = await rewriteFieldText(user, { field: "kendala", text: "telat" });
    expect(res.ok).toBe(false);
    expect(checkAiGuard).not.toHaveBeenCalled();
    expect(aiCall).not.toHaveBeenCalled();
  });

  it("kuota/kill-switch AI menolak → pesan guard diteruskan, provider tidak dipanggil", async () => {
    const { AiGuardError } = await import("@/lib/ai-hub/guard");
    checkAiGuard.mockRejectedValue(new AiGuardError("kuota_org", "Kuota AI harian organisasi habis."));
    const res = await rewriteFieldText(user, { field: "notes", text: ASLI });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toMatch(/kuota/i);
    expect(aiCall).not.toHaveBeenCalled();
  });

  it("hasil identik dengan aslinya → dibilang sudah rapi, bukan usulan kosong", async () => {
    aiCall.mockResolvedValue({ ok: true, model: "uji-1", text: ASLI });
    const res = await rewriteFieldText(user, { field: "notes", text: ASLI });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toMatch(/sudah rapi/i);
  });

  it("provider gagal → pesannya diteruskan apa adanya (tidak ditelan diam-diam)", async () => {
    aiCall.mockResolvedValue({ ok: false, error: "Layanan AI tidak menjawab (timeout)." });
    const res = await rewriteFieldText(user, { field: "solusi", text: ASLI });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toMatch(/timeout/i);
  });
});
