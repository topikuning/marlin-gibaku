import { describe, expect, it } from "vitest";
import {
  bacaBalasanSetuju,
  buatKodePersetujuan,
  kabarKirimNotifikasi,
  kunciMenungguPersetujuan,
  perluNotifikasiPd,
  teksPersetujuanWa,
} from "@/lib/rab/persetujuan-wa-aturan";
import { nilaiPersetujuan } from "@/lib/rab/persetujuan-aturan";
import { canTransitionWaPersetujuan } from "@/lib/lifecycle";

/** Persetujuan aktivasi adendum lewat WhatsApp – DECISIONS 714. */

const kosong = nilaiPersetujuan([]);
const adaPd = nilaiPersetujuan([{ userId: "pd", role: "program_director", approvedAt: new Date() }]);

describe("perluNotifikasiPd", () => {
  it("AM/PM/SM menyetujui adendum dan PD belum → kirim", () => {
    for (const peran of ["regional_manager", "project_manager", "site_manager"] as const) {
      expect(perluNotifikasiPd({ adendum: true, peranPenyetuju: peran, status: kosong })).toBe(true);
    }
  });

  it("PD sendiri yang menyetujui, atau suara PD sudah ada → tidak", () => {
    expect(perluNotifikasiPd({ adendum: true, peranPenyetuju: "program_director", status: kosong })).toBe(false);
    expect(perluNotifikasiPd({ adendum: true, peranPenyetuju: "site_manager", status: adaPd })).toBe(false);
  });

  it("HPS awal (bukan adendum) tidak menuntut empat mata → tidak", () => {
    expect(perluNotifikasiPd({ adendum: false, peranPenyetuju: "site_manager", status: kosong })).toBe(false);
  });
});

describe("bacaBalasanSetuju", () => {
  it("bentuk yang lazim diketik dari HP", () => {
    for (const t of ["SETUJU 4821", "setuju 4821", "Setuju #4821", "setuju: 4821", "SETUJU4821", " setuju  4821. "]) {
      expect(bacaBalasanSetuju(t), t).toEqual({ kode: "4821" });
    }
  });

  it("'setuju' saja → minta kodenya, bukan menebak draft", () => {
    expect(bacaBalasanSetuju("setuju")).toEqual({ kode: null });
    expect(bacaBalasanSetuju("Setuju!")).toEqual({ kode: null });
  });

  it("selain itu bukan urusan persetujuan – diteruskan ke lapor", () => {
    for (const t of ["setuju pak", "saya setuju 4821", "setuju 482", "setuju 48211", "pasang paving 20", "4821", ""]) {
      expect(bacaBalasanSetuju(t), t).toBeNull();
    }
  });
});

describe("kode", () => {
  it("empat angka 1000–9999", () => {
    expect(buatKodePersetujuan(() => 0)).toBe("1000");
    expect(buatKodePersetujuan(() => 0.999999)).toBe("9999");
    for (let i = 0; i < 200; i++) expect(buatKodePersetujuan()).toMatch(/^[1-9]\d{3}$/);
  });

  it("kunci menunggu terikat ke PD-nya – kode yang sama milik PD lain tidak bertabrakan", () => {
    expect(kunciMenungguPersetujuan("pd-a", "4821")).not.toBe(kunciMenungguPersetujuan("pd-b", "4821"));
  });
});

describe("lifecycle", () => {
  it("menunggu → disetujui | batal; sesudahnya tidak ke mana-mana", () => {
    expect(canTransitionWaPersetujuan("menunggu", "disetujui")).toBe(true);
    expect(canTransitionWaPersetujuan("menunggu", "batal")).toBe(true);
    expect(canTransitionWaPersetujuan("disetujui", "batal")).toBe(false);
    expect(canTransitionWaPersetujuan("batal", "disetujui")).toBe(false);
    expect(canTransitionWaPersetujuan("batal", "menunggu")).toBe(false);
  });
});

describe("teks", () => {
  const isi = {
    lokasi: "Songbanyu",
    paket: "Paket Jateng 2",
    revisionNo: 3,
    nilaiDraft: "Rp 1.250.000.000",
    perubahan: "2 item baru · 0 dihapus · 5 diubah · Δ +Rp 30.000.000",
    sudahSetuju: ["Budi (Site Manager)"],
    kode: "4821",
  };

  it("notifikasi menyebut lokasi, nilai, siapa yang sudah setuju, kodenya, dan bahwa draft langsung aktif", () => {
    const t = teksPersetujuanWa.notifikasi(isi);
    expect(t).toMatch(/Songbanyu/);
    expect(t).toMatch(/Rp 1\.250\.000\.000 \(pra-PPN\)/);
    expect(t).toMatch(/Budi \(Site Manager\)/);
    expect(t).toMatch(/\*SETUJU 4821\*/);
    expect(t).toMatch(/langsung diaktifkan/);
    expect(t).toMatch(/batal kalau draftnya diubah/);
  });

  it("tanpa pembanding, baris perubahan tidak ditulis", () => {
    expect(teksPersetujuanWa.notifikasi({ ...isi, perubahan: null })).not.toMatch(/Perubahan dari RAB/);
  });

  it("tanda pisah UI en-dash, tidak pernah em-dash (DECISIONS 385)", () => {
    const semua = [
      teksPersetujuanWa.notifikasi(isi),
      teksPersetujuanWa.mintaKode(["4821"]),
      teksPersetujuanWa.mintaKode(["4821", "7310"]),
      teksPersetujuanWa.belumVerifikasi,
      teksPersetujuanWa.draftBerubah(3, "Songbanyu"),
      teksPersetujuanWa.tercatatMenunggu(3, "Songbanyu", ["persetujuan Program Director"]),
      kabarKirimNotifikasi({ terkirim: ["Hery"], sudah: ["Budi"], tidak: [{ nama: "Ani", sebab: "nomor WA belum diverifikasi" }] }),
    ].join("\n");
    expect(semua).not.toMatch(/\u2014/);
  });

  it("kabar ke pemohon menyebut siapa yang dikirimi dan siapa tidak, beserta sebabnya", () => {
    const t = kabarKirimNotifikasi({
      terkirim: ["Hery"],
      sudah: ["Budi"],
      tidak: [{ nama: "Ani", sebab: "belum punya nomor WA" }],
    });
    expect(t).toMatch(/dikirim lewat WhatsApp ke Hery/);
    expect(t).toMatch(/Budi sudah dikirimi permintaan WA untuk isi draft ini/);
    expect(t).toMatch(/Ani tidak dikirimi WA: belum punya nomor WA/);
    expect(kabarKirimNotifikasi({ terkirim: [], sudah: [], tidak: [] })).toMatch(/Belum ada Program Director/);
  });
});
