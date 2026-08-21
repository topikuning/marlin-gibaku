// BLOK TANDA TANGAN FORMULIR RENCANA MINGGUAN (DECISIONS 267).
//
// Keberatan user 2026-08-06, dengan tangkapan layar berkasnya: "ini rencana
// mingguan kenapa administrator, kan seharusnya direktur".
//
// Cacatnya SENYAP: formulir tetap terbentuk, tetap rapi, tetap bisa dicetak dan
// dikirim ke PPK. Yang salah adalah ISI blok tanda tangannya — nama diambil dari
// PENGGUNA APLIKASI yang menyusun rencana (`disusunOleh`), sementara jabatan di
// bawahnya tetap dari kontrak (`contractorSignerTitle`). Hasilnya satu blok yang
// menyatakan dua orang berbeda sebagai satu: "Administrator" di atas "Direktur".
//
// Yang dikunci berkas ini:
//
//  1. penanda tangan penyedia jasa = yang DITUNJUK KONTRAK, bukan operator;
//  2. jejak penyusun tidak ikut hilang — hanya pindah tempat;
//  3. penanda tangan yang belum diisi tetap kosong, tidak "ditambal" operator;
//  4. Excel benar-benar MEMAKAI blok bersama itu, bukan menyalinnya lagi.
//
// Ketiga penyaji (PDF, Excel, layar) memanggil `pihakTandaTanganRencana` yang
// sama; tiga salinan yang disusun sendiri-sendiri adalah asal cacat ini.
import { describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import {
  jejakPenyusun,
  pihakTandaTanganRencana,
  type SumberTtdRencana,
} from "@/lib/plan/rencana-ttd";
import type { RencanaMingguan } from "@/lib/plan/rencana-mingguan";

vi.hoisted(() => {
  // `rencana-xlsx` menarik rantai import yang memvalidasi env saat DIMUAT, dan
  // `import` di-hoist ke atas berkas — jadi env harus disetel lebih dulu lagi.
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
  process.env.SESSION_SECRET ??= "0123456789abcdef0123456789abcdef";
});
const { buildRencanaMingguanXlsx } = await import("@/lib/export/rencana-xlsx");

const PENANDA_KONTRAK = "Andi Prasetyo";
const OPERATOR_APLIKASI = "Administrator";

const kopTtd: SumberTtdRencana["header"] = {
  vendorName: "PT Kurnia Alam Sentosa",
  contractorSignerName: PENANDA_KONTRAK,
  contractorSignerTitle: "Direktur",
  supervisorName: "Rina Wijaya",
  supervisorFirm: "PT Konsultan Pengawas Nusantara",
  ppkName: "Budi Santoso",
  ppkNip: "19800101 200501 1 001",
};

describe("pihak penanda tangan rencana mingguan", () => {
  it("penyedia jasa ditandatangani oleh penanda tangan KONTRAK", () => {
    const [penyedia] = pihakTandaTanganRencana({ header: kopTtd });
    expect(penyedia.title).toBe("Disusun Oleh,");
    expect(penyedia.role).toBe("Penyedia Jasa – PT Kurnia Alam Sentosa");
    expect(penyedia.name).toBe(PENANDA_KONTRAK);
    expect(penyedia.sub).toBe("Direktur");
  });

  it("nama penyusun tidak bisa masuk – bentuk datanya yang menolak", () => {
    // Penjaga struktural: `SumberTtdRencana` hanya memuat medan kop kontrak.
    // Selama blok TTD dibangun dari sini, `disusunOleh` TIDAK TERSEDIA untuk
    // dipakai — bukan sekadar "diingat supaya jangan".
    expect(Object.keys(kopTtd)).not.toContain("disusunOleh");
    expect(pihakTandaTanganRencana({ header: kopTtd }).map((p) => p.name)).not.toContain(
      OPERATOR_APLIKASI,
    );
  });

  it("pengawas & PPK dari kontrak, NIP diberi awalan", () => {
    const [, pengawas, ppk] = pihakTandaTanganRencana({ header: kopTtd });
    expect(pengawas).toMatchObject({ name: "Rina Wijaya", sub: "PT Konsultan Pengawas Nusantara" });
    expect(ppk).toMatchObject({ name: "Budi Santoso", sub: "NIP. 19800101 200501 1 001" });
  });

  it("penanda tangan yang belum diisi jadi null – bukan ditambal nama lain", () => {
    // null adalah isyarat bagi penyaji untuk menulis garis titik-titik. Kolom
    // kosong yang jujur masih bisa ditandatangani manual; kolom yang diisi orang
    // yang salah tidak bisa dibatalkan setelah dokumennya beredar.
    const pihak = pihakTandaTanganRencana({
      header: { ...kopTtd, contractorSignerName: null, supervisorName: "   ", ppkNip: null },
    });
    expect(pihak[0].name).toBeNull();
    expect(pihak[1].name).toBeNull();
    expect(pihak[2].sub).toBeNull();
  });
});

describe("jejak penyusun (provenansi, bukan tanda tangan)", () => {
  const tgl = (d: Date) => d.toISOString().slice(0, 10);

  it("menyebut tanggal DAN orangnya", () => {
    expect(
      jejakPenyusun({ disusunOleh: OPERATOR_APLIKASI, disusunPada: new Date("2026-05-11") }, tgl),
    ).toBe(`disusun 2026-05-11 oleh ${OPERATOR_APLIKASI}`);
  });

  it("hanya orang, tanpa tanggal → kalimatnya tetap utuh", () => {
    expect(jejakPenyusun({ disusunOleh: OPERATOR_APLIKASI, disusunPada: null }, tgl)).toBe(
      `disusun oleh ${OPERATOR_APLIKASI}`,
    );
  });

  it("tidak ada apa-apa → null, supaya penyaji tidak mencetak baris kosong", () => {
    expect(jejakPenyusun({ disusunOleh: null, disusunPada: null }, tgl)).toBeNull();
  });
});

/* ── Bukti bahwa penyaji benar-benar MEMAKAI blok bersama ───────────────────
   Excel dipilih karena isinya bisa dibaca ulang tanpa alat luar (teks PDF
   memakai font tersubset — glyph, bukan huruf). PDF & layar memanggil fungsi
   yang sama dan tidak lagi menyimpan salinan bloknya. */

function rencana(): RencanaMingguan {
  const start = new Date(Date.UTC(2026, 4, 4));
  return {
    header: {
      locationName: "Pasar Banggi",
      village: "Pasar Banggi",
      district: "Rembang",
      regency: "Rembang",
      province: "Jawa Tengah",
      packageName: "Pembangunan Kampung Nelayan Merah Putih – Pasar Banggi",
      ownerAgency: "Kementerian Kelautan dan Perikanan",
      contractNumber: "B.17105/DJPT.6/PI.420/PPK/VI/2026",
      contractValue: 5_872_342_857n,
      locationValue: 1_000_000_000n,
      masaPelaksanaanHari: 140,
      tahunAnggaran: 2026,
      contractStart: start,
      periodeStart: new Date(start.getTime() + 7 * 86_400_000),
      periodeEnd: new Date(start.getTime() + 13 * 86_400_000),
      // Rencana mingguan BELUM diputuskan pindah ke Pelaksana (DECISIONS 402);
      // medannya ada di kop, tapi blok TTD rencana tetap memakai direktur.
      pelaksanaName: "Joko Susilo",
      pelaksanaTitle: "Pelaksana Lapangan",
      ...kopTtd,
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
  };
}

async function selXlsx(buf: Buffer): Promise<string[]> {
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
  return out;
}

describe("Excel formulir rencana mingguan", () => {
  it("menandatangani dengan nama kontrak", async () => {
    const sel = await selXlsx(await buildRencanaMingguanXlsx(rencana()));
    expect(sel).toContain(PENANDA_KONTRAK);
    expect(sel).toContain("Direktur");
  });

  it("nama operator TIDAK berdiri sebagai sel tanda tangan", async () => {
    const sel = await selXlsx(await buildRencanaMingguanXlsx(rencana()));
    expect(sel).not.toContain(OPERATOR_APLIKASI);
  });

  it("jejak penyusun tetap ada, menempel di baris keterangan cetak", async () => {
    const sel = await selXlsx(await buildRencanaMingguanXlsx(rencana()));
    const jejak = sel.find((t) => t.startsWith("Dicetak dari"));
    expect(jejak).toContain(`oleh ${OPERATOR_APLIKASI}`);
  });

  it("penanda tangan kontrak kosong → garis titik, bukan nama operator", async () => {
    const r = rencana();
    const sel = await selXlsx(
      await buildRencanaMingguanXlsx({ ...r, header: { ...r.header, contractorSignerName: null } }),
    );
    expect(sel).toContain("(………………………)");
    expect(sel).not.toContain(OPERATOR_APLIKASI);
  });
});
