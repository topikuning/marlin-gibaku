import { describe, expect, it, vi } from "vitest";
import {
  ANGGARAN_WAKTU_MS,
  MAKS_BERKAS_PER_PUTARAN,
  MAKS_PERCOBAAN,
  hitungMundur,
  jenisGalat,
  masihAdaJatah,
  retryAfterMs,
} from "@/lib/gdrive/laju";

// `antrean.ts` menarik `db` → `env.ts`, yang menolak jalan tanpa konfigurasi.
// Uji ini tidak menyentuh database sama sekali; env-nya cuma syarat impor.
process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";
process.env.DATABASE_URL ??= "postgresql://marlin:marlin@localhost:5432/marlin_test";

vi.mock("server-only", () => ({}));

const { mingguRampung } = await import("@/lib/gdrive/antrean");

/**
 * Aturan laju unggah Drive (DECISIONS 313).
 *
 * Yang paling berharga diuji di sini adalah PEMBEDAAN "ditahan laju" vs "gagal
 * beneran". Kalau keduanya diperlakukan sama, satu sore sibuk yang membuat
 * Google menyuruh pelan-pelan akan menghanguskan laporan yang sebenarnya sehat
 * — dan tidak ada yang tahu sampai KKP menanyakan berkasnya.
 */

const T0 = new Date("2026-08-13T09:00:00.000Z");

describe("jenisGalat", () => {
  it("429 dan 5xx = ditahan laju", () => {
    expect(jenisGalat(429)).toBe("laju");
    expect(jenisGalat(500)).toBe("laju");
    expect(jenisGalat(503)).toBe("laju");
  });

  it("tanpa status HTTP = gagal beneran — kalau tidak, ia mengulang selamanya", () => {
    // "Paket belum punya folder Drive", R2 tak terbaca, render PDF melempar:
    // semuanya sampai ke sini tanpa status. Menggolongkannya "ditahan laju"
    // berarti percobaannya tidak pernah bertambah, jadi ia tidak akan PERNAH
    // menyerah dan tidak akan pernah muncul sebagai macet — sambil
    // menghentikan sisa putaran tiap kali.
    expect(jenisGalat(null)).toBe("nyata");
    expect(jenisGalat(undefined)).toBe("nyata");
    expect(jenisGalat(null, "Paket ini belum punya folder Google Drive")).toBe("nyata");
  });

  it("403 dibedakan lewat alasannya — kuota vs hak akses", () => {
    // Drive memakai 403 untuk dua hal yang penanganannya berlawanan.
    expect(jenisGalat(403, "User rate limit exceeded")).toBe("laju");
    expect(jenisGalat(403, "rateLimitExceeded")).toBe("laju");
    expect(jenisGalat(403, "The user has exceeded their Drive storage quota")).toBe("laju");
    expect(jenisGalat(403, "insufficientFilePermissions")).toBe("nyata");
  });

  it("folder salah / permintaan salah = gagal beneran", () => {
    expect(jenisGalat(404, "File not found")).toBe("nyata");
    expect(jenisGalat(400, "Bad Request")).toBe("nyata");
    expect(jenisGalat(401, "Invalid Credentials")).toBe("nyata");
  });
});

describe("retryAfterMs", () => {
  it("membaca detik", () => {
    expect(retryAfterMs("30", T0.getTime())).toBe(30_000);
  });

  it("membaca tanggal HTTP relatif terhadap sekarang", () => {
    const nanti = new Date(T0.getTime() + 120_000).toUTCString();
    expect(retryAfterMs(nanti, T0.getTime())).toBe(120_000);
  });

  it("mengabaikan yang kosong, tak terbaca, atau sudah lewat", () => {
    expect(retryAfterMs(null, T0.getTime())).toBeNull();
    expect(retryAfterMs("", T0.getTime())).toBeNull();
    expect(retryAfterMs("besok pagi", T0.getTime())).toBeNull();
    expect(retryAfterMs("0", T0.getTime())).toBeNull();
    const lampau = new Date(T0.getTime() - 60_000).toUTCString();
    expect(retryAfterMs(lampau, T0.getTime())).toBeNull();
  });

  it("dibatasi atas — jangan tertidur berhari-hari karena satu header", () => {
    const ms = retryAfterMs(String(60 * 60 * 24 * 30), T0.getTime());
    expect(ms).toBe(6 * 3_600_000);
  });
});

