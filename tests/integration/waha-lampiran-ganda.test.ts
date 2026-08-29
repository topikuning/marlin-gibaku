// SATU BERKAS, SATU KARTU — PESAN YANG DIULANG TIDAK BOLEH DITANGKAP DUA KALI.
//
// Keluhan user 2026-08-28, dengan tangkapan layar: dua kartu kembar di
// `/lampiran` untuk `Surat_Undangan_PCM_Puncel.pdf` — nama, ukuran (453 KB),
// pengirim, dan jam (17.17) sama persis, dua-duanya menunggu ketetapan.
//
// Sebabnya bukan orang mengirim dua kali. `ingest.ts` meng-upsert PESANnya
// secara idempoten, tetapi hanya cabang RACE (dua INSERT berbarengan → P2002)
// yang berhenti lebih awal. Pengiriman ulang yang BERURUTAN — WAHA memancarkan
// `message` dan `message.any` untuk pesan yang sama, dan webhook yang gagal
// akan dicoba lagi — jatuh ke `update: {}`, mengembalikan id baris yang sama,
// lalu lanjut menangkap lampirannya sekali lagi.
//
// Penyaring sidik jari di `tangkapLampiran` tidak menolong: ia menghindari
// mengunduh dan menulis BERKASnya dua kali, tetapi barisnya tetap dibuat.
//
// Akibatnya orang diminta memutuskan dua kali untuk satu berkas — dan yang
// lebih buruk, bisa menetapkannya berbeda: satu "surat", satu "bukan bahan
// kerja", tanpa ada yang tahu mana yang berlaku.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.APP_ENV ??= "test";
process.env.SESSION_SECRET ??= "test-secret-0123456789abcdef-0123456789abcdef";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Map() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

/*
 * Unduhan diganti: uji ini tentang BERAPA BARIS yang lahir, bukan tentang HTTP.
 * Tanpa penggantian ini berkasnya benar-benar diambil lewat jaringan, dan
 * ujinya jadi bergantung pada hal yang tidak ia uji.
 */
const ISI = Buffer.from("%PDF-1.4 surat undangan uji\n");
let jumlahUnduh = 0;
vi.mock("undici", async (asli) => {
  const m = (await asli()) as Record<string, unknown>;
  return {
    ...m,
    fetch: async () => {
      jumlahUnduh += 1;
      return new Response(new Uint8Array(ISI), {
        status: 200,
        headers: { "content-type": "application/pdf" },
      });
    },
  };
});
const fetchAsli = globalThis.fetch;
globalThis.fetch = (async () => {
  jumlahUnduh += 1;
  return new Response(new Uint8Array(ISI), {
    status: 200,
    headers: { "content-type": "application/pdf" },
  });
}) as typeof fetch;

const { db } = await import("@/lib/db");
const { ingestWaEvent } = await import("@/lib/waha/ingest");

const suffix = Math.random().toString(36).slice(2, 8);
const GRUP = "12036300000000009@g.us";
let packageId = "";

/** Payload webhook WAHA untuk satu pesan bermedia; `id` menentukan identitasnya. */
function eventMedia(id: string) {
  return {
    event: "message",
    session: "default",
    payload: {
      id,
      timestamp: 1_690_000_000,
      from: GRUP,
      author: "6281234757999@c.us",
      body: "mohon dibaca suratnya",
      hasMedia: true,
      media: {
        url: "https://waha.contoh.test/media/surat.pdf",
        mimetype: "application/pdf",
        filename: "Surat_Undangan_PCM_Puncel.pdf",
      },
    },
  };
}

beforeAll(async () => {
  const org = await db.organization.create({
    data: { name: `Org ${suffix}`, slug: `olg-${suffix}` },
  });
  const pkg = await db.package.create({
    data: { orgId: org.id, name: `Paket ${suffix}`, waGroupId: GRUP },
    select: { id: true },
  });
  packageId = pkg.id;
});

