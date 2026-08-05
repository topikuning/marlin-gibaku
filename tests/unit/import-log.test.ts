import { describe, expect, it } from "vitest";
import { LABEL_JENIS_IMPOR, LABEL_STATUS_IMPOR, TONE_STATUS_IMPOR, ringkasImpor } from "@/lib/import-log/labels";
import { statusDari, type BarisImpor } from "@/lib/import-log/labels";

/**
 * Status impor DITURUNKAN dari hitungan baris, bukan diminta dari pemanggil.
 * Kalau pemanggil yang menentukan, cepat atau lambat akan ada impor berlabel
 * "berhasil" yang berdampingan dengan ratusan baris tertolak — dan label itulah
 * yang dibaca orang, bukan angkanya.
 *
 * Yang diuji adalah fungsi YANG DIPAKAI produksi (`labels.ts`), bukan salinan
 * aturannya — uji yang menyalin implementasinya tidak menguji apa pun.
 */

describe("jejak impor", () => {
  it("nol baris diterima = gagal, walau berkasnya terbaca", () => {
    expect(statusDari(120, 0, 120)).toBe("gagal");
    expect(statusDari(120, 0, 0)).toBe("gagal");
  });

  it("ada yang tertolak = sebagian, bukan berhasil", () => {
    expect(statusDari(120, 118, 2)).toBe("sebagian");
  });

  it("semua masuk = berhasil", () => {
    expect(statusDari(120, 120, 0)).toBe("berhasil");
    // Berkas kosong yang tidak menolak apa pun bukan kegagalan.
    expect(statusDari(0, 0, 0)).toBe("berhasil");
  });

  it("setiap jenis & status punya label Indonesia dan tone", () => {
    for (const [k, v] of Object.entries(LABEL_JENIS_IMPOR)) {
      expect(v.trim(), `label kosong untuk ${k}`).toBeTruthy();
    }
    for (const [k, v] of Object.entries(LABEL_STATUS_IMPOR)) {
      expect(v.trim(), `label kosong untuk ${k}`).toBeTruthy();
      expect(TONE_STATUS_IMPOR[k as keyof typeof TONE_STATUS_IMPOR], `tone kosong untuk ${k}`).toBeTruthy();
    }
  });

  it("ringkasan menghitung yang tidak mulus, bukan hanya total", () => {
    const baris = (over: Partial<BarisImpor>): BarisImpor => ({
      id: "x",
      kind: "rab",
      status: "berhasil",
      fileName: "a.xlsx",
      fileBytes: 1,
      rowsRead: 10,
      rowsAccepted: 10,
      rowsRejected: 0,
      message: null,
      startedAt: new Date(0),
      olehNama: null,
      lokasiNama: null,
      jumlahMasalah: 0,
      ...over,
    });
    const r = ringkasImpor([
      baris({}),
      baris({ status: "sebagian", rowsAccepted: 8, rowsRejected: 2 }),
      baris({ status: "gagal", rowsAccepted: 0, rowsRejected: 10 }),
    ]);
    expect(r.total).toBe(3);
    expect(r.bermasalah).toBe(2);
    expect(r.barisTertolak).toBe(12);
    expect(r.barisDiterima).toBe(18);
  });
});
