// FOTO CEPAT — jepret dulu, itemnya belakangan (DECISIONS 253).
//
// Permintaan user 2026-08-05: "seringnya user itu ambil foto dulu, baru
// masukkan inputan item. jadi seringkali malah tagging lokasi tidak pas."
//
// Yang dijaga berkas ini bukan "fiturnya jalan", melainkan JANJI-nya:
//
//  1. Foto masuk TANPA induk (itu inti kantongnya).
//  2. TANPA cadangan titik proyek. Ini yang paling mudah hilang tanpa terlihat:
//     kalau suatu saat `locationLat/locationLng` ikut dikirim ke
//     `savePhotoForItem`, foto tanpa GPS akan diam-diam ditandai titik proyek —
//     persis mesin "lokasi default" yang membuat fitur ini ada. Tidak ada galat,
//     tidak ada tampilan yang berubah; hanya koordinat yang berbohong.
//  3. Cap awalnya DASAR (waktu + koordinat), bukan menyebut lokasi/kategori yang
//     pada detik memotret memang belum diketahui.
//  4. Foto hanya boleh dipakai di LOKASI TEMPAT IA DIPOTRET, dan hanya ke
//     laporan/kegiatan yang masih boleh disunting.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/r2", () => ({
  // Dikonfigurasi (supaya action tidak berhenti di gerbang awal), tapi tidak ada
  // bucket sungguhan — penulisan objek tidak pernah terjadi karena
  // `savePhotoForItem` di-mock dan foto uji sengaja tanpa arsip asli.
  isR2Configured: () => true,
  r2Delete: async () => {},
  r2Put: async () => {},
  r2GetBuffer: async () => Buffer.alloc(0),
}));

type PanggilanFoto = Parameters<typeof import("@/lib/photos").savePhotoForItem>[0];
const panggilan: PanggilanFoto[] = [];

vi.mock("@/lib/photos", async (importAsli) => {
  const asli = await importAsli<typeof import("@/lib/photos")>();
  return {
    ...asli,
    savePhotoForItem: async (input: PanggilanFoto) => {
      panggilan.push(input);
      return { id: `foto-${panggilan.length}`, gpsSource: input.stamp?.lat != null ? "device" : "none" };
    },
  };
});

let sesi = "";
vi.mock("@/lib/auth/session", async (importAsli) => {
  const asli = await importAsli<typeof import("@/lib/auth/session")>();
  return {
    ...asli,
    requireUser: async () => pengguna(sesi),
    requireCapability: async () => pengguna(sesi),
    requireLocationAccess: async () => {},
    requestIp: async () => null,
  };
});

const { db } = await import("@/lib/db");
const { simpanFotoCepatAction, pakaiFotoAction, tetapkanLokasiAction } =
  await import("@/lib/foto-cepat/actions");

const suffix = `fc${Date.now().toString(36)}`;
let locA = "";
let locB = "";
let mandorId = "";
let itemDraftId = "";
let itemFinalId = "";
let kegiatanDraftId = "";
let kegiatanFinalId = "";

async function pengguna(id: string) {
  return db.user.findUniqueOrThrow({
    where: { id },
    select: {
      id: true,
      orgId: true,
      username: true,
      email: true,
      fullName: true,
      role: true,
      mustChangePassword: true,
    },
  });
}

function fd(entries: Record<string, string | string[]>, files: File[] = []): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    if (Array.isArray(v)) v.forEach((x) => f.append(k, x));
    else f.set(k, v);
  }
  for (const file of files) f.append("photos", file);
  return f;
}

const berkas = (nama: string) => new File([new Uint8Array([1, 2, 3])], nama, { type: "image/jpeg" });

/** Meter per derajat lintang pada jari-jari yang dipakai `jarakMeter`. */
const M_PER_DEG = (2 * Math.PI * 6_371_000) / 360;
const LAT_A = -8.4;
const LAT_B = LAT_A + 474 / M_PER_DEG;
/** Geser dari A ke utara sejauh `m` meter. */
const dariA = (m: number) => (LAT_A + m / M_PER_DEG).toString();

