// Mesin kesiapan termin/PHO/FHO — rule murni (DECISIONS 426).
import { describe, expect, it } from "vitest";
import {
  AMBANG_TERMIN_PCT,
  ambangTerminBerikutnya,
  KESIAPAN_VERDICT_LABEL,
  pctMencukupi,
  verdictDariSyarat,
  type Syarat,
} from "@/lib/kesiapan/rules";
import { VERIFIED_REPORT_STATUSES, COUNTED_REPORT_STATUSES } from "@/lib/lifecycle";

const s = (status: Syarat["status"]): Syarat => ({ key: "k", label: "l", status, detail: "d" });

describe("verdictDariSyarat", () => {
  it("semua lolos → siap", () => {
    expect(verdictDariSyarat([s("lolos"), s("lolos")])).toBe("siap");
  });
  it("ada peringatan tanpa gagal → siap dengan catatan", () => {
    expect(verdictDariSyarat([s("lolos"), s("peringatan")])).toBe("siap_catatan");
  });
  it("SATU gagal saja → belum siap, walau sisanya lolos", () => {
    expect(verdictDariSyarat([s("lolos"), s("peringatan"), s("gagal")])).toBe("belum_siap");
  });
  it("labelnya bahasa manusia, bukan kode", () => {
    expect(KESIAPAN_VERDICT_LABEL.belum_siap).toBe("Belum siap");
  });
});

describe("ambang termin (DECISIONS 078: 25/50/80/100)", () => {
  it("belum ada termin → termin ke-1 ambang 25%", () => {
    expect(ambangTerminBerikutnya(0)).toEqual({ terminKe: 1, ambangPct: 25 });
  });
  it("dua termin terpakai → termin ke-3 ambang 80%", () => {
    expect(ambangTerminBerikutnya(2)).toEqual({ terminKe: 3, ambangPct: 80 });
  });
  it("semua termin terpakai → null (tidak ada termin berikutnya)", () => {
    expect(ambangTerminBerikutnya(AMBANG_TERMIN_PCT.length)).toBeNull();
  });
});

describe("pctMencukupi", () => {
  it("toleransi pembulatan: 99,999% dianggap mencapai 100%", () => {
    expect(pctMencukupi(99.999, 100)).toBe(true);
    expect(pctMencukupi(99.9, 100)).toBe(false);
  });
  it("di bawah ambang jelas tidak lolos", () => {
    expect(pctMencukupi(49.996, 50)).toBe(true); // dalam toleransi 0,005
    expect(pctMencukupi(49.99, 50)).toBe(false);
  });
});

describe("level status progress (CIP)", () => {
  it("terverifikasi = disetujui+final, subset ketat dari dilaporkan", () => {
    expect([...VERIFIED_REPORT_STATUSES]).toEqual(["disetujui", "final"]);
    for (const st of VERIFIED_REPORT_STATUSES) {
      expect(COUNTED_REPORT_STATUSES).toContain(st);
    }
    expect(COUNTED_REPORT_STATUSES).toContain("dikirim");
    expect(VERIFIED_REPORT_STATUSES).not.toContain("dikirim");
  });
});
