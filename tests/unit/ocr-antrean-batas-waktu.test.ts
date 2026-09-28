// ANTREAN OCR SESUDAH BATAS WAKTU (DECISIONS 628).
//
// Log produksi 2026-09-28: "[ocr] membaca tulisan foto gagal – cap lengkap
// dipakai: OCR lewat batas waktu". Batas waktu hanya MENYERAH menunggu – mesin
// OCR (satu worker) tetap mengerjakan foto itu sampai selesai. Antrean lama
// langsung melepas foto berikutnya, jadi foto berikutnya berjalan bertumpuk di
// worker yang masih sibuk dan batas waktunya ikut termakan sisa foto sebelumnya.
// Yang dijaga: foto berikutnya menunggu sisa pekerjaan itu selesai.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const kosong = { data: { blocks: [] } };
let tahan = false;
let lepas: (() => void)[] = [];
const recognize = vi.fn(
  () =>
    new Promise((r) => {
      if (tahan) lepas.push(() => r(kosong));
      else r(kosong);
    }),
);

vi.mock("tesseract.js", () => ({
  createWorker: async () => ({ setParameters: async () => {}, recognize }),
  PSM: { SPARSE_TEXT: "11" },
}));

vi.mock("sharp", () => {
  const pipa: Record<string, unknown> = {};
  for (const m of ["rotate", "resize", "grayscale", "threshold", "negate", "png"]) pipa[m] = () => pipa;
  pipa.toBuffer = async () => ({ data: Buffer.alloc(1), info: { width: 10, height: 10 } });
  return { default: () => pipa };
});

const { bacaTulisanFoto } = await import("@/lib/photo-stamp/ocr");

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("antrean OCR sesudah batas waktu", () => {
  it("foto berikutnya MENUNGGU sisa pekerjaan foto yang habis waktu, tidak ditumpuk ke worker", async () => {
    tahan = true;
    const a = bacaTulisanFoto(Buffer.alloc(1));
    await vi.advanceTimersByTimeAsync(8_000);
    expect(await a).toBeNull();
    const dipanggilSaatHabis = recognize.mock.calls.length;

    tahan = false;
    const b = bacaTulisanFoto(Buffer.alloc(1));
    await vi.advanceTimersByTimeAsync(10);
    expect(recognize.mock.calls.length, "foto B dikirim ke worker yang masih sibuk").toBe(dipanggilSaatHabis);

    // Sisa pekerjaan foto A selesai → baru foto B dibaca, dengan batas waktunya sendiri.
    for (const f of lepas) f();
    lepas = [];
    await vi.advanceTimersByTimeAsync(10);
    expect(await b).toEqual({ teks: "", kotak: [] });
  });
});
