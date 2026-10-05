import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { describe, expect, it } from "vitest";
import {
  bukaSandi,
  KEPALA_SANDI,
  kunciCadanganDari,
  sandiStream,
} from "@/lib/cadangan/sandi";
import {
  cadanganDbJatuhTempo,
  kenaliMasalahCadangan,
  namaBerkasDb,
  namaDiDrive,
  pilihCadanganDbDibuang,
  urlUntukPgDump,
} from "@/lib/cadangan/aturan";

/*
 * CADANGAN KE GOOGLE DRIVE (DECISIONS 650) – bagian yang murni.
 *
 * Permintaan user 2026-10-05: cadangan database dan foto berjalan rutin ke
 * akun Google One 2TB, *"agar tidak cuma di backup di server lokal lenovo"*.
 */

async function kumpulkan(r: Readable): Promise<Buffer> {
  const bagian: Buffer[] = [];
  for await (const c of r) bagian.push(c as Buffer);
  return Buffer.concat(bagian);
}

describe("kunci enkripsi cadangan", () => {
  it("menerima 32 byte base64 atau 64 karakter hex apa adanya", () => {
    const k = randomBytes(32);
    const a = kunciCadanganDari(k.toString("base64"));
    expect(a?.jenis === "kunci" && a.kunci.equals(k)).toBe(true);
    const b = kunciCadanganDari(k.toString("hex"));
    expect(b?.jenis === "kunci" && b.kunci.equals(k)).toBe(true);
  });

  it("boleh kalimat sandi buatan sendiri, minimal 12 karakter", () => {
    expect(kunciCadanganDari("Proyek KNMP 2026 aman!")).toEqual({ jenis: "frasa", frasa: "Proyek KNMP 2026 aman!" });
  });

  it("menolak yang kosong atau terlalu pendek – lebih baik tidak mencadangkan daripada sandi lemah", () => {
    expect(kunciCadanganDari("")).toBeNull();
    expect(kunciCadanganDari(undefined)).toBeNull();
    expect(kunciCadanganDari("rahasia")).toBeNull();
    expect(kunciCadanganDari("12345678901")).toBeNull();
  });
});

describe("sandi cadangan dengan kalimat sandi sendiri", () => {
  const frasa = kunciCadanganDari("Proyek KNMP 2026 aman!")!;

  it("bisa dibuka kembali dengan kalimat sandi yang sama", async () => {
    const asli = randomBytes(100_000);
    const tersandi = await kumpulkan(Readable.from([asli]).pipe(sandiStream(frasa)));
    expect(bukaSandi(tersandi, frasa).equals(asli)).toBe(true);
  });

  it("kalimat sandi lain = gagal dibuka", async () => {
    const tersandi = await kumpulkan(Readable.from([Buffer.from("isi")]).pipe(sandiStream(frasa)));
    expect(() => bukaSandi(tersandi, kunciCadanganDari("Proyek KNMP 2026 aman?")!)).toThrow();
  });

  it("dua cadangan dengan kalimat sandi sama tetap berbeda isinya (garam acak tiap berkas)", async () => {
    const a = await kumpulkan(Readable.from([Buffer.from("isi sama")]).pipe(sandiStream(frasa)));
    const b = await kumpulkan(Readable.from([Buffer.from("isi sama")]).pipe(sandiStream(frasa)));
    expect(a.equals(b)).toBe(false);
  });
});

describe("sandi cadangan – bisa dibuka kembali, dan ketahuan bila rusak", () => {
  const kunci = randomBytes(32);

  it("isi yang disandikan lalu dibuka kembali sama persis", async () => {
    const asli = randomBytes(3 * 1024 * 1024 + 17);
    const tersandi = await kumpulkan(Readable.from([asli]).pipe(sandiStream(kunci)));
    expect(tersandi.subarray(0, KEPALA_SANDI.length).toString()).toBe(KEPALA_SANDI);
    expect(tersandi.includes(asli.subarray(0, 64))).toBe(false);
    expect(bukaSandi(tersandi, kunci).equals(asli)).toBe(true);
  });

  it("satu byte berubah = gagal dibuka, bukan isi rusak yang diam-diam", async () => {
    const tersandi = await kumpulkan(Readable.from([Buffer.from("isi database")]).pipe(sandiStream(kunci)));
    tersandi[tersandi.length - 20] ^= 1;
    expect(() => bukaSandi(tersandi, kunci)).toThrow();
  });

  it("kunci lain = gagal dibuka", async () => {
    const tersandi = await kumpulkan(Readable.from([Buffer.from("isi")]).pipe(sandiStream(kunci)));
    expect(() => bukaSandi(tersandi, randomBytes(32))).toThrow();
  });

  it("bisa dipakai di pipeline aliran", async () => {
    const keluar: Buffer[] = [];
    await pipeline(Readable.from([Buffer.from("a"), Buffer.from("b")]), sandiStream(kunci), async function* (src) {
      for await (const c of src) keluar.push(c as Buffer);
    });
    expect(bukaSandi(Buffer.concat(keluar), kunci).toString()).toBe("ab");
  });
});

