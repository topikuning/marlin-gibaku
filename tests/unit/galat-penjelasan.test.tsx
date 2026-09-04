import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { jelaskanGalat } from "@/lib/galat-penjelasan";
import { PanelGalat } from "@/components/shell/panel-galat";

/**
 * GALAT HARUS DIJELASKAN, BUKAN CUMA DISEBUT.
 *
 * Keluhan user 2026-09-04: *"yang kupermasalahkan kenapa errornya gak kamu
 * jelaskan!"* — layar berhenti hanya menyalin kalimat Next mentah-mentah,
 * "An unexpected response was received from the server", tanpa menyebut apa
 * yang terjadi, apakah kerjanya hilang, atau apa yang harus dilakukan.
 *
 * Yang dijaga di sini bukan susunan kalimatnya, melainkan tiga hal yang kalau
 * hilang membuat layar itu kembali tidak berguna:
 *   1. Sebabnya disebut dalam bahasa orang, bukan istilah Next.
 *   2. Keadaan datanya dinyatakan – itu pertanyaan pertama siapa pun.
 *   3. Ada langkah yang benar-benar bisa dikerjakan sekarang.
 * Dan satu pagar: galat yang TIDAK dikenali tidak boleh dikarang sebabnya.
 */

describe("penjelasan galat", () => {
  it('"unexpected response" dijelaskan sebagai kiriman yang tidak sampai tuntas – bukan istilah Next', () => {
    const p = jelaskanGalat("Error", "An unexpected response was received from the server.");
    expect(p.golongan).toBe("balasan-bukan-aksi");
    expect(p.sebab).toMatch(/server/i);
    expect(p.sebab).not.toMatch(/unexpected response/i);
    expect(p.tentangData).toMatch(/tidak ada yang tersimpan setengah jalan/i);
    expect(p.langkah.length).toBeGreaterThan(1);
  });

  it("tab basi sesudah deploy TIDAK disuruh coba lagi – hanya muat ulang yang menolong", () => {
    const p = jelaskanGalat("UnrecognizedActionError", "Server action was not found on the server");
    expect(p.golongan).toBe("tab-basi");
    expect(p.langkah.join(" ")).toMatch(/muat ulang/i);
    expect(p.langkah.join(" ")).toMatch(/tidak akan berhasil/i);
  });

  it("sambungan putus dibedakan dari server yang menolak", () => {
    const p = jelaskanGalat("TypeError", "Failed to fetch");
    expect(p.golongan).toBe("jaringan");
    expect(p.tentangData).toMatch(/tidak pernah sampai/i);
  });

  it("muatan terlalu besar menyebut fotonya, karena itu memang selalu sebabnya", () => {
    const p = jelaskanGalat("Error", "Request Entity Too Large (413)");
    expect(p.golongan).toBe("muatan-terlalu-besar");
    expect(p.sebab).toMatch(/foto/i);
  });

  it("berkas aplikasi gagal dimuat → muat ulang, dan data server disebut aman", () => {
    const p = jelaskanGalat("ChunkLoadError", "Loading chunk 4821 failed.");
    expect(p.golongan).toBe("berkas-aplikasi-gagal-dimuat");
    expect(p.tentangData).toMatch(/tidak tersentuh/i);
  });

  it("galat asing TIDAK dikarang sebabnya – mengaku tidak tahu lalu minta dilaporkan", () => {
    const p = jelaskanGalat("TypeError", "x.y is not a function");
    expect(p.golongan).toBe("tak-dikenal");
    expect(p.sebab).toMatch(/belum kami kenali/i);
    expect(p.langkah.join(" ")).toMatch(/laporkan/i);
  });

  it("panel galat menampilkan penjelasannya, bukan cuma kalimat mentah", () => {
    const html = renderToStaticMarkup(
      <PanelGalat error={Object.assign(new Error("An unexpected response was received from the server."), { name: "Error" })} />,
    );
    expect(html).toMatch(/Yang bisa dilakukan sekarang/);
    expect(html).toMatch(/Kiriman sampai ke server/);
    // Rincian teknisnya TETAP ada – itu satu-satunya bahan laporan dari ponsel.
    expect(html).toMatch(/An unexpected response was received from the server/);
  });
});
