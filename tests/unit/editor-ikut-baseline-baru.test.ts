/*
 * ANGKA DI LAYAR TIDAK IKUT BERUBAH SESUDAH "HITUNG ULANG" (produksi 2026-09-20).
 *
 * Laporan user: *"saat hitung ulang data target kumulatif itu tidak terupdate
 * juga, padahal seharusnya semuanya ikut langsung direload, termasuk kurva S di
 * tampilan. baru berubah kalau refresh level browser secara keseluruhan."*
 *
 * Direproduksi dengan menjalankan aplikasinya: deret rencana kumulatif terbaca
 * `7.3 | 22.8 | 28.5 | 32.1 | 37 | 43.8` sebelum DAN sesudah aksi berhasil, lalu
 * berubah jadi `7.3 | 21.8 | 26.8 | 30.3 | 35.1 | 41.8` begitu halaman dimuat
 * ulang. Jadi servernya benar — `revalidatePath` jalan, RSC-nya terkirim ulang —
 * yang tidak ikut adalah KLIENNYA.
 *
 * Sebabnya: editor-editor itu menyemai `useState` dari props server
 * (`useState(() => initial.map(r1))`). Penyemai hanya dibaca SEKALI, saat
 * komponennya pertama dipasang. Ketika RSC datang membawa props baru, React
 * memakai ulang instance yang sama — posisinya di pohon tidak berubah — jadi
 * state lamanya bertahan dan menang atas data baru. Grafik pratinjau di
 * sebelahnya digambar dari state yang sama, jadi ia ikut basi.
 *
 * Obatnya `key`, bukan `useEffect` penyelaras: state editor itu MILIK satu versi
 * baseline. Begitu baseline aktifnya berganti versi, yang di layar bukan lagi
 * editor yang sama — ia harus dipasang ulang. `key` menyatakan persis itu, dan
 * ia satu-satunya cara yang tidak diam-diam membuang ketikan yang belum sempat
 * disimpan pada baseline yang MASIH sama.
 *
 * Yang dijaga di sini: setiap komponen klien pada halaman progress yang
 * menyemai state dari data baseline harus dipasang dengan `key` yang mengikuti
 * identitas baseline aktif.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HALAMAN = join(
  import.meta.dirname,
  "..",
  "..",
  "src/app/(app)/lokasi/[slug]/progress/page.tsx",
);

/**
 * Komponen klien yang state-nya disemai dari data baseline. Daftarnya sengaja
 * ditulis tangan: yang berbahaya bukan "punya useState", melainkan "punya
 * useState yang disemai props server yang bisa berganti tanpa unmount".
 */
const WAJIB_BER_KEY = [
  "BaselineEditor", // deret %-kumulatif + grafik pratinjau
  "ScheduleEditor", // matriks jadwal per kategori
  "BaselineHistory", // centang versi yang dibandingkan
  "RecalcBaselineButton", // profil kurva yang sedang berlaku
] as const;

/** Potongan JSX satu elemen, dari `<Nama` sampai `>` pembuka yang menutupnya. */
function tagPembuka(isi: string, nama: string): string | null {
  const mulai = isi.indexOf(`<${nama}`);
  if (mulai === -1) return null;
  let i = mulai;
  let kurung = 0;
  for (; i < isi.length; i++) {
    const c = isi[i];
    if (c === "{") kurung++;
    else if (c === "}") kurung--;
    else if (c === ">" && kurung === 0) break;
  }
  return isi.slice(mulai, i + 1);
}

describe("editor klien dipasang ulang ketika baseline aktif berganti versi", () => {
  const isi = readFileSync(HALAMAN, "utf8");

  for (const nama of WAJIB_BER_KEY) {
    it(`<${nama}> membawa key yang mengikuti baseline aktif`, () => {
      const tag = tagPembuka(isi, nama);
      expect(tag, `<${nama}> tidak ditemukan di halaman progress`).not.toBeNull();
      // `key` harus ADA dan harus bergantung pada identitas baseline – `key="x"`
      // tetap atau key dari indeks tidak memasang ulang apa pun.
      expect(tag, `<${nama}> dipasang tanpa key, jadi state lamanya bertahan`).toMatch(/\bkey=\{/);
      expect(
        tag,
        `key <${nama}> tidak mengikuti baseline aktif, jadi versi baru tidak memasangnya ulang`,
      ).toMatch(/key=\{[^}]*[Bb]aseline[^}]*\}/);
    });
  }
});