describe("alamat database untuk pg_dump", () => {
  it("membuang parameter khusus Prisma yang ditolak libpq", () => {
    expect(
      urlUntukPgDump("postgresql://u:p@h:5432/db?schema=public&connection_limit=5&sslmode=require&pool_timeout=10"),
    ).toBe("postgresql://u:p@h:5432/db?sslmode=require");
  });

  it("alamat tanpa parameter tetap apa adanya", () => {
    expect(urlUntukPgDump("postgresql://u:p@h:5432/db")).toBe("postgresql://u:p@h:5432/db");
  });
});

describe("jadwal cadangan database", () => {
  const sekarang = new Date("2026-10-05T02:00:00Z");

  it("belum pernah = jatuh tempo", () => {
    expect(cadanganDbJatuhTempo(null, sekarang)).toBe(true);
  });

  it("sekali sehari: 21 jam lalu jatuh tempo, 10 jam lalu belum", () => {
    expect(cadanganDbJatuhTempo(new Date("2026-10-04T05:00:00Z"), sekarang)).toBe(true);
    expect(cadanganDbJatuhTempo(new Date("2026-10-04T16:00:00Z"), sekarang)).toBe(false);
  });
});

describe("retensi cadangan database: 30 hari terakhir + 1 per bulan selama 12 bulan", () => {
  const sekarang = new Date("2026-10-05T02:00:00Z");
  const berkas = (iso: string, id = iso) => ({ id, name: namaBerkasDb(new Date(iso)) });

  it("cadangan 30 hari terakhir disimpan semua", () => {
    const daftar = Array.from({ length: 30 }, (_, i) =>
      berkas(new Date(sekarang.getTime() - i * 86_400_000).toISOString()),
    );
    expect(pilihCadanganDbDibuang(daftar, sekarang)).toEqual([]);
  });

  it("yang lebih tua dari 30 hari: hanya cadangan PERTAMA tiap bulan yang disimpan", () => {
    const daftar = [berkas("2026-07-01T01:00:00Z"), berkas("2026-07-02T01:00:00Z"), berkas("2026-07-15T01:00:00Z")];
    expect(pilihCadanganDbDibuang(daftar, sekarang).sort()).toEqual(
      ["2026-07-02T01:00:00Z", "2026-07-15T01:00:00Z"].sort(),
    );
  });

  it("cadangan bulanan lebih tua dari 12 bulan dibuang", () => {
    expect(pilihCadanganDbDibuang([berkas("2025-09-01T01:00:00Z")], sekarang)).toEqual(["2025-09-01T01:00:00Z"]);
  });

  it("berkas yang namanya bukan cadangan MARLIN tidak pernah disentuh", () => {
    expect(pilihCadanganDbDibuang([{ id: "x", name: "catatan pribadi.pdf" }], sekarang)).toEqual([]);
  });
});

describe("nama berkas di Drive", () => {
  it("kunci berjalur jadi satu nama yang terbaca", () => {
    expect(namaDiDrive("photos/karanggondang/2026-07-10/abc.jpg")).toBe("photos__karanggondang__2026-07-10__abc.jpg");
  });
});

describe("kapan cadangan perlu diperiksa orang", () => {
  const sekarang = new Date("2026-10-05T12:00:00Z");
  const dasar = {
    aktif: true,
    terhubung: true,
    adaKunci: true,
    dbTerakhirBerhasil: new Date("2026-10-05T02:00:00Z"),
    berkasMenunggu: 0,
    berkasTerakhirBerhasil: new Date("2026-10-05T11:00:00Z"),
    galatTerakhir: null,
  };

  it("semuanya berjalan = diam", () => {
    expect(kenaliMasalahCadangan(dasar, sekarang)).toEqual([]);
  });

  it("dimatikan orang = diam, itu disengaja", () => {
    expect(kenaliMasalahCadangan({ ...dasar, aktif: false, dbTerakhirBerhasil: null }, sekarang)).toEqual([]);
  });

  it("database tidak tercadangkan lebih dari 36 jam = masalah", () => {
    const m = kenaliMasalahCadangan({ ...dasar, dbTerakhirBerhasil: new Date("2026-10-03T12:00:00Z") }, sekarang);
    expect(m.map((x) => x.kode)).toContain("db-terlambat");
  });

  it("akun Google terputus atau kunci hilang = masalah, karena tidak ada cadangan yang bisa jalan", () => {
    expect(kenaliMasalahCadangan({ ...dasar, terhubung: false }, sekarang).map((x) => x.kode)).toContain("akun-terputus");
    expect(kenaliMasalahCadangan({ ...dasar, adaKunci: false }, sekarang).map((x) => x.kode)).toContain("tanpa-kunci");
  });

  it("ada antrean berkas tapi tidak satu pun berhasil 24 jam = macet", () => {
    const m = kenaliMasalahCadangan(
      { ...dasar, berkasMenunggu: 50, berkasTerakhirBerhasil: new Date("2026-10-04T08:00:00Z") },
      sekarang,
    );
    expect(m.map((x) => x.kode)).toContain("berkas-macet");
  });
});
