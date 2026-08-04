// STATUS FOTO = TURUNAN laporan/kegiatan induknya (DECISIONS 250).
//
// Keluhan user 2026-08-04: "semua foto menunggu review, padahal laporan sudah
// difinalkan." Penyebabnya `Photo.verification` HANYA pernah ditulis `pending`
// saat unggah — tidak ada aksi, UI, maupun capability yang menaikkannya. Jadi
// badge "Menunggu Review" bukan menyatakan keadaan; ia satu-satunya nilai yang
// mungkin.
//
// Yang dikunci berkas ini adalah ATURAN TURUNANNYA. Cacat semacam "status
// diambil dari kolom yang tidak pernah berubah" tidak menimbulkan galat apa
// pun — layarnya tetap tampil rapi, cuma isinya selalu sama — jadi hanya uji
// yang menyatakan arti tiap status yang bisa menahannya kembali.
import { describe, expect, it } from "vitest";
import {
  PHOTO_STATUS_LABEL,
  PHOTO_STATUS_ORDER,
  PHOTO_STATUS_TONE,
  deriveStatusFoto,
  type PhotoStatus,
} from "@/lib/photo-status";

describe("foto milik LAPORAN HARIAN", () => {
  it("laporan final → Terverifikasi (inti keluhannya)", () => {
    expect(deriveStatusFoto({ reportStatus: "final" })).toBe("terverifikasi");
  });

  it("laporan DISETUJUI juga Terverifikasi, tidak menunggu final", () => {
    // Penyetujuan adalah momen seseorang berwenang membaca laporan berikut
    // lampirannya; `final` sesudahnya cuma penguncian. Menunggu `final` saja
    // akan menahan foto yang sebetulnya sudah diperiksa.
    expect(deriveStatusFoto({ reportStatus: "disetujui" })).toBe("terverifikasi");
  });

  it("laporan dikirim → Menunggu Review", () => {
    expect(deriveStatusFoto({ reportStatus: "dikirim" })).toBe("menunggu_review");
  });

  it("laporan perlu koreksi TIDAK disamarkan jadi menunggu review", () => {
    // Bedanya penting bagi Site Manager: "menunggu review" itu antrean orang
    // lain, "perlu koreksi" itu pekerjaan dia sendiri.
    expect(deriveStatusFoto({ reportStatus: "perlu_koreksi" })).toBe("perlu_koreksi");
  });

  it("laporan draft → Draft, bukan Menunggu Review", () => {
    expect(deriveStatusFoto({ reportStatus: "draft" })).toBe("draft");
  });
});

describe("foto milik KEGIATAN LAPANGAN", () => {
  it("kegiatan final → Terverifikasi", () => {
    expect(deriveStatusFoto({ activityStatus: "final" })).toBe("terverifikasi");
  });

  it("kegiatan draft → Draft", () => {
    expect(deriveStatusFoto({ activityStatus: "draft" })).toBe("draft");
  });
});

describe("kasus tepi", () => {
  it("LAPORAN menang bila foto menempel ke keduanya", () => {
    // Laporan punya siklus persetujuan berjenjang; kegiatan hanya draft/final.
    // Kalau kegiatan yang menang, foto laporan yang masih perlu koreksi bisa
    // tampil "Terverifikasi" hanya karena kegiatannya sudah dikunci.
    expect(
      deriveStatusFoto({ reportStatus: "perlu_koreksi", activityStatus: "final" }),
    ).toBe("perlu_koreksi");
    expect(deriveStatusFoto({ reportStatus: "draft", activityStatus: "final" })).toBe("draft");
  });

  it("tanpa induk → 'lepas', bukan diam-diam jadi Draft", () => {
    // Foto yatim adalah data yang perlu ditelusuri. Menyamarkannya jadi Draft
    // membuatnya lenyap ke dalam kelompok yang wajar.
    expect(deriveStatusFoto({})).toBe("lepas");
    expect(deriveStatusFoto({ reportStatus: null, activityStatus: null })).toBe("lepas");
  });
});

describe("kelengkapan label & tone", () => {
  const SEMUA: PhotoStatus[] = [
    "terverifikasi",
    "menunggu_review",
    "perlu_koreksi",
    "draft",
    "lepas",
  ];

  it("tiap status punya label dan tone", () => {
    // Status tanpa label akan tampil sebagai `undefined` di badge — bukan galat,
    // cuma badge kosong yang mudah lolos dari pandangan.
    for (const s of SEMUA) {
      expect(PHOTO_STATUS_LABEL[s], s).toBeTruthy();
      expect(PHOTO_STATUS_TONE[s], s).toBeTruthy();
    }
  });

  it("chip filter TIDAK menawarkan 'lepas'", () => {
    // Bukan pilihan yang berguna bagi pengguna; ia keadaan yang tak seharusnya
    // ada, dan menawarkannya sebagai filter menormalkannya.
    expect(PHOTO_STATUS_ORDER).not.toContain("lepas");
    expect(PHOTO_STATUS_ORDER).toEqual([
      "menunggu_review",
      "terverifikasi",
      "perlu_koreksi",
      "draft",
    ]);
  });
});
