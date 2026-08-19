/**
 * Jadwal Excel DIPAKAI APA ADANYA (DECISIONS 203).
 *
 * Permintaan user 2026-08-01: "jika user sudah upload jadwal versinya, apakah
 * kamu tidak bisa mengikuti angka dari dia apa adanya? ini upload manual kamu
 * harus mengikuti, kecuali orang tersebut meminta agar disesuaikan dengan
 * sistem dari inputan dia."
 *
 * Sebelumnya impor Excel hanya meminjam BENTUK-nya: tiap kategori diskalakan
 * ulang agar Σ mingguannya sama dengan bobot RAB. Orang yang menyusun jadwal
 * 12% untuk satu pekerjaan lalu melihat 9,4% di sistem wajar menyimpulkan
 * uploadnya tidak dibaca. Sekarang angkanya yang dipakai; renormalisasi ke RAB
 * jadi pilihan yang harus DIMINTA.
 *
 * Modul ini MURNI (tanpa db) supaya bisa diuji tanpa database.
 */

export type KategoriRab = {
  lineageKey: string;
  name: string;
  /** Bobot kategori menurut RAB aktif (%) — hanya untuk dilaporkan selisihnya. */
  weightRabPct: number;
};

export type BarisJadwal = {
  lineageKey: string;
  name: string;
  weightPct: number;
  weekly: number[];
};

export type HasilApaAdanya = {
  rows: BarisJadwal[];
  /** Jumlah kategori RAB yang benar-benar punya jadwal di Excel. */
  cocok: number;
  /** Σ seluruh sel Excel yang terpakai, SEBELUM penyelarasan ke 100. */
  totalExcel: number;
  /** 1 = angka Excel dipakai persis; ≠1 = diskalakan seragam agar tuntas 100%. */
  faktorSkala: number;
  /** Kategori RAB yang tidak dijadwalkan sama sekali di Excel. */
  tanpaJadwal: string[];
  /** Kategori yang bobot Excel-nya berbeda dari bobot RAB (> 0,1 pp). */
  selisihBobot: { name: string; excel: number; rab: number }[];
};

/**
 * Batas selisih total yang masih dianggap "pembulatan spreadsheet", bukan
 * kesalahan isi. Di atas ini file-nya yang salah (baris terlewat, kategori
 * belum diisi) dan menskalakannya diam-diam akan menyembunyikan kesalahan itu.
 */
export const TOLERANSI_TOTAL_PP = 2;

/** Ambang pelaporan selisih bobot Excel vs RAB (poin persen). */
const AMBANG_SELISIH_PP = 0.1;

const bulat6 = (v: number): number => Math.round(v * 1e6) / 1e6;
const pp = (v: number): string => v.toFixed(2).replace(".", ",");

/**
 * Susun baris jadwal dari matriks mingguan Excel TANPA menyentuh bobotnya.
 *
 * Satu-satunya penyesuaian: kalau total seluruh sel bukan tepat 100%, semua sel
 * dikalikan SATU faktor yang sama. Perbandingan antar-pekerjaan, antar-minggu,
 * dan setiap jeda tetap persis seperti di file — yang berubah cuma satuannya,
 * karena kurva-S wajib tuntas 100% (DECISIONS 052). Selisih di atas
 * `TOLERANSI_TOTAL_PP` ditolak, bukan diperbaiki diam-diam.
 *
 * Melempar `Error` berbahasa Indonesia yang langsung bisa ditampilkan ke user.
 */
