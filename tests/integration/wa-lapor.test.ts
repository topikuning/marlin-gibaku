/*
 * LAPOR LEWAT WHATSAPP PRIBADI – dari pesan masuk sampai baris laporan
 * (DECISIONS 706, 707).
 *
 * Permintaan user 2026-10-26: PIC mengetik "lokasi A", lalu foto yang dikirim
 * lewat WA disimpan untuk lokasi itu; menyebut nama pekerjaan mencari
 * pekerjaan yang cocok. Volume dan foto pekerjaan berhenti sebagai USULAN
 * (707) dan baru masuk laporan setelah orang yang boleh mengisi laporan
 * menekan Masukkan di aplikasi.
 *
 * Yang ASLI: basis data, pencocok lokasi & pekerjaan, penyimpan foto (sharp),
 * `upsertItem`, `pakaiFotoKeTujuan`, antrean jawaban, EWS. Yang dipalsukan hanya
 * yang memang bukan milik kita: kiriman WhatsApp, server media WAHA, R2, AI.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Map() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const terkirim: { chatId: string; teks: string }[] = [];
vi.mock("@/lib/waha/client", () => ({
  getIdentitasMarlin: async () => ({ nomor: "6281200000000", lid: null }),
}));
vi.mock("@/lib/waha/kirim", () => ({
  balasWa: async (chatId: string, teks: string) => {
    terkirim.push({ chatId, teks });
    return "mock-id";
  },
  sendText: async (chatId: string, teks: string) => {
    terkirim.push({ chatId, teks });
    return "mock-id";
  },
  balasFileWa: async () => "mock-id",
}));
vi.mock("@/lib/ai/structured", () => ({
  aiStructured: async () => ({ ok: false, errorCode: "provider_down", error: "uji", meta: null, attempts: 1 }),
}));

const bucket = new Map<string, Buffer>();
vi.mock("@/lib/r2", () => ({
  isR2Configured: () => true,
  r2Put: async (k: string, b: Buffer) => {
    bucket.set(k, b);
  },
  r2GetBuffer: async (k: string) => {
    const b = bucket.get(k);
    if (!b) throw new Error(`objek tidak ada: ${k}`);
    return b;
  },
  r2GetDenganJenis: async (k: string) => ({ isi: bucket.get(k)!, jenis: null }),
  r2PresignGet: async (k: string) => `https://r2.tiruan/${k}`,
  r2Delete: async (k: string) => {
    bucket.delete(k);
  },
  r2HapusBanyak: async () => ({ terhapus: 0, gagal: [] }),
}));

/** Server media WAHA tiruan: tiap nama berkas = satu gambar berbeda (bukan duplikat). */
const media = new Map<string, Buffer>();
const server: Server = createServer((req, res) => {
  const b = media.get((req.url ?? "").slice(1));
  if (!b) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { "content-type": "image/jpeg" });
  res.end(b);
});
await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
const MEDIA = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const { db } = await import("@/lib/db");
const { jawabPertanyaanWa } = await import("@/lib/waha/tanya");
const { antreJawaban, prosesAntrean } = await import("@/lib/waha/antrean");
const { jakartaDateKey, parseDateKey } = await import("@/lib/format");
const sharp = (await import("sharp")).default;

const suffix = `wl${Date.now().toString(36)}`;
const NOMOR_PIC = "6281299990001";
const NOMOR_BELUM = "6281299990002";
const CHAT_PIC = `${NOMOR_PIC}@c.us`;
let locationId = "";
let lokasiKedua = "";
let picId = "";
let smId = "";
let nomorPesan = 0;
let detik = Math.floor(Date.now() / 1000);

function pesan(p: { dari?: string; teks?: string; foto?: string; mime?: string }) {
  return {
    event: "message",
    payload: {
      id: `lapor-${suffix}-${++nomorPesan}`,
      from: `${p.dari ?? NOMOR_PIC}@c.us`,
      fromMe: false,
      body: p.teks ?? "",
      timestamp: detik++,
      ...(p.foto
        ? { hasMedia: true, media: { url: `${MEDIA}/${p.foto}`, mimetype: p.mime ?? "image/jpeg", filename: null } }
        : {}),
    },
  };
}

