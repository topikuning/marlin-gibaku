// KATALOG HARGA WILAYAH – bagian murni (DECISIONS 806).
//
// Perintah user 2026-11-28: *"rancang matang sistem ini, buat dia mencari
// online atau sambungkan dengan ai untuk handle ini semua"*. Yang dijaga di
// sini adalah KEJUJURAN data riset:
//  - sumber yang disebut AI hanya diterima bila alamatnya benar-benar muncul
//    di hasil pencarian (alamat karangan dibuang);
//  - estimasi tanpa sumber tidak boleh mengaku yakin;
//  - harga hasil usulan mesin tidak pernah dihitung sebagai "harga lapangan";
//  - respons pencarian web dibaca sesuai bentuk resmi, termasuk galat dan
//    lanjutan `pause_turn`.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  batasiKeyakinan,
  hargaBuatanOrang,
  masihSegar,
  medianRupiah,
  normalUrl,
  susunAlasan,
  verifikasiSumber,
  zonaWaktu,
} from "@/lib/harga-wilayah/aturan";
import { bacaHasilPencarian, webDimatikan } from "@/lib/harga-wilayah/web-parse";

const { risetWeb, badanPermintaanWeb } = await import("@/lib/harga-wilayah/web");

describe("aturan katalog", () => {
  it("alamat dibakukan: www, garis miring penutup, pecahan, dan parameter pelacak tidak membedakan", () => {
    expect(normalUrl("https://www.Tokopedia.com/semen/?utm_source=x#atas")).toBe("tokopedia.com/semen");
    expect(normalUrl("http://demakkab.go.id/ssh?tahun=2026")).toBe("demakkab.go.id/ssh?tahun=2026");
    expect(normalUrl("ftp://x.id/a")).toBeNull();
    expect(normalUrl("bukan alamat")).toBeNull();
  });

  it("sumber karangan AI dibuang; yang muncul di hasil pencarian dipakai, paling banyak tiga", () => {
    const ditemukan = new Map([
      [normalUrl("https://demakkab.go.id/ssh-2026")!, { url: "https://demakkab.go.id/ssh-2026", judul: "SSH Demak 2026" }],
      [normalUrl("https://www.tokopedia.com/semen")!, { url: "https://www.tokopedia.com/semen", judul: "Semen 50 kg" }],
    ]);
    expect(
      verifikasiSumber(
        [
          { url: "https://demakkab.go.id/ssh-2026/?utm_campaign=a", judul: "SSH" },
          { url: "https://harga-karangan.example/semen", judul: "tidak pernah ada" },
          { url: "https://tokopedia.com/semen", judul: null },
          { url: "https://demakkab.go.id/ssh-2026", judul: "ganda" },
        ],
        ditemukan,
      ),
    ).toEqual([
      { url: "https://demakkab.go.id/ssh-2026", judul: "SSH Demak 2026" },
      { url: "https://www.tokopedia.com/semen", judul: "Semen 50 kg" },
    ]);
  });

  it("estimasi tanpa sumber paling tinggi 'sedang'; yang bersumber tidak diubah", () => {
    expect(batasiKeyakinan("ai", "tinggi")).toBe("sedang");
    expect(batasiKeyakinan("ai", "rendah")).toBe("rendah");
    expect(batasiKeyakinan("web", "tinggi")).toBe("tinggi");
  });

  it("keterangan usulan menyebut asalnya dan tidak lebih dari 240 huruf", () => {
    const web = susunAlasan({
      alasan: "SSH Kab. Demak 2026 untuk semen PCC 50 kg, ditambah ongkos angkut ke pesisir",
      metode: "web",
      sumber: [{ url: "https://demakkab.go.id/ssh", judul: "SSH" }, { url: "https://www.tokopedia.com/x", judul: "x" }],
      diperbarui: new Date("2026-11-28T03:00:00Z"),
    });
    expect(web).toContain("Sumber: demakkab.go.id, tokopedia.com");
    expect(web).toContain("(2026-11-28)");
    expect(susunAlasan({ alasan: "x".repeat(500), metode: "ai", sumber: [] })).toHaveLength(240);
    expect(susunAlasan({ alasan: "perkiraan", metode: "ai", sumber: [] })).toContain("Estimasi AI, tanpa sumber web");
  });

  it("umur katalog: 90 hari masih segar, 91 hari usang", () => {
    const kini = new Date("2026-11-28T00:00:00Z");
    expect(masihSegar(new Date("2026-08-30T00:00:00Z"), kini)).toBe(true);
    expect(masihSegar(new Date("2026-08-29T00:00:00Z"), kini)).toBe(false);
  });

  it("median rupiah; harga usulan mesin bukan harga lapangan", () => {
    expect(medianRupiah([90_000n, 80_000n, 120_000n])).toBe(90_000n);
    expect(medianRupiah([80_000n, 90_000n])).toBe(85_000n);
    expect(medianRupiah([])).toBeNull();
    expect(hargaBuatanOrang("Input manual")).toBe(true);
    expect(hargaBuatanOrang(null)).toBe(true);
    for (const s of [
      "Usulan AI – disetujui pengguna",
      "Harga web (katalog wilayah) – disetujui pengguna",
      "Harga lapangan sekabupaten – disetujui pengguna",
      "Harga acuan templat RAPL – disetujui pengguna",
    ])
      expect(hargaBuatanOrang(s)).toBe(false);
  });

  it("zona waktu mengikuti provinsi", () => {
    expect(zonaWaktu("Jawa Tengah")).toBe("Asia/Jakarta");
    expect(zonaWaktu("Sulawesi Utara")).toBe("Asia/Makassar");
    expect(zonaWaktu("Nusa Tenggara Timur")).toBe("Asia/Makassar");
    expect(zonaWaktu("Maluku Utara")).toBe("Asia/Jayapura");
  });
});

