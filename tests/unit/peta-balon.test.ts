// BALON KETERANGAN LOKASI: DIPASANG SEKALI, LALU DIPINDAHKAN.
//
// Teguran user 2026-09-07, dengan rekaman layar: *"saat aku arahkan ke titik
// lokasi, ada di pojok kanan ada balloon yang double walaupun cuma sekilas lalu
// hilang, sepertinya ini sesuatu yang tidak nyaman untuk dilihat"*.
//
// Bingkai rekamannya memperlihatkan balon berkedip di POJOK KIRI-ATAS peta —
// menimpa tombol lapisan — tepat sebelum balon yang benar muncul di sebelah
// titik yang ditunjuk.
//
// Yang PASTI (dibaca dari sumber maplibre-gl 6.7.0, `Popup.addTo`):
//
//     addTo(map) { if (this._map) this.remove(); … }
//
// artinya kode lama — yang memanggil `.addTo(map)` di SETIAP `mousemove` —
// membongkar lalu membangun ulang elemen balon puluhan kali per detik, dan
// mencopotnya lagi tiap kursor keluar. Elemen yang baru disisipkan adalah satu-
// satunya keadaan di mana balon bisa tergambar sebelum posisinya dihitung.
//
// Perbaikannya menutup celah itu: balon dipasang SEKALI (tersembunyi), dan baru
// ditampilkan sesudah `setLngLat` — yang selalu menulis `transform`. Jadi tidak
// pernah ada balon yang terlihat tanpa posisi.
//
// Catatan jujur: kedipannya TIDAK berhasil direproduksi di peramban headless
// (60 kali arah masuk–keluar pada kode LAMA: nol balon di pojok, satu elemen
// saja). Jadi yang dijaga di sini bentuk kodenya, bukan piksel kedipannya.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const peta = readFileSync(
  new URL("../../src/app/(app)/peta/peta-map.tsx", import.meta.url),
  "utf8",
);
const maplibre = readFileSync(
  new URL("../../node_modules/maplibre-gl/dist/maplibre-gl-dev.mjs", import.meta.url),
  "utf8",
);

describe("balon keterangan lokasi", () => {
  it("maplibre memang MEMBONGKAR balon tiap addTo – dasar perbaikan ini", () => {
    // Kalau anggapan ini suatu saat tidak berlaku lagi, uji ini yang pertama
    // memberitahu, bukan mata orang di lapangan.
    expect(maplibre).toContain("addTo(map) {\n\t\tif (this._map) this.remove();");
  });

  it("dipasang sekali saat peta siap, dalam keadaan tersembunyi", () => {
    const load = /map\.on\("load", \(\) => \{([\s\S]*?)\n {4}\}\);/.exec(peta)?.[1] ?? "";
    expect(load).toContain("popup.setLngLat(PUSAT_KOSONG).addTo(map)");
    expect(load).toContain("tampilkanPopup(false)");
  });

  it("arahan kursor hanya MEMINDAHKAN, tidak memasang ulang", () => {
    const move = /map\.on\("mousemove", LAPIS_TITIK[\s\S]*?\n {4}\}\);/.exec(peta)?.[0] ?? "";
    expect(move, "penangan mousemove tidak ketemu").not.toBe("");
    expect(move).not.toContain("addTo(");
    expect(move).toContain("popup.setLngLat(");
    // Ditampilkan SESUDAH posisinya ditetapkan — bukan sebelum.
    expect(move.indexOf("setLngLat")).toBeLessThan(move.indexOf("tampilkanPopup(true)"));
  });

  it("kursor keluar MENYEMBUNYIKAN, tidak mencopot", () => {
    const leave = /map\.on\("mouseleave", LAPIS_TITIK[\s\S]*?\n {4}\}\);/.exec(peta)?.[0] ?? "";
    expect(leave).toContain("tampilkanPopup(false)");
    expect(leave).not.toContain("popup.remove()");
  });

  it("isi balon hanya ditulis ulang saat lokasinya berganti", () => {
    // `mousemove` berdetak puluhan kali per detik; menulis ulang isinya tiap
    // detak membuat balon melebar-menyempit dan memaksa MapLibre menghitung
    // ulang sisi sandarannya.
    const move = /map\.on\("mousemove", LAPIS_TITIK[\s\S]*?\n {4}\}\);/.exec(peta)?.[0] ?? "";
    expect(move).toContain("if (id !== idPopup)");
  });
});
