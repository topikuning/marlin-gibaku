import { describe, expect, it } from "vitest";
import { klasifikasiAudit } from "../../scripts/audit-hasil.mjs";

/**
 * PENJAGA AUDIT KEAMANAN TIDAK BOLEH MENUDUH.
 *
 * CI 2026-09-04 memerahkan PR dengan "Security audit menemukan kerentanan
 * high-severity" padahal endpoint advisories npm yang tidak menjawab. Penjaga
 * lama cuma mengenali satu bentuk kegagalan endpoint; sisanya jatuh ke cabang
 * "ada kerentanan".
 *
 * Dua kesalahan yang dijaga di sini, dan keduanya mahal dengan cara berbeda:
 * menuduh kerentanan yang tidak ada membuat orang berhenti memercayai pesannya
 * — dan begitu itu terjadi, temuan yang ASLI ikut tidak dipercaya. Sebaliknya,
 * meloloskan kerentanan sungguhan sebagai "gangguan jaringan" persis kegagalan
 * yang audit ini ada untuk mencegahnya.
 */

const TEMUAN_ASLI = `
┌───────────────┬──────────────────────────────────────────────────────────────┐
│ high          │ Prototype pollution in xyz                                   │
└───────────────┴──────────────────────────────────────────────────────────────┘
1 vulnerabilities found
Severity: 1 high
`;

const TIMEOUT_NPM = `
[WARN] POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk error (23). Will retry in 10 seconds. 2 retries left.
[23] The operation was aborted due to timeout

TimeoutError: The operation was aborted due to timeout
    at new DOMException (node:internal/per_context/domexception:76:18)
`;

describe("klasifikasi hasil audit keamanan", () => {
  it("keluar 0 = aman", () => {
    expect(klasifikasiAudit("", 0)).toBe("aman");
    expect(klasifikasiAudit(TIMEOUT_NPM, 0)).toBe("aman");
  });

  it("timeout endpoint npm BUKAN kerentanan", () => {
    expect(klasifikasiAudit(TIMEOUT_NPM, 1)).toBe("endpoint");
  });

  it("bentuk lama (ERR_PNPM_AUDIT_BAD_RESPONSE) tetap dikenali", () => {
    expect(klasifikasiAudit("ERR_PNPM_AUDIT_BAD_RESPONSE  Bad response", 1)).toBe("endpoint");
  });

  it("gangguan jaringan lain juga dikenali", () => {
    for (const teks of [
      "request to https://registry.npmjs.org/-/npm/v1/security/advisories/bulk failed, reason: socket hang up",
      "FetchError: getaddrinfo EAI_AGAIN registry.npmjs.org",
      "ERR_PNPM_FETCH_503  GET https://registry.npmjs.org/…: Service Unavailable",
      "Error: connect ECONNRESET 104.16.0.35:443",
    ]) {
      expect(klasifikasiAudit(teks, 1), teks).toBe("endpoint");
    }
  });

  it("temuan sungguhan tetap merah", () => {
    expect(klasifikasiAudit(TEMUAN_ASLI, 1)).toBe("temuan");
  });

  it("temuan yang datang BERSAMA keluhan jaringan tetap merah", () => {
    expect(klasifikasiAudit(`${TIMEOUT_NPM}\n${TEMUAN_ASLI}`, 1)).toBe("temuan");
  });

  it("kegagalan yang tidak dikenali dianggap temuan – bawaan yang aman", () => {
    expect(klasifikasiAudit("sesuatu yang belum pernah kita lihat", 1)).toBe("temuan");
    expect(klasifikasiAudit("", 1)).toBe("temuan");
  });
});
