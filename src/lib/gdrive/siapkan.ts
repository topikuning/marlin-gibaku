import { cocokSimpul, type SimpulFolder } from "./struktur";

/**
 * MENYIAPKAN KERANGKA FOLDER DRIVE (DECISIONS 715).
 *
 * Hanya MENAMBAH folder yang belum ada. Folder yang sudah ada – apa pun isinya,
 * siapa pun pembuatnya – tidak pernah diganti nama, dipindah, atau dihapus.
 *
 * Akses Drive diinjeksi (`OpsDrive`) supaya cara menelusuri pohonnya bisa diuji
 * tanpa jaringan. Pekerjaannya bertenggat (`batasMs`): Drive kosong butuh ±200
 * folder, dan aksi di layar tidak boleh menggantung. Yang belum sempat dibuat
 * dikerjakan saat tombolnya ditekan lagi – menekan ulang selalu aman karena
 * folder yang sudah ada dilewati.
 */

export type OpsDrive = {
  daftarSubfolder(parentId: string): Promise<{ id: string; name: string }[]>;
  buatFolder(parentId: string, name: string): Promise<string>;
};

export type HasilSiapkan = {
  /** Jalur folder yang baru dibuat, mis. "7. BERKAS TERMIN/TERMIN 1 (25%) …/3. SPMK". */
  dibuat: string[];
  /** Folder baku yang sudah ada sebelumnya. */
  sudahAda: number;
  /** false = tenggat habis; sisanya dikerjakan pada tekanan berikutnya. */
  selesai: boolean;
};

/** Berapa folder sejajar dibuat bersamaan – cukup cepat tanpa memancing batas laju Drive. */
const SEJAJAR = 4;

export async function siapkanStruktur(
  rootId: string,
  pohon: readonly SimpulFolder[],
  ops: OpsDrive,
  opsi: { batasMs: number; sekarang?: () => number },
): Promise<HasilSiapkan> {
  const jam = opsi.sekarang ?? Date.now;
  const tenggat = jam() + opsi.batasMs;
  const hasil: HasilSiapkan = { dibuat: [], sudahAda: 0, selesai: true };

  /** `baru` = induknya baru dibuat, jadi pasti kosong – tidak perlu dibaca. */
  async function telusuri(parentId: string, simpul: readonly SimpulFolder[], jalur: string, baru: boolean) {
    if (simpul.length === 0) return;
    const ada = baru ? [] : await ops.daftarSubfolder(parentId);
    const turun: { id: string; s: SimpulFolder; baru: boolean; jalur: string }[] = [];
    const harusDibuat: SimpulFolder[] = [];
    for (const s of simpul) {
      const f = ada.find((x) => cocokSimpul(s, x.name));
      if (f) {
        hasil.sudahAda++;
        turun.push({ id: f.id, s, baru: false, jalur: `${jalur}${f.name}` });
      } else {
        harusDibuat.push(s);
      }
    }
    for (let i = 0; i < harusDibuat.length; i += SEJAJAR) {
      if (jam() >= tenggat) {
        hasil.selesai = false;
        return;
      }
      const kelompok = harusDibuat.slice(i, i + SEJAJAR);
      const ids = await Promise.all(kelompok.map((s) => ops.buatFolder(parentId, s.nama)));
      kelompok.forEach((s, j) => {
        hasil.dibuat.push(`${jalur}${s.nama}`);
        turun.push({ id: ids[j], s, baru: true, jalur: `${jalur}${s.nama}` });
      });
    }
    for (const t of turun) {
      if (!t.s.anak?.length) continue;
      if (jam() >= tenggat) {
        hasil.selesai = false;
        return;
      }
      await telusuri(t.id, t.s.anak, `${t.jalur}/`, t.baru);
      if (!hasil.selesai) return;
    }
  }

  await telusuri(rootId, pohon, "", false);
  return hasil;
}
