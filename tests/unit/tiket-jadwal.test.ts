// TERAPKAN JADWAL TANPA MENGUNGGAH ULANG (DECISIONS 774).
//
// Pertanyaan user 2026-11-24: *"kenapa import jadwal sangat lambat, apa yang
// terjadi?"*. Diukur: membaca & menghitung di server < 0,5 detik, tetapi
// "Periksa" dan "Terapkan" masing-masing MENGUNGGAH dan MEMBACA berkas yang
// sama. Di jaringan lapangan unggahan itulah yang lama, dan dibayar dua kali.
//
// Sekarang Periksa mengembalikan tiket bertanda tangan berisi jadwal yang
// terbaca; Terapkan mengirim tiket itu, bukan berkasnya. Tiket hanya sah untuk
// lokasi & orang yang sama, dan tidak bisa diubah tanpa ketahuan.
import { describe, expect, it } from "vitest";
import { bacaTiketJadwal, buatTiketJadwal, TIKET_JADWAL_MS } from "@/lib/scurve/tiket-jadwal";

const KUNCI = "kunci-uji-tiket-jadwal-0123456789";
const isi = {
  lokasi: "lok-1",
  user: "user-1",
  namaBerkas: "TS MOJO.xlsx",
  input: [{ lineageKey: "I", weekly: [1.5, 2, 0, 3.25] }],
};

describe("tiket hasil pemeriksaan jadwal", () => {
  it("bolak-balik utuh untuk lokasi & orang yang sama", () => {
    const t = buatTiketJadwal(isi, KUNCI, 1_000);
    const b = bacaTiketJadwal(t, { lokasi: "lok-1", user: "user-1" }, KUNCI, 2_000);
    expect(b?.input).toEqual(isi.input);
    expect(b?.namaBerkas).toBe("TS MOJO.xlsx");
  });

  it("angka jadwal diubah → ditolak", () => {
    const t = buatTiketJadwal(isi, KUNCI, 1_000);
    const [badan, tanda] = t.split(".");
    const isiLain = JSON.parse(Buffer.from(badan!, "base64url").toString("utf8"));
    isiLain.input[0].weekly[0] = 99;
    const palsu = `${Buffer.from(JSON.stringify(isiLain)).toString("base64url")}.${tanda}`;
    expect(bacaTiketJadwal(palsu, { lokasi: "lok-1", user: "user-1" }, KUNCI, 2_000)).toBeNull();
  });

  it("lokasi lain, orang lain, atau kunci lain → ditolak", () => {
    const t = buatTiketJadwal(isi, KUNCI, 1_000);
    expect(bacaTiketJadwal(t, { lokasi: "lok-2", user: "user-1" }, KUNCI, 2_000)).toBeNull();
    expect(bacaTiketJadwal(t, { lokasi: "lok-1", user: "user-2" }, KUNCI, 2_000)).toBeNull();
    expect(bacaTiketJadwal(t, { lokasi: "lok-1", user: "user-1" }, "kunci-lain-0123456789012345", 2_000)).toBeNull();
  });

  it("kedaluwarsa sesudah 30 menit", () => {
    expect(TIKET_JADWAL_MS).toBe(30 * 60_000);
    const t = buatTiketJadwal(isi, KUNCI, 1_000);
    expect(bacaTiketJadwal(t, { lokasi: "lok-1", user: "user-1" }, KUNCI, 1_000 + TIKET_JADWAL_MS)).not.toBeNull();
    expect(bacaTiketJadwal(t, { lokasi: "lok-1", user: "user-1" }, KUNCI, 1_001 + TIKET_JADWAL_MS)).toBeNull();
  });

  it("sampah → null, bukan lempar galat", () => {
    expect(bacaTiketJadwal("bukan-tiket", { lokasi: "lok-1", user: "user-1" }, KUNCI)).toBeNull();
    expect(bacaTiketJadwal("", { lokasi: "lok-1", user: "user-1" }, KUNCI)).toBeNull();
  });
});