describe("hitungMundur", () => {
  it("ditahan laju TIDAK menambah hitungan percobaan", () => {
    const m = hitungMundur({ jenis: "laju", attemptsSebelum: 3, sekarang: T0 });
    expect(m.attempts).toBe(3);
    expect(m.menyerah).toBe(false);
    expect(m.nextAttemptAt.getTime()).toBeGreaterThan(T0.getTime());
  });

  it("ditahan laju tidak akan pernah menyerah, walau berulang kali", () => {
    let attempts = 0;
    for (let i = 0; i < MAKS_PERCOBAAN * 3; i++) {
      const m = hitungMundur({ jenis: "laju", attemptsSebelum: attempts, sekarang: T0 });
      attempts = m.attempts;
      expect(m.menyerah).toBe(false);
    }
    expect(attempts).toBe(0);
  });

  it("Retry-After dari Google didahulukan atas tebakan sendiri", () => {
    const m = hitungMundur({
      jenis: "laju",
      attemptsSebelum: 0,
      sekarang: T0,
      retryAfterMs: 45_000,
    });
    expect(m.nextAttemptAt.getTime()).toBe(T0.getTime() + 45_000);
  });

  it("gagal beneran menambah percobaan dan mundurnya makin panjang", () => {
    const a = hitungMundur({ jenis: "nyata", attemptsSebelum: 0, sekarang: T0 });
    const b = hitungMundur({ jenis: "nyata", attemptsSebelum: 1, sekarang: T0 });
    expect(a.attempts).toBe(1);
    expect(b.attempts).toBe(2);
    expect(b.nextAttemptAt.getTime()).toBeGreaterThan(a.nextAttemptAt.getTime());
    expect(a.menyerah).toBe(false);
  });

  it("menyerah setelah batas percobaan — berhenti membebani antrean", () => {
    const m = hitungMundur({ jenis: "nyata", attemptsSebelum: MAKS_PERCOBAAN - 1, sekarang: T0 });
    expect(m.attempts).toBe(MAKS_PERCOBAAN);
    expect(m.menyerah).toBe(true);
  });
});

describe("masihAdaJatah", () => {
  it("berhenti saat batas berkas tercapai", () => {
    const mulai = T0.getTime();
    expect(masihAdaJatah({ berkas: MAKS_BERKAS_PER_PUTARAN - 1, mulai, sekarang: mulai })).toBe(true);
    expect(masihAdaJatah({ berkas: MAKS_BERKAS_PER_PUTARAN, mulai, sekarang: mulai })).toBe(false);
  });

  it("berhenti saat anggaran waktu habis walau berkasnya masih sedikit", () => {
    const mulai = T0.getTime();
    expect(masihAdaJatah({ berkas: 1, mulai, sekarang: mulai + ANGGARAN_WAKTU_MS })).toBe(false);
  });
});

describe("mingguRampung", () => {
  const mulai = new Date("2026-01-01T00:00:00.000Z");

  it("minggu berjalan belum dihitung tuntas", () => {
    expect(mingguRampung(mulai, new Date("2026-01-01T10:00:00.000Z"), 52)).toBe(0);
  });

  it("HARI TERAKHIR minggu ke-1 belum tuntas — datanya belum lengkap sore itu", () => {
    // Penjadwal berjalan 16:00 WIB; laporan harian hari itu sering belum final.
    expect(mingguRampung(mulai, new Date("2026-01-07T09:00:00.000Z"), 52)).toBe(0);
  });

  it("sehari setelahnya minggu ke-1 baru tuntas", () => {
    expect(mingguRampung(mulai, new Date("2026-01-08T09:00:00.000Z"), 52)).toBe(1);
  });

  it("menghitung maju sesuai lamanya kontrak berjalan", () => {
    expect(mingguRampung(mulai, new Date("2026-01-15T09:00:00.000Z"), 52)).toBe(2);
    expect(mingguRampung(mulai, new Date("2026-03-05T09:00:00.000Z"), 52)).toBe(9);
  });

  it("tidak pernah melewati jumlah minggu kontrak", () => {
    // Kontrak molor: waktu jalan terus, tapi laporan mingguan ke-53 tidak ada.
    expect(mingguRampung(mulai, new Date("2027-06-01T09:00:00.000Z"), 52)).toBe(52);
  });

  it("tidak pernah negatif sebelum SPMK", () => {
    expect(mingguRampung(mulai, new Date("2025-12-20T09:00:00.000Z"), 52)).toBe(0);
  });
});
