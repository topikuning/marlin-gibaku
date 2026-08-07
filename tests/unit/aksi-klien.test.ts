// PENGIRIMAN YANG GAGAL HARUS BISA DIULANG, BUKAN MENGHAPUS ISIAN.
//
// Laporan user 2026-08-07: `Error: An unexpected response was received from the
// server.` di `/lokasi/kranji-kranji/harian/2026-08-01` saat melampirkan foto.
// Kalimat itu milik Next — dilempar ketika balasan POST server action bukan
// `text/x-component`. Lemparannya lolos ke batas galat, dan batas galat
// mengganti SELURUH halaman: volume yang diketik, pekerjaan yang dipilih, dan
// foto yang dilampirkan ikut hilang gara-gara satu POST yang gagal.
import { describe, expect, it, vi, afterEach } from "vitest";
import { tahanGagalKirim, type AksiState } from "@/lib/aksi-klien";

function pasangFetch(ok: boolean) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => (ok ? { ok: true } : Promise.reject(new Error("offline")))),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("tahanGagalKirim", () => {
  it("meneruskan hasil sukses apa adanya", async () => {
    const aksi = tahanGagalKirim<AksiState>(async () => ({ success: "Tersimpan" }));
    expect(await aksi(undefined, new FormData())).toEqual({ success: "Tersimpan" });
  });

  it("meneruskan galat logika dari server apa adanya — bukan urusannya", async () => {
    // Validasi/izin sudah jadi state di sisi server; jangan ditimpa.
    const aksi = tahanGagalKirim<AksiState>(async () => ({ error: "Volume wajib diisi" }));
    expect(await aksi(undefined, new FormData())).toEqual({ error: "Volume wajib diisi" });
  });

  it("kegagalan transport jadi PESAN, tidak melempar", async () => {
    pasangFetch(true);
    const aksi = tahanGagalKirim<AksiState>(async () => {
      throw new Error("An unexpected response was received from the server.");
    });
    const hasil = await aksi(undefined, new FormData());
    // Tidak melempar = batas galat tidak kena = form tidak dibongkar.
    expect(hasil?.error).toContain("Gagal mengirim");
    // Nama galat aslinya TETAP disebut supaya laporan berikutnya membawa fakta.
    expect(hasil?.error).toContain("An unexpected response was received from the server.");
    // Dan pelapor diberi tahu isiannya tidak hilang — itu yang menentukan
    // apakah ia menekan tombolnya lagi atau menyerah.
    expect(hasil?.error).toContain("TIDAK hilang");
  });

  it("membedakan server hidup vs server tak terjangkau", async () => {
    const meledak = async (): Promise<AksiState> => {
      throw new Error("An unexpected response was received from the server.");
    };
    pasangFetch(true);
    expect((await tahanGagalKirim(meledak)(undefined, new FormData()))?.error).toContain(
      "menolak permintaan ini",
    );
    pasangFetch(false);
    expect((await tahanGagalKirim(meledak)(undefined, new FormData()))?.error).toContain(
      "tidak bisa dihubungi",
    );
  });

  it("lemparan redirect()/notFound() Next TETAP lewat", async () => {
    // Keduanya bekerja DENGAN cara melempar; menelannya merusak navigasi.
    const aksi = tahanGagalKirim<AksiState>(async () => {
      throw Object.assign(new Error("redirect"), { digest: "NEXT_REDIRECT;replace;/masuk;307;" });
    });
    await expect(aksi(undefined, new FormData())).rejects.toThrow("redirect");
  });
});
