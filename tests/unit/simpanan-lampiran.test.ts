// SIMPANAN LAMPIRAN HARUS MENGUMUMKAN KEADAANNYA SENDIRI.
//
// Keluhan user 2026-09-03: *"kenapa file masih hilang saat deploy ulang?
// padahal di production sudah ada volume khusus?!"*
//
// Volume terpasang tidak sama dengan volume yang BISA DITULIS. Railway memasang
// volume sebagai milik root; aplikasi berjalan sebagai `marlin`. Saat `mkdir`
// gagal, `siapkanDirektoriLampiran()` pindah ke `/tmp` — yang justru dibersihkan
// tiap kontainer diganti. Satu-satunya jejaknya dulu adalah satu baris
// `console.warn` di log yang tidak pernah dibaca siapa pun, jadi dari layar
// keadaan "volume benar" dan "volume tidak bisa ditulis" terlihat identik:
// berkas ada hari ini, hilang besok.
//
// Berkas ini menjaga pembedanya. Kalau `periksaSimpananLampiran()` mulai
// menjawab "aman" untuk keadaan yang tidak aman, peringatan di layar Lampiran
// Masuk lenyap tanpa satu pun uji lain berubah merah.
import { mkdtempSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { periksaSimpananLampiran, direktoriLampiran } from "@/lib/waha/lampiran-simpanan";

const semula = process.env.LAMPIRAN_DIR;
const sampah: string[] = [];

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  if (semula === undefined) delete process.env.LAMPIRAN_DIR;
  else process.env.LAMPIRAN_DIR = semula;
  for (const d of sampah.splice(0)) {
    try {
      chmodSync(d, 0o700);
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* sudah hilang – tidak apa-apa */
    }
  }
});

function dirSementara(): string {
  const d = mkdtempSync(join(tmpdir(), "marlin-uji-lampiran-"));
  sampah.push(d);
  return d;
}

describe("periksaSimpananLampiran", () => {
  it("LAMPIRAN_DIR belum disetel = tidak tahan deploy, dan mengatakannya", () => {
    delete process.env.LAMPIRAN_DIR;
    // Bawaannya di dalam kontainer. Ia BISA ditulis — jadi tidak ada galat
    // apa pun — tapi isinya tetap ikut terhapus bersama kontainernya. Inilah
    // kegagalan yang paling mudah lolos: semuanya "berhasil".
    return periksaSimpananLampiran().then((s) => {
      expect(s.tahanDeploy).toBe(false);
      expect(s.masalah).toContain("LAMPIRAN_DIR");
      expect(s.masalah).toContain("deploy ulang");
      expect(s.dipakai).toBe(direktoriLampiran());
    });
  });

  it("LAMPIRAN_DIR ke direktori yang bisa ditulis = aman, tanpa peringatan", async () => {
    const dir = join(dirSementara(), "lampiran");
    process.env.LAMPIRAN_DIR = dir;

    const s = await periksaSimpananLampiran();
    expect(s.tahanDeploy).toBe(true);
    expect(s.masalah).toBeNull();
    // Dibuat sendiri kalau belum ada — titik pasang volume yang masih kosong
    // adalah keadaan normal, bukan kegagalan.
    expect(s.dipakai).toBe(dir);
  });

  it("LAMPIRAN_DIR tidak bisa ditulis = cadangan /tmp, DAN sebabnya disebut", async () => {
    // Root menembus mode berkas, jadi keadaan ini tidak bisa dibuat-buat di
    // sana. Dilewati — bukan dihijaukan dengan asersi yang lebih lemah.
    if (typeof process.getuid === "function" && process.getuid() === 0) {
      return;
    }
    const induk = dirSementara();
    chmodSync(induk, 0o500); // r-x: tidak boleh membuat apa pun di dalamnya
    process.env.LAMPIRAN_DIR = join(induk, "lampiran");

    const s = await periksaSimpananLampiran();
    expect(s.tahanDeploy).toBe(false);
    // Yang dipakai BUKAN yang diminta — inilah kenyataan yang dulu tersembunyi.
    expect(s.dipakai).not.toBe(s.diminta);
    expect(s.dipakai).toContain("marlin-lampiran");
    expect(s.masalah).toContain("hilang setiap aplikasi di-deploy ulang");
    // Sebabnya, bukan cuma akibatnya: orang yang membacanya harus tahu apa
    // yang perlu diperbaiki.
    expect(s.masalah).toMatch(/root/);
  });

  it("teks peringatannya memakai en-dash, bukan em-dash", async () => {
    delete process.env.LAMPIRAN_DIR;
    const s = await periksaSimpananLampiran();
    // Dirakit dari titik kodenya, bukan ditulis apa adanya: penjaga
    // `tanda-pisah-ui` memindai berkas ini juga, dan em-dash harfiah di sini
    // akan membuatnya merah karena uji ini justru melarangnya.
    expect(s.masalah ?? "").not.toContain(String.fromCharCode(0x2014));
  });
});