async function kirim(p: Parameters<typeof pesan>[0]) {
  const sebelum = terkirim.length;
  const hasil = await jawabPertanyaanWa(pesan(p));
  return { hasil, balasan: terkirim.slice(sebelum).map((t) => t.teks) };
}

let warna = 0;
async function gambar(nama: string) {
  warna += 37;
  media.set(
    nama,
    await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: warna % 256, g: 90, b: 200 } } })
      .jpeg()
      .toBuffer(),
  );
  return nama;
}

const hariIni = () => jakartaDateKey(new Date());
const usulan = (lineageKey: string) =>
  db.waUsulan.findFirst({ where: { locationId, lineageKey, status: "menunggu" } });
async function itemLaporan(lineageKey: string) {
  const report = await db.dailyReport.findUnique({
    where: { locationId_reportDate: { locationId, reportDate: parseDateKey(hariIni())! } },
    select: { id: true, status: true },
  });
  if (!report) return null;
  return db.dailyReportItem.findUnique({
    where: { reportId_lineageKey: { reportId: report.id, lineageKey } },
    select: { id: true, volumeDone: true },
  });
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org WL ${suffix}`, slug: `wl-${suffix}` } });
  const buatUser = async (tag: string, nomor: string, verified: boolean) =>
    (
      await db.user.create({
        data: {
          orgId: org.id,
          username: `${tag}-${suffix}`,
          fullName: `PIC ${tag}`,
          passwordHash: "x",
          role: "field_supervisor",
          waNumber: `${nomor}@c.us`,
          waVerifiedAt: verified ? new Date() : null,
        },
      })
    ).id;
  picId = await buatUser("pic", NOMOR_PIC, true);
  const belumId = await buatUser("belum", NOMOR_BELUM, false);
  smId = (
    await db.user.create({
      data: { orgId: org.id, username: `sm-${suffix}`, fullName: "SM Uji", passwordHash: "x", role: "site_manager" },
    })
  ).id;
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket WL ${suffix}`, stage: "pelaksanaan" } });
  const buatLokasi = (name: string) =>
    db.location.create({
      data: {
        packageId: pkg.id,
        name,
        slug: `${name.toLowerCase().replace(/\s+/g, "-")}-${suffix}`,
        village: "Desa Uji",
        regency: "Kab Uji",
        province: "Prov",
        gpsLat: -7.1,
        gpsLng: 112.6,
        status: "berjalan",
        isActive: true,
      },
    });
  const lok = await buatLokasi("Matabulu Timur");
  locationId = lok.id;
  // Lokasi lain di organisasi yang sama, TIDAK ditugaskan ke PIC.
  await buatLokasi("Kedung Lain");
  for (const u of [picId, belumId, smId]) await db.locationAssignment.create({ data: { userId: u, locationId } });
  // Lokasi kedua PIC – untuk daftar bernomor "lokasi" saja (DECISIONS 710).
  lokasiKedua = (await buatLokasi("Pesisir Utara")).id;
  await db.locationAssignment.create({ data: { userId: picId, locationId: lokasiKedua } });

  const rev = await db.rabRevision.create({
    data: { locationId, revisionNo: 1, source: "hps_awal", status: "aktif", totalValue: 100_000_000n },
  });
  const kat = await db.rabNode.create({
    data: { revisionId: rev.id, kind: "kategori", code: "I", name: "PEKERJAAN JALAN", amount: 100_000_000n, lineageKey: "I", sortOrder: 1 },
  });
  const item = (code: string, name: string, unit: string, volume: number, urut: number) =>
    db.rabNode.create({
      data: {
        revisionId: rev.id, parentId: kat.id, kind: "item", code, name, unit, volume,
        unitPrice: 100_000, amount: BigInt(volume * 100_000), lineageKey: `I#${code}`, sortOrder: urut,
      },
    });
  await item("1", "Pemasangan Paving Block", "m2", 100, 2);
  await item("2", "Galian Tanah", "m3", 50, 3);
  await item("3", "Bekesting Kolom Praktis", "m2", 40, 4);
  await item("4", "Bekesting Kolom Utama", "m2", 40, 5);
  await item("5", "Pasangan Bata", "m2", 60, 6);
}, 60_000);

afterAll(async () => {
  const { antreanCapSelesai } = await import("@/lib/photo-stamp/cap-latar");
  await antreanCapSelesai();
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
  await new Promise<void>((ok) => server.close(() => ok()));
});

