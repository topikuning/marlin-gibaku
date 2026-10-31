import { describe, expect, it, vi } from "vitest";
import JSZip from "jszip";

/**
 * Penggambar surat berkop penyedia (DECISIONS 716): PDF dan Word memuat isi
 * yang SAMA – nomor, nilai, terbilang – dan Word-nya berkas .docx yang sah.
 */

vi.mock("server-only", () => ({}));

const { susunSurat } = await import("@/lib/surat-penyedia/aturan");
const { buatPdfSurat, rapikanSpasiRuns } = await import("@/lib/pdf/surat-penyedia");
const { buatDocxSurat } = await import("@/lib/docx/surat");

const DATA = {
  jenis: "kwitansi" as const,
  penyedia: { nama: "CV. Putera Fahlevi", npwp: "0502 5643 0540 4000" },
  penandaTangan: { nama: "Rheza Fajar Adi P.", jabatan: "Direktur" },
  kontrak: {
    nomor: "B.19714/DJPT.6/PI.420/PPK/VII/2026",
    tanggal: new Date("2026-07-15T00:00:00Z"),
    judul: "Pekerjaan Konstruksi Pembangunan Kampung Nelayan Merah Putih di Kabupaten Pemalang",
    nilai: 13_478_994_000n,
    adendum: [],
  },
  bank: { nama: "Bank BJB KC Bogor", rekening: "0138941035001", atasNama: "PUTERA FAHLEVI CV" },
  termin: { ke: 1, ambangPct: 25, bayarPct: 20, retensiPct: 0, bruto: 2_695_798_800n, retensi: 0n, nilai: 2_695_798_800n },
  progres: {
    pct: 26.6,
    mingguKe: 7,
    lokasi: [{ nama: "Asemdoyong", nomor: "", tanggal: new Date("2026-09-13T00:00:00Z"), mingguKe: 7, persen: 35.9 }],
  },
  konsultan: { firma: "PT. Konsultan Uji", nama: "Ir. Uji", jabatan: "Co-Team Leader" },
  surat: {
    nomor: "324.19/SP/PF-KNMP-ATMP/IX/2026",
    tanggal: new Date("2026-09-17T03:00:00Z"),
    kota: "Bogor",
    kepada: ["Pejabat Pembuat Komitmen", "Satker Sekretariat DJPT"],
    lampiran: [],
    rapat: { pimpinan: "", peserta: [], cara: "" },
  },
};
const KOP = { gambar: null, logo: null, nama: "CV. Putera Fahlevi", alamat: "Perum Bumi Citra Kencana No. 3, Kota Bogor", telepon: "0813-9901-7896", email: "puterafahlevi@gmail.com" };

describe("buatPdfSurat", () => {
  it("menghasilkan PDF untuk kelima jenis surat", async () => {
    for (const jenis of ["permohonan_pemeriksaan", "ba_pembahasan_kemajuan", "permohonan_pembayaran", "invoice", "kwitansi"] as const) {
      const pdf = await buatPdfSurat(susunSurat({ ...DATA, jenis }), KOP);
      expect(pdf.subarray(0, 5).toString(), jenis).toBe("%PDF-");
      expect(pdf.length, jenis).toBeGreaterThan(1500);
    }
  });

  it("spasi pembuka potongan pindah ke ujung potongan sebelumnya (rata kanan-kiri memangkasnya)", () => {
    expect(
      rapikanSpasiRuns([{ teks: "sebesar " }, { teks: "Rp 2.695.798.800,-", tebal: true }, { teks: " (Dua Miliar)." }]),
    ).toEqual([{ teks: "sebesar " }, { teks: "Rp 2.695.798.800,- ", tebal: true }, { teks: "(Dua Miliar)." }]);
    // Potongan yang isinya hanya spasi tidak hilang begitu saja: spasinya pindah.
    expect(rapikanSpasiRuns([{ teks: "a" }, { teks: " " }, { teks: "b" }])).toEqual([{ teks: "a " }, { teks: "b" }]);
  });
});

describe("buatDocxSurat", () => {
  it("berkas Word sah: bagian wajib ada, isi sama dengan PDF", async () => {
    const buf = await buatDocxSurat(susunSurat(DATA), KOP);
    const zip = await JSZip.loadAsync(buf);
    for (const f of ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml", "word/_rels/document.xml.rels"]) {
      expect(zip.file(f), f).not.toBeNull();
    }
    const doc = await zip.file("word/document.xml")!.async("string");
    expect(doc).toContain("KWITANSI");
    expect(doc).toContain("324.19/SP/PF-KNMP-ATMP/IX/2026");
    expect(doc).toContain("Rp 2.695.798.800,-");
    expect(doc).toContain("Delapan Ribu Delapan Ratus Rupiah");
    expect(doc).toContain("0138941035001");
    expect(doc).toContain("PUTERA FAHLEVI");
    // Karakter XML khusus di-escape (nama/alamat bisa memuat "&").
    const denganAmp = await buatDocxSurat(susunSurat({ ...DATA, penyedia: { ...DATA.penyedia, nama: "CV. A & B" } }), KOP);
    const isi = await (await JSZip.loadAsync(denganAmp)).file("word/document.xml")!.async("string");
    expect(isi).toContain("CV. A &amp; B");
    expect(isi).not.toMatch(/CV\. A & B/);
  });

  it("BA: dua pihak meneken berdampingan; penanda daftar ditulis, tab sebagai <w:tab/>", async () => {
    const buf = await buatDocxSurat(susunSurat({ ...DATA, jenis: "ba_pembahasan_kemajuan" }), KOP);
    const doc = await (await JSZip.loadAsync(buf)).file("word/document.xml")!.async("string");
    expect(doc).toContain("Ir. Uji");
    expect(doc).toContain("Co-Team Leader");
    expect(doc).toContain("PT. Konsultan Uji");
    expect(doc).toContain("(1)</w:t><w:tab/>");
    expect(doc).toContain("a)</w:t><w:tab/>");
    expect(doc).not.toMatch(/<w:t[^>]*>[^<]*\t/);
    // Butir induk ("3. Penjelasan dari …") ditahan bersama butir anaknya.
    expect(doc).toMatch(/<w:keepNext\/>(?:(?!<\/w:p>).)*3\.<\/w:t><w:tab\/>/);
  });
});
