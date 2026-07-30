import { describe, expect, it } from "vitest";
import {
  documentDisplayName,
  documentDisplayNames,
  documentSequence,
} from "../../src/lib/document-label";

/**
 * Nama tampilan dokumen: diturunkan dari data, bukan judul yang diketik.
 * Yang diuji adalah properti yang membuat daftar dokumen bisa dibedakan —
 * bukan string persisnya, kecuali di kasus format inti.
 */

const d = (iso: string) => new Date(iso);

describe("documentDisplayName", () => {
  it("merangkai istilah · lokasi · tanggal · nomor", () => {
    const { name } = documentDisplayName({
      type: "spmk",
      locationName: "Kedungrejo",
      docDate: d("2026-05-12T00:00:00Z"),
      docNumber: "027/PPK-KNMP/V/2026",
    });
    expect(name).toBe("SPMK · Kedungrejo · 12 Mei 2026 · No. 027/PPK-KNMP/V/2026");
  });

  it("memakai nama paket bila dokumen tidak tertaut lokasi", () => {
    const { name } = documentDisplayName({ type: "kontrak", packageName: "KNMP Jawa Timur 1" });
    expect(name).toBe("Kontrak · KNMP Jawa Timur 1");
  });

  it("tetap memberi nama walau hanya jenis dokumen yang diketahui", () => {
    expect(documentDisplayName({ type: "pcm" }).name).toBe("PCM");
  });

  it("menandai berkas ke-n hanya bila grupnya lebih dari satu", () => {
    const base = { type: "pcm", locationName: "Pesisir" } as const;
    expect(documentDisplayName({ ...base, index: 2, total: 3 }).name).toContain("(berkas 2/3)");
    expect(documentDisplayName({ ...base, index: 1, total: 1 }).name).not.toContain("berkas");
  });

  it("memendekkan nomor dokumen yang kepanjangan", () => {
    const { name } = documentDisplayName({
      type: "invoice",
      docNumber: "INV/KNMP/2026/VII/0001-REVISI-KEDUA-SETELAH-CCO",
    });
    expect(name).toContain("…");
    expect(name.length).toBeLessThan(60);
  });

  describe("judul pengunggah jadi keterangan sekunder", () => {
    it("dibuang bila hanya mengulang jenis dokumen", () => {
      expect(documentDisplayName({ type: "spmk", title: "SPMK" }).secondary).toBeNull();
      expect(
        documentDisplayName({ type: "pcm", title: "PCM (Pre-Construction Meeting)" }).secondary,
      ).toBeNull();
    });

    it("dibuang bila sudah termuat di nama turunan", () => {
      expect(
        documentDisplayName({ type: "spmk", locationName: "Kedungrejo", title: "SPMK Kedungrejo" })
          .secondary,
      ).toBeNull();
    });

    it("dibuang bila judul asal-asalan hasil scan", () => {
      for (const title of ["scan", "Scan 001", "dokumen", "IMG_0231", "untitled"]) {
        expect(documentDisplayName({ type: "lainnya", title }).secondary).toBeNull();
      }
    });

    it("dipertahankan bila menambah informasi", () => {
      const { secondary } = documentDisplayName({
        type: "surat_kendala",
        locationName: "Pesisir",
        title: "Kendala akses jalan material batu",
      });
      expect(secondary).toBe("Kendala akses jalan material batu");
    });
  });
});

describe("documentSequence", () => {
  const row = (id: string, over: Partial<Parameters<typeof documentSequence>[0][number]> = {}) => ({
    id,
    type: "pcm" as const,
    locationId: "loc-1",
    docNumber: null,
    docDate: d("2026-05-12T00:00:00Z"),
    uploadedAt: d("2026-05-12T03:00:00Z"),
    ...over,
  });

  it("menomori berkas sejenis pada konteks sama menurut waktu unggah", () => {
    const seq = documentSequence([
      row("c", { uploadedAt: d("2026-05-12T05:00:00Z") }),
      row("a", { uploadedAt: d("2026-05-12T03:00:00Z") }),
      row("b", { uploadedAt: d("2026-05-12T04:00:00Z") }),
    ]);
    expect(seq.get("a")).toEqual({ index: 1, total: 3 });
    expect(seq.get("b")).toEqual({ index: 2, total: 3 });
    expect(seq.get("c")).toEqual({ index: 3, total: 3 });
  });

  it("berkas tunggal bertotal 1 (tidak diberi penanda di label)", () => {
    expect(documentSequence([row("a")]).get("a")).toEqual({ index: 1, total: 1 });
  });

  it("tidak menggabungkan lokasi, jenis, tanggal, atau nomor yang berbeda", () => {
    const seq = documentSequence([
      row("a"),
      row("b", { locationId: "loc-2" }),
      row("c", { type: "mc0" }),
      row("d", { docDate: d("2026-05-13T00:00:00Z") }),
      row("e", { docNumber: "12/X" }),
    ]);
    for (const id of ["a", "b", "c", "d", "e"]) expect(seq.get(id)!.total).toBe(1);
  });

  it("nomor berkas lama tidak bergeser saat berkas baru masuk", () => {
    const lama = [row("a", { uploadedAt: d("2026-05-12T03:00:00Z") })];
    const baru = [...lama, row("b", { uploadedAt: d("2026-05-12T09:00:00Z") })];
    expect(documentSequence(lama).get("a")!.index).toBe(1);
    expect(documentSequence(baru).get("a")!.index).toBe(1);
    expect(documentSequence(baru).get("b")!.index).toBe(2);
  });

  it("dokumen level paket dikelompokkan per paket bila tanpa lokasi", () => {
    const seq = documentSequence([
      row("a", { locationId: null, packageId: "pkg-1" }),
      row("b", { locationId: null, packageId: "pkg-1" }),
      row("c", { locationId: null, packageId: "pkg-2" }),
    ]);
    expect(seq.get("a")!.total).toBe(2);
    expect(seq.get("c")!.total).toBe(1);
  });
});

describe("documentDisplayNames", () => {
  it("memberi label lengkap sekaligus penanda berkas untuk satu daftar", () => {
    const labels = documentDisplayNames([
      {
        id: "a",
        type: "pcm",
        locationId: "loc-1",
        locationName: "Kedungrejo",
        docDate: d("2026-05-12T00:00:00Z"),
        uploadedAt: d("2026-05-12T03:00:00Z"),
        title: "scan",
      },
      {
        id: "b",
        type: "pcm",
        locationId: "loc-1",
        locationName: "Kedungrejo",
        docDate: d("2026-05-12T00:00:00Z"),
        uploadedAt: d("2026-05-12T04:00:00Z"),
        title: "lampiran daftar hadir",
      },
    ]);
    expect(labels.get("a")!.name).toBe("PCM · Kedungrejo · 12 Mei 2026 (berkas 1/2)");
    expect(labels.get("a")!.secondary).toBeNull();
    expect(labels.get("b")!.name).toBe("PCM · Kedungrejo · 12 Mei 2026 (berkas 2/2)");
    expect(labels.get("b")!.secondary).toBe("lampiran daftar hadir");
  });
});