describe("lapor lewat WhatsApp", () => {
  it("foto sebelum menyebut lokasi tidak disimpan, dan PIC diberi tahu caranya", async () => {
    const { hasil, balasan } = await kirim({ foto: await gambar("awal.jpg") });
    expect(hasil.alasan).toMatch(/^lapor:/);
    expect(balasan.join("\n")).toMatch(/lokasinya belum disebut/);
    expect(await db.photo.count({ where: { uploadedById: picId } })).toBe(0);
  });

  it("'lokasi …' membuka sesi untuk lokasi yang boleh diakses", async () => {
    const { balasan } = await kirim({ teks: "lokasi matabulu" });
    expect(balasan.join("\n")).toMatch(/Lokasi aktif: \*Matabulu Timur\*/);
    const s = await db.waLaporSesi.findUnique({ where: { userId: picId } });
    expect(s?.locationId).toBe(locationId);
  });

  it("'lokasi' saja → daftar bernomor lokasi PIC sendiri; balas angka = lokasi itu aktif (DECISIONS 710)", async () => {
    const daftar = await kirim({ teks: "daftar lokasi" });
    const b = daftar.balasan.join("\n");
    expect(b).toMatch(/Lokasi yang bisa Anda laporkan:\n1\. Matabulu Timur – Desa Uji, Kab Uji\n2\. Pesisir Utara – Desa Uji, Kab Uji\nBalas dengan angkanya\./);
    expect(b, "lokasi yang tidak ditugaskan tidak ikut").not.toMatch(/Kedung Lain/);
    const pilih2 = await kirim({ teks: "2" });
    expect(pilih2.balasan.join("\n")).toMatch(/Lokasi aktif: \*Pesisir Utara\*/);
    expect((await db.waLaporSesi.findUnique({ where: { userId: picId } }))?.locationId).toBe(lokasiKedua);

    // Kembali ke Matabulu lewat "lokasi" saja – uji berikutnya bekerja di sana.
    await kirim({ teks: "lokasi" });
    const pilih1 = await kirim({ teks: "1" });
    expect(pilih1.balasan.join("\n")).toMatch(/Lokasi aktif: \*Matabulu Timur\*/);
    expect((await db.waLaporSesi.findUnique({ where: { userId: picId } }))?.locationId).toBe(locationId);
  });

  it("lokasi yang TIDAK ditugaskan tidak pernah cocok – diteruskan ke Tanya MARLIN", async () => {
    const { hasil } = await kirim({ teks: "lokasi kedung lain" });
    expect(hasil.alasan).not.toMatch(/^lapor:/);
    const s = await db.waLaporSesi.findUnique({ where: { userId: picId } });
    expect(s?.locationId, "sesi tidak boleh berpindah ke lokasi tanpa akses").toBe(locationId);
  });

  it("foto masuk kantong lokasi itu, koordinat titik proyek BERTANDA, catatan GPS sekali", async () => {
    const { balasan } = await kirim({ foto: await gambar("satu.jpg") });
    const foto = await db.photo.findFirst({ where: { uploadedById: picId }, orderBy: { createdAt: "desc" } });
    expect(foto?.locationId).toBe(locationId);
    expect(foto?.reportId).toBeNull();
    expect(foto?.gpsSource, "bukan bukti GPS").toBe("project");
    expect(balasan.join("\n")).toMatch(/1 foto tersimpan untuk \*Matabulu Timur\*/);
    expect(balasan.join("\n")).toMatch(/kirim sebagai \*Dokumen\*/);

    const kedua = await kirim({ foto: await gambar("dua.jpg") });
    expect(kedua.balasan.join("\n"), "catatan GPS cukup sekali per sesi").not.toMatch(/Dokumen/);
  });

  it("pertanyaan di tengah sesi tetap untuk Tanya MARLIN, dan tidak menyentuh sesi", async () => {
    const sebelum = await db.waLaporSesi.findUnique({ where: { userId: picId }, select: { terakhirAt: true } });
    const { hasil } = await kirim({ teks: "berapa progres matabulu?" });
    expect(hasil.alasan).not.toMatch(/^lapor:/);
    const sesudah = await db.waLaporSesi.findUnique({ where: { userId: picId }, select: { terakhirAt: true } });
    expect(sesudah?.terakhirAt).toEqual(sebelum?.terakhirAt);
  });

  it("nama pekerjaan + volume → USULAN, bukan baris laporan", async () => {
    const { balasan } = await kirim({ teks: "pasang paving 20 m2" });
    expect(balasan.join("\n")).toMatch(/Usulan volume \*Pemasangan Paving Block\* hari ini: \*20 m2\*/);
    expect(balasan.join("\n")).toMatch(/Belum masuk laporan/);
    const u = await usulan("I#1");
    expect(Number(u?.volume)).toBe(20);
    expect(u?.status).toBe("menunggu");
    expect(await itemLaporan("I#1"), "WA tidak pernah menulis baris laporan").toBeNull();
  });

  it("foto berikutnya ikut usulan pekerjaan itu, dan bertanda lewat WhatsApp", async () => {
    const { balasan } = await kirim({ foto: await gambar("tiga.jpg") });
    const foto = await db.photo.findFirst({ where: { uploadedById: picId }, orderBy: { createdAt: "desc" } });
    expect(foto?.reportItemId, "tidak ditempel ke laporan").toBeNull();
    expect(foto?.waMessageId).toMatch(/^lapor-/);
    expect((await usulan("I#1"))?.photoIds).toContain(foto!.id);
    expect(balasan.join("\n")).toMatch(/diusulkan untuk pekerjaan \*Pemasangan Paving Block\*/);
  });

  it("volume baru menggantikan usulan, dan balasannya menyebut angka sebelumnya", async () => {
    const { balasan } = await kirim({ teks: "25" });
    expect(balasan.join("\n")).toMatch(/\*25 m2\* \(menggantikan usulan sebelumnya 20 m2\), dengan 1 foto/);
    expect(Number((await usulan("I#1"))?.volume)).toBe(25);
    expect(await db.waUsulan.count({ where: { locationId, lineageKey: "I#1" } }), "satu usulan, diperbarui").toBe(1);
  });

  it("volume melebihi sisa RAB ditolak saat itu juga", async () => {
    const { balasan } = await kirim({ teks: "galian tanah 60" });
    expect(balasan.join("\n")).toMatch(/melebihi sisa RAB\. Sisa yang masih bisa dilaporkan: 50 m3/);
    expect(await usulan("I#2")).toBeNull();
  });

  it("pekerjaan tanpa volume: foto diusulkan dulu, volumenya menyusul ke usulan yang sama", async () => {
    const aktif = await kirim({ teks: "galian" });
    expect(aktif.balasan.join("\n")).toMatch(/Pekerjaan aktif: \*Galian Tanah\* \(m3\)\. Foto berikutnya diusulkan/);
    await kirim({ foto: await gambar("empat.jpg") });
    const u0 = await usulan("I#2");
    expect(u0?.volume, "usulan foto saja").toBeNull();
    expect(u0?.photoIds).toHaveLength(1);

    const vol = await kirim({ teks: "galian tanah 5" });
    expect(vol.balasan.join("\n")).toMatch(/\*5 m3\*, dengan 1 foto/);
    expect(vol.balasan.join("\n"), "tanpa satuan = tidak perlu disebut").not.toMatch(/Satuan mengikuti RAB/);
    const u1 = await usulan("I#2");
    expect(u1?.id).toBe(u0?.id);
    expect(Number(u1?.volume)).toBe(5);
  });

  it("satuan TIDAK perlu diketik: yang diketik diabaikan, angkanya dalam satuan RAB dan disebut (DECISIONS 709)", async () => {
    const { balasan } = await kirim({ teks: "galian tanah 6 m2" });
    const b = balasan.join("\n");
    expect(b).toMatch(/Usulan volume \*Galian Tanah\* hari ini: \*6 m3\* \(menggantikan usulan sebelumnya 5 m3\)/);
    expect(b).toMatch(/Satuan mengikuti RAB: \*m3\*\./);
    const u = await usulan("I#2");
    expect(Number(u?.volume)).toBe(6);
    expect(u?.satuan).toBe("m3");
  });

  it("beberapa pekerjaan cocok → ditawarkan, dijawab dengan angka", async () => {
    const tawar = await kirim({ teks: "bekesting kolom 3" });
    expect(tawar.balasan.join("\n")).toMatch(/Ada 2 pekerjaan yang cocok/);
    const pilih = await kirim({ teks: "2" });
    expect(pilih.balasan.join("\n")).toMatch(/Usulan volume \*Bekesting Kolom Utama\* hari ini: \*3 m2\*/);
  });

  it("yang hanya MENDEKATI ditawarkan dulu – tidak jadi usulan sebelum dipilih", async () => {
    const tawar = await kirim({ teks: "pasang batako 2" });
    expect(tawar.balasan.join("\n")).toMatch(/Tidak ada pekerjaan yang persis cocok dengan "pasang batako"/);
    expect(await usulan("I#5"), "tebakan tidak boleh langsung jadi usulan").toBeNull();
    const nomor = /(\d+)\. 5 Pasangan Bata/.exec(tawar.balasan.join("\n"))?.[1];
    expect(nomor, "Pasangan Bata ada di antara yang ditawarkan").toBeDefined();
    const pilih = await kirim({ teks: nomor! });
    expect(pilih.balasan.join("\n")).toMatch(/Usulan volume \*Pasangan Bata\* hari ini: \*2 m2\*/);
  });

  it("tidak satu pun baris laporan harian tertulis dari WhatsApp", async () => {
    expect(await db.dailyReport.count({ where: { locationId } })).toBe(0);
  });

  it("pekerjaan yang tidak ada di RAB dijawab apa adanya", async () => {
    const { balasan } = await kirim({ teks: "atap baja ringan" });
    expect(balasan.join("\n")).toMatch(/tidak ketemu di RAB \*Matabulu Timur\*/);
  });

  it("rentetan foto dijawab SATU balasan, bukan satu per foto", async () => {
    const ev = [pesan({ foto: await gambar("r1.jpg") }), pesan({ foto: await gambar("r2.jpg") }), pesan({ foto: await gambar("r3.jpg") })];
    for (const e of ev) await antreJawaban(e);
    const sebelum = terkirim.length;
    await prosesAntrean(10);
    const balasan = terkirim.slice(sebelum).map((t) => t.teks);
    expect(balasan).toHaveLength(1);
    expect(balasan[0]).toMatch(/^3 foto tersimpan untuk \*Matabulu Timur\*/);
  });

  it("rentetan foto yang ditutup pesan teks tetap dilaporkan, SEBELUM jawaban teksnya", async () => {
    for (const e of [pesan({ foto: await gambar("t1.jpg") }), pesan({ foto: await gambar("t2.jpg") }), pesan({ teks: "galian" })])
      await antreJawaban(e);
    const sebelum = terkirim.length;
    await prosesAntrean(10);
    const balasan = terkirim.slice(sebelum).map((t) => t.teks);
    expect(balasan).toHaveLength(2);
    expect(balasan[0]).toMatch(/^2 foto tersimpan untuk \*Matabulu Timur\*/);
    expect(balasan[1]).toMatch(/^Pekerjaan aktif: \*Galian Tanah\*/);
  });

  it("'selesai' menutup sesi; foto sesudahnya tidak disimpan", async () => {
    const tutup = await kirim({ teks: "selesai" });
    expect(tutup.balasan.join("\n")).toMatch(/Sesi lapor \*Matabulu Timur\* selesai\. \d+ foto tersimpan/);
    const jumlah = await db.photo.count({ where: { uploadedById: picId } });
    const { balasan } = await kirim({ foto: await gambar("sesudah.jpg") });
    expect(balasan.join("\n")).toMatch(/lokasinya belum disebut/);
    expect(await db.photo.count({ where: { uploadedById: picId } })).toBe(jumlah);
  });

  it("nomor yang belum diverifikasi tidak bisa menulis apa pun", async () => {
    const lokasi = await kirim({ dari: NOMOR_BELUM, teks: "lokasi matabulu" });
    expect(lokasi.balasan.join("\n")).toMatch(/belum diverifikasi/);
    const foto = await kirim({ dari: NOMOR_BELUM, foto: await gambar("belum.jpg") });
    expect(foto.balasan.join("\n")).toMatch(/belum diverifikasi/);
    expect(await db.waLaporSesi.count({ where: { chatId: `${NOMOR_BELUM}@c.us` } })).toBe(0);
  });

  it("chat sesi tetap milik PIC: semua balasan lapor ke nomornya sendiri", () => {
    const keLain = terkirim.filter((t) => t.chatId !== CHAT_PIC && t.chatId !== `${NOMOR_BELUM}@c.us`);
    expect(keLain).toEqual([]);
  });
});

