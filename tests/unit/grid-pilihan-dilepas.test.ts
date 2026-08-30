// Melepas centang di GRID, bukan cuma di hitungan React.
//
// `MarlinGrid` menyerahkan pilihan baris ke AG Grid — itu disengaja: hanya
// dengan begitu "pilih semua" mengikuti saringan yang sedang aktif (DECISIONS
// 328). Konsekuensinya, yang memegang kebenaran tentang "baris mana yang
// tercentang" adalah grid, bukan state React di panel.
//
// Panel RAPL sempat mengosongkan state-nya sendiri sesudah aksi borongan
// berhasil (`setDicentang([])`, `setTerpilih([])`) tanpa memberi tahu grid.
// Karena `getRowId` dipasang, AG Grid mempertahankan pilihan per-id saat data
// disegarkan — jadi centangnya bisa tetap menyala sementara tombolnya menulis
// "0 dicentang" dan mati. Jalan buntu yang sukar didiagnosis: yang dilihat
// pengguna dan yang dipercaya kode berbeda, dan tidak ada pesan apa pun.
//
// Penjaga ini memaksa dua hal:
//
//  1. Panel yang memakai pilihan baris WAJIB memegang `MarlinGridApi` dan
//     memanggil `kosongkanPilihan()`.
//  2. Pengosongan state React hanya boleh ditulis di SATU tempat — penolong
//     yang juga memanggil grid. Dua jalur berarti cepat atau lambat ada yang
//     lupa memanggil salah satunya.
//
// Diperiksa dari sumber, bukan dari render: uji unit repo ini berjalan di
// lingkungan node tanpa DOM, dan AG Grid tidak bisa dijalankan di sana.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PANEL: { berkas: string; setter: string }[] = [
  { berkas: "src/app/(app)/lokasi/[slug]/rapl/harga-panel.tsx", setter: "setDicentang([])" },
  { berkas: "src/app/(app)/lokasi/[slug]/rapl/padanan-panel.tsx", setter: "setTerpilih([])" },
];

function baca(berkas: string): string {
  return readFileSync(join(process.cwd(), berkas), "utf8");
}

describe("pilihan baris dilepas di grid, bukan cuma di state", () => {
  for (const { berkas, setter } of PANEL) {
    it(`${berkas} memegang MarlinGridApi dan memanggil kosongkanPilihan`, () => {
      const isi = baca(berkas);
      expect(isi, "panel berpilihan baris harus memegang api gridnya").toContain(
        "MarlinGridApi",
      );
      expect(isi, "harus ada yang benar-benar melepas centang di grid").toContain(
        "kosongkanPilihan()",
      );
    });

    it(`${berkas} hanya punya SATU tempat yang mengosongkan pilihan`, () => {
      const isi = baca(berkas);
      const jumlah = isi.split(setter).length - 1;
      expect(
        jumlah,
        `${setter} harus terkumpul di satu penolong yang juga memanggil grid – ` +
          "kalau tersebar, satu di antaranya cepat atau lambat lupa",
      ).toBe(1);
    });
  }
});
