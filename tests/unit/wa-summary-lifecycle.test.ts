import { describe, expect, it } from "vitest";
import {
  canFinalize,
  canSend,
  canTransition,
  computeConfidence,
  confidenceLabel,
  confidenceTone,
  countByRelevance,
  orderByRelevance,
  parseDispatches,
  transitionSummary,
} from "@/lib/waha/summary-lifecycle";
import { classifyMessage, type MessageClass } from "@/lib/waha/message-classify";

/** Siklus hidup ringkasan chat grup: draf AI tidak pernah otomatis final. DECISIONS 139. */

describe("transisi status", () => {
  it("hanya bisa mulai dari draf AI", () => {
    expect(canTransition("belum_dibuat", "draft_ai")).toBe(true);
    expect(canTransition("belum_dibuat", "final")).toBe(false);
    expect(canTransition("belum_dibuat", "sent")).toBe(false);
  });

  it("draf AI TIDAK bisa langsung terkirim tanpa final", () => {
    expect(canTransition("draft_ai", "sent")).toBe(false);
    expect(canTransition("edited_draft", "sent")).toBe(false);
    expect(canTransition("final", "sent")).toBe(true);
  });

  it("menyusun ulang draf boleh dari status apa pun", () => {
    for (const s of ["draft_ai", "edited_draft", "final", "sent"] as const) {
      expect(canTransition(s, "draft_ai")).toBe(true);
    }
  });

  it("menyunting yang sudah terkirim mengembalikan ke draf disunting", () => {
    expect(canTransition("sent", "edited_draft")).toBe(true);
    expect(canTransition("sent", "final")).toBe(false);
  });

  it("transitionSummary memberi pesan Indonesia saat ditolak", () => {
    const r = transitionSummary("belum_dibuat", "final");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Belum dibuat");
    const ok = transitionSummary("draft_ai", "final");
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.status).toBe("final");
  });

  it("gerbang kirim & finalkan", () => {
    expect(canSend("draft_ai")).toBe(false);
    expect(canSend("edited_draft")).toBe(false);
    expect(canSend("final")).toBe(true);
    expect(canSend("sent")).toBe(true);
    expect(canFinalize("draft_ai")).toBe(true);
    expect(canFinalize("final")).toBe(false);
    expect(canFinalize("belum_dibuat")).toBe(false);
  });
});

describe("computeConfidence", () => {
  const zero = { usedCount: 0, excludedCount: 0, needsInterpretationCount: 0, marlinCount: 0, truncated: false };

  it("tanpa bukti apa pun = 0", () => {
    expect(computeConfidence(zero)).toBe(0);
  });

  it("makin banyak bukti makin yakin, dibatasi 0–100", () => {
    const few = computeConfidence({ ...zero, usedCount: 2 });
    const many = computeConfidence({ ...zero, usedCount: 25 });
    expect(few).toBeLessThan(many);
    expect(many).toBeLessThanOrEqual(100);
    expect(few).toBeGreaterThanOrEqual(0);
  });

  it("kiriman resmi MARLIN menaikkan keyakinan", () => {
    const tanpa = computeConfidence({ ...zero, usedCount: 5 });
    const dengan = computeConfidence({ ...zero, usedCount: 5, marlinCount: 3 });
    expect(dengan).toBeGreaterThan(tanpa);
  });

  it("banyak pesan ambigu & transkrip terpotong menurunkan keyakinan", () => {
    const bersih = computeConfidence({ ...zero, usedCount: 10 });
    const ambigu = computeConfidence({ ...zero, usedCount: 10, needsInterpretationCount: 8 });
    const potong = computeConfidence({ ...zero, usedCount: 10, truncated: true });
    expect(ambigu).toBeLessThan(bersih);
    expect(potong).toBeLessThan(bersih);
  });

  it("bukti sangat tipis tanpa kiriman MARLIN = rendah", () => {
    expect(confidenceTone(computeConfidence({ ...zero, usedCount: 1 }))).not.toBe("success");
  });

  it("label & tone konsisten dengan ambang", () => {
    expect(confidenceTone(80)).toBe("success");
    expect(confidenceLabel(80)).toBe("Tinggi");
    expect(confidenceTone(50)).toBe("warning");
    expect(confidenceLabel(50)).toBe("Sedang");
    expect(confidenceTone(20)).toBe("danger");
    expect(confidenceLabel(20)).toBe("Rendah");
  });
});

describe("orderByRelevance", () => {
  const mk = (body: string, id: string) => ({
    id,
    class: classifyMessage({ body, hasMedia: false, noise: false, fromMe: false }),
  });

  it("kendala didahulukan, urutan waktu dipertahankan untuk bobot sama", () => {
    const items = [
      mk("Kunjungan konsultan pengawas hari ini", "a"), // relevan
      mk("Besi belum datang, pekerjaan berhenti", "b"), // sangat relevan
      mk("Pengecoran sudah selesai zona 2", "c"), // relevan
      mk("Tolong segera kirim data volume", "d"), // sangat relevan
    ];
    expect(orderByRelevance(items).map((x) => x.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("tidak mengubah array asal", () => {
    const items = [mk("Besi belum datang", "b"), mk("Rapat dinas", "a")];
    const before = items.map((x) => x.id);
    orderByRelevance(items);
    expect(items.map((x) => x.id)).toEqual(before);
  });
});

describe("countByRelevance", () => {
  it("menghitung per tingkat", () => {
    const classes: MessageClass[] = [
      classifyMessage({ body: "Besi belum datang", hasMedia: false, noise: false, fromMe: false }),
      classifyMessage({ body: "ok", hasMedia: false, noise: false, fromMe: false }),
    ];
    const c = countByRelevance(classes);
    expect(c.sangat_relevan).toBe(1);
    expect(c.konteks_rendah).toBe(1);
    expect(c.relevan).toBe(0);
  });
});

describe("parseDispatches", () => {
  it("membaca riwayat kiriman yang valid", () => {
    const r = parseDispatches([
      { at: "2026-07-26T10:00:00.000Z", target: "Direksi", chatId: "628@c.us", byId: "u1" },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].target).toBe("Direksi");
  });

  it("data lama/rusak tidak melempar", () => {
    expect(parseDispatches(null)).toEqual([]);
    expect(parseDispatches("bukan array")).toEqual([]);
    expect(parseDispatches([null, 42, { at: 1 }, { target: "x" }])).toEqual([]);
  });

  it("field opsional yang hilang diisi aman", () => {
    const r = parseDispatches([{ at: "2026-07-26T10:00:00.000Z", target: "Pimpinan" }]);
    expect(r[0].chatId).toBe("");
    expect(r[0].byId).toBeNull();
  });
});
