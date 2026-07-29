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

const { suggestActivityRewrite } = await import("@/lib/field-activity/rewrite-service");

const user = { id: "u1", orgId: "o1", role: "site_manager" } as never;
const TEKS = {
  notes: "hari ini pengecoran kolom 12 titik, berhenti jam 15 karena hujan",
  kendala: "alat berat telat datang dari suplier, nunggu 2 jam",
  solusi: "besok mulai lebih pagi biar kekejar",
};

/** Balasan model dalam format bagian bertanda. */
function balasan(parts: Partial<Record<"notes" | "kendala" | "solusi", string>>): string {
  const mark = { notes: "[CATATAN]", kendala: "[KENDALA]", solusi: "[TINDAK_LANJUT]" };
  return (Object.entries(parts) as [keyof typeof mark, string][])
    .map(([k, v]) => `${mark[k]}\n${v}`)
    .join("\n\n");
}

beforeEach(() => {
  vi.clearAllMocks();
  getActiveAiConfig.mockResolvedValue({ provider: "claude" });
  checkAiGuard.mockResolvedValue({ enabled: true });
});

describe("suggestActivityRewrite — satu panggilan untuk seluruh teks bebas", () => {
  it("usulan bersih → dikembalikan per bagian (tidak menyimpan apa pun)", async () => {
    aiCall.mockResolvedValue({
      ok: true,
      model: "uji-1",
      text: balasan({
        notes:
          "Dilaksanakan pengecoran kolom sebanyak 12 titik. Pekerjaan dihentikan pukul 15 karena hujan.",
        kendala: "Alat berat terlambat tiba dari pemasok sehingga terjadi waktu tunggu selama 2 jam.",
        solusi: "Pekerjaan akan dimulai lebih pagi pada hari berikutnya.",
      }),
    });

    const res = await suggestActivityRewrite(user, { texts: TEKS, style: "teknis" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.style).toBe("teknis");
    expect(res.fields.map((f) => f.field)).toEqual(["notes", "kendala", "solusi"]);
    expect(res.fields.every((f) => f.suggestion)).toBe(true);
    // Satu panggilan model saja untuk tiga bagian.
    expect(aiCall).toHaveBeenCalledTimes(1);
  });

  it("bagian yang menyelundupkan angka DIBUANG, bagian lain tetap lolos", async () => {
    aiCall.mockResolvedValue({
      ok: true,
      model: "uji-1",
      text: balasan({
        notes: "Dilaksanakan pengecoran kolom 12 titik dengan volume 8 m3, dihentikan pukul 15 karena hujan.",
        kendala: "Alat berat terlambat tiba dari pemasok sehingga terjadi waktu tunggu selama 2 jam.",
        solusi: "Pekerjaan akan dimulai lebih pagi pada hari berikutnya.",
      }),
    });

    const res = await suggestActivityRewrite(user, { texts: TEKS, style: "rapi" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const notes = res.fields.find((f) => f.field === "notes")!;
    expect(notes.suggestion).toBeNull();
    expect(notes.rejected).toMatch(/tidak ada di teks asli/i);
    expect(res.fields.find((f) => f.field === "kendala")!.suggestion).toBeTruthy();
  });

  it("bagian yang tidak dibalas model → dipertahankan aslinya, bukan dikarang", async () => {
    aiCall.mockResolvedValue({
      ok: true,
      model: "uji-1",
      text: balasan({ notes: "Dilaksanakan pengecoran kolom sebanyak 12 titik; dihentikan pukul 15 karena hujan." }),
    });
    const res = await suggestActivityRewrite(user, { texts: TEKS, style: "rapi" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const kendala = res.fields.find((f) => f.field === "kendala")!;
    expect(kendala.suggestion).toBeNull();
    expect(kendala.original).toBe(TEKS.kendala);
  });

  it("semua bagian gagal penjaga → tidak ada usulan yang ditawarkan", async () => {
    aiCall.mockResolvedValue({
      ok: true,
      model: "uji-1",
      text: balasan({ notes: "Pengecoran 99 titik.", kendala: "Telat 5 jam.", solusi: "Mulai jam 6." }),
    });
    const res = await suggestActivityRewrite(user, { texts: TEKS, style: "rapi" });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toMatch(/tidak ada usulan yang lolos/i);
  });

  it("hanya bagian cukup panjang yang dikirim ke model", async () => {
    aiCall.mockResolvedValue({ ok: true, model: "uji-1", text: balasan({ notes: "Dilaksanakan pengecoran kolom 12 titik, dihentikan pukul 15 karena hujan." }) });
    const res = await suggestActivityRewrite(user, {
      texts: { notes: TEKS.notes, kendala: "aman", solusi: null },
      style: "rapi",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.fields.map((f) => f.field)).toEqual(["notes"]);
    const prompt = String((aiCall.mock.calls[0][0] as { prompt: string }).prompt);
    expect(prompt).not.toContain("aman");
  });

  it("tidak ada teks yang layak → provider & guard tidak dipanggil", async () => {
    const res = await suggestActivityRewrite(user, { texts: { notes: "oke" }, style: "rapi" });
    expect(res.ok).toBe(false);
    expect(checkAiGuard).not.toHaveBeenCalled();
    expect(aiCall).not.toHaveBeenCalled();
  });

  it("AI belum dikonfigurasi → pesan menunjuk halaman Sistem, provider tidak dipanggil", async () => {
    getActiveAiConfig.mockResolvedValue(null);
    const res = await suggestActivityRewrite(user, { texts: TEKS, style: "rapi" });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toMatch(/halaman Sistem/i);
    expect(aiCall).not.toHaveBeenCalled();
  });

  it("kuota/kill-switch menolak → pesan guard diteruskan, provider tidak dipanggil", async () => {
    const { AiGuardError } = await import("@/lib/ai-hub/guard");
    checkAiGuard.mockRejectedValue(new AiGuardError("kuota_org", "Kuota AI harian organisasi habis."));
    const res = await suggestActivityRewrite(user, { texts: TEKS, style: "rapi" });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toMatch(/kuota/i);
    expect(aiCall).not.toHaveBeenCalled();
  });

  it("provider gagal → pesannya diteruskan apa adanya", async () => {
    aiCall.mockResolvedValue({ ok: false, error: "Layanan AI tidak menjawab (timeout)." });
    const res = await suggestActivityRewrite(user, { texts: TEKS, style: "rapi" });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toMatch(/timeout/i);
  });

  it("gaya teknis & rapi memakai instruksi berbeda", async () => {
    aiCall.mockResolvedValue({ ok: true, model: "uji-1", text: balasan({ notes: "Dilaksanakan pengecoran kolom 12 titik, dihentikan pukul 15 karena hujan." }) });
    await suggestActivityRewrite(user, { texts: { notes: TEKS.notes }, style: "teknis" });
    const teknis = String((aiCall.mock.calls[0][0] as { prompt: string }).prompt);
    aiCall.mockClear();
    aiCall.mockResolvedValue({ ok: true, model: "uji-1", text: balasan({ notes: "Dilaksanakan pengecoran kolom 12 titik, dihentikan pukul 15 karena hujan." }) });
    await suggestActivityRewrite(user, { texts: { notes: TEKS.notes }, style: "rapi" });
    const rapi = String((aiCall.mock.calls[0][0] as { prompt: string }).prompt);
    expect(teknis).toMatch(/register teknis/i);
    expect(rapi).not.toMatch(/register teknis/i);
  });
});
