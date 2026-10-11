import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  cetakOtomatisDiminta,
  denganCetakOtomatis,
  iniAplikasiTerpasang,
  modeCetak,
  tautanCetakDalamAplikasi,
  type KeadaanCetak,
} from "@/lib/cetak/mode-cetak";
import { alamatPdf } from "@/lib/cetak/alamat-pdf";

/**
 * MENCETAK DARI APLIKASI TERPASANG (PWA).
 *
 * Laporan user 2026-10-11: *"aku tidak bisa mencetak jika menggunakan PWA"*.
 * `window.print()` – satu-satunya jalan cetak sampai saat ini – sering tidak
 * memunculkan apa-apa di aplikasi yang dipasang ke layar depan (paling parah di
 * iPhone). Yang diuji di sini aturan murninya: tombol apa yang pantas muncul
 * untuk keadaan apa, dan alamat mana yang dibuka.
 */

const PDF = "/api/laporan/harian/kedungmutih/2026-09-27/pdf";

const keadaan = (k: Partial<KeadaanCetak>): KeadaanCetak => ({
  standalone: false,
  pdfHref: null,
  ios: false,
  bisaBagikanBerkas: false,
  ...k,
});

describe("modeCetak – peramban biasa TIDAK berubah", () => {
  it.each([
    keadaan({}),
    keadaan({ pdfHref: PDF }),
    keadaan({ pdfHref: PDF, ios: true, bisaBagikanBerkas: true }),
  ])("tetap satu tombol Cetak / Simpan PDF tanpa petunjuk (%o)", (k) => {
    expect(modeCetak(k)).toEqual({
      utama: { aksi: "cetak-layar", label: "Cetak / Simpan PDF" },
      cadangan: null,
      petunjuk: null,
    });
  });
});

describe("modeCetak – aplikasi terpasang", () => {
  it("ada PDF resmi: buka PDF-nya, cetak layar tinggal cadangan", () => {
    const m = modeCetak(keadaan({ standalone: true, pdfHref: PDF }));
    expect(m.utama.aksi).toBe("buka-pdf");
    expect(m.cadangan?.aksi).toBe("cetak-layar");
  });

  it("iPhone yang bisa membagikan berkas: PDF dibagikan, bukan dibuka di jendela lain", () => {
    // Jendela baru di iPhone tidak membawa sesi aplikasi terpasang, jadi
    // membuka PDF di sana berakhir di halaman masuk.
    const m = modeCetak(keadaan({ standalone: true, pdfHref: PDF, ios: true, bisaBagikanBerkas: true }));
    expect(m.utama.aksi).toBe("bagikan-pdf");
    expect(m.cadangan?.aksi).toBe("cetak-layar");
  });

  it("iPhone lama tanpa bagikan-berkas jatuh ke buka PDF", () => {
    const m = modeCetak(keadaan({ standalone: true, pdfHref: PDF, ios: true, bisaBagikanBerkas: false }));
    expect(m.utama.aksi).toBe("buka-pdf");
  });

  it("bisa membagikan berkas tapi BUKAN iPhone: tetap buka PDF (lembar bagikan Android tidak punya Cetak)", () => {
    const m = modeCetak(keadaan({ standalone: true, pdfHref: PDF, bisaBagikanBerkas: true }));
    expect(m.utama.aksi).toBe("buka-pdf");
  });

  it("tanpa PDF (RAPL, laporan AI, atau tanpa izin ekspor): buka halaman yang sama di peramban", () => {
    const m = modeCetak(keadaan({ standalone: true, pdfHref: null }));
    expect(m.utama.aksi).toBe("buka-peramban");
    expect(m.cadangan?.aksi).toBe("cetak-layar");
    expect(m.petunjuk).not.toMatch(/masuk/);
  });

  it("tanpa PDF di iPhone: petunjuknya jujur bahwa peramban bisa meminta masuk", () => {
    const m = modeCetak(keadaan({ standalone: true, pdfHref: null, ios: true }));
    expect(m.utama.aksi).toBe("buka-peramban");
    expect(m.petunjuk).toMatch(/masuk/);
  });

  it.each([
    keadaan({ standalone: true, pdfHref: PDF }),
    keadaan({ standalone: true, pdfHref: PDF, ios: true, bisaBagikanBerkas: true }),
    keadaan({ standalone: true, pdfHref: null }),
    keadaan({ standalone: true, pdfHref: null, ios: true }),
  ])("petunjuk menyebut tombol utamanya PERSIS – teks dan tombol tidak boleh berselisih (%o)", (k) => {
    const m = modeCetak(k);
    expect(m.petunjuk).toBeTruthy();
    expect(m.petunjuk).toContain(m.utama.label);
  });

  it("semua teks memakai en-dash, bukan em-dash (DECISIONS 385)", () => {
    const semua = [true, false].flatMap((standalone) =>
      [PDF, null].flatMap((pdfHref) =>
        [true, false].flatMap((ios) =>
          [true, false].map((bisaBagikanBerkas) =>
            modeCetak({ standalone, pdfHref, ios, bisaBagikanBerkas }),
          ),
        ),
      ),
    );
    for (const m of semua) {
      for (const t of [m.utama.label, m.cadangan?.label ?? "", m.petunjuk ?? ""]) {
        expect(t).not.toContain(String.fromCharCode(0x2014));
      }
    }
  });
});

