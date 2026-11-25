import { cocokSimpul, type SimpulFolder } from "./struktur";

/**
 * MENYIAPKAN KERANGKA FOLDER DRIVE (DECISIONS 715, 776).
 *
 * Hanya MENAMBAH folder dan pintasan yang belum ada. Folder yang sudah ada –
 * apa pun isinya, siapa pun pembuatnya – tidak pernah diganti nama atau
 * dipindah. Satu-satunya yang dibuang: folder GANDA lama di BERKAS DOKUMEN
 * TEKNIS yang KOSONG dan terbukti buatan MARLIN (`folderBolehDiganti`), untuk
 * digantikan pintasan ke folder utama termin (DECISIONS 776). Ke Sampah Drive,
 * bukan dihapus permanen.
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
  daftarPintasan(parentId: string): Promise<{ id: string; name: string; targetId: string | null }[]>;
  buatPintasan(input: { folderId: string; name: string; targetId: string }): Promise<string>;
  /** Folder ganda lama ini kosong, tidak diubah orang, dan terbukti buatan MARLIN? (`folderMilikMarlin`) */
  folderBolehDiganti(id: string): Promise<boolean>;
  buangKeSampah(id: string): Promise<void>;
};

export type HasilSiapkan = {
  /** Jalur folder yang baru dibuat, mis. "7. BERKAS TERMIN/TERMIN 1 (25%) …/3. SPMK". */
  dibuat: string[];
  /** Jalur pintasan yang baru dibuat. */
  pintasan: string[];
  /** Folder ganda lama buatan MARLIN (kosong) yang dibuang dan diganti pintasan. */
  diganti: string[];
  /** Folder ganda yang dibiarkan: berisi, atau dibuat/diubah orang. */
  dibiarkan: string[];
  /** Folder & pintasan baku yang sudah ada sebelumnya. */
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
  const hasil: HasilSiapkan = { dibuat: [], pintasan: [], diganti: [], dibiarkan: [], sudahAda: 0, selesai: true };

  /**
   * `baru` = induknya baru dibuat, jadi pasti kosong – tidak perlu dibaca.
   * `sejajarInduk` = nama → id folder sejajar induk: tujuan pintasan.
   */
  async function telusuri(
    parentId: string,
    simpul: readonly SimpulFolder[],
    jalur: string,
    baru: boolean,
    sejajarInduk: ReadonlyMap<string, string>,
  ) {
    if (simpul.length === 0) return;
    const folderSimpul = simpul.filter((s) => !s.pintasanKe);
    const pintasanSimpul = simpul.filter((s) => s.pintasanKe);
    const ada = baru ? [] : await ops.daftarSubfolder(parentId);
    const turun: { id: string; s: SimpulFolder; baru: boolean; jalur: string }[] = [];
    const harusDibuat: SimpulFolder[] = [];
    for (const s of folderSimpul) {
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

    if (pintasanSimpul.length > 0) {
      const pintasanAda = baru ? [] : await ops.daftarPintasan(parentId);
      const kerja = pintasanSimpul.filter((s) => {
        if (!pintasanAda.some((x) => cocokSimpul(s, x.name))) return true;
        hasil.sudahAda++; // Pintasan yang ada tidak diperiksa tujuannya: bisa buatan orang.
        return false;
      });
      for (let i = 0; i < kerja.length; i += SEJAJAR) {
        if (jam() >= tenggat) {
          hasil.selesai = false;
          return;
        }
        await Promise.all(
          kerja.slice(i, i + SEJAJAR).map(async (s) => {
            const targetId = sejajarInduk.get(s.pintasanKe!);
            if (!targetId) return; // tujuan tidak ada di tingkat induk = salah susun pohon; dijaga uji
            const lama = ada.find((x) => cocokSimpul(s, x.name));
            if (lama) {
              // Folder ganda lama: hanya yang KOSONG dan buatan MARLIN yang diganti.
              if (!(await ops.folderBolehDiganti(lama.id))) {
                hasil.dibiarkan.push(`${jalur}${s.nama}`);
                return;
              }
              await ops.buangKeSampah(lama.id);
              await ops.buatPintasan({ folderId: parentId, name: s.nama, targetId });
              hasil.diganti.push(`${jalur}${s.nama}`);
              return;
            }
            await ops.buatPintasan({ folderId: parentId, name: s.nama, targetId });
            hasil.pintasan.push(`${jalur}${s.nama}`);
          }),
        );
      }
    }

    const tingkatIni = new Map(turun.map((t) => [t.s.nama, t.id]));
    for (const t of turun) {
      if (!t.s.anak?.length) continue;
      if (jam() >= tenggat) {
        hasil.selesai = false;
        return;
      }
      await telusuri(t.id, t.s.anak, `${t.jalur}/`, t.baru, tingkatIni);
      if (!hasil.selesai) return;
    }
  }

  await telusuri(rootId, pohon, "", false, new Map());
  return hasil;
}

/** Kabar hasil "Siapkan folder Drive" untuk layar. `total` = jumlah simpul pohon. */
export function kabarSiapkan(h: HasilSiapkan, total: number): string {
  const kalimat: string[] = [];
  const baru = [
    h.dibuat.length ? `${h.dibuat.length} folder baru` : "",
    h.pintasan.length ? `${h.pintasan.length} pintasan` : "",
  ].filter(Boolean);
  if (baru.length === 0 && h.diganti.length === 0 && h.selesai) {
    kalimat.push(`Semua ${total} folder baku sudah ada. Tidak ada yang perlu dibuat.`);
  } else {
    const bagian = [
      baru.length ? `${baru.join(" dan ")} dibuat` : "",
      h.sudahAda ? `${h.sudahAda} sudah ada dan tidak diubah` : "",
    ].filter(Boolean);
    if (bagian.length) kalimat.push(`${bagian.join(", ")}.`);
  }
  if (h.diganti.length) {
    kalimat.push(
      `${h.diganti.length} folder ganda di BERKAS DOKUMEN TEKNIS diganti pintasan ke folder utama termin. ` +
        "Folder lamanya kosong dan bisa dipulihkan dari Sampah Drive.",
    );
  }
  if (h.dibiarkan.length) {
    kalimat.push(
      `${h.dibiarkan.length} folder ganda di BERKAS DOKUMEN TEKNIS dibiarkan karena berisi berkas atau dibuat orang lain.`,
    );
  }
  if (!h.selesai) kalimat.push("Belum semua sempat dibuat. Tekan Siapkan folder Drive sekali lagi untuk melanjutkan.");
  return kalimat.join(" ");
}
