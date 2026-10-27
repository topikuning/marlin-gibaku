/*
 * PERSETUJUAN AKTIVASI ADENDUM LEWAT WHATSAPP (DECISIONS 714).
 *
 * Permintaan user 2026-10-27: *"saat ada yg minta aktivasi draft rab/adendum,
 * program director dapat notifikasi wa, dan bisa approve by wa"*. Pilihan user:
 * dikirim begitu AM/PM/SM menyetujui; SETUJU dari PD langsung mengaktifkan bila
 * persetujuannya lengkap; hanya nomor TERVERIFIKASI; pengecualian sempit pada
 * pagar nomor pribadi.
 *
 * Kiriman melewati gateway SUNGGUHAN – hanya klien WAHA yang ditiru – supaya
 * pagar nomor pribadi (DECISIONS 433) dan pengecualiannya ikut teruji.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

/** Siapa yang sedang login saat server action dipanggil. */
let sesi = "sm";
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

const terkirim: { chatId: string; teks: string }[] = [];
/** ID pesan keluar unik sepanjang berkas – `wa_outbound.wa_message_id` unique. */
let idKeluar = 0;
vi.mock("@/lib/waha/client", async (importAsli) => {
  const asli = await importAsli<typeof import("@/lib/waha/client")>();
  return {
    ...asli,
    getSessionStatus: async () => ({ name: "default", status: "WORKING", me: null }),
    getIdentitasMarlin: async () => ({ nomor: null, lid: null }),
    lidKeNomor: async () => null,
    kirimMentahTeks: async (chatId: string, text: string) => {
      terkirim.push({ chatId, teks: text });
      return `keluar-${Date.now()}-${++idKeluar}`;
    },
  };
});
vi.mock("@/lib/ai/structured", () => ({
  aiStructured: async () => ({ ok: false, errorCode: "provider_down", error: "uji", meta: null, attempts: 1 }),
}));

const { db } = await import("@/lib/db");
const { approveRevisionAction } = await import("@/app/(app)/lokasi/[slug]/rab/actions");
const { updateUserProfile } = await import("@/lib/users/actions");
const { jawabPertanyaanWa } = await import("@/lib/waha/tanya");
const { antreJawaban } = await import("@/lib/waha/antrean");
const { sendWaMessage } = await import("@/lib/waha/gateway");
const { permintaanWaMenunggu } = await import("@/lib/rab/persetujuan-wa");

const suffix = `wp${Date.now().toString(36)}`;
/** Nomor unik per putaran uji – sisa putaran lain tidak boleh membuat nomornya "dipakai dua akun". */
const putaran = String(Date.now() % 1_000_000).padStart(6, "0");
const NOMOR = {
  pd: `6281${putaran}01`,
  pd2: `6281${putaran}02`,
  pdBelum: `6281${putaran}03`,
  sm: `6281${putaran}09`,
  mandor: `6281${putaran}10`,
  asing: `6281${putaran}99`,
};
let orgId = "";
let locationId = "";
const orang: Record<string, string> = {};
let nomorPesan = 0;
let detik = Math.floor(Date.now() / 1000);

async function pengguna(tag: string) {
  return db.user.findUniqueOrThrow({
    where: { id: orang[tag]! },
    select: { id: true, orgId: true, username: true, email: true, fullName: true, role: true, mustChangePassword: true },
  });
}

async function buatUser(tag: string, role: string, nomor: string | null, verified: boolean) {
  const u = await db.user.create({
    data: {
      orgId,
      username: `${tag}-${suffix}`,
      fullName: tag.toUpperCase(),
      passwordHash: "x",
      role: role as never,
      waNumber: nomor ? `${nomor}@c.us` : null,
      waVerifiedAt: verified ? new Date() : null,
    },
  });
  orang[tag] = u.id;
}

/** Revisi tanpa node – cukup untuk gerbang, aktivasi, dan pesan. */
async function buatRevisi(no: number, status: "aktif" | "draft") {
  return db.rabRevision.create({
    data: {
      locationId,
      revisionNo: no,
      status,
      source: no === 1 ? "hps_awal" : "adendum",
      totalValue: 1_000_000n * BigInt(no),
      createdById: orang.pd!,
    },
  });
}

async function setujuiDiWeb(tag: string, revisionId: string) {
  sesi = tag;
  const fd = new FormData();
  fd.set("revisionId", revisionId);
  return approveRevisionAction(undefined, fd);
}

