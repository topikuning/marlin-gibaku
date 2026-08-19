import { describe, expect, it } from "vitest";
import {
  alasanDilewati,
  classifyDriveFile,
  extractDocDate,
  matchLocation,
  phaseForType,
} from "../../src/lib/gdrive/classify";
import { ALL_DOC_TYPES } from "../../src/lib/documents-meta";

/**
 * Klasifikasi berkas Drive KKP. Nama-nama file di sini mengikuti pola penamaan
 * berkas KKP yang berjalan (SPMK, BA PCM, MC-0, BAST-1, laporan mingguan, dst).
 * Tebakan salah tidak fatal — manusia mengoreksi di pratinjau — tapi tebakan
 * yang KELIRU SISTEMATIS (mis. semua isi folder 1 dianggap kontrak) membuat
 * impor tak berguna, jadi diuji.
 */

const FOLDER_1 = ["1. SPPBJ, SPK, SPMK, RAB, DED"];
const FOLDER_2 = ["2. PCM"];
const FOLDER_7 = ["7. BERKAS TERMIN"];

describe("classifyDriveFile – nama berkas menang atas folder", () => {
  const kasus: { file: string; path: string[]; type: string }[] = [
    { file: "SPMK Kedungrejo.pdf", path: FOLDER_1, type: "spmk" },
    { file: "SPPBJ-027-2026.pdf", path: FOLDER_1, type: "sppbj" },
    { file: "Surat Perjanjian Kontrak Kedungrejo.pdf", path: FOLDER_1, type: "kontrak" },
    { file: "RAB Kedungrejo final.xlsx", path: FOLDER_1, type: "hps" },
    { file: "DED Kedungrejo.pdf", path: FOLDER_1, type: "ded" },
    { file: "Jaminan Pelaksanaan Bank Jatim.pdf", path: FOLDER_1, type: "jaminan" },
    { file: "BA PCM 12 Mei 2026.pdf", path: FOLDER_2, type: "pcm" },
    { file: "BA MC-0 Kedungrejo.pdf", path: FOLDER_2, type: "mc0" },
    { file: "BA Opname termin 1.pdf", path: FOLDER_7, type: "mc_berkala" },
    { file: "Invoice termin 1.pdf", path: FOLDER_7, type: "invoice" },
    { file: "Faktur Pajak termin 1.pdf", path: FOLDER_7, type: "faktur_pajak" },
    { file: "BAST-1 PHO Kedungrejo.pdf", path: FOLDER_7, type: "bast_pho" },
    { file: "BAST-2 FHO Kedungrejo.pdf", path: FOLDER_7, type: "bast_fho" },
    { file: "Adendum 1 Kontrak.pdf", path: FOLDER_1, type: "adendum" },
    { file: "Laporan Mingguan M-03.pdf", path: ["4. LAPORAN MINGGUAN"], type: "laporan" },
    { file: "Shop Drawing dermaga rev2.pdf", path: ["8. SHOP DRAWING"], type: "shop_drawing" },
    { file: "As Built Drawing.pdf", path: ["9. AS BUILT"], type: "as_built" },
    { file: "Surat Peringatan SP-1.pdf", path: FOLDER_1, type: "surat_peringatan" },
  ];

  for (const k of kasus) {
    it(`"${k.file}" → ${k.type}`, () => {
      expect(classifyDriveFile({ fileName: k.file, path: k.path }).type).toBe(k.type);
    });
  }

  it("BAST-2/FHO tidak tertukar dengan BAST-1/PHO", () => {
    expect(classifyDriveFile({ fileName: "BAST 2 FHO.pdf", path: FOLDER_7 }).type).toBe("bast_fho");
    expect(classifyDriveFile({ fileName: "BAST 1.pdf", path: FOLDER_7 }).type).toBe("bast_pho");
  });

  it("MC-0 tidak tertukar dengan MC berkala", () => {
    expect(classifyDriveFile({ fileName: "MC-0.pdf", path: FOLDER_2 }).type).toBe("mc0");
    expect(classifyDriveFile({ fileName: "MC-2 Juni.pdf", path: FOLDER_7 }).type).toBe("mc_berkala");
  });

  it("as built tidak tertukar dengan shop drawing", () => {
    expect(classifyDriveFile({ fileName: "Gambar As-Built.pdf", path: ["8. SHOP DRAWING"] }).type).toBe(
      "as_built",
    );
  });
});

describe("classifyDriveFile – jatuh ke folder & keyakinan", () => {
  it("nama tak bermakna di folder PCM ditebak pcm dengan keyakinan rendah", () => {
    const r = classifyDriveFile({ fileName: "Scan001.pdf", path: FOLDER_2 });
    expect(r.type).toBe("pcm");
    expect(r.keyakinan).toBe("rendah");
    expect(r.alasan).toMatch(/folder/);
  });

  it("nama + folder sepakat → keyakinan tinggi", () => {
    const r = classifyDriveFile({ fileName: "BA PCM.pdf", path: FOLDER_2 });
    expect(r.keyakinan).toBe("tinggi");
  });

  it("nama bicara tapi beda folder → keyakinan sedang, bukan tinggi", () => {
    const r = classifyDriveFile({ fileName: "Invoice termin 2.pdf", path: FOLDER_1 });
    expect(r.type).toBe("invoice");
    expect(r.keyakinan).toBe("sedang");
  });

  it("subfolder bernama jenis dipakai bila nama & folder KKP bungkam", () => {
    const r = classifyDriveFile({ fileName: "dokumen.pdf", path: ["Berkas", "Adendum"] });
    expect(r.type).toBe("adendum");
  });

  it("benar-benar tak terbaca → lainnya, keyakinan rendah, alasan menyuruh pilih manual", () => {
    const r = classifyDriveFile({ fileName: "dokumen.pdf", path: ["Berkas lain"] });
    expect(r.type).toBe("lainnya");
    expect(r.keyakinan).toBe("rendah");
    expect(r.alasan).toMatch(/manual/);
  });

  it("folder KKP dikenali walau ditulis longgar (nomor saja / tanpa titik)", () => {
    for (const seg of ["2. PCM", "2 PCM", "2", "PCM"]) {
      expect(classifyDriveFile({ fileName: "Scan.pdf", path: [seg] }).type).toBe("pcm");
    }
  });
});

