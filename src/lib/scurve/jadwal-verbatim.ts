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
  /** Pekerjaan yang punya minggu bernilai MINUS (penyesuaian CCO) – disebut, tidak diubah. */
  selMinus: { name: string; minggu: number[] }[];
  /** Minggu (1-based) tempat rencana KUMULATIF total turun dari minggu sebelumnya. */
  mingguTurun: number[];
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
    /*
     * NILAI MINUS DIIKUTI (DECISIONS baru 2026-10-07). Sesudah CCO, minggu yang
     * sudah terlapor tidak diubah; bobot yang turun diserap minggu sesudahnya,
     * jadi satu pekerjaan bisa minus di minggu tertentu. Yang ditolak hanya sel
     * yang bukan angka, dan pekerjaan yang JUMLAH akhirnya negatif – bobot
     * pekerjaan tidak mungkin di bawah nol.
     */
    const rusak = raw.findIndex((v) => !Number.isFinite(v));
    if (rusak >= 0) {
      throw new Error(`"${kat.name}" minggu ${rusak + 1} bukan angka (${raw[rusak]}). Perbaiki dulu berkasnya.`);
    }
    const weekly = raw.map(bulat6);
    const sum = weekly.reduce((s, v) => s + v, 0);
    if (sum < -1e-6) {
      throw new Error(
        `Jumlah minggu "${kat.name}" di Excel ${pp(sum)}% – negatif. Nilai minus boleh untuk penyesuaian sesudah CCO, tapi jumlah akhir tiap pekerjaan tidak boleh di bawah 0%.`,
      );
    }
    const adaIsi = weekly.some((v) => Math.abs(v) > 1e-9);
    // Pekerjaan yang dicabut CCO bisa berjumlah 0 tapi tetap membawa minggu
    // yang sudah terlapor (+x lalu −x). Itu jadwal, bukan "tanpa jadwal".
    if (!adaIsi) tanpaJadwal.push(kat.name);
    mentah.push(adaIsi ? { kat, weekly, sum: Math.max(0, sum) } : { kat, weekly: kosong(), sum: 0 });
  }

  const totalExcel = mentah.reduce((s, r) => s + r.sum, 0);
  if (!(totalExcel > 0)) {
    throw new Error(
      "Semua nilai minggu di Excel kosong atau 0, jadi tidak ada jadwal yang bisa dijadikan rencana.",
    );
  }

  if (Math.abs(totalExcel - 100) > TOLERANSI_TOTAL_PP) {
    const sisa =
      tanpaJadwal.length > 0
        ? ` ${tanpaJadwal.length} pekerjaan RAB belum punya jadwal di Excel: ${tanpaJadwal.slice(0, 5).join(", ")}${tanpaJadwal.length > 5 ? ", …" : ""}.`
        : "";
    throw new Error(
      `Total bobot di Excel ${pp(totalExcel)}%, selisihnya lebih dari ${TOLERANSI_TOTAL_PP}% dari 100%. Angka ini tidak bisa dipakai apa adanya karena kurva-S harus tuntas 100%.${sisa} Perbaiki berkasnya, atau centang "Sesuaikan bobot ke RAB" bila memang ingin sistem yang menghitung bobotnya.`,
    );
  }

  const faktorSkala = 100 / totalExcel;
  // Sisa pembulatan sel (bulat6 per sel, desimal panjang Excel) bukan alasan
  // menyentuh angka user – di bawah 0,0001 poin dianggap tepat 100%.
  const perluSkala = Math.abs(totalExcel - 100) > 1e-4;

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

  const selMinus = rows
    .map((r) => ({ name: r.name, minggu: r.weekly.flatMap((v, i) => (v < -1e-9 ? [i + 1] : [])) }))
    .filter((r) => r.minggu.length > 0);

  // Kumulatif MENTAH (sebelum dibatasi 100) – yang lewat 100% di tengah jalan
  // lalu turun lagi akan terpotong diam-diam oleh penyimpan, jadi ditolak di sini.
  const mingguTurun: number[] = [];
  let kum = 0;
  let sebelum = 0;
  for (let w = 0; w < n; w++) {
    kum += rows.reduce((s, r) => s + (r.weekly[w] ?? 0), 0);
    if (kum > 100 + 0.5 || kum < -0.5) {
      throw new Error(
        `Rencana kumulatif minggu ${w + 1} menjadi ${pp(kum)}% – di luar 0–100%. Nilai minus boleh, tapi kumulatifnya harus tetap di antara 0% dan 100%.`,
      );
    }
    if (w > 0 && kum < sebelum - 0.005) mingguTurun.push(w + 1);
    sebelum = kum;
  }

  return {
    rows,
    cocok: mentah.filter((r) => r.weekly.some((v) => Math.abs(v) > 1e-9)).length,
    totalExcel,
    faktorSkala: perluSkala ? faktorSkala : 1,
    tanpaJadwal,
    selisihBobot,
    selMinus,
    mingguTurun,
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
  if (h.selMinus.length > 0) {
    const contoh = h.selMinus
      .slice(0, 3)
      .map((m) => `${m.name} minggu ${m.minggu.join(", ")}`)
      .join("; ");
    bagian.push(`${h.selMinus.length} pekerjaan punya nilai minus (penyesuaian CCO) – ${contoh}${h.selMinus.length > 3 ? "; …" : ""}`);
  }
  if (h.mingguTurun.length > 0) {
    bagian.push(`rencana kumulatif turun di minggu ${h.mingguTurun.join(", ")}`);
  }
  return bagian.join(". ") + ".";
}