/** Pesan WA masuk dari `dari`. Diantrekan dulu – itu bukti "chat ini menyapa duluan" bagi balasan. */
async function kirimWa(dari: string, teks: string) {
  const body = {
    event: "message",
    payload: { id: `wp-${suffix}-${++nomorPesan}`, from: `${dari}@c.us`, fromMe: false, body: teks, timestamp: detik++ },
  };
  await antreJawaban(body);
  const sebelum = terkirim.length;
  const hasil = await jawabPertanyaanWa(body);
  const baru = terkirim.slice(sebelum);
  return {
    hasil,
    balasan: baru.filter((t) => t.chatId === `${dari}@c.us`).map((t) => t.teks).join("\n"),
    ke: (nomor: string) => baru.filter((t) => t.chatId === `${nomor}@c.us`).map((t) => t.teks).join("\n"),
  };
}

const pesanKe = (nomor: string) => terkirim.filter((t) => t.chatId === `${nomor}@c.us`).map((t) => t.teks);
const kodeDari = (teks: string) => /SETUJU (\d{4})/.exec(teks)?.[1] ?? null;

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: `Org WP ${suffix}`, slug: `org-${suffix}` } });
  orgId = org.id;
  const pkg = await db.package.create({ data: { orgId, name: `Paket WP ${suffix}`, stage: "pelaksanaan" } });
  const loc = await db.location.create({
    data: { packageId: pkg.id, name: "Songbanyu Uji", slug: `songbanyu-${suffix}`, village: "D", regency: "K", province: "P" },
  });
  locationId = loc.id;
  await buatUser("pd", "program_director", NOMOR.pd, true);
  await buatUser("pd2", "program_director", NOMOR.pd2, true);
  await buatUser("pdbelum", "program_director", NOMOR.pdBelum, false);
  await buatUser("pdtanpa", "program_director", null, false);
  await buatUser("sm", "site_manager", NOMOR.sm, true);
  await buatUser("mandor", "field_supervisor", NOMOR.mandor, true);
  await buatUser("sa", "super_admin", null, false);
  for (const tag of ["sm", "mandor"]) {
    await db.locationAssignment.create({ data: { userId: orang[tag]!, locationId } });
  }
});

afterAll(async () => {
  await db.waReplyJob.deleteMany({ where: { waMessageId: { startsWith: `wp-${suffix}` } } });
  await db.$executeRawUnsafe('TRUNCATE TABLE "organizations" RESTART IDENTITY CASCADE');
  await db.$disconnect();
});

beforeEach(async () => {
  terkirim.length = 0;
  await db.rabRevision.deleteMany({ where: { locationId } });
});

