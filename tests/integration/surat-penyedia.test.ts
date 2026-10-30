/*
 * SURAT BERKOP PENYEDIA (DECISIONS 716/717) – jadwal termin (bawaan KKP atau
 * milik kontrak), retensi, progres laporan konsultan, data surat, nomor
 * otomatis dari pola perusahaan, dan unduhan PDF/Word.
 *
 * Isi gambar surat diuji di `tests/unit/surat-penyedia-gambar.test.ts`; di sini
 * sambungannya: gerbang `contract.manage`, isolasi organisasi, nomor urut per
 * perusahaan per tahun, surat yang belum lengkap DITOLAK sebelum disimpan, dan
 * uang yang selalu dihitung ulang dari kontrak saat diunduh.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import type { SessionUser } from "@/lib/auth/session";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let peran: SessionUser["role"] = "super_admin";
let pengguna: SessionUser | null = null;
vi.mock("@/lib/auth/session", async (importAsli) => {
  const asli = await importAsli<typeof import("@/lib/auth/session")>();
  const { can } = await import("@/lib/authz");
  return {
    ...asli,
    getCurrentUser: async () => (pengguna ? { ...pengguna, role: peran } : null),
    requireCapability: async (cap: Parameters<typeof can>[1]) => {
      if (!can(peran, cap)) throw new asli.ForbiddenError("Tidak berhak.");
      return { ...pengguna!, role: peran };
    },
    requestIp: async () => null,
  };
});

const { db } = await import("@/lib/db");
const { can } = await import("@/lib/authz");
const { buatSuratAction, hapusSuratAction, simpanDataSuratAction, simpanJadwalTerminAction, simpanProgresKonsultanAction } =
  await import("@/lib/surat-penyedia/actions");
const { muatTerminSurat } = await import("@/lib/surat-penyedia/data");
const { GET } = await import("@/app/api/surat-penyedia/[id]/[format]/route");

const suffix = `sp${Date.now().toString(36)}`;
let orgId = "";
let contractId = "";
let vendorId = "";
let contractLainId = "";
let contractBawaanId = "";
const lokasiIds: string[] = [];

function fd(isi: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(isi)) f.set(k, v);
  return f;
}
const jadwal = (isi: Record<string, string>, id = contractId) =>
  simpanJadwalTerminAction(undefined, fd({ contractId: id, ...isi }));
const dataSurat = (isi: Record<string, string>, id = contractId) =>
  simpanDataSuratAction(undefined, fd({ contractId: id, ...isi }));
const buat = (isi: Record<string, string> = {}) =>
  buatSuratAction(
    undefined,
    fd({ contractId, jenis: "invoice", terminKe: "1", tanggal: "2026-09-17", kota: "Bogor", nomor: "", ...isi }),
  );
const unduh = (id: string, format: string) =>
  GET(new Request(`https://marlin.test/api/surat-penyedia/${id}/${format}`), {
    params: Promise.resolve({ id, format }),
  });

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org SP ${suffix}`, slug: `org-${suffix}` } });
  orgId = org.id;
  const u = await db.user.create({
    data: { orgId, username: `sa-${suffix}`, fullName: "Admin Surat", passwordHash: "x", role: "super_admin", mustChangePassword: false },
  });
  pengguna = u as unknown as SessionUser;
  const vendor = await db.vendor.create({
    data: { orgId, name: `CV. Uji Fahlevi ${suffix}`, npwp: "0000 1111 2222 3333", address: "Jl. Sintetis 1, Kota Uji" },
  });
  vendorId = vendor.id;
  const kontrak = (n: number) =>
    db.package
      .create({ data: { orgId, name: `Paket SP ${n} ${suffix}`, stage: "pelaksanaan" } })
      .then((p) =>
        db.contract.create({
          data: {
            packageId: p.id,
            vendorId: vendor.id,
            contractNumber: `K-${n}-${suffix}`,
            workTitle: "Pekerjaan Konstruksi Uji",
            contractValue: 13_478_994_000n,
            durationDays: 150,
            signedDate: new Date("2026-07-15T00:00:00.000Z"),
            contractorSignerName: "Penanda Tangan Uji",
            contractorSignerTitle: "Direktur",
          },
        }),
      );
  contractId = (await kontrak(1)).id;
  contractLainId = (await kontrak(2)).id;
  contractBawaanId = (await kontrak(3)).id;
  // Paket kontrak 1: dua lokasi aktif + satu nonaktif (tidak ikut surat progres).
  const k1 = await db.contract.findUniqueOrThrow({ where: { id: contractId }, select: { packageId: true } });
  for (const [nama, aktif] of [["Muarareja", true], ["Asemdoyong", true], ["Lama", false]] as const) {
    const l = await db.location.create({
      data: { packageId: k1.packageId, name: nama, slug: `${nama.toLowerCase()}-${suffix}`, village: nama, regency: "K", province: "P", isActive: aktif },
    });
    if (aktif) lokasiIds.push(l.id);
  }
  await db.contract.update({
    where: { id: contractId },
    data: { supervisorFirm: "PT. Konsultan Sintetis", coTeamLeaderName: "Ir. Co Uji", supervisorName: "Pengawas Lapangan Uji" },
  });
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

describe("gerbang", () => {
  it("peran tanpa contract.manage tidak bisa mengubah jadwal, data, atau membuat surat", async () => {
    expect(can("site_manager", "contract.manage")).toBe(false);
    peran = "site_manager";
    try {
      expect((await jadwal({ ambang1: "25", bayar1: "20" }))?.error).toBeTruthy();
      expect((await dataSurat({ bankNama: "Bank X", bankRekening: "1", bankAtasNama: "A" }))?.error).toBeTruthy();
      expect((await buat())?.error).toBeTruthy();
      expect(await db.contractTermin.count({ where: { contractId } })).toBe(0);
    } finally {
      peran = "super_admin";
    }
  });

  it("kontrak organisasi lain tidak bisa disentuh", async () => {
    const lain = await db.organization.create({ data: { name: `Org Lain ${suffix}`, slug: `lain-${suffix}` } });
    const v = await db.vendor.create({ data: { orgId: lain.id, name: "CV. Lain" } });
    const p = await db.package.create({ data: { orgId: lain.id, name: "Paket Lain" } });
    const k = await db.contract.create({
      data: { packageId: p.id, vendorId: v.id, contractNumber: `L-${suffix}`, contractValue: 1n, signedDate: new Date() },
    });
    expect((await jadwal({ ambang1: "25", bayar1: "20" }, k.id))?.error).toMatch(/tidak ditemukan/);
    expect(await db.contractTermin.count({ where: { contractId: k.id } })).toBe(0);
  });
});

describe("jadwal termin", () => {
  it("menolak jadwal yang tidak masuk akal, tanpa menyimpan apa pun", async () => {
    expect((await jadwal({ ambang1: "25", bayar1: "" }))?.error).toMatch(/Termin 1/);
    expect((await jadwal({ ambang1: "25", bayar1: "20", ambang3: "80", bayar3: "30" }))?.error).toMatch(/Termin 2 kosong/);
    expect((await jadwal({ ambang1: "50", bayar1: "20", ambang2: "25", bayar2: "20" }))?.error).toMatch(/lebih besar/);
    expect((await jadwal({ ambang1: "25", bayar1: "60", ambang2: "50", bayar2: "50" }))?.error).toMatch(/melebihi 100%/);
    expect(await db.contractTermin.count({ where: { contractId } })).toBe(0);
  });

  it("menyimpan jadwal SSKK; menyimpan ulang mengganti seluruhnya", async () => {
    const r = await jadwal({ ambang1: "25", bayar1: "20", ambang2: "50", bayar2: "25", ambang3: "80", bayar3: "30", ambang4: "100", bayar4: "25" });
    expect(r?.success).toMatch(/4 termin/);
    const r2 = await jadwal({ ambang1: "25", bayar1: "20", ambang2: "50", bayar2: "25,5" });
    expect(r2?.success).toMatch(/2 termin.*45,5%/);
    const rows = await db.contractTermin.findMany({ where: { contractId }, orderBy: { terminKe: "asc" } });
    expect(rows.map((t) => [t.terminKe, Number(t.ambangPct), Number(t.bayarPct)])).toEqual([
      [1, 25, 20],
      [2, 50, 25.5],
    ]);
    const jejak = await db.auditLog.findFirst({ where: { action: "surat_penyedia.jadwal_termin", resourceId: contractId } });
    expect(jejak).not.toBeNull();
  });
});

describe("surat", () => {
  it("invoice tanpa rekening DITOLAK sebelum disimpan, dengan menyebut yang kurang", async () => {
    const r = await buat({ nomor: "1/MANUAL" });
    expect(r?.error).toMatch(/rekening bank/);
    expect(await db.suratPenyedia.count({ where: { contractId } })).toBe(0);
  });

  it("nomor kosong tanpa pola perusahaan meminta nomor diketik", async () => {
    await dataSurat({ bankNama: "Bank Uji", bankRekening: "0011223344", bankAtasNama: "UJI FAHLEVI CV" });
    const r = await buat();
    expect(r?.error).toMatch(/pola nomor/);
  });

  it("rekening setengah terisi ditolak; pola nomor yang tak dikenal ditolak", async () => {
    expect((await dataSurat({ bankNama: "Bank Uji", bankRekening: "", bankAtasNama: "" }))?.error).toMatch(/lengkap/);
    expect((await dataSurat({ bankNama: "", bankRekening: "", bankAtasNama: "", polaNomorSurat: "324.{nomor}/SP" }))?.error).toBeTruthy();
    const c = await db.contract.findUniqueOrThrow({ where: { id: contractId }, select: { bankRekening: true } });
    expect(c.bankRekening).toBe("0011223344");
  });

  it("nomor otomatis berurut per perusahaan per tahun; nomor diketik dipakai apa adanya dan tidak memakan urutan", async () => {
    const d = await dataSurat({
      bankNama: "Bank Uji",
      bankRekening: "0011223344",
      bankAtasNama: "UJI FAHLEVI CV",
      polaNomorSurat: "324.{urut}/SP/PF-KNMP-ATMP/{bulan}/{tahun}",
      kotaSurat: "Bogor",
    });
    expect(d?.success).toBeTruthy();

    expect((await buat({ jenis: "permohonan_pembayaran" }))?.success).toMatch(/324\.1\/SP\/PF-KNMP-ATMP\/IX\/2026/);
    expect((await buat({ nomor: "99/KETIK/2026" }))?.success).toMatch(/99\/KETIK\/2026/);
    expect((await buat({ jenis: "kwitansi" }))?.success).toMatch(/324\.2\/SP\/PF-KNMP-ATMP\/IX\/2026/);
    // Paket lain perusahaan yang sama melanjutkan urutan yang sama.
    await jadwal({ ambang1: "25", bayar1: "20" }, contractLainId);
    // Pola & kota milik perusahaan: formulir paket lain menampilkannya terisi, jadi ikut terkirim.
    await dataSurat(
      { bankNama: "Bank Uji", bankRekening: "55", bankAtasNama: "UJI", polaNomorSurat: "324.{urut}/SP/PF-KNMP-ATMP/{bulan}/{tahun}", kotaSurat: "Bogor" },
      contractLainId,
    );
    const lain = await buatSuratAction(
      undefined,
      fd({ contractId: contractLainId, jenis: "invoice", terminKe: "1", tanggal: "2026-10-01", kota: "Bogor", nomor: "" }),
    );
    expect(lain?.success).toMatch(/324\.3\/SP\/PF-KNMP-ATMP\/X\/2026/);
    // Tahun baru mulai dari 1 lagi.
    expect((await buat({ tanggal: "2027-01-05" }))?.success).toMatch(/324\.1\/SP\/PF-KNMP-ATMP\/I\/2027/);

    const urut = await db.suratPenyedia.findMany({ where: { contract: { vendorId } }, orderBy: { createdAt: "asc" }, select: { nomorUrut: true } });
    expect(urut.map((s) => s.nomorUrut)).toEqual([1, null, 2, 3, 1]);
    expect(await db.auditLog.count({ where: { action: "surat_penyedia.buat", userId: pengguna!.id } })).toBe(5);
  });

  it("surat bernomor otomatis yang dibuat serentak tidak berbagi nomor", async () => {
    const hasil = await Promise.all(Array.from({ length: 4 }, () => buat({ tanggal: "2027-02-01" })));
    expect(hasil.every((r) => r?.success)).toBe(true);
    const nomor = await db.suratPenyedia.findMany({
      where: { contract: { vendorId }, tanggal: { gte: new Date("2027-01-01T00:00:00Z") } },
      select: { nomorUrut: true },
    });
    expect(nomor.map((s) => s.nomorUrut).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("termin yang tidak ada di jadwal milik kontrak ditolak, walau jadwal bawaan punya termin 3", async () => {
    expect((await buat({ terminKe: "3" }))?.error).toMatch(/Termin 3 tidak ada di jadwal/);
  });
});

describe("jadwal bawaan KKP & retensi (DECISIONS 717)", () => {
  const unduhXml = async (id: string) =>
    (await JSZip.loadAsync(await (await unduh(id, "docx")).arrayBuffer())).file("word/document.xml")!.async("string");

  it("kontrak tanpa jadwal tersimpan memakai jadwal bawaan: termin 4 = 25% dikurangi retensi 5%", async () => {
    expect(await db.contractTermin.count({ where: { contractId: contractBawaanId } })).toBe(0);
    await dataSurat({ bankNama: "Bank Uji", bankRekening: "77", bankAtasNama: "UJI" }, contractBawaanId);
    const r = await buatSuratAction(
      undefined,
      fd({ contractId: contractBawaanId, jenis: "kwitansi", terminKe: "4", tanggal: "2026-12-20", kota: "Bogor", nomor: "T4/BAWAAN" }),
    );
    expect(r?.success).toBeTruthy();
    const { id } = await db.suratPenyedia.findFirstOrThrow({ where: { nomor: "T4/BAWAAN" }, select: { id: true } });
    const xml = await unduhXml(id);
    // 25% × 13.478.994.000 = 3.369.748.500; retensi 5% = 673.949.700; dibayar 2.695.798.800.
    expect(xml).toContain("Rp 2.695.798.800,-");
    expect(xml).toContain("dikurangi retensi 5%");
  });

  it("jadwal dengan retensi tersimpan; retensi melebihi persen termin ditolak; mengosongkan = kembali ke bawaan", async () => {
    expect(
      (await jadwal({ ambang1: "50", bayar1: "40", retensi1: "45" }, contractBawaanId))?.error,
    ).toMatch(/retensi paling besar/);
    expect((await jadwal({ ambang1: "50", bayar1: "60", ambang2: "100", bayar2: "40", retensi2: "5" }, contractBawaanId))?.success).toMatch(/2 termin/);
    const rows = await db.contractTermin.findMany({ where: { contractId: contractBawaanId }, orderBy: { terminKe: "asc" } });
    expect(rows.map((t) => Number(t.retensiPct))).toEqual([0, 5]);
    expect((await jadwal({}, contractBawaanId))?.success).toMatch(/bawaan KKP/);
    expect(await db.contractTermin.count({ where: { contractId: contractBawaanId } })).toBe(0);
  });
});

describe("progres laporan konsultan + surat progres (DECISIONS 717)", () => {
  const isiProgres = (ubah: Record<string, string> = {}) => {
    const isi: Record<string, string> = { contractId, terminKe: "1", progresPct: "26,6", mingguKe: "7" };
    const [muara, asem] = lokasiIds;
    Object.assign(isi, {
      [`persen_${muara}`]: "3,7",
      [`tanggal_${muara}`]: "2026-09-13",
      [`nomor_${muara}`]: "LKP/MR/07",
      [`persen_${asem}`]: "35,9",
      [`tanggal_${asem}`]: "2026-09-13",
      [`minggu_${asem}`]: "7",
    });
    return fd({ ...isi, ...ubah });
  };
  const buatProgres = (jenis: string, nomor: string, tambahan: Record<string, string> = {}) =>
    buat({ jenis, nomor, tanggal: "2026-09-16", ...tambahan });

  it("surat progres sebelum progres konsultan diisi ditolak dengan menyebutnya", async () => {
    expect((await buatProgres("permohonan_pemeriksaan", "PP/1"))?.error).toMatch(/progres dari laporan konsultan untuk termin 1/);
  });

  it("menyimpan progres: semua lokasi AKTIF wajib, tanggal tidak di masa depan, peran tanpa izin ditolak", async () => {
    const [muara] = lokasiIds;
    expect((await simpanProgresKonsultanAction(undefined, isiProgres({ [`persen_${muara}`]: "" })))?.error).toMatch(/Muarareja/);
    expect((await simpanProgresKonsultanAction(undefined, isiProgres({ [`tanggal_${muara}`]: "2999-01-01" })))?.error).toMatch(
      /sesudah hari ini/,
    );
    peran = "site_manager";
    try {
      expect((await simpanProgresKonsultanAction(undefined, isiProgres()))?.error).toBeTruthy();
    } finally {
      peran = "super_admin";
    }
    expect(await db.terminProgresKonsultan.count({ where: { contractId } })).toBe(0);

    expect((await simpanProgresKonsultanAction(undefined, isiProgres()))?.success).toMatch(/26,6%/);
    const p = await db.terminProgresKonsultan.findFirstOrThrow({ where: { contractId, terminKe: 1 } });
    expect(Number(p.progresPct)).toBe(26.6);
    const lokasi = p.lokasi as { locationId: string; persen: number; mingguKe: number }[];
    expect(lokasi.map((l) => l.persen).sort()).toEqual([3.7, 35.9]);
    // Minggu kosong per lokasi = minggu keseluruhan.
    expect(lokasi.every((l) => l.mingguKe === 7)).toBe(true);
    expect(await db.auditLog.count({ where: { action: "surat_penyedia.progres_konsultan", resourceId: contractId } })).toBe(1);
  });

  it("halaman: progres tersimpan tampil per termin bersama angka MARLIN per lokasi aktif", async () => {
    const d = await muatTerminSurat(
      (await db.contract.findUniqueOrThrow({ where: { id: contractId }, select: { packageId: true } })).packageId,
      { ...pengguna!, role: "super_admin" },
    );
    const t1 = d!.progres.find((p) => p.terminKe === 1)!;
    expect(t1.tersimpan?.progresPct).toBe(26.6);
    expect(t1.lokasi.map((l) => l.nama)).toEqual(["Asemdoyong", "Muarareja"]);
    expect(t1.lokasi.every((l) => l.marlinPct !== null)).toBe(true);
    // Lokasi tanpa RAB tidak punya bobot → tidak ada rata-rata tertimbang palsu "0%".
    expect(t1.tertimbangKonsultan).toBeNull();
  });

  it("progres di bawah ambang termin: surat progres ditolak, menyebut angka dan ambangnya", async () => {
    await simpanProgresKonsultanAction(undefined, isiProgres({ progresPct: "24,5" }));
    expect((await buatProgres("ba_pembahasan_kemajuan", "BA/1"))?.error).toMatch(/tercatat 24,5%, ambangnya 25%/);
    await simpanProgresKonsultanAction(undefined, isiProgres());
  });

  it("permohonan pemeriksaan & BA: dibuat, diunduh berisi angka konsultan, lokasi, dan penanda tangan konsultan", async () => {
    expect((await buatProgres("permohonan_pemeriksaan", "PP/1"))?.success).toBeTruthy();
    expect(
      (await buatProgres("ba_pembahasan_kemajuan", "BA/1", { pimpinan: "Wakil Sah PPK Wilayah Uji", peserta: "Peserta Satu\nPeserta Dua", cara: "di kantor PPK" }))
        ?.success,
    ).toBeTruthy();
    const xml = async (nomor: string) => {
      const { id } = await db.suratPenyedia.findFirstOrThrow({ where: { nomor }, select: { id: true } });
      return (await JSZip.loadAsync(await (await unduh(id, "docx")).arrayBuffer())).file("word/document.xml")!.async("string");
    };
    const pp = await xml("PP/1");
    expect(pp).toContain("rata-rata progres sebesar ");
    expect(pp).toContain("26,6%");
    expect(pp).toContain("Lokasi KNMP Desa Muarareja Nomor: LKP/MR/07 tanggal 13 September 2026 pada Minggu ke-7 sebesar 3,7%");
    expect(pp).toContain("PT. Konsultan Sintetis");
    expect(pp).not.toContain("Lama");
    const ba = await xml("BA/1");
    expect(ba).toContain("PEMBAHASAN KEMAJUAN HASIL PEKERJAAN (25%)");
    expect(ba).toContain("Rabu, tanggal Enam Belas, bulan September");
    expect(ba).toContain("Wakil Sah PPK Wilayah Uji");
    expect(ba).toContain("Peserta Dua");
    expect(ba).toContain("Ir. Co Uji");
    expect(ba).toContain("Co-Team Leader");
    // Pengawas lapangan BUKAN penanda tangan BA.
    expect(ba).not.toContain("Pengawas Lapangan Uji");
  });

  it("BA tanpa Co-Team Leader/Team Leader ditolak, tidak jatuh ke pengawas lapangan", async () => {
    await db.contract.update({ where: { id: contractId }, data: { coTeamLeaderName: null, teamLeaderName: null } });
    try {
      expect((await buatProgres("ba_pembahasan_kemajuan", "BA/2"))?.error).toMatch(/Co-Team Leader atau Team Leader/);
    } finally {
      await db.contract.update({ where: { id: contractId }, data: { coTeamLeaderName: "Ir. Co Uji" } });
    }
  });
});

describe("unduh", () => {
  async function suratNomor(nomor: string) {
    return db.suratPenyedia.findFirstOrThrow({ where: { nomor }, select: { id: true } });
  }

  it("PDF dan Word: nilai = persen bayar × nilai kontrak berjalan, beserta terbilangnya", async () => {
    const { id } = await suratNomor("324.2/SP/PF-KNMP-ATMP/IX/2026");
    const pdf = await unduh(id, "pdf");
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");

    const word = await unduh(id, "docx");
    expect(word.status).toBe(200);
    expect(word.headers.get("content-disposition")).toMatch(/\.docx/);
    const xml = await (await JSZip.loadAsync(await word.arrayBuffer())).file("word/document.xml")!.async("string");
    expect(xml).toContain("KWITANSI");
    expect(xml).toContain("324.2/SP/PF-KNMP-ATMP/IX/2026");
    // 20% × Rp 13.478.994.000 = Rp 2.695.798.800 (termin 1 berkas TERMIN 1 yang sudah cair).
    expect(xml).toContain("Rp 2.695.798.800,-");
    expect(xml).toContain("Dua Miliar Enam Ratus Sembilan Puluh Lima Juta Tujuh Ratus Sembilan Puluh Delapan Ribu Delapan Ratus Rupiah");
    expect(xml).toContain("0011223344");
    expect(await db.auditLog.count({ where: { action: "surat_penyedia.unduh", resourceId: id } })).toBe(2);
  });

  it("uang dihitung ulang saat diunduh: adendum menaikkan nilai kontrak → nilai surat ikut", async () => {
    const { id } = await suratNomor("324.2/SP/PF-KNMP-ATMP/IX/2026");
    await db.contractAmendment.create({
      data: {
        contractId,
        ccoNumber: `CCO-${suffix}`,
        valueDelta: 521_006_000n,
        endDateDelta: 0,
        effectiveDate: new Date("2026-09-01T00:00:00.000Z"),
        reason: "Uji",
        createdById: pengguna!.id,
      },
    });
    const word = await unduh(id, "docx");
    const xml = await (await JSZip.loadAsync(await word.arrayBuffer())).file("word/document.xml")!.async("string");
    // 20% × 14.000.000.000
    expect(xml).toContain("Rp 2.800.000.000,-");
    expect(xml).not.toContain("Rp 2.695.798.800,-");
  });

  it("termin berikutnya dibulatkan kumulatif: jadwal 100% berjumlah persis nilai kontrak", async () => {
    await db.contract.update({ where: { id: contractLainId }, data: { contractValue: 8_851_251_259n } });
    await jadwal({ ambang1: "25", bayar1: "20", ambang2: "50", bayar2: "25", ambang3: "80", bayar3: "30", ambang4: "100", bayar4: "25" }, contractLainId);
    const r = await buatSuratAction(
      undefined,
      fd({ contractId: contractLainId, jenis: "kwitansi", terminKe: "3", tanggal: "2026-12-01", kota: "Bogor", nomor: "T3/KETIK" }),
    );
    expect(r?.success).toBeTruthy();
    const { id } = await suratNomor("T3/KETIK");
    const xml = await (await JSZip.loadAsync(await (await unduh(id, "docx")).arrayBuffer())).file("word/document.xml")!.async("string");
    // bulat(75% × N) − bulat(45% × N) = 6.638.438.444 − 3.983.063.067; dibulatkan sendiri akan 2.655.375.378.
    expect(xml).toContain("Rp 2.655.375.377,-");
  });

  it("data yang dikosongkan sesudah surat dibuat: unduhan menyebut kekurangannya (409), bukan surat cacat", async () => {
    const { id } = await suratNomor("324.2/SP/PF-KNMP-ATMP/IX/2026");
    await dataSurat({ bankNama: "", bankRekening: "", bankAtasNama: "" });
    const res = await unduh(id, "pdf");
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/rekening bank/);
  });

  it("format asing 404; surat organisasi lain 404; peran tanpa izin 403", async () => {
    const { id } = await suratNomor("99/KETIK/2026");
    expect((await unduh(id, "xlsx")).status).toBe(404);

    const asli = pengguna!;
    const lain = await db.organization.create({ data: { name: `Org Lain2 ${suffix}`, slug: `lain2-${suffix}` } });
    const u = await db.user.create({
      data: { orgId: lain.id, username: `lain-${suffix}`, fullName: "Lain", passwordHash: "x", role: "super_admin", mustChangePassword: false },
    });
    pengguna = u as unknown as SessionUser;
    try {
      expect((await unduh(id, "pdf")).status).toBe(404);
      expect((await hapusSuratAction(undefined, fd({ suratId: id })))?.error).toMatch(/tidak ditemukan/);
    } finally {
      pengguna = asli;
    }

    peran = "site_manager";
    try {
      expect((await unduh(id, "pdf")).status).toBe(403);
    } finally {
      peran = "super_admin";
    }
  });

  it("hapus surat tercatat di audit; nomor otomatis di tengah tidak dipakai ulang, nomor terakhir dipakai lagi", async () => {
    const { id } = await suratNomor("99/KETIK/2026");
    expect((await hapusSuratAction(undefined, fd({ suratId: id })))?.success).toMatch(/dihapus/);
    expect(await db.suratPenyedia.count({ where: { id } })).toBe(0);
    expect(await db.auditLog.count({ where: { action: "surat_penyedia.hapus", resourceId: id } })).toBe(1);

    await dataSurat({
      bankNama: "Bank Uji",
      bankRekening: "0011223344",
      bankAtasNama: "UJI FAHLEVI CV",
      polaNomorSurat: "324.{urut}/SP/PF-KNMP-ATMP/{bulan}/{tahun}",
      kotaSurat: "Bogor",
    });
    // Urutan 2026 sekarang 1, 2, 3. Menghapus nomor 2 meninggalkan lubang; berikutnya tetap 4.
    await hapusSuratAction(undefined, fd({ suratId: (await suratNomor("324.2/SP/PF-KNMP-ATMP/IX/2026")).id }));
    expect((await buat({ tanggal: "2026-11-02" }))?.success).toMatch(/324\.4\/SP\/PF-KNMP-ATMP\/XI\/2026/);
    // Menghapus yang TERAKHIR membebaskan nomornya untuk surat berikutnya (disebut di dialog hapus).
    await hapusSuratAction(undefined, fd({ suratId: (await suratNomor("324.4/SP/PF-KNMP-ATMP/XI/2026")).id }));
    expect((await buat({ tanggal: "2026-11-03" }))?.success).toMatch(/324\.4\/SP\/PF-KNMP-ATMP\/XI\/2026/);
  });
});
