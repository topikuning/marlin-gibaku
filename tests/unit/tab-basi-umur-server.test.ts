/*
 * TAB BASI DIKENALI DARI UMUR SERVER, BUKAN DARI KALIMAT GALATNYA.
 *
 * **Laporan user 2026-09-23**, beberapa menit sesudah rilis masuk `main`:
 *
 *   *"Gagal mengirim – server menolak permintaan ini… Error: An unexpected
 *   response was received from the server."*
 *
 * dan di log server, berkali-kali:
 *
 *   *"Failed to find Server Action "6090da7f…". This request might be from an
 *   older or newer deployment."*
 *
 * Jadi penyebabnya MEMANG tab yang lebih tua daripada servernya — persis yang
 * sudah dijaga DECISIONS 292. Penjaganya tidak kena karena mengenali keadaan itu
 * dari KALIMAT galat, sedangkan kalimat `Failed to find Server Action` cuma ada
 * di LOG SERVER. Yang sampai ke browser kalimat Next yang generik, sama persis
 * dengan kegagalan transport lain, jadi user disuruh *"coba tekan lagi"* untuk
 * sesuatu yang tidak akan pernah berhasil sampai halamannya dimuat ulang.
 *
 * Pembedanya yang benar-benar tersedia di browser: **umur**. ID server action
 * di-hash per build, jadi ia hilang tepat ketika server dimulai ulang dengan
 * build baru. Kalau server hidup TAPI sudah jalan lebih SEBENTAR daripada umur
 * halaman ini, server itu bukan server yang mengirim halaman ini.
 *
 * Dua durasi, masing-masing diukur di mesinnya sendiri (`performance.now()` di
 * browser, `process.uptime()` di server) — tidak ada jam yang dibandingkan, jadi
 * jam user yang meleset tidak membuat pagar ini salah tuduh.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { tahanGagalKirim, type AksiState } from "@/lib/aksi-klien";

/** `/api/health` versi server: hidup, dan sudah jalan `uptimeMs`. */
function pasangHealth(uptimeMs: number | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => (uptimeMs === null ? { status: "ok" } : { status: "ok", uptimeMs }),
    })),
  );
}

/** Halaman ini sudah terbuka selama `ms`. */
function umurHalaman(ms: number) {
  vi.spyOn(performance, "now").mockReturnValue(ms);
}

const gagalTransport = async (): Promise<AksiState> => {
  // Kalimat yang BENAR-BENAR sampai ke browser — bukan kalimat di log server.
  throw new Error("An unexpected response was received from the server.");
};

const kirim = async () => (await tahanGagalKirim(gagalTransport)(undefined, new FormData()))?.error ?? "";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("server lebih muda daripada halaman = deploy menyalip tab", () => {
  it("server baru jalan 30 detik sementara halaman sudah 10 menit → tab basi", async () => {
    umurHalaman(10 * 60_000);
    pasangHealth(30_000);
    const pesan = await kirim();
    expect(pesan).toContain("MARLIN sudah diperbarui");
    expect(pesan).toContain("Muat ulang");
  });

  it("…dan TIDAK menyuruh menekan tombolnya lagi", async () => {
    // Menekan lagi mustahil berhasil: ID aksinya tidak ada lagi di server mana
    // pun. Menyuruh mencoba lagi cuma membuat orang menunggu lebih lama.
    umurHalaman(10 * 60_000);
    pasangHealth(30_000);
    expect(await kirim()).not.toContain("coba tekan lagi");
  });

  it("server yang sudah jalan lebih lama dari halaman = gangguan biasa", async () => {
    // Batas yang penting ke arah sebaliknya: menyuruh "muat ulang" untuk
    // gangguan sesaat membuang isian orang tanpa satu pun alasan.
    umurHalaman(60_000);
    pasangHealth(3 * 3_600_000);
    const pesan = await kirim();
    expect(pesan).not.toContain("MARLIN sudah diperbarui");
    expect(pesan).toContain("TIDAK hilang");
  });

  it("server lama yang belum mengabarkan umurnya tidak dituduh apa-apa", async () => {
    // Selama deploy berjalan, versi lama masih melayani sebagian permintaan.
    // Tanpa `uptimeMs`, perilakunya harus persis seperti sebelum pagar ini ada.
    umurHalaman(10 * 60_000);
    pasangHealth(null);
    const pesan = await kirim();
    expect(pesan).not.toContain("MARLIN sudah diperbarui");
    expect(pesan).toContain("menolak permintaan ini");
  });

  it("server tak terjangkau tetap dibaca sebagai server mati, bukan deploy", async () => {
    umurHalaman(10 * 60_000);
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    expect(await kirim()).toContain("tidak bisa dihubungi");
  });

  it("umur yang sama persis belum cukup jadi tuduhan", async () => {
    // Batas dibaca KETAT: hanya server yang benar-benar lebih muda yang
    // membuktikan ada build lain di antara halaman ini dan sekarang.
    umurHalaman(120_000);
    pasangHealth(120_000);
    expect(await kirim()).not.toContain("MARLIN sudah diperbarui");
  });
});

describe("/api/health mengabarkan umurnya sendiri", () => {
  it("balasan sehat memuat uptimeMs", async () => {
    vi.resetModules();
    vi.doMock("@/lib/db", () => ({ db: { $queryRaw: async () => [{ "?column?": 1 }] } }));
    const { GET } = await import("../../src/app/api/health/route");
    const body = await (await GET()).json();
    expect(body.status).toBe("ok");
    expect(typeof body.uptimeMs, `uptimeMs tidak ada: ${JSON.stringify(body)}`).toBe("number");
    expect(body.uptimeMs).toBeGreaterThanOrEqual(0);
    vi.doUnmock("@/lib/db");
  });
});
