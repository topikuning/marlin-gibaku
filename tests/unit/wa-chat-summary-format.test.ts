import { describe, expect, it } from "vitest";
import {
  buildTranscript,
  describePackageContext,
  formatGlobalSummaryForWa,
  formatSummaryForWa,
  isNoiseMessage,
  shortPackageTitle,
  type PackageContext,
} from "@/lib/waha/chat-summary-format";

/** Ringkasan chat grup: konteks paket, filter uji sistem, format kirim WA. DECISIONS 137. */

const ctx: PackageContext = {
  packageName: "KNMP Jawa Tengah & DIY",
  packageNumber: "PKT-2026-004",
  workTitle: "Pembangunan Kampung Nelayan Purwahamba & Muara Reja",
  vendorName: "CV. Putera Fahlevi",
  waGroupName: "KNMP Jawa",
  locationNames: ["Purwahamba", "Muara Reja", "Karangmangu"],
};

describe("describePackageContext", () => {
  it("sebut paket, pekerjaan, pelaksana, dan lokasi — bukan cuma nama grup generik", () => {
    const s = describePackageContext(ctx);
    expect(s).toContain("KNMP Jawa Tengah & DIY");
    expect(s).toContain("PKT-2026-004");
    expect(s).toContain("Pembangunan Kampung Nelayan");
    expect(s).toContain("CV. Putera Fahlevi");
    expect(s).toContain("Purwahamba");
  });

  it("lokasi > 6 diringkas dengan penanda sisa", () => {
    const many = { ...ctx, locationNames: Array.from({ length: 9 }, (_, i) => `Lokasi${i}`) };
    expect(describePackageContext(many)).toContain("+3 lokasi lain");
  });

  it("field opsional kosong tidak memunculkan label kosong", () => {
    const minimal: PackageContext = {
      packageName: "Paket A",
      packageNumber: null,
      workTitle: null,
      vendorName: null,
      waGroupName: null,
      locationNames: [],
    };
    const s = describePackageContext(minimal);
    expect(s).toBe("Paket: Paket A");
  });

  it("shortPackageTitle pakai judul pekerjaan bila ada", () => {
    expect(shortPackageTitle(ctx)).toContain("—");
    expect(shortPackageTitle({ ...ctx, workTitle: null })).toBe("KNMP Jawa Tengah & DIY");
  });
});

describe("isNoiseMessage", () => {
  it("menyaring uji webhook/sistem", () => {
    expect(isNoiseMessage("Test webhook MARLIN")).toBe(true);
    expect(isNoiseMessage("webhook aktif")).toBe(true);
    expect(isNoiseMessage("uji sistem")).toBe(true);
    expect(isNoiseMessage("MARLIN test")).toBe(true);
  });

  it("menyaring basa-basi satu kata & pesan kosong", () => {
    expect(isNoiseMessage("test")).toBe(true);
    expect(isNoiseMessage("  Oke ")).toBe(true);
    expect(isNoiseMessage("siap")).toBe(true);
    expect(isNoiseMessage("...")).toBe(true);
    expect(isNoiseMessage("   ")).toBe(true);
  });

  it("TIDAK menyaring pesan operasional asli (konservatif)", () => {
    expect(isNoiseMessage("Sudah komunikasi dengan Kades Purwahamba?")).toBe(false);
    expect(isNoiseMessage("Material urug belum datang, besok dicek lagi")).toBe(false);
    expect(isNoiseMessage("Siap pak, besok saya dampingi ke lokasi")).toBe(false);
    expect(isNoiseMessage("Ok besok kita mulai pengecoran")).toBe(false);
    // "test" sebagai bagian kalimat teknis nyata tidak dibuang
    expect(isNoiseMessage("Hasil test beton sudah keluar, mutu K-250")).toBe(false);
  });

  it("pesan sistem sendiri yang sangat pendek disaring", () => {
    expect(isNoiseMessage("ok", { fromMe: true })).toBe(true);
    expect(isNoiseMessage("Laporan harian sudah dikirim", { fromMe: true })).toBe(false);
  });
});

describe("buildTranscript", () => {
  const lines = [
    { timeLabel: "08:00", fromName: "Budi", body: "Mulai pengecoran", hasMedia: false },
    { timeLabel: "09:00", fromName: "Rheza", body: "Foto progres", hasMedia: true },
  ];

  it("susun transkrip lengkap bila muat", () => {
    const r = buildTranscript(lines, 10_000);
    expect(r.truncated).toBe(false);
    expect(r.used).toBe(2);
    expect(r.transcript).toContain("[08:00] Budi: Mulai pengecoran");
    expect(r.transcript).toContain("[media]");
  });

  it("berhenti & tandai truncated bila melebihi batas", () => {
    const r = buildTranscript(lines, 30);
    expect(r.truncated).toBe(true);
    expect(r.used).toBeLessThan(2);
  });
});

describe("format pesan WhatsApp", () => {
  it("ringkasan satu grup memuat judul, tanggal, jumlah pesan, dan disclaimer", () => {
    const wa = formatSummaryForWa("Paket A — Pekerjaan X", "Minggu, 26 Juli 2026", "Isi ringkasan.", 12);
    expect(wa).toContain("*Ringkasan Chat Grup — Paket A — Pekerjaan X*");
    expect(wa).toContain("Minggu, 26 Juli 2026 · 12 pesan");
    expect(wa).toContain("Isi ringkasan.");
    expect(wa).toContain("verifikasi manusia");
  });

  it("ringkasan global menggabungkan banyak grup + pengantar opsional", () => {
    const wa = formatGlobalSummaryForWa(
      "Minggu, 26 Juli 2026",
      [
        { title: "Paket A", summaryText: "Ringkasan A", messageCount: 5 },
        { title: "Paket B", summaryText: "Ringkasan B", messageCount: 8 },
      ],
      "Dua paket berjalan; Paket B perlu perhatian.",
    );
    expect(wa).toContain("Lintas Paket");
    expect(wa).toContain("Dua paket berjalan");
    expect(wa).toContain("*Paket A* (5 pesan)");
    expect(wa).toContain("*Paket B* (8 pesan)");
  });

  it("ringkasan global tanpa pengantar tetap valid", () => {
    const wa = formatGlobalSummaryForWa("26 Juli 2026", [{ title: "P", summaryText: "S", messageCount: 1 }], null);
    expect(wa).toContain("*P* (1 pesan)");
  });
});