afterAll(async () => {
  globalThis.fetch = fetchAsli;
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE wa_attachments, wa_messages, packages, organizations RESTART IDENTITY CASCADE`,
  );
  await db.$disconnect();
});

describe("pesan bermedia yang dikirim ulang webhook", () => {
  it("REGRESI: satu pesan → SATU baris lampiran, walau webhooknya mengulang", async () => {
    const id = `m-${suffix}-ulang`;

    const pertama = await ingestWaEvent(eventMedia(id));
    expect(pertama.stored, pertama.reason).toBe(true);

    // `message.any` menyusul untuk pesan yang SAMA — bukan race, berurutan.
    const kedua = await ingestWaEvent(eventMedia(id));
    expect(kedua.stored, kedua.reason).toBe(true);

    const pesan = await db.waMessage.count({ where: { waMessageId: id } });
    expect(pesan, "pesannya sendiri memang sudah idempoten").toBe(1);

    const lampiran = await db.waAttachment.findMany({
      where: { message: { waMessageId: id } },
      select: { id: true, fileName: true },
    });
    expect(
      lampiran.length,
      "dua kartu kembar di /lampiran untuk satu berkas – orang diminta memutuskan dua kali",
    ).toBe(1);
    expect(lampiran[0].fileName).toBe("Surat_Undangan_PCM_Puncel.pdf");
  });

  it("pesan BERBEDA dengan berkas sama tetap masing-masing tercatat", async () => {
    /*
     * Arah sebaliknya, dan sengaja dibiarkan begitu: dua kiriman terpisah
     * memang DUA peristiwa di grup, dan jejaknya tidak boleh dihapus. Yang
     * menjaga orang tidak ditanyai dua kali adalah pewarisan ketetapan lewat
     * sidik jari di `tangkapLampiran` — bukan penghapusan barisnya.
     */
    const a = `m-${suffix}-a`;
    const b = `m-${suffix}-b`;
    await ingestWaEvent(eventMedia(a));
    await ingestWaEvent(eventMedia(b));

    const jumlah = await db.waAttachment.count({
      where: { message: { waMessageId: { in: [a, b] } } },
    });
    expect(jumlah).toBe(2);

    // Dan berkasnya TIDAK diunduh ulang untuk kembarannya.
    const rows = await db.waAttachment.findMany({
      where: { message: { waMessageId: { in: [a, b] } } },
      select: { sha256: true, localPath: true },
    });
    expect(new Set(rows.map((r) => r.sha256)).size, "sidik jarinya sama").toBe(1);
    expect(new Set(rows.map((r) => r.localPath)).size, "berkas fisiknya satu").toBe(1);
  });

  it("lampiran yang tertangkap punya jalan untuk DIBUKA", async () => {
    /*
     * Pertanyaan user yang kedua: *"apa gunanya kalau tidak bisa dicek isinya,
     * atau dibuka?"* — sampai 2026-08-28 memang tidak ada rutenya sama sekali.
     * Layar meminta ketetapan "surat / dokumen / bukan bahan kerja" atas berkas
     * yang tidak bisa dilihat siapa pun tanpa membuka WhatsApp sendiri.
     *
     * Yang dijaga di sini bukan HTTP-nya, melainkan syarat yang membuat rute
     * itu bisa melayani: berkasnya benar-benar ada di salah satu simpanan.
     */
    const id = `m-${suffix}-buka`;
    await ingestWaEvent(eventMedia(id));
    const a = await db.waAttachment.findFirstOrThrow({
      where: { message: { waMessageId: id } },
      select: { status: true, localPath: true, r2Key: true, packageId: true },
    });
    expect(a.status).toBe("tertangkap");
    expect(a.localPath ?? a.r2Key, "tidak ada berkas yang bisa dibuka").toBeTruthy();
    // Lingkupnya diperiksa lewat paket; tanpa paket rute menolak melayani.
    expect(a.packageId).toBe(packageId);
  });
});