describe("iniAplikasiTerpasang", () => {
  const cocokHanya = (q: string) => (kueri: string) => kueri === q;

  it.each(["(display-mode: standalone)", "(display-mode: fullscreen)", "(display-mode: minimal-ui)"])(
    "%s dihitung terpasang",
    (q) => {
      expect(iniAplikasiTerpasang(cocokHanya(q))).toBe(true);
    },
  );

  it("mode browser biasa bukan terpasang", () => {
    expect(iniAplikasiTerpasang(cocokHanya("(display-mode: browser)"))).toBe(false);
  });

  it("Safari iOS lama: navigator.standalone", () => {
    expect(iniAplikasiTerpasang(() => false, true)).toBe(true);
  });
});

describe("denganCetakOtomatis", () => {
  it("menambah cetak=1", () => {
    expect(denganCetakOtomatis("/cetak/rapl/kedungmutih")).toBe("/cetak/rapl/kedungmutih?cetak=1");
  });

  it("asal halaman (?dari=) ikut terbawa – tombol Kembali di jendela baru tetap benar", () => {
    const hasil = denganCetakOtomatis("/cetak/rapl/kedungmutih?dari=%2Flokasi%2Fkedungmutih%2Frapl");
    const u = new URL(hasil, "http://x");
    expect(u.pathname).toBe("/cetak/rapl/kedungmutih");
    expect(u.searchParams.get("dari")).toBe("/lokasi/kedungmutih/rapl");
    expect(u.searchParams.get("cetak")).toBe("1");
  });

  it("tidak menggandakan cetak=1", () => {
    expect(denganCetakOtomatis("/cetak/ai/a1?cetak=1")).toBe("/cetak/ai/a1?cetak=1");
  });

  it("alamat lengkap tetap alamat lengkap", () => {
    expect(denganCetakOtomatis("https://marlin.example/cetak/ai/a1#bagian")).toBe(
      "https://marlin.example/cetak/ai/a1?cetak=1#bagian",
    );
  });
});

describe("cetakOtomatisDiminta", () => {
  it.each([
    ["1", true],
    [["1", "1"], true],
    ["0", false],
    [undefined, false],
    ["ya", false],
  ] as const)("%o → %s", (nilai, harap) => {
    expect(cetakOtomatisDiminta(nilai as string | string[] | undefined)).toBe(harap);
  });
});

describe("tautanCetakDalamAplikasi", () => {
  const ASAL = "https://marlin.example";

  it.each([
    ["/cetak/harian/a/2026-09-27?dari=%2Flokasi%2Fa", "/cetak/harian/a/2026-09-27?dari=%2Flokasi%2Fa"],
    ["https://marlin.example/cetak/ai/a1", "/cetak/ai/a1"],
  ])("%s → %s", (href, harap) => {
    expect(tautanCetakDalamAplikasi(href, ASAL)).toBe(harap);
  });

  it.each([
    "https://lain.example/cetak/ai/a1",
    "//lain.example/cetak/ai/a1",
    "/api/laporan/harian/a/2026-09-27/pdf",
    "/cetakan/x",
    "/lokasi/a",
    "",
  ])("%s bukan halaman cetak MARLIN", (href) => {
    expect(tautanCetakDalamAplikasi(href, ASAL)).toBeNull();
  });

  it("dibuka di tempat: halaman asal ikut sebagai ?dari= supaya Kembali pulang ke situ", () => {
    const hasil = tautanCetakDalamAplikasi("/cetak/rencana/a/6", ASAL, "/lokasi/a/rab?bagian=rencana&minggu=6");
    const u = new URL(hasil ?? "", ASAL);
    expect(u.pathname).toBe("/cetak/rencana/a/6");
    expect(u.searchParams.get("dari")).toBe("/lokasi/a/rab?bagian=rencana&minggu=6");
  });

  it("?dari= yang sudah ada TIDAK ditimpa – penulis tautannya lebih tahu", () => {
    const hasil = tautanCetakDalamAplikasi("/cetak/harian/a/2026-09-27?dari=%2Flaporan", ASAL, "/lokasi/a");
    expect(new URL(hasil ?? "", ASAL).searchParams.get("dari")).toBe("/laporan");
  });
});

describe("alamatPdf menunjuk route yang ADA", () => {
  /*
   * Tombol utama aplikasi terpasang membuka alamat ini. Alamat yang salah satu
   * huruf tidak menimbulkan galat apa pun saat build – pengguna cuma melihat
   * 404 persis di saat ia mau mencetak.
   */
  it.each([
    [alamatPdf.harian("kedungmutih", "2026-09-27"), "/api/laporan/harian/kedungmutih/2026-09-27/pdf", "src/app/api/laporan/harian/[slug]/[date]/pdf/route.ts"],
    [alamatPdf.periodik("kedungmutih", "mingguan", 6), "/api/laporan/periodik/kedungmutih/mingguan/6/pdf", "src/app/api/laporan/periodik/[slug]/[kind]/[n]/pdf/route.ts"],
    [alamatPdf.rencana("kedungmutih", 6), "/api/laporan/rencana/kedungmutih/6/pdf", "src/app/api/laporan/rencana/[slug]/[n]/pdf/route.ts"],
    [alamatPdf.jadwal("kedungmutih"), "/api/laporan/jadwal/kedungmutih/pdf", "src/app/api/laporan/jadwal/[slug]/pdf/route.ts"],
  ])("%s", (href, harap, berkas) => {
    expect(href).toBe(harap);
    expect(existsSync(berkas), berkas).toBe(true);
  });

  it("slug di-encode – bukan disisipkan mentah ke alamat", () => {
    expect(alamatPdf.jadwal("a b/c")).toBe("/api/laporan/jadwal/a%20b%2Fc/pdf");
  });
});