/** Respons contoh berbentuk dokumentasi resmi alat web_search. */
const respons = (o: { teks: string; stop?: string; galat?: boolean }) => ({
  model: "claude-opus-5",
  stop_reason: o.stop ?? "end_turn",
  content: [
    { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "harga semen Demak 2026" } },
    o.galat
      ? { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: { type: "web_search_tool_result_error", error_code: "too_many_requests" } }
      : {
          type: "web_search_tool_result",
          tool_use_id: "srvtoolu_1",
          content: [{ type: "web_search_result", url: "https://demakkab.go.id/ssh", title: "SSH Demak", encrypted_content: "x", page_age: "May 1, 2026" }],
        },
    {
      type: "text",
      text: o.teks,
      citations: [{ type: "web_search_result_location", url: "https://www.tokopedia.com/semen", title: "Semen", encrypted_index: "y", cited_text: "Rp 88.000" }],
    },
  ],
  usage: { input_tokens: 5_000, output_tokens: 400, server_tool_use: { web_search_requests: 2 } },
});

describe("pembaca respons pencarian web", () => {
  it("mengumpulkan kueri, alamat hasil pencarian dan sitasi, teks, serta jumlah pencarian", () => {
    const h = bacaHasilPencarian(respons({ teks: '{"harga":[]}' }));
    expect(h.kueri).toEqual(["harga semen Demak 2026"]);
    expect([...h.ditemukan.keys()].sort()).toEqual(["demakkab.go.id/ssh", "tokopedia.com/semen"]);
    expect(h).toMatchObject({ teks: '{"harga":[]}', pencarian: 2, inputTokens: 5_000, outputTokens: 400, model: "claude-opus-5" });
  });

  it("galat pencarian berupa objek, bukan daftar – dicatat, tidak dianggap hasil", () => {
    const h = bacaHasilPencarian(respons({ teks: "", galat: true }));
    expect(h.galat).toEqual(["too_many_requests"]);
    expect([...h.ditemukan.keys()]).toEqual(["tokopedia.com/semen"]);
  });

  it("respons lanjutan menyambung teks dan menjumlah pencarian", () => {
    const a = bacaHasilPencarian(respons({ teks: '{"harga":[', stop: "pause_turn" }));
    const b = bacaHasilPencarian(respons({ teks: "]}" }), a);
    expect(b.teks).toBe('{"harga":[]}');
    expect(b.pencarian).toBe(4);
    expect(b.stopReason).toBe("end_turn");
  });

  it("400 'web search is not enabled' dikenali sebagai web dimatikan", () => {
    expect(webDimatikan(400, '{"error":{"type":"invalid_request_error","message":"Web search is not enabled for this organization"}}')).toBe(true);
    expect(webDimatikan(400, '{"error":{"message":"max_tokens too large"}}')).toBe(false);
    expect(webDimatikan(500, "web search not enabled")).toBe(false);
  });
});

describe("permintaan riset web", () => {
  const cfg = { id: "claude", apiStyle: "anthropic", jalurPdf: "anthropic_document", baseUrl: "https://api.uji", tokenParam: "max_tokens", model: "claude-opus-5", apiKey: "kunci" } as const;
  const req = { system: "s", prompt: "p", lokasi: { provinsi: "Sulawesi Utara", kabupaten: "Bolaang Mongondow Timur" } };

  it("memakai web_search_20250305 dengan batas pencarian dan lokasi Indonesia", () => {
    const b = badanPermintaanWeb(cfg, req, [{ role: "user", content: "p" }]);
    expect(b.tools).toEqual([
      {
        type: "web_search_20250305",
        name: "web_search",
        max_uses: 8,
        user_location: { type: "approximate", country: "ID", region: "Sulawesi Utara", city: "Bolaang Mongondow Timur", timezone: "Asia/Makassar" },
      },
    ]);
  });

  it("pause_turn: isi asisten dikirim balik apa adanya, lalu hasil digabung", async () => {
    const kiriman: { messages: { role: string; content: unknown }[] }[] = [];
    const jawab = [respons({ teks: '{"harga":[', stop: "pause_turn" }), respons({ teks: "]}" })];
    const ambil = vi.fn(async (_u: unknown, init?: RequestInit) => {
      kiriman.push(JSON.parse(String(init!.body)));
      return new Response(JSON.stringify(jawab[kiriman.length - 1]), { status: 200 });
    }) as unknown as typeof fetch;
    const h = await risetWeb(cfg, req, ambil);
    expect(h).toMatchObject({ ok: true, teks: '{"harga":[]}', pencarian: 4 });
    expect(kiriman).toHaveLength(2);
    expect(kiriman[1]!.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(kiriman[1]!.messages[1]!.content).toEqual(jawab[0]!.content);
  });

  it("web dimatikan di akun → kode web_tidak_aktif (pemanggil jatuh ke estimasi)", async () => {
    const ambil = (async () =>
      new Response('{"error":{"type":"invalid_request_error","message":"web search is not enabled"}}', { status: 400 })) as unknown as typeof fetch;
    expect(await risetWeb(cfg, req, ambil)).toMatchObject({ ok: false, kode: "web_tidak_aktif" });
  });
});