describe("permintaan ke Program Director", () => {
  it("SM menyetujui adendum → PD terverifikasi dikirimi WA berkode walau kiriman pribadi DIMATIKAN", async () => {
    await buatRevisi(1, "aktif");
    const draft = await buatRevisi(2, "draft");
    const hasil = await setujuiDiWeb("sm", draft.id);
    expect(hasil?.error).toBeUndefined();

    const kePd = pesanKe(NOMOR.pd).join("\n");
    expect(kePd).toMatch(/Persetujuan aktivasi adendum/);
    expect(kePd).toMatch(/Songbanyu Uji/);
    expect(kePd).toMatch(/Rp 2\.000\.000 \(pra-PPN\)/);
    expect(kePd).toMatch(/SM \(Site Manager\)/);
    expect(kodeDari(kePd)).not.toBeNull();
    expect(pesanKe(NOMOR.pd2)).toHaveLength(1);

    // Yang TIDAK dikirimi disebut namanya dan sebabnya, bukan didiamkan.
    expect(hasil?.success).toMatch(/dikirim lewat WhatsApp ke PD, PD2/);
    expect(hasil?.success).toMatch(/PDBELUM tidak dikirimi WA: nomor WA-nya belum diverifikasi/);
    expect(hasil?.success).toMatch(/PDTANPA tidak dikirimi WA: belum ada nomor WA/);
    expect(pesanKe(NOMOR.pdBelum), "nomor belum terverifikasi tidak menerima isi draft").toHaveLength(0);

    const baris = await db.waPersetujuan.findMany({ where: { revisionId: draft.id } });
    expect(baris.map((b) => b.status)).toEqual(["menunggu", "menunggu"]);
    expect(baris.every((b) => b.draftDiubahPada.getTime() === draft.updatedAt.getTime())).toBe(true);

    // Panel persetujuan menyebut siapa yang sudah dikirimi dan belum membalas…
    expect((await permintaanWaMenunggu(draft.id)).map((w) => w.nama)).toEqual(["PD", "PD2"]);
    // …dan berhenti menyebutnya begitu draft berubah (kodenya tak berlaku lagi).
    await new Promise((ok) => setTimeout(ok, 10));
    await db.rabRevision.update({ where: { id: draft.id }, data: { totalValue: 7_000_000n } });
    expect(await permintaanWaMenunggu(draft.id)).toEqual([]);
  });

  it("menyetujui lagi tanpa perubahan draft tidak mengirim ulang", async () => {
    await buatRevisi(1, "aktif");
    const draft = await buatRevisi(2, "draft");
    await setujuiDiWeb("sm", draft.id);
    terkirim.length = 0;
    const lagi = await setujuiDiWeb("sm", draft.id);
    expect(pesanKe(NOMOR.pd)).toHaveLength(0);
    expect(lagi?.success).toMatch(/PD, PD2 sudah dikirimi permintaan WA untuk isi draft ini/);
  });

  it("PD yang menyetujui di web tidak memicu WA; HPS awal juga tidak", async () => {
    await buatRevisi(1, "aktif");
    const draft = await buatRevisi(2, "draft");
    await setujuiDiWeb("pd", draft.id);
    expect(terkirim).toHaveLength(0);

    await db.rabRevision.deleteMany({ where: { locationId } });
    const awal = await buatRevisi(1, "draft");
    await setujuiDiWeb("sm", awal.id);
    expect(terkirim).toHaveLength(0);
  });

  it("penanda persetujuan tidak membuka pagar untuk nomor lain", async () => {
    await buatRevisi(1, "aktif");
    const draft = await buatRevisi(2, "draft");
    await setujuiDiWeb("sm", draft.id);
    const baris = await db.waPersetujuan.findFirstOrThrow({ where: { revisionId: draft.id } });
    terkirim.length = 0;

    const asing = await sendWaMessage({
      kind: "teks",
      destination: `${NOMOR.asing}@c.us`,
      payload: { teks: "uji" },
      sourceType: "uji",
      persetujuanAktivasiId: baris.id,
    });
    expect(asing.status).toBe("ditolak");
    const tanpaPenanda = await sendWaMessage({
      kind: "teks",
      destination: `${NOMOR.pd}@c.us`,
      payload: { teks: "uji" },
      sourceType: "uji",
    });
    expect(tanpaPenanda.status, "kiriman pribadi lain tetap tertahan").toBe("ditolak");
    expect(terkirim).toHaveLength(0);
  });
});

