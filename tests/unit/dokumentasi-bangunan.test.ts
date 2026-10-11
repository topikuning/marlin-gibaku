/*
 * DOKUMENTASI FOTO PER BANGUNAN DI DRIVE – LEWAT SHORTCUT (DECISIONS 666).
 *
 * Permintaan user 2026-10-11: dokumentasi foto selain per hari juga per
 * kategori/bangunan, tanpa redundansi berkas. Ketetapan: struktur
 * Lokasi → Bangunan (belum sampai sub-pekerjaan), shortcut saja.
 *
 * Foto aslinya tetap satu di "3. LAPORAN HARIAN/<Lokasi>/<Bulan>/Foto". Di
 * "6. DOKUMENTASI/<Lokasi>/<Bangunan>" hanya ada shortcut ke foto itu.
 */
import { describe, expect, it } from "vitest";
import {
  BANGUNAN_ALAT,
  BANGUNAN_MATERIAL,
  dokumentasiPath,
  namaBangunan,
  namaPintasan,
  rencanaPintasan,
  tautkanTarget,
  type AdaPintasan,
  type InginPintasan,
} from "@/lib/gdrive/dokumentasi-murni";

describe("nama folder & shortcut", () => {
  it("folder bangunan = kode + nama kategori RAB tingkat 1", () => {
    expect(namaBangunan({ code: "III", name: "PEKERJAAN TAMBATAN PERAHU" })).toBe("III PEKERJAAN TAMBATAN PERAHU");
    expect(namaBangunan({ code: "", name: "PEKERJAAN PERSIAPAN" })).toBe("PEKERJAAN PERSIAPAN");
    // Nama yang sudah memuat kodenya tidak diulang.
    expect(namaBangunan({ code: "IV", name: "IV. PEKERJAAN PAGAR" })).toBe("IV. PEKERJAAN PAGAR");
  });

  it("jalur: 6. DOKUMENTASI / Lokasi / Bangunan – garis miring di nama tidak membuat folder baru", () => {
    expect(dokumentasiPath("Kedung Mutih", "II PEKERJAAN BALAI / NELAYAN")).toEqual([
      "6. DOKUMENTASI",
      "Kedung Mutih",
      "II PEKERJAAN BALAI - NELAYAN",
    ]);
  });

  it("nama shortcut: tanggal – pekerjaan – nomor urut foto hari itu", () => {
    expect(namaPintasan("2026-09-27", "Pasangan batu kali", 3)).toBe("2026-09-27 – Pasangan batu kali – 03");
  });

  it("material & peralatan punya folder sendiri", () => {
    expect([BANGUNAN_MATERIAL, BANGUNAN_ALAT]).toEqual(["Material Masuk", "Peralatan"]);
  });
});

