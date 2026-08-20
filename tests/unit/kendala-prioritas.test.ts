import { describe, expect, it } from "vitest";
import {
  bandingKendala,
  lewatTenggat,
  terbengkalai,
  urutkanKendala,
} from "@/lib/kendala/prioritas";

/**
 * PRIORITAS KENDALA (DECISIONS 392).
 *
 * Keberatan user 2026-08-20: *"setelah dicatat tidak ada tindak lanjut"*.
 * Papan kendala hanya berguna kalau yang paling perlu ditagih benar-benar ada
 * di atas — dan urutan itu sekarang ditulis SEKALI, dipakai papan, dashboard,
 * dan pengingat WhatsApp.
 */

const HARI_INI = new Date("2026-08-20T00:00:00.000Z");
const kemarin = new Date("2026-08-19T00:00:00.000Z");
const besok = new Date("2026-08-21T00:00:00.000Z");

const buat = (o: Partial<Parameters<typeof bandingKendala>[0]> = {}) => ({
  severity: "sedang" as const,
  status: "terbuka" as const,
  dueDate: null,
  recoveryStatus: null,
  picUserId: null,
  picName: null,
  ...o,
});

describe("lewatTenggat", () => {
  it("tenggat kemarin dan belum selesai = terlambat", () => {
    expect(lewatTenggat(buat({ dueDate: kemarin }), HARI_INI)).toBe(true);
  });

  it("tenggat besok belum terlambat", () => {
    expect(lewatTenggat(buat({ dueDate: besok }), HARI_INI)).toBe(false);
  });

  it("tanpa tenggat tidak pernah terlambat – tidak ada janji yang dilanggar", () => {
    expect(lewatTenggat(buat({ dueDate: null }), HARI_INI)).toBe(false);
  });

  it("yang SUDAH selesai tidak pernah terlambat, berapa pun tenggatnya", () => {
    /*
     * Menandainya merah sesudah selesai membuat papan penuh peringatan yang
     * tidak menuntut apa pun – dan peringatan seperti itu berhenti dibaca.
     */
    expect(lewatTenggat(buat({ status: "selesai", dueDate: kemarin }), HARI_INI)).toBe(false);
  });
});

describe("terbengkalai", () => {
  it("tanpa PIC dan tanpa tenggat = terbengkalai", () => {
    // Persis keadaan empat kendala di tangkapan layar user.
    expect(terbengkalai(buat())).toBe(true);
  });

  it("punya PIC pengguna → tidak terbengkalai", () => {
    expect(terbengkalai(buat({ picUserId: "u1" }))).toBe(false);
  });

  it("punya PIC nama bebas → tidak terbengkalai", () => {
    // PIC pihak ketiga (PLN, pemilik lahan) tetap pemilik, walau tidak bisa
    // dikirimi pengingat.
    expect(terbengkalai(buat({ picName: "PLN Rayon Banyuwangi" }))).toBe(false);
  });

  it("punya tenggat saja → tidak terbengkalai", () => {
    expect(terbengkalai(buat({ dueDate: besok }))).toBe(false);
  });

  it("yang selesai tidak pernah terbengkalai", () => {
    expect(terbengkalai(buat({ status: "selesai" }))).toBe(false);
  });
});

describe("urutan papan kendala", () => {
  it("LEWAT TENGGAT menang atas tingkat yang lebih parah", () => {
    /*
     * Kendala "rendah" yang tenggatnya lewat seminggu sudah membuktikan
     * dirinya tidak tertangani; "kritis" yang tenggatnya besok masih punya
     * kesempatan.
     */
    const hasil = urutkanKendala(
      [
        buat({ severity: "kritis", dueDate: besok }),
        buat({ severity: "rendah", dueDate: kemarin }),
      ],
      HARI_INI,
    );
    expect(hasil[0].severity).toBe("rendah");
  });

  it("TERBENGKALAI menang atas yang sudah punya pemilik", () => {
    const hasil = urutkanKendala(
      [
        buat({ severity: "kritis", picUserId: "u1", dueDate: besok }),
        buat({ severity: "rendah" }), // tanpa PIC, tanpa tenggat
      ],
      HARI_INI,
    );
    expect(hasil[0].severity).toBe("rendah");
  });

  it("sesudah itu barulah tingkat", () => {
    const hasil = urutkanKendala(
      [
        buat({ severity: "sedang", picUserId: "u1", dueDate: besok }),
        buat({ severity: "kritis", picUserId: "u1", dueDate: besok }),
      ],
      HARI_INI,
    );
    expect(hasil[0].severity).toBe("kritis");
  });

  it("tingkat sama → tenggat terdekat dulu", () => {
    const lusa = new Date("2026-08-22T00:00:00.000Z");
    const hasil = urutkanKendala(
      [
        buat({ picUserId: "u1", dueDate: lusa }),
        buat({ picUserId: "u1", dueDate: besok }),
      ],
      HARI_INI,
    );
    expect(hasil[0].dueDate).toEqual(besok);
  });

  it("tidak mengubah larik aslinya", () => {
    const rows = [buat({ severity: "rendah" }), buat({ severity: "kritis" })];
    const salinan = [...rows];
    urutkanKendala(rows, HARI_INI);
    expect(rows).toEqual(salinan);
  });
});
