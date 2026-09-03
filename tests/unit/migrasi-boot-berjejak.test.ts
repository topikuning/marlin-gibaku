import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * MIGRASI SAAT BOOT HARUS MENINGGALKAN JEJAK AUDIT.
 *
 * `audit()` sengaja best-effort: kegagalan menulis jejak tidak boleh
 * menggagalkan aksi utama. Ongkosnya, kegagalannya SENYAP — hanya `console`.
 * Dan saat boot ia PASTI gagal kalau tidak ditandai: boot bukan request, jadi
 * `headers()` di dalam `requestIp()` melempar. Terbaca di log E2E CI
 * 2026-09-03:
 *
 *   [audit] gagal menulis audit log: daily_report.snapshot_periode_backfill
 *   Error: `headers` was called outside a request scope.
 *
 * Artinya dua migrasi yang benar-benar MENGUBAH isi basis data —
 * `daily_report.snapshot_periode_backfill` dan `contract.week_mode_default` —
 * berjalan tanpa satu baris audit pun. Penandanya sudah ada sejak DECISIONS
 * 456 (`jalankanDiLatar`); yang kurang cuma pemakaiannya di sini.
 *
 * Dijaga dari SUMBER karena tidak ada cara lain: `instrumentation-node.ts`
 * berjalan saat Next memuat server, bukan sesuatu yang bisa dipanggil vitest.
 * Yang dijaga bukan gaya penulisan, melainkan satu fakta: pekerjaan boot
 * dibungkus penanda latar.
 */
describe("bootstrap boot ditandai sebagai pekerjaan latar", () => {
  const berkas = join(process.cwd(), "src/instrumentation-node.ts");
  const isi = readFileSync(berkas, "utf8");

  it("mengimpor penanda latar", () => {
    expect(isi).toMatch(/import \{ jalankanDiLatar \} from "@\/lib\/auth\/latar"/);
  });

  it("bootstrapDone dibungkus jalankanDiLatar, bukan IIFE telanjang", () => {
    expect(isi).toMatch(/export const bootstrapDone[^=]*=\s*jalankanDiLatar\(/);
    // IIFE telanjang = jalur yang membuat auditnya hilang; jangan kembali.
    expect(isi).not.toMatch(/export const bootstrapDone[^=]*=\s*\(async \(\) =>/);
  });

  it("semua pekerjaan boot berada DI DALAM bungkusnya", () => {
    const mulai = isi.indexOf("jalankanDiLatar(");
    expect(mulai).toBeGreaterThan(-1);
    const sisa = isi.slice(mulai);
    for (const kerja of ["bootstrapAdmin()", "bootstrapDemoData()", "migrasiDataOtomatis()"]) {
      expect(sisa).toContain(`await ${kerja}`);
    }
  });
});