describe("usulan WA diputus di aplikasi (DECISIONS 707)", () => {
  const sm = () =>
    db.user.findUniqueOrThrow({
      where: { id: smId },
      select: { id: true, orgId: true, username: true, email: true, fullName: true, role: true, mustChangePassword: true },
    });
  const svc = () => import("@/lib/wa-usulan/service");
  const usulanDiEws = async () => {
    const { bangunEws } = await import("@/lib/ews/builder");
    return (await bangunEws(await sm())).filter((w) => w.ruleId === "usulan_wa_menunggu");
  };

  it("Perlu Tindakan menunjuk lokasi yang usulannya belum diperiksa", async () => {
    const menunggu = await db.waUsulan.count({ where: { locationId, status: "menunggu" } });
    expect(menunggu).toBeGreaterThan(0);
    const [w, ...lain] = await usulanDiEws();
    expect(lain).toEqual([]);
    expect(w.alasan).toContain(`${menunggu} usulan dari WhatsApp`);
    expect(w.href).toMatch(new RegExp(`/harian/${hariIni()}$`));
  });

  it("halaman laporan melihat usulan yang menunggu, lengkap dengan foto dan pengirimnya", async () => {
    const daftar = await (await svc()).usulanMenunggu(locationId, hariIni());
    const paving = daftar.find((u) => u.lineageKey === "I#1");
    expect(paving?.volume).toBe(25);
    expect(paving?.fotos).toHaveLength(1);
    expect(paving?.pengusul).toBe("PIC pic");
    expect(paving?.volumeDiLaporan).toBeNull();
  });

  it("Masukkan → baris laporan DRAFT + fotonya ditempel; usulan tercatat siapa yang memasukkan", async () => {
    const u = await usulan("I#1");
    const h = await (await svc()).masukkanUsulan(await sm(), u!.id, null);
    expect(h).toMatchObject({ volume: 25, foto: 1, gagalFoto: null });
    const item = await itemLaporan("I#1");
    expect(Number(item?.volumeDone)).toBe(25);
    const foto = await db.photo.findUnique({ where: { id: u!.photoIds[0] }, select: { reportItemId: true } });
    expect(foto?.reportItemId).toBe(item?.id);
    const sesudah = await db.waUsulan.findUniqueOrThrow({ where: { id: u!.id } });
    expect(sesudah).toMatchObject({ status: "dimasukkan", kunciMenunggu: null, diputusOlehId: smId, reportItemId: item?.id });
    const report = await db.dailyReport.findFirst({ where: { locationId }, select: { status: true } });
    expect(report?.status).toBe("draft");
  });

  it("volume boleh dibetulkan pemeriksa sebelum dimasukkan", async () => {
    const u = await usulan("I#2");
    await (await svc()).masukkanUsulan(await sm(), u!.id, 4);
    expect(Number((await itemLaporan("I#2"))?.volumeDone)).toBe(4);
  });

  it("usulan yang sudah diputus tidak bisa diputus lagi", async () => {
    const u = await db.waUsulan.findFirstOrThrow({ where: { locationId, lineageKey: "I#1" } });
    await expect((await svc()).masukkanUsulan(await sm(), u.id, null)).rejects.toThrow(/sudah diputus/);
  });

  it("Buang → usulan dibuang, fotonya tetap di kantong", async () => {
    const u = await usulan("I#5");
    expect(u?.photoIds.length).toBeGreaterThan(0);
    await (await svc()).buangUsulan(await sm(), u!.id);
    expect((await db.waUsulan.findUniqueOrThrow({ where: { id: u!.id } })).status).toBe("dibuang");
    const fotos = await db.photo.findMany({ where: { id: { in: u!.photoIds } }, select: { reportId: true } });
    expect(fotos).toHaveLength(u!.photoIds.length);
    expect(fotos.every((f) => f.reportId === null)).toBe(true);
    expect(await itemLaporan("I#5")).toBeNull();
  });

  it("usulan foto saja tanpa volume tidak bisa jadi baris baru", async () => {
    const u = await db.waUsulan.create({
      data: {
        locationId,
        reportDate: parseDateKey(hariIni())!,
        lineageKey: "I#3",
        namaPekerjaan: "Bekesting Kolom Praktis",
        satuan: "m2",
        diusulkanOlehId: picId,
        kunciMenunggu: `uji-foto-saja-${suffix}`,
      },
    });
    await expect((await svc()).masukkanUsulan(await sm(), u.id, null)).rejects.toThrow(/belum punya volume/);
  });

  it("pekerjaan bisa diganti sebelum Masukkan: angkanya ikut, satuannya satuan pekerjaan baru (DECISIONS 709)", async () => {
    // Dari WA: "bekesting kolom 3" → dipilih Bekesting Kolom UTAMA (I#4), 3 m2.
    // Ternyata yang dikerjakan kolom PRAKTIS (I#3).
    const u = await db.waUsulan.findFirstOrThrow({
      where: { locationId, lineageKey: "I#4", status: "menunggu", diusulkanOlehId: picId },
    });
    expect(Number(u.volume)).toBe(3);
    const h = await (await svc()).masukkanUsulan(await sm(), u.id, null, "I#3");
    expect(h.volume).toBe(3);
    expect(Number((await itemLaporan("I#3"))?.volumeDone)).toBe(3);
    expect(await itemLaporan("I#4"), "pekerjaan usulan WA tidak tersentuh").toBeNull();
    const sesudah = await db.waUsulan.findUniqueOrThrow({ where: { id: u.id } });
    expect(sesudah.status).toBe("dimasukkan");
    expect(sesudah.reportItemId).toBe((await itemLaporan("I#3"))?.id);
    const jejak = await db.auditLog.findFirst({
      where: { action: "wa.usulan.masukkan", resourceId: u.id },
      select: { payload: true },
    });
    expect(jejak?.payload).toMatchObject({ lineageKey: "I#4", lineageKeyDimasukkan: "I#3", pekerjaanDiganti: true });
  });

  it("usulan yang pekerjaannya sudah tidak ada di RAB bisa dimasukkan ke pekerjaan lain, bukan hanya dibuang", async () => {
    const u = await db.waUsulan.create({
      data: {
        locationId,
        reportDate: parseDateKey(hariIni())!,
        lineageKey: "I#99",
        namaPekerjaan: "Pekerjaan yang dihapus adendum",
        satuan: "m2",
        volume: 2,
        diusulkanOlehId: picId,
        kunciMenunggu: `uji-luar-rab-${suffix}`,
      },
    });
    await expect((await svc()).masukkanUsulan(await sm(), u.id, null)).rejects.toThrow(/Pilih pekerjaan lain/);
    await (await svc()).masukkanUsulan(await sm(), u.id, null, "I#5");
    expect(Number((await itemLaporan("I#5"))?.volumeDone)).toBe(2);
  });

  it("laporan yang sudah dikirim menolak usulan – aturan laporan tetap berlaku", async () => {
    await db.dailyReport.updateMany({ where: { locationId }, data: { status: "dikirim" } });
    const u = await db.waUsulan.create({
      data: {
        locationId,
        reportDate: parseDateKey(hariIni())!,
        lineageKey: "I#4",
        namaPekerjaan: "Bekesting Kolom Utama",
        satuan: "m2",
        volume: 1,
        diusulkanOlehId: picId,
        kunciMenunggu: `uji-dikirim-${suffix}`,
      },
    });
    await expect((await svc()).masukkanUsulan(await sm(), u.id, null)).rejects.toThrow(/Draft atau Perlu Koreksi/);
    expect((await db.waUsulan.findUniqueOrThrow({ where: { id: u.id } })).status, "tetap menunggu").toBe("menunggu");
  });

  it("semua usulan sudah diputus → Perlu Tindakan tidak menyebutnya lagi", async () => {
    const sisa = await db.waUsulan.findMany({ where: { locationId, status: "menunggu" }, select: { id: true } });
    expect(sisa.length).toBeGreaterThan(0);
    for (const u of sisa) await (await svc()).buangUsulan(await sm(), u.id);
    expect(await usulanDiEws()).toEqual([]);
  });
});