/** Foto kantong palsu — dibuat langsung di DB (jalur unggah sudah di-mock). */
async function buatFotoKantong(locationId: string, kunci: string) {
  return db.photo.create({
    data: {
      locationId,
      r2Key: `photos/${kunci}`,
      sha256: kunci,
      bytes: 10,
      exifTakenAt: new Date("2026-08-05T02:15:00Z"),
      exifGpsLat: "-8.5000000",
      exifGpsLng: "116.1000000",
      gpsSource: "device",
      metadataSource: "device",
      uploadedById: mandorId,
    },
  });
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org FC ${suffix}`, slug: `org-${suffix}` } });
  const pkg = await db.package.create({ data: { orgId: org.id, name: `Paket FC ${suffix}` } });
  // Koordinat uji memakai jarak NYATA: B dipasang 474 m dari A — pasangan
  // paling berdekatan di katalog KNMP (Kedungmalang ↔ Kedungmutih).
  const mk = async (n: string, lat: string, lng: string) =>
    (
      await db.location.create({
        data: {
          packageId: pkg.id,
          name: `Lokasi ${n.toUpperCase()}`,
          slug: `lokasi-${n}-${suffix}`,
          village: "Desa",
          regency: "Kab",
          province: "Prov",
          // Location.isActive default FALSE. Deteksi hanya melirik lokasi aktif
          // (sama dengan pemilih lokasi di galeri foto) — lokasi yang belum
          // dijalankan memang tidak boleh jadi tujuan foto lapangan.
          isActive: true,
          gpsLat: lat,
          gpsLng: lng,
        },
      })
    ).id;
  locA = await mk("a", "-8.4000000", "116.0000000");
  locB = await mk("b", LAT_B.toFixed(7), "116.0000000");

  mandorId = (
    await db.user.create({
      data: {
        orgId: org.id,
        username: `mandor-${suffix}`,
        fullName: "Mandor FC",
        passwordHash: "x",
        role: "field_supervisor",
      },
    })
  ).id;
  sesi = mandorId;

  // Penugasan lokasi WAJIB ada: kandidat deteksi diambil dari lokasi yang boleh
  // diakses user, dan itulah sekaligus otorisasinya (foto tidak akan pernah
  // terdeteksi ke lokasi yang bukan haknya). Tanpa penugasan, daftar kandidat
  // kosong dan tidak ada yang bisa terdeteksi — perilaku yang benar, tapi bukan
  // yang sedang diuji di sini.
  await db.locationAssignment.createMany({
    data: [
      { userId: mandorId, locationId: locA },
      { userId: mandorId, locationId: locB },
    ],
  });

  const rev = await db.rabRevision.create({
    data: {
      locationId: locA,
      revisionNo: 1,
      status: "aktif",
      source: "hps_awal",
      totalValue: 1_000_000n,
      createdById: mandorId,
    },
  });
  const kategori = await db.rabNode.create({
    data: { revisionId: rev.id, kind: "kategori", code: "I", name: "PEKERJAAN PERSIAPAN", lineageKey: "I", sortOrder: 1 },
  });
  const node = await db.rabNode.create({
    data: {
      revisionId: rev.id,
      parentId: kategori.id,
      kind: "item",
      code: "I.1",
      name: "Papan Nama Proyek",
      unit: "bh",
      volume: "1",
      unitPrice: "1000000",
      amount: 1_000_000n,
      lineageKey: "I#1",
      sortOrder: 2,
    },
  });

  const mkItem = async (status: "draft" | "final", tanggal: string) => {
    const r = await db.dailyReport.create({
      data: { locationId: locA, reportDate: new Date(tanggal), status, createdById: mandorId },
    });
    return (
      await db.dailyReportItem.create({
        data: { reportId: r.id, rabNodeId: node.id, lineageKey: "I#1", volumeDone: "1", valueDone: 1_000_000n },
      })
    ).id;
  };
  itemDraftId = await mkItem("draft", "2026-08-05T00:00:00Z");
  itemFinalId = await mkItem("final", "2026-08-04T00:00:00Z");

  const mkKegiatan = async (status: "draft" | "final", tanggal: string) =>
    (
      await db.fieldActivity.create({
        data: {
          locationId: locA,
          activityDate: new Date(tanggal),
          type: "kunjungan",
          title: `Kegiatan ${status}`,
          status,
          createdById: mandorId,
        },
      })
    ).id;
  kegiatanDraftId = await mkKegiatan("draft", "2026-08-05T00:00:00Z");
  kegiatanFinalId = await mkKegiatan("final", "2026-08-03T00:00:00Z");
});

afterAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

beforeEach(() => {
  panggilan.length = 0;
});

describe("menyimpan ke kantong", () => {
  it("foto masuk TANPA induk", async () => {
    const hasil = await simpanFotoCepatAction(
      {},
      fd({ gpsLat: dariA(20), gpsLng: "116.0" }, [berkas("a.jpg")]),
    );
    expect(hasil.error).toBeUndefined();
    expect(panggilan).toHaveLength(1);
    expect(panggilan[0].reportId).toBeNull();
    expect(panggilan[0].reportItemId).toBeNull();
    expect(panggilan[0].activityId).toBeNull();
  });

  it("TIDAK mengirim titik proyek sebagai cadangan koordinat", async () => {
    // Pagar terpenting berkas ini. Lokasi uji PUNYA gpsLat/gpsLng, jadi kalau
    // suatu saat kode ini meneruskannya, uji ini yang menangkapnya — bukan
    // pengguna yang menemukan 96% fotonya bertitik sama.
    await simpanFotoCepatAction({}, fd({ gpsLat: dariA(20), gpsLng: "116.0" }, [berkas("b.jpg")]));
    expect(panggilan[0].stamp?.locationLat ?? null).toBeNull();
    expect(panggilan[0].stamp?.locationLng ?? null).toBeNull();
    expect(panggilan[0].stamp?.fallbackMode).toBe("none");
  });

  it("sumber SELALU kamera — kiriman yang mengaku 'gallery' pun diabaikan", async () => {
    // Sumber tidak boleh datang dari input klien (DECISIONS 255): kalau dipercaya,
    // jalur galeri bisa dihidupkan lagi dari luar tanpa satu baris pun berubah
    // di server, dan seluruh jaminan "koordinat & jam benar" ikut bocor.
    await simpanFotoCepatAction(
      {},
      fd({ photoSource: "gallery", galleryAtSite: "on", gpsLat: dariA(20), gpsLng: "116.0" }, [
        berkas("nyamar.jpg"),
      ]),
    );
    expect(panggilan[0].stamp?.source).toBe("camera");
    expect(panggilan[0].stamp?.atSite ?? false).toBe(false);
  });

  it("cap awalnya DASAR — tidak menyebut yang belum diketahui", async () => {
    await simpanFotoCepatAction({}, fd({ gpsLat: dariA(20), gpsLng: "116.0" }, [berkas("c.jpg")]));
    const s = panggilan[0].stamp!;
    expect(s.locationLabel).toBeNull();
    expect(s.companyName).toBeNull();
    expect(s.categoryName).toBeNull();
    expect(s.workName).toBeNull();
    // Pelapor TETAP dicap: itu identitas yang memang sudah diketahui saat jepret.
    expect(s.reporterName).toBe("Mandor FC");
  });

  it("foto tanpa koordinat tetap tersimpan, tapi DISEBUT", async () => {
    // Menolaknya akan mengembalikan orang ke aplikasi kamera HP; mendiamkannya
    // membuat cacatnya baru ketahuan saat laporan disusun. Jadi: simpan + sebut.
    const hasil = await simpanFotoCepatAction(
      {},
      fd({}, [berkas("d.jpg")]),
    );
    expect(hasil.error).toBeUndefined();
    expect(hasil.warning).toMatch(/TANPA koordinat/i);
  });

  it("tanpa berkas ditolak", async () => {
    const hasil = await simpanFotoCepatAction({}, fd({}));
    expect(hasil.error).toBeTruthy();
    expect(panggilan).toHaveLength(0);
  });
});

describe("invarian induk foto di DATABASE", () => {
  // Migrasi 20260805090000 MELONGGARKAN constraint lama "tepat satu induk"
  // menjadi "paling banyak satu". Yang dilonggarkan dan yang TIDAK dilonggarkan
  // sama-sama dikunci di sini — kalau nanti seseorang mengembalikan `= 1`,
  // seluruh Foto Cepat mati; kalau seseorang membuangnya sama sekali, foto bisa
  // jadi lampiran laporan DAN kegiatan sekaligus (dua kebenaran yang bisa
  // berbeda). Keduanya cacat senyap.
  it("NOL induk diterima — itu bentuk foto kantong", async () => {
    const f = await buatFotoKantong(locA, `${suffix}-nol`);
    expect(f.reportId).toBeNull();
    expect(f.activityId).toBeNull();
  });

  it("DUA induk tetap DITOLAK database", async () => {
    const f = await buatFotoKantong(locA, `${suffix}-dua`);
    const keg = await db.fieldActivity.findFirstOrThrow({ where: { id: kegiatanDraftId } });
    const item = await db.dailyReportItem.findUniqueOrThrow({ where: { id: itemDraftId } });
    await expect(
      db.photo.update({
        where: { id: f.id },
        data: { reportId: item.reportId, activityId: keg.id },
      }),
    ).rejects.toThrow(/parent_xor/i);
  });
});

describe("memakai foto dari kantong", () => {
  it("menempel ke item laporan yang masih draft", async () => {
    const f = await buatFotoKantong(locA, `${suffix}-ok`);
    const hasil = await pakaiFotoAction(
      {},
      fd({ photoIds: [f.id], tujuan: "laporan", reportItemId: itemDraftId }),
    );
    expect(hasil.error).toBeUndefined();
    const sesudah = await db.photo.findUniqueOrThrow({ where: { id: f.id } });
    expect(sesudah.reportItemId).toBe(itemDraftId);
    expect(sesudah.activityId).toBeNull();
  });

  it("WAKTU & KOORDINAT tidak berubah saat dipakai", async () => {
    // Inti janji fiturnya. Menurunkannya ulang dari induk barunya (tanggal
    // laporan, titik proyek) akan mengembalikan persis cacat yang diperbaiki.
    const f = await buatFotoKantong(locA, `${suffix}-tetap`);
    await pakaiFotoAction({}, fd({ photoIds: [f.id], tujuan: "kegiatan", kegiatanId: kegiatanDraftId }));
    const sesudah = await db.photo.findUniqueOrThrow({ where: { id: f.id } });
    expect(sesudah.exifTakenAt?.toISOString()).toBe(f.exifTakenAt?.toISOString());
    expect(sesudah.exifGpsLat?.toString()).toBe(f.exifGpsLat?.toString());
    expect(sesudah.exifGpsLng?.toString()).toBe(f.exifGpsLng?.toString());
    expect(sesudah.gpsSource).toBe("device");
  });

  it("foto dari lokasi LAIN ditolak", async () => {
    const f = await buatFotoKantong(locB, `${suffix}-beda`);
    const hasil = await pakaiFotoAction(
      {},
      fd({ photoIds: [f.id], tujuan: "laporan", reportItemId: itemDraftId }),
    );
    expect(hasil.error).toMatch(/lokasi lain/i);
    const sesudah = await db.photo.findUniqueOrThrow({ where: { id: f.id } });
    expect(sesudah.reportItemId).toBeNull();
  });

  it("laporan yang sudah final ditolak", async () => {
    // Menambah lampiran ke laporan yang sudah disahkan berarti mengubah berkas
    // yang sudah dipertanggungjawabkan orang lain.
    const f = await buatFotoKantong(locA, `${suffix}-final`);
    const hasil = await pakaiFotoAction(
      {},
      fd({ photoIds: [f.id], tujuan: "laporan", reportItemId: itemFinalId }),
    );
    expect(hasil.error).toMatch(/dikirim|disetujui/i);
  });

  it("kegiatan yang sudah final ditolak", async () => {
    const f = await buatFotoKantong(locA, `${suffix}-kegfinal`);
    const hasil = await pakaiFotoAction(
      {},
      fd({ photoIds: [f.id], tujuan: "kegiatan", kegiatanId: kegiatanFinalId }),
    );
    expect(hasil.error).toMatch(/difinalkan/i);
  });

  it("foto tanpa arsip asli TETAP dipakai, capnya tetap dasar — dan itu disebut", async () => {
    // Kegagalan melengkapi cap tidak boleh membatalkan penautan: foto & datanya
    // sudah benar, yang kurang hanya teks di gambarnya.
    const f = await buatFotoKantong(locA, `${suffix}-noarsip`);
    const hasil = await pakaiFotoAction(
      {},
      fd({ photoIds: [f.id], tujuan: "kegiatan", kegiatanId: kegiatanDraftId }),
    );
    expect(hasil.error).toBeUndefined();
    expect(hasil.warning).toMatch(/cap dasar/i);
    const sesudah = await db.photo.findUniqueOrThrow({ where: { id: f.id } });
    expect(sesudah.activityId).toBe(kegiatanDraftId);
  });
});

/**
 * DETEKSI LOKASI DARI GEOTAG (DECISIONS 254).
 *
 * Aturannya sudah dikunci uji unit; yang dijaga DI SINI adalah bahwa aturan itu
 * benar-benar dipakai jalur simpan, dan bahwa kegagalan deteksi TIDAK membuang
 * fotonya. Dua-duanya cacat senyap kalau rusak: foto yang mendarat di desa
 * sebelah tampak normal, dan foto yang dibuang tidak meninggalkan jejak apa pun.
 */
describe("deteksi lokasi dari koordinat foto", () => {
  it("berdiri di lokasi A → foto terdeteksi ke A, tanpa memilih apa pun", async () => {
    const hasil = await simpanFotoCepatAction(
      {},
      fd({ gpsLat: dariA(30), gpsLng: "116.0" }, [berkas("dekat-a.jpg")]),
    );
    expect(hasil.error).toBeUndefined();
    expect(panggilan).toHaveLength(1);
    expect(panggilan[0].locationId).toBe(locA);
    // Nama lokasi yang terdeteksi WAJIB disebut ke pelapor — deteksi diam-diam
    // tidak bisa dipercaya siapa pun.
    expect(`${hasil.ok ?? hasil.warning}`).toMatch(/Lokasi A/);
  });

  it("di antara dua lokasi berdekatan → TIDAK menebak, foto tetap tersimpan", async () => {
    // Titik tengah pasangan 474 m. Yang benar di sini adalah menolak memutuskan.
    const hasil = await simpanFotoCepatAction(
      {},
      fd({ gpsLat: dariA(237), gpsLng: "116.0" }, [berkas("ambigu.jpg")]),
    );
    expect(hasil.error).toBeUndefined();
    expect(panggilan[0].locationId).toBeNull();
    expect(hasil.warning).toMatch(/belum ketahuan lokasinya/i);
    expect(hasil.warning).toMatch(/berdekatan/i);
  });

  it("jauh dari semua lokasi → tidak terdeteksi, sebabnya disebut", async () => {
    const hasil = await simpanFotoCepatAction(
      {},
      fd({ gpsLat: "-6.8700000", gpsLng: "112.3" }, [berkas("jauh.jpg")]),
    );
    expect(panggilan[0].locationId).toBeNull();
    expect(hasil.warning).toMatch(/km/);
  });

  it("tanpa koordinat → tidak terdeteksi, foto TETAP tersimpan", async () => {
    // Membuang fotonya berarti menghilangkan bukti lapangan hanya karena kita
    // belum tahu nama raknya.
    const hasil = await simpanFotoCepatAction({}, fd({}, [berkas("nogps.jpg")]));
    expect(hasil.error).toBeUndefined();
    expect(panggilan).toHaveLength(1);
    expect(panggilan[0].locationId).toBeNull();
    expect(panggilan[0].locationSlug).toBe("_kantong");
  });

  it("satu kiriman, dua lokasi berbeda — dideteksi PER BERKAS", async () => {
    // Unggahan borongan dari galeri/cloud bisa memuat foto dari beberapa lokasi.
    // Memaksakan satu lokasi untuk seluruh kiriman akan menaruh sebagian di
    // tempat yang salah — persis cacat yang sedang diperbaiki.
    await simpanFotoCepatAction(
      {},
      fd({ gpsLat: dariA(30), gpsLng: "116.0" }, [
        berkas("satu.jpg"),
        berkas("dua.jpg"),
      ]),
    );
    expect(panggilan).toHaveLength(2);
    expect(panggilan.every((p) => p.locationId === locA)).toBe(true);
  });
});

describe("foto tanpa lokasi tidak bisa diselundupkan", () => {
  it("dipakai di laporan → DITOLAK sebelum lokasinya ditetapkan", async () => {
    // Menautkannya akan MENETAPKAN lokasinya diam-diam ke lokasi laporan itu,
    // padahal deteksi tadi justru menolak menebak.
    const f = await db.photo.create({
      data: {
        locationId: null,
        r2Key: `photos/_kantong/${suffix}-lepas`,
        sha256: `${suffix}-lepas`,
        bytes: 10,
        gpsSource: "none",
        metadataSource: "server",
        uploadedById: mandorId,
      },
    });
    const hasil = await pakaiFotoAction(
      {},
      fd({ photoIds: [f.id], tujuan: "laporan", reportItemId: itemDraftId }),
    );
    expect(hasil.error).toMatch(/belum ketahuan lokasinya/i);
  });

  it("ditetapkan manual dulu, baru bisa dipakai", async () => {
    const f = await db.photo.create({
      data: {
        locationId: null,
        r2Key: `photos/_kantong/${suffix}-tetap2`,
        sha256: `${suffix}-tetap2`,
        bytes: 10,
        gpsSource: "none",
        metadataSource: "server",
        uploadedById: mandorId,
      },
    });
    const t = await tetapkanLokasiAction({}, fd({ photoIds: [f.id], locationId: locA }));
    expect(t.error).toBeUndefined();
    expect((await db.photo.findUniqueOrThrow({ where: { id: f.id } })).locationId).toBe(locA);

    const hasil = await pakaiFotoAction(
      {},
      fd({ photoIds: [f.id], tujuan: "kegiatan", kegiatanId: kegiatanDraftId }),
    );
    expect(hasil.error).toBeUndefined();
  });
});
