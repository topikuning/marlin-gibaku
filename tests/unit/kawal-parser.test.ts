import { describe, expect, it } from "vitest";
import { parseResponsKawal } from "@/lib/kawal/parser";
import { barisKawal, RAHASIA, responsKawal } from "../fixtures/kawal-sintetis";

/**
 * PARSER KETAT KAWAL (DECISIONS 690). Bentuk fixture meniru uji sambungan ke
 * Kawal sungguhan; isinya sintetis.
 */

const serialisasi = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

describe("parser Kawal", () => {
  it("membaca bentuk yang terbukti: angka, teks angka, teks JSON kurva, array campuran", () => {
    const r = parseResponsKawal(responsKawal([barisKawal({ id: 7, actual: 12.5, target: 20 })]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const b = r.baris[0];
    expect(b).toMatchObject({
      kawalId: 7,
      kabupaten: "Kabupaten Contoh",
      noKontrak: "KONTRAK/CONTOH/7",
      mulai: "2026-08-01",
      actualPct: 12.5,
      targetPct: 20,
      deviasiPct: -7.5,
      weekNo: 12,
      lastActualWeek: 11,
      nilaiLokasi: 4_500_000_000n,
      nilaiAdd1: 0n,
      latitude: -6.9,
      remarkHambatan: null,
      remarkSaranInstruksi: null,
    });
    expect(b.kurva.realisasiKumulatif).toEqual([0, 1.0, 2.9, null]);
    expect(b.kurva.k).toEqual([0, 1.2, 3.4, 6.8]);
    expect(b.kurva.a1).toEqual([]);
    expect(b.sarana).toHaveLength(2);
    expect(b.sarana[0]).toEqual({
      kawalItemId: 701,
      sarprasId: 1,
      nama: "Dermaga",
      jenis: "Utama",
      nilai: 1_500_000_000n,
      status: 1,
      bobot: 30.5,
      progresPct: 40,
      realisasiKumulatif: 12.2,
    });
  });

  it("data pribadi tidak pernah keluar dari parser", () => {
    const r = parseResponsKawal(responsKawal([barisKawal({ id: 1 }), barisKawal({ id: 2 })]));
    const keluar = serialisasi(r);
    for (const v of Object.values(RAHASIA)) expect(keluar, v).not.toContain(v);
    expect(keluar).not.toContain("4242");
    expect(keluar).not.toContain("rahasia");
  });

  it("field yang dipakai HILANG = seluruh tarikan ditolak, disebut namanya", () => {
    const rusak = barisKawal({ id: 2 });
    delete rusak.progres_final;
    const r = parseResponsKawal(responsKawal([barisKawal({ id: 1 }), rusak]));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.masalah).toEqual(["Baris 2 (id Kawal 2): field progres_final tidak ada."]);
  });

  it("field di dalam sarpras yang hilang juga disebut", () => {
    const rusak = barisKawal({ id: 3 });
    for (const s of rusak.sarpras as Record<string, unknown>[]) delete s.bobot;
    const r = parseResponsKawal(responsKawal([rusak]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.masalah[0]).toContain("sarpras[].bobot tidak ada");
  });

  it("tipe BERUBAH = ditolak, tanpa menyebut nilainya", () => {
    const rusak = barisKawal({ id: 4 });
    rusak.progres_final = "dua belas";
    rusak.kurva_rencana_kumulatif = { minggu: 1 };
    const r = parseResponsKawal(responsKawal([rusak]));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.masalah).toContain("Baris 1 (id Kawal 4), field progres_final: harus angka.");
    expect(r.masalah).toContain("Baris 1 (id Kawal 4), field kurva_rencana_kumulatif: tipenya berubah (sekarang objek).");
    expect(r.masalah.join(" ")).not.toContain("dua belas");
  });

  /*
   * Tarikan 2026-10-22 gagal dengan "field sarpras: tipenya berubah" saja –
   * union zod melipat SEMUA masalah di dalam daftar sarana ke pesan itu, jadi
   * sebab sebenarnya tidak terbaca (DECISIONS 695).
   */
  it("masalah di dalam daftar sarana menyebut sarana ke berapa dan field-nya, tanpa nilai", () => {
    const b = barisKawal({ id: 334 });
    const [s0] = b.sarpras as Record<string, unknown>[];
    const kasus: [unknown, string][] = [
      [[s0, { ...s0, nama_sarpras: "" }], "sarana ke-2 (id 33401), nama_sarpras tidak boleh kosong"],
      [[{ ...s0, nama_sarpras: null }], "sarana ke-1 (id 33401), nama_sarpras tipenya berubah (sekarang null)"],
      [[{ ...s0, bobot: "dua belas" }], "sarana ke-1 (id 33401), bobot harus angka"],
      [["x"], "sarana ke-1 tipenya berubah (sekarang teks)"],
      [5, "tipenya berubah (sekarang angka)"],
      [{ a: 1 }, "tipenya berubah (sekarang objek)"],
    ];
    for (const [sarpras, pesan] of kasus) {
      const r = parseResponsKawal(responsKawal([{ ...b, sarpras }]));
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.masalah).toEqual([`Baris 1 (id Kawal 334), field sarpras: ${pesan}.`]);
      expect(r.masalah.join(" ")).not.toMatch(/dua belas|Dermaga/);
    }
  });

  it("bentuk lain yang ISINYA sama diterima: objek berkunci nomor, teks JSON, teks kosong", () => {
    const b = barisKawal({ id: 7 });
    const [s0, s1] = b.sarpras as Record<string, unknown>[];
    const daftar = (sarpras: unknown) => {
      const r = parseResponsKawal(responsKawal([{ ...b, sarpras }]));
      expect(r.ok).toBe(true);
      return r.ok ? r.baris[0].sarana.map((s) => s.kawalItemId) : [];
    };
    // Array PHP yang kuncinya bolong ter-encode sebagai objek.
    expect(daftar({ "0": s0, "3": s1 })).toEqual([701, 702]);
    expect(daftar(JSON.stringify([s0, s1]))).toEqual([701, 702]);
    expect(daftar(JSON.stringify({ "1": s1 }))).toEqual([702]);
    expect(daftar("")).toEqual([]);
    expect(daftar(null)).toEqual([]);
    // Field wajib sarana tetap diperiksa di bentuk objek berkunci.
    const tanpaBobot = { ...s0 };
    delete tanpaBobot.bobot;
    const r = parseResponsKawal(responsKawal([{ ...b, sarpras: { "0": tanpaBobot } }]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.masalah).toEqual(["Baris 1 (id Kawal 7): field sarpras[].bobot tidak ada."]);
  });

  it("nilai kosong boleh: lokasi baru tanpa SPMK dan tanpa kurva", () => {
    const baru = barisKawal({ id: 5 });
    Object.assign(baru, {
      start_date_penyedia: "0000-00-00",
      tgl_kontrak_penyedia: "",
      progres_final: null,
      current_week: null,
      kurva_rencana_kumulatif: null,
      kurva_k_json: "",
      sarpras: [],
    });
    const r = parseResponsKawal(responsKawal([baru]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.baris[0]).toMatchObject({ mulai: null, tglKontrak: null, actualPct: null, weekNo: null, sarana: [] });
    expect(r.baris[0].kurva.rencanaKumulatif).toEqual([]);
  });

  it("kurva teks-JSON yang hilang (bukan wajib) dibaca kosong; kurva wajib yang hilang ditolak", () => {
    const tanpaA1 = barisKawal({ id: 6 });
    delete tanpaA1.kurva_a1_json;
    expect(parseResponsKawal(responsKawal([tanpaA1])).ok).toBe(true);

    const tanpaRencana = barisKawal({ id: 6 });
    delete tanpaRencana.kurva_rencana_kumulatif;
    expect(parseResponsKawal(responsKawal([tanpaRencana])).ok).toBe(false);
  });

  it("id kembar dan respons tanpa `data` ditolak", () => {
    const kembar = parseResponsKawal(responsKawal([barisKawal({ id: 9 }), barisKawal({ id: 9 })]));
    expect(kembar.ok).toBe(false);
    expect(parseResponsKawal("<html>masuk</html>").ok).toBe(false);
  });

  it("teks angka berkoma desimal dan tanggal berjam dibaca", () => {
    const b = barisKawal({ id: 10 });
    Object.assign(b, { progres_final: "12,75", end_date_penyedia: "2026-12-20 00:00:00" });
    const r = parseResponsKawal(responsKawal([b]));
    expect(r.ok && r.baris[0].actualPct).toBe(12.75);
    expect(r.ok && r.baris[0].selesai).toBe("2026-12-20");
  });

  it("tanggal yang tidak ada di kalender ditolak", () => {
    const b = barisKawal({ id: 11 });
    b.start_date_penyedia = "2026-02-30";
    expect(parseResponsKawal(responsKawal([b])).ok).toBe(false);
  });
});
