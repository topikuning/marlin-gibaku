// BLOK TANDA TANGAN FORMULIR RENCANA MINGGUAN.
//
// Keberatan user 2026-08-06 (dengan tangkapan layar berkasnya): "ini rencana
// mingguan kenapa administrator, kan seharusnya direktur".
//
// Cacatnya SENYAP: formulir tetap terbentuk, tetap rapi, tetap bisa dicetak dan
// dikirim ke PPK. Yang salah adalah ISI blok tanda tangannya — nama diambil dari
// PENGGUNA APLIKASI yang menyusun rencana (`disusunOleh`), sementara jabatan di
// bawahnya tetap dari kontrak (`contractorSignerTitle`). Hasilnya satu blok yang
// menyatakan dua orang berbeda sebagai satu: "Administrator / Direktur".
//
// Aturannya: yang menandatangani atas nama penyedia jasa adalah penanda tangan
// yang DITUNJUK KONTRAK. Siapa yang mengetikkan rencananya ke sistem tetap
// dicatat — tempatnya jejak dokumen, bukan tanda tangan.
import { describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RencanaMingguan } from "@/lib/plan/rencana-mingguan";

// Kedua modul menarik rantai import yang memvalidasi env saat DIMUAT — dan
// `import` di-hoist ke atas berkas, jadi menyetel env di badan modul saja tidak
// cukup. `vi.hoisted` berjalan sebelum import mana pun dievaluasi.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
  process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";
});

const { buildRencanaKkpPdf } = await import("@/lib/pdf/rencana-kkp");
const { buildRencanaMingguanXlsx } = await import("@/lib/export/rencana-xlsx");

const PENANDA_KONTRAK = "Andi Prasetyo";
const OPERATOR_APLIKASI = "Administrator";

function fixture(over?: Partial<RencanaMingguan>): RencanaMingguan {
  const start = new Date(Date.UTC(2026, 4, 4));
  return {
    header: {
      locationName: "Pasar Banggi",
      village: "Pasar Banggi",
      district: "Rembang",
      regency: "Rembang",
      province: "Jawa Tengah",
      packageName: "Pembangunan Kampung Nelayan Merah Putih — Pasar Banggi",
      ownerAgency: "Kementerian Kelautan dan Perikanan",
      contractNumber: "B.17105/DJPT.6/PI.420/PPK/VI/2026",
      vendorName: "PT Kurnia Alam Sentosa",
      contractValue: 5_872_342_857n,
      locationValue: 1_000_000_000n,
      masaPelaksanaanHari: 140,
      tahunAnggaran: 2026,
      contractStart: start,
      periodeStart: new Date(start.getTime() + 7 * 86_400_000),
      periodeEnd: new Date(start.getTime() + 13 * 86_400_000),
      ppkName: "Budi Santoso",
      ppkNip: "19800101 200501 1 001",
      supervisorName: "Rina Wijaya",
      supervisorFirm: "PT Konsultan Pengawas Nusantara",
      contractorSignerName: PENANDA_KONTRAK,
      contractorSignerTitle: "Direktur",
    },
    weekNumber: 2,
    totalWeeks: 20,
    currentWeek: 2,
    targetPct: 6,
    actualPct: 4.2,
    deviationPct: -1.8,
    status: "perhatian",
    proyeksi: { tambahanPct: 2.4, proyeksiPct: 6.6, targetPct: 6, selisihPct: 0.6, masihTertinggal: false },
    ppc: { jumlah: 2, tuntas: 1, pct: 50, volumePct: 62 },
    tidakTuntas: [],
    baris: [
      {
        code: "1",
        name: "Galian tanah biasa",
        categoryName: "PEKERJAAN TANAH",
        unit: "m3",
        volumeKontrak: 1240,
        realisasi: 310,
        sisa: 930,
        target: 200,
        bobotTarget: 2.4,
        nilaiTarget: 24_000_000,
        picName: "Sarno",
        note: null,
        priority: 1,
      },
    ],
    totalNilai: 24_000_000,
    totalBobot: 2.4,
    catatan: "Butuh tambahan alat.",
    // Pengguna aplikasi yang menyusun — BUKAN penanda tangan.
    disusunOleh: OPERATOR_APLIKASI,
    disusunPada: new Date(Date.UTC(2026, 4, 11)),
    ...over,
  };
}

/** Teks PDF terkompresi di dalam berkas; dibaca lewat pdftotext. */
function teksPdf(buf: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), "rencana-ttd-"));
  const pdf = join(dir, "r.pdf");
  writeFileSync(pdf, buf);
  return execFileSync("pdftotext", ["-layout", pdf, "-"], { encoding: "utf8" });
}

async function teksXlsx(buf: Buffer): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const out: string[] = [];
  for (const ws of wb.worksheets) {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const v = cell.value;
        out.push(typeof v === "string" ? v : String(v ?? ""));
      });
    });
  }
  return out.join("\n");
}

describe("PDF formulir rencana mingguan", () => {
  it("menandatangani dengan penanda tangan KONTRAK, bukan operator aplikasi", async () => {
    const t = teksPdf(await buildRencanaKkpPdf(fixture(), "MARLIN"));
    // Blok tanda tangan: nama kontrak berdampingan dengan jabatannya.
    expect(t).toContain(PENANDA_KONTRAK);
    expect(t).toContain("Direktur");
  });

  it("nama operator TIDAK muncul sebagai penanda tangan", async () => {
    const t = teksPdf(await buildRencanaKkpPdf(fixture(), "MARLIN"));
    const barisTtd = t
      .split("\n")
      .filter((b) => b.includes(PENANDA_KONTRAK) || b.includes("Direktur"))
      .join("\n");
    expect(barisTtd).not.toContain(OPERATOR_APLIKASI);
  });

  it("jejak penyusun TIDAK hilang — pindah ke kaki halaman", async () => {
    // Kalau `disusunOleh` cuma dibuang, sistem kehilangan siapa yang menyusun.
    const t = teksPdf(await buildRencanaKkpPdf(fixture(), "MARLIN"));
    expect(t).toContain(`oleh ${OPERATOR_APLIKASI}`);
  });

  it("penanda tangan kontrak belum diisi → garis titik, bukan diisi operator", async () => {
    const r = fixture();
    const t = teksPdf(
      await buildRencanaKkpPdf(
        { ...r, header: { ...r.header, contractorSignerName: null } },
        "MARLIN",
      ),
    );
    expect(t).not.toMatch(new RegExp(`${OPERATOR_APLIKASI}\\s*\\n?\\s*Direktur`));
    expect(t).toContain("………");
  });
});

describe("Excel formulir rencana mingguan", () => {
  it("blok tanda tangan memakai nama kontrak; operator hanya di baris jejak", async () => {
    const t = await teksXlsx(await buildRencanaMingguanXlsx(fixture()));
    expect(t).toContain(PENANDA_KONTRAK);
    expect(t).toContain(`oleh ${OPERATOR_APLIKASI}`);
    // Operator tidak boleh berdiri sebagai sel nama tanda tangan.
    expect(t.split("\n")).not.toContain(OPERATOR_APLIKASI);
  });
});