describe("balasan SETUJU", () => {
  async function siapkan() {
    await buatRevisi(1, "aktif");
    const draft = await buatRevisi(2, "draft");
    await setujuiDiWeb("sm", draft.id);
    const kode = kodeDari(pesanKe(NOMOR.pd).join("\n"))!;
    terkirim.length = 0;
    return { draft, kode };
  }

  it("SETUJU <kode> → suara PD tercatat, draft LANGSUNG aktif, SM dikabari, permintaan PD lain batal", async () => {
    const { draft, kode } = await siapkan();
    const r = await kirimWa(NOMOR.pd, `setuju ${kode}`);
    expect(r.hasil.alasan).toMatch(/^persetujuan:/);
    expect(r.balasan).toMatch(/Persetujuan Anda tercatat/);
    expect(r.balasan).toMatch(/Revisi #2/);

    const rev = await db.rabRevision.findUniqueOrThrow({ where: { id: draft.id } });
    expect(rev.status).toBe("aktif");
    expect(rev.awaitingCco).toBe(true);
    const suara = await db.rabRevisionApproval.findMany({ where: { revisionId: draft.id }, select: { userId: true } });
    expect(suara.map((s) => s.userId).sort()).toEqual([orang.pd, orang.sm].sort());

    expect(r.ke(NOMOR.sm)).toMatch(/PD menyetujui draft revisi #2 \*Songbanyu Uji\* lewat WhatsApp/);
    const baris = await db.waPersetujuan.findMany({
      where: { revisionId: draft.id },
      select: { untukUserId: true, status: true },
    });
    expect(baris.find((b) => b.untukUserId === orang.pd)?.status).toBe("disetujui");
    expect(baris.find((b) => b.untukUserId === orang.pd2)?.status).toBe("batal");
    expect(
      await db.auditLog.count({ where: { action: "rab.aktivasi_lewat_wa", resourceId: draft.id, userId: orang.pd } }),
    ).toBe(1);

    // Kode yang sama dikirim lagi: tidak ada aktivasi kedua.
    const lagi = await kirimWa(NOMOR.pd, `SETUJU ${kode}`);
    expect(lagi.balasan).toMatch(/tidak ada di antara persetujuan yang menunggu/);
  });

  it("'setuju' tanpa kode → diminta kodenya, tidak ada yang berubah", async () => {
    const { draft, kode } = await siapkan();
    const r = await kirimWa(NOMOR.pd, "setuju");
    expect(r.balasan).toContain(`SETUJU ${kode}`);
    expect((await db.rabRevision.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("draft");
  });

  it("kode salah → ditolak, draft tetap draft", async () => {
    const { draft, kode } = await siapkan();
    const salah = kode === "1234" ? "4321" : "1234";
    const r = await kirimWa(NOMOR.pd, `SETUJU ${salah}`);
    expect(r.balasan).toMatch(/tidak ada di antara persetujuan/);
    expect((await db.rabRevision.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("draft");
  });

  it("draft berubah sesudah pesan → kode batal, suara PD TIDAK tercatat", async () => {
    const { draft, kode } = await siapkan();
    await new Promise((ok) => setTimeout(ok, 10));
    await db.rabRevision.update({ where: { id: draft.id }, data: { totalValue: 9_999_999n } });
    const r = await kirimWa(NOMOR.pd, `SETUJU ${kode}`);
    expect(r.balasan).toMatch(/sudah diubah sesudah pesan permintaan itu/);
    expect(await db.rabRevisionApproval.count({ where: { revisionId: draft.id, userId: orang.pd } })).toBe(0);
    const baris = await db.waPersetujuan.findFirstOrThrow({ where: { revisionId: draft.id, untukUserId: orang.pd } });
    expect(baris.status).toBe("batal");
  });

  it("nomor yang belum diverifikasi tidak bisa menyetujui", async () => {
    const { draft, kode } = await siapkan();
    await db.user.update({ where: { id: orang.pd! }, data: { waVerifiedAt: null } });
    try {
      const r = await kirimWa(NOMOR.pd, `SETUJU ${kode}`);
      expect(r.balasan).toMatch(/belum diverifikasi/);
      expect(await db.rabRevisionApproval.count({ where: { revisionId: draft.id, userId: orang.pd } })).toBe(0);
      expect((await db.rabRevision.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("draft");
    } finally {
      await db.user.update({ where: { id: orang.pd! }, data: { waVerifiedAt: new Date() } });
    }
  });

  it("bukan Program Director → ditolak", async () => {
    await siapkan();
    const r = await kirimWa(NOMOR.mandor, "SETUJU 1234");
    expect(r.balasan).toMatch(/hanya untuk Program Director/);
  });

  it("persetujuan AM/PM/SM dicabut sebelum PD membalas → suara PD tercatat, draft belum aktif", async () => {
    const { draft, kode } = await siapkan();
    await db.rabRevisionApproval.deleteMany({ where: { revisionId: draft.id, userId: orang.sm } });
    const r = await kirimWa(NOMOR.pd, `SETUJU ${kode}`);
    expect(r.balasan).toMatch(/masih menunggu persetujuan Area Manager/);
    expect((await db.rabRevision.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("draft");
    expect(await db.rabRevisionApproval.count({ where: { revisionId: draft.id, userId: orang.pd } })).toBe(1);
  });
});

describe("Tanya MARLIN dimatikan (bawaan)", () => {
  it("pertanyaan dari pengguna dikenal dijawab bahwa fiturnya dimatikan", async () => {
    const r = await kirimWa(NOMOR.sm, "berapa progres songbanyu?");
    expect(r.balasan).toMatch(/Tanya MARLIN sedang dimatikan sementara/);
    expect(r.balasan).toMatch(/ketik \*lokasi\*/);
  });

  it("nomor tak dikenal tetap didiamkan", async () => {
    const r = await kirimWa(NOMOR.asing, "berapa progres songbanyu?");
    expect(r.hasil.dijawab).toBe(false);
    expect(r.balasan).toBe("");
  });
});

describe("mengganti nomor WA di Master menggugurkan verifikasinya", () => {
  const ubah = async (waNumber: string) => {
    sesi = "sa";
    const fd = new FormData();
    fd.set("userId", orang.sm!);
    fd.set("fullName", "SM");
    fd.set("waNumber", waNumber);
    return updateUserProfile(undefined, fd);
  };

  it("nomor sama dalam bentuk lain → tetap terverifikasi; nomor beda → gugur", async () => {
    expect((await ubah(`0${NOMOR.sm.slice(2)}`))?.error).toBeUndefined();
    expect((await db.user.findUniqueOrThrow({ where: { id: orang.sm! } })).waVerifiedAt).not.toBeNull();
    expect((await ubah(`081${putaran}55`))?.error).toBeUndefined();
    expect((await db.user.findUniqueOrThrow({ where: { id: orang.sm! } })).waVerifiedAt).toBeNull();
  });
});