export function susunJadwalApaAdanya(
  kategori: KategoriRab[],
  excel: Map<string, number[]>,
  totalWeeks: number,
): HasilApaAdanya {
  const n = Math.max(1, Math.floor(totalWeeks));
  const kosong = (): number[] => new Array<number>(n).fill(0);

  const mentah: { kat: KategoriRab; weekly: number[]; sum: number }[] = [];
  const tanpaJadwal: string[] = [];
  for (const kat of kategori) {
    const raw = excel.get(kat.lineageKey);
    if (!raw || raw.length !== n) {
      tanpaJadwal.push(kat.name);
      mentah.push({ kat, weekly: kosong(), sum: 0 });
      continue;
    }
    // Nilai negatif tidak bisa diikuti: kurva-S kumulatif harus monoton naik.
    // Menolaknya lebih jujur daripada mengubahnya jadi 0 tanpa memberi tahu.
    const minggu = raw.findIndex((v) => !Number.isFinite(v) || v < 0);
    if (minggu >= 0) {
      throw new Error(
        `"${kat.name}" minggu ${minggu + 1} bernilai ${raw[minggu]} – nilai negatif membuat kurva turun. Perbaiki filenya.`,
      );
    }
    const weekly = raw.map(bulat6);
    const sum = weekly.reduce((s, v) => s + v, 0);
    if (sum <= 0) tanpaJadwal.push(kat.name);
    mentah.push(sum > 0 ? { kat, weekly, sum } : { kat, weekly: kosong(), sum: 0 });
  }

  const totalExcel = mentah.reduce((s, r) => s + r.sum, 0);
  if (!(totalExcel > 0)) {
    throw new Error(
      "Semua nilai minggu di Excel kosong atau 0 – tidak ada jadwal yang bisa dijadikan rencana.",
    );
  }

  if (Math.abs(totalExcel - 100) > TOLERANSI_TOTAL_PP) {
    const sisa =
      tanpaJadwal.length > 0
        ? ` ${tanpaJadwal.length} pekerjaan RAB belum punya jadwal di Excel: ${tanpaJadwal.slice(0, 5).join(", ")}${tanpaJadwal.length > 5 ? ", …" : ""}.`
        : "";
    throw new Error(
      `Total bobot di Excel ${pp(totalExcel)}%, selisihnya lebih dari ${TOLERANSI_TOTAL_PP}% dari 100% – angkanya tidak bisa dipakai apa adanya karena kurva-S harus tuntas 100%.${sisa} Perbaiki filenya, atau centang "Sesuaikan bobot ke RAB" bila memang ingin sistem yang menghitung bobotnya.`,
    );
  }

  const faktorSkala = 100 / totalExcel;
  const perluSkala = Math.abs(faktorSkala - 1) > 1e-9;

  const rows: BarisJadwal[] = mentah.map((r) => {
    const weekly = perluSkala ? r.weekly.map((v) => bulat6(v * faktorSkala)) : r.weekly;
    return {
      lineageKey: r.kat.lineageKey,
      name: r.kat.name,
      weightPct: Math.round(weekly.reduce((s, v) => s + v, 0) * 1000) / 1000,
      weekly,
    };
  });

  const selisihBobot = rows
    .map((row, i) => ({ name: row.name, excel: row.weightPct, rab: mentah[i].kat.weightRabPct }))
    .filter((d) => Math.abs(d.excel - d.rab) > AMBANG_SELISIH_PP);

  return {
    rows,
    cocok: mentah.filter((r) => r.sum > 0).length,
    totalExcel,
    faktorSkala: perluSkala ? faktorSkala : 1,
    tanpaJadwal,
    selisihBobot,
  };
}

/**
 * Kalimat ringkas untuk banner hasil impor. Sengaja MENYEBUT apa yang berbeda
 * dari RAB: user memilih memakai angkanya sendiri, jadi dia berhak tahu persis
 * di mana pilihannya berbeda dari bobot kontrak — bukan diam-diam dianggap sama.
 */
export function ringkasApaAdanya(h: HasilApaAdanya): string {
  const bagian: string[] = [`${h.cocok} pekerjaan memakai angka Excel apa adanya`];
  if (h.faktorSkala !== 1) {
    bagian.push(`total ${pp(h.totalExcel)}% diskalakan seragam ke 100% (bentuk & perbandingan tidak berubah)`);
  }
  if (h.tanpaJadwal.length > 0) {
    bagian.push(`${h.tanpaJadwal.length} pekerjaan tanpa jadwal di Excel dibiarkan kosong`);
  }
  if (h.selisihBobot.length > 0) {
    const contoh = h.selisihBobot
      .slice(0, 3)
      .map((d) => `${d.name} ${pp(d.excel)}% (RAB ${pp(d.rab)}%)`)
      .join("; ");
    bagian.push(
      `${h.selisihBobot.length} pekerjaan berbeda dari bobot RAB – ${contoh}${h.selisihBobot.length > 3 ? "; …" : ""}`,
    );
  }
  return bagian.join(". ") + ".";
}