describe("phaseForType", () => {
  it("setiap jenis dokumen punya fase kanonik", () => {
    for (const t of ALL_DOC_TYPES) expect(phaseForType(t)).toBeTruthy();
  });

  it("fase mengikuti tahap administrasi, bukan folder", () => {
    expect(phaseForType("spmk")).toBe("mulai_kerja");
    expect(phaseForType("invoice")).toBe("pembayaran");
    expect(phaseForType("bast_pho")).toBe("serah_terima");
    expect(phaseForType("adendum")).toBe("adendum");
  });
});

describe("matchLocation", () => {
  const locations = [
    { id: "l1", name: "Kedungrejo" },
    { id: "l2", name: "Pesisir" },
    { id: "l3", name: "Pesisir Wetan" },
  ];

  it("mengenali desa dari lapisan folder", () => {
    const r = matchLocation({ fileName: "SPMK.pdf", path: ["2. PCM", "Kedungrejo"] }, locations);
    expect(r).toMatchObject({ locationId: "l1", dari: "folder" });
  });

  it("mengenali desa dari nama berkas bila folder tidak menyebut", () => {
    const r = matchLocation({ fileName: "SPMK Pesisir.pdf", path: ["1. SPPBJ, SPK, SPMK, RAB, DED"] }, locations);
    expect(r).toMatchObject({ locationId: "l2", dari: "nama berkas" });
  });

  it("nama desa lebih panjang menang (Pesisir Wetan bukan Pesisir)", () => {
    const r = matchLocation({ fileName: "SPMK Pesisir Wetan.pdf", path: [] }, locations);
    expect(r?.locationId).toBe("l3");
  });

  it("tidak menyambar kata yang cuma mirip", () => {
    expect(matchLocation({ fileName: "SPMK Pesisirwetan.pdf", path: [] }, locations)).toBeNull();
    expect(matchLocation({ fileName: "SPMK.pdf", path: ["2. PCM"] }, locations)).toBeNull();
  });

  it("folder didahulukan atas nama berkas", () => {
    const r = matchLocation({ fileName: "SPMK Pesisir.pdf", path: ["Kedungrejo"] }, locations);
    expect(r).toMatchObject({ locationId: "l1", dari: "folder" });
  });
});

describe("alasanDilewati", () => {
  const didukung = (m: string) => m === "application/pdf";

  it("mengizinkan dokumen yang didukung", () => {
    expect(
      alasanDilewati({ fileName: "SPMK.pdf", mimeType: "application/pdf", path: FOLDER_1, didukung }),
    ).toBeNull();
  });

  it("melewati seluruh folder dokumentasi foto", () => {
    const r = alasanDilewati({
      fileName: "apa saja.pdf",
      mimeType: "application/pdf",
      path: ["6. DOKUMENTASI", "Kedungrejo"],
      didukung,
    });
    expect(r).toMatch(/foto/i);
  });

  it("melewati foto kamera walau di folder dokumen", () => {
    const r = alasanDilewati({
      fileName: "IMG_20260512_101122.jpg",
      mimeType: "image/jpeg",
      path: FOLDER_1,
      didukung: () => true,
    });
    expect(r).toMatch(/foto/i);
  });

  it("melewati jenis berkas tak didukung dengan menyebut mime-nya", () => {
    const r = alasanDilewati({
      fileName: "video.mp4",
      mimeType: "video/mp4",
      path: FOLDER_1,
      didukung,
    });
    expect(r).toMatch(/video\/mp4/);
  });

  it("scan bernama foto tapi dokumen tetap boleh (bukan pola kamera)", () => {
    expect(
      alasanDilewati({
        fileName: "Foto dokumentasi papan nama.pdf",
        mimeType: "application/pdf",
        path: FOLDER_1,
        didukung,
      }),
    ).toBeNull();
  });
});

describe("extractDocDate", () => {
  const key = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

  it("membaca yyyy-mm-dd", () => {
    expect(key(extractDocDate("Laporan Harian 2026-05-12.pdf"))).toBe("2026-05-12");
    expect(key(extractDocDate("2026_05_12 BA PCM.pdf"))).toBe("2026-05-12");
  });

  it("membaca dd-mm-yyyy", () => {
    expect(key(extractDocDate("BA PCM 12-05-2026.pdf"))).toBe("2026-05-12");
    expect(key(extractDocDate("SPMK 01.06.2026.pdf"))).toBe("2026-06-01");
  });

  it("membaca nama bulan Indonesia", () => {
    expect(key(extractDocDate("BA PCM 12 Mei 2026.pdf"))).toBe("2026-05-12");
    expect(key(extractDocDate("Laporan 3 Agustus 2026 final.pdf"))).toBe("2026-08-03");
  });

  it("menolak yang bukan tanggal – lebih baik kosong daripada salah", () => {
    for (const n of [
      "MC-2 termin 1.pdf",
      "Laporan Mingguan M-03.pdf",
      "SPMK 027-PPK-V.pdf",
      "BA 31-02-2026.pdf", // 31 Februari tidak ada
      "dokumen 12-05-1999.pdf", // tahun di luar rentang wajar
    ]) {
      expect(key(extractDocDate(n)), n).toBeNull();
    }
  });
});
