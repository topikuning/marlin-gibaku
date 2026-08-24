// Smoke test PDF register temuan & laporan kesiapan (DECISIONS 426):
// builder menghasilkan PDF sah dari data contoh, termasuk keadaan kosong dan
// daftar panjang yang memaksa pindah halaman. Angkanya tidak dihitung di sini
// — builder hanya menuangkan.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { buildTemuanRegisterPdf } = await import("@/lib/pdf/temuan-register");
const { buildKesiapanPdf } = await import("@/lib/pdf/kesiapan");
import type { BarisTemuan } from "@/lib/findings/queries";
import type { KesiapanPaket } from "@/lib/kesiapan/builder";

const baris = (n: number): BarisTemuan => ({
  id: `id-${n}`,
  title: `Temuan nomor ${n} dengan judul yang cukup panjang supaya membungkus baris`,
  status: n % 2 ? "ditindaklanjuti" : "menunggu_verifikasi",
  severity: n % 3 ? "sedang" : "kritis",
  category: "mutu",
  locationId: "loc",
  locationName: "Kedungmutih",
  locationSlug: "kedungmutih",
  findingDate: new Date("2026-08-01T00:00:00Z"),
  dueDate: new Date("2026-08-10T00:00:00Z"),
  lewatTenggat: n % 4 === 0,
  reopenCount: n % 5 === 0 ? 1 : 0,
  assignedName: "Slamet Riyadi",
  buktiCount: n,
  raisedByName: "Andi Wakil PPK",
});

describe("buildTemuanRegisterPdf", () => {
  it("PDF sah untuk daftar kosong dan daftar panjang (pindah halaman)", async () => {
    for (const jumlah of [0, 80]) {
      const buf = await buildTemuanRegisterPdf(
        Array.from({ length: jumlah }, (_, i) => baris(i + 1)),
        "Penguji",
      );
      expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
      expect(buf.length).toBeGreaterThan(1000);
    }
  });
});

describe("buildKesiapanPdf", () => {
  it("PDF sah untuk portofolio kosong dan berisi", async () => {
    const paket: KesiapanPaket = {
      packageId: "p1",
      packageName: "Paket KNMP Jateng 1",
      stage: "pelaksanaan",
      progressDilaporkanPct: 45.6,
      progressTerverifikasiPct: 41.2,
      lokasi: [{ id: "l1", name: "Kedungmutih", slug: "kedungmutih", status: "berjalan" }],
      kartu: [
        {
          jenis: "termin",
          judul: "Kesiapan Termin",
          verdict: "belum_siap",
          syarat: [
            { key: "progress", label: "Progress terverifikasi >= 50%", status: "gagal", detail: "Terverifikasi 41,2% belum mencapai ambang 50%." },
            { key: "temuan", label: "Temuan kritis terbuka", status: "lolos", detail: "Tidak ada temuan kritis terbuka." },
            { key: "dok", label: "Dokumen fase pembayaran", status: "peringatan", detail: "2 milestone belum lengkap." },
          ],
        },
      ],
    };
    for (const daftar of [[], [paket]]) {
      const buf = await buildKesiapanPdf(daftar, "Penguji");
      expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
      expect(buf.length).toBeGreaterThan(1000);
    }
  });
});