describe("tautkanTarget – foto ↔ berkas Drive di folder laporan harian", () => {
  const foto = [
    { id: "f1", r2Key: "foto/a.jpg" },
    { id: "f2", r2Key: "foto/b.jpg" },
  ];
  const ctx = { dateKey: "2026-09-27", locationName: "Kedung Mutih", finalizedAt: new Date("2026-09-27T10:00:00Z") };
  const t = (jam: string) => new Date(`2026-09-27T${jam}:00Z`);

  it("baris unggah ber-photoId dipakai langsung, yang terbaru menang", () => {
    const m = tautkanTarget(foto, [
      { fileName: "2026-09-27 Kedung Mutih 01.jpg", fileId: "lama", photoId: "f1", createdAt: t("11:00") },
      { fileName: "2026-09-27 Kedung Mutih 01.jpg", fileId: "baru", photoId: "f1", createdAt: t("12:00") },
    ], ctx);
    expect(m.get("f1")).toBe("baru");
    expect(m.has("f2")).toBe(false);
  });

  it("unggahan lama tanpa photoId: dicocokkan lewat nama berkas, HANYA bila diunggah sesudah laporan final", () => {
    const rows = [
      { fileName: "2026-09-27 Kedung Mutih 01.jpg", fileId: "d1", photoId: null, createdAt: t("11:00") },
      { fileName: "2026-09-27 Kedung Mutih 02.jpg", fileId: "d2", photoId: null, createdAt: t("09:00") },
    ];
    const m = tautkanTarget(foto, rows, ctx);
    expect(m.get("f1")).toBe("d1");
    // Diunggah SEBELUM final: urutan fotonya bisa sudah berubah – tidak ditebak.
    expect(m.has("f2")).toBe(false);
  });

  it("nama yang kini dipakai foto LAIN (ber-photoId) tidak dipinjam", () => {
    const m = tautkanTarget(foto, [
      { fileName: "2026-09-27 Kedung Mutih 01.jpg", fileId: "x", photoId: "f9", createdAt: t("11:00") },
    ], ctx);
    expect(m.has("f1")).toBe(false);
  });

  it("laporan tanpa waktu final: nama saja tidak cukup", () => {
    const m = tautkanTarget(foto, [
      { fileName: "2026-09-27 Kedung Mutih 01.jpg", fileId: "d1", photoId: null, createdAt: t("11:00") },
    ], { ...ctx, finalizedAt: null });
    expect(m.size).toBe(0);
  });
});

describe("rencanaPintasan – apa yang harus dikerjakan di Drive", () => {
  const ingin = (o: Partial<InginPintasan> = {}): InginPintasan => ({
    photoId: "f1",
    targetId: "d1",
    bangunan: "II BALAI NELAYAN",
    nama: "2026-09-27 – Pasangan batu – 01",
    ...o,
  });
  const ada = (o: Partial<AdaPintasan> = {}): AdaPintasan => ({
    photoId: "f1",
    targetId: "d1",
    shortcutId: "s1",
    folderId: "fd",
    bangunan: "II BALAI NELAYAN",
    nama: "2026-09-27 – Pasangan batu – 01",
    ...o,
  });
  const jenis = (a: ReturnType<typeof rencanaPintasan>) => a.map((x) => `${x.jenis}:${"ingin" in x ? x.ingin.photoId : x.lama.photoId}`);

  it("belum ada → buat", () => {
    expect(jenis(rencanaPintasan([ingin()], []))).toEqual(["buat:f1"]);
  });

  it("sama persis → tidak ada pekerjaan (tidak membuat dobel)", () => {
    expect(rencanaPintasan([ingin()], [ada()])).toEqual([]);
  });

  it("bangunan berganti nama (adendum) atau nama pekerjaan berubah → pindah/ganti nama, bukan buat baru", () => {
    expect(jenis(rencanaPintasan([ingin({ bangunan: "II BALAI NELAYAN (REVISI)" })], [ada()]))).toEqual(["ubah:f1"]);
    expect(jenis(rencanaPintasan([ingin({ nama: "baru" })], [ada()]))).toEqual(["ubah:f1"]);
  });

  it("berkas tujuannya berganti → shortcut dibuat ulang (target shortcut tidak bisa diubah)", () => {
    expect(jenis(rencanaPintasan([ingin({ targetId: "d2" })], [ada()]))).toEqual(["buat_ulang:f1"]);
  });

  it("foto tidak lagi di laporan → shortcut dibuang", () => {
    expect(jenis(rencanaPintasan([], [ada()]))).toEqual(["buang:f1"]);
  });

  it("berkas Drive foto belum diketahui → ditunda, shortcut yang sudah ada tidak dibuang", () => {
    expect(jenis(rencanaPintasan([ingin({ targetId: null })], []))).toEqual(["tunda:f1"]);
    expect(rencanaPintasan([ingin({ targetId: null })], [ada()])).toEqual([]);
  });

  it("baris tertunda yang kini punya tujuan → buat", () => {
    expect(jenis(rencanaPintasan([ingin()], [ada({ shortcutId: null, targetId: null })]))).toEqual(["buat:f1"]);
  });
});
