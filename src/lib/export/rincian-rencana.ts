/**
 * RENCANA SHEET RINCIAN RAB BERTAUT (DECISIONS 741) – murni, tanpa ExcelJS.
 *
 * Permintaan user 2026-11-05: unduhan RAB aktif dan CCO format KKP *"dilengkapi
 * dengan resume, sub resume, analisa, resume analisa, back up volumenya juga
 * yang terlink total"*, dengan pilihan **"tautkan bila cocok"**: sel di Detail
 * ditautkan ke rinciannya HANYA bila angkanya sama dengan angka resmi MARLIN.
 * Yang berbeda tetap angka resmi, ditandai, dan didaftar – tautan tidak
 * mengubah satu angka pun dibanding unduhan tanpa rincian.
 *
 * Rantai tautannya:
 *
 *   Detail RAB  Volume       = ROUND('Backup Volume'!<total>, 3)
 *               Harga Satuan = ROUND('Resume Analisa'!<harga>, 2)
 *   Resume Analisa  Harga    = 'Analisa'!<F blok>
 *   Analisa     Harga komp.  = 'Bahan & Upah'!<harga>
 *               Jumlah       = Koefisien × Harga
 *               D = A + B + C, E = D × overhead, F = D + E
 *   Backup Volume  baris berkas (rumus asli digeser) / isian MARLIN
 *
 * ROUND ke 3 dan 2 desimal = presisi penyimpanan volume dan harga satuan
 * MARLIN. Tanpanya, harga analisa yang berdesimal panjang membuat
 * ROUND(volume × harga) di Detail meleset dari jumlah resmi.
 *
 * SETIAP RUMUS DIBUKTIKAN sebelum ditulis (`rumus-mini`): rumus asli berkas
 * hanya dipakai bila menghasilkan angka yang tersimpan; kalau tidak, angkanya
 * yang ditulis. Draf analisa AI dan padanan AHSP TIDAK ikut – yang ditulis
 * hanya analisa dari berkas kontrak (DECISIONS 652).
 */

import { hitungRumus, geserRumus, type AmbilSel } from "./rumus-mini";
import { hasilBarisBackup } from "@/lib/ahsp/rapl-calc";
import { angkaKeKolom, galatExcel } from "@/lib/rab/rincian/rumus";

/* ── Masukan ──────────────────────────────────────────────────────────────── */

export type SelBerkasEkspor = { kolom: number; nilai: number | string | null; rumus: string | null };
export type BarisBerkasEkspor = { sheet: string; baris: number; sel: SelBerkasEkspor[] };

export type AsalRincian = { revisionNo: number; warisan: boolean };

export type BackupEkspor =
  | {
      jenis: "berkas";
      asal: AsalRincian;
      /** Rumus sel volume di sheet RAB berkas, tanpa "=". */
      rumusRab: string | null;
      nilaiRab: number | null;
      sumber: { sheet: string; sel: string; nilai: number | null }[];
      baris: BarisBerkasEkspor[];
      /** Label kolom per sheet berkas (baris kepala tabelnya). */
      kepala: Record<string, Record<number, string>>;
    }
  | {
      jenis: "isian";
      asal: AsalRincian;
      baris: {
        uraian: string;
        jumlah: number | null;
        panjang: number | null;
        lebar: number | null;
        tinggi: number | null;
        kurang: boolean;
        keterangan: string | null;
      }[];
    };

export type KomponenEkspor = {
  kategori: "upah" | "bahan" | "alat" | "lain";
  nama: string;
  satuan: string | null;
  koefisien: number | null;
  harga: number | null;
  jumlah: number | null;
  /** Kunci harga dasar (`hargaDasar[].kunci`) yang dirujuk berkas, bila ada. */
  hargaDasar: string | null;
};

export type AnalisaEkspor = {
  id: string;
  kode: string | null;
  uraian: string | null;
  hargaSatuan: number | null;
  /** 0,15 = 15 %. */
  overhead: number | null;
  /**
   * Pembulatan harga satuan pekerjaan menurut RUMUS berkas – sel blok yang
   * nilainya sama dengan harga analisa, mis. `ROUNDUP((G51+G52),2)`. Dibaca
   * dari rumusnya, tidak ditebak; null = tanpa pembulatan.
   */
  pembulatan?: { fungsi: "ROUND" | "ROUNDUP" | "ROUNDDOWN"; digit: number } | null;
  asal: AsalRincian;
  komponen: KomponenEkspor[];
};

export type HargaDasarEkspor = {
  kunci: string;
  nama: string | null;
  satuan: string | null;
  harga: number | null;
  /** "Bahan & Upah!C336 · rev #2" – asal di berkas. */
  asalSel: string;
};

export type ItemEkspor = {
  lineageKey: string;
  kode: string;
  nama: string;
  satuan: string | null;
  volume: number | null;
  hargaSatuan: number | null;
  backup: BackupEkspor | null;
  /** Kenapa tanpa backup (kalimat siap baca), bila `backup` null. */
  sebabTanpaBackup: string | null;
  analisaId: string | null;
};

export type RincianEkspor = {
  item: ItemEkspor[];
  analisa: AnalisaEkspor[];
  hargaDasar: HargaDasarEkspor[];
};

/* ── Keluaran ─────────────────────────────────────────────────────────────── */

export type Gaya = "judul" | "kepala" | "subjudul" | "total" | "beda";
export type SelRencana = {
  c: number;
  v: number | string | null;
  /** Rumus TANPA "=", dengan `v` sebagai hasil tersimpan. */
  f?: string;
  fmt?: string;
  gaya?: Gaya;
  catatan?: string;
};
export type BarisRencana = { r: number; sel: SelRencana[]; gaya?: Gaya };
export type LembarRencana = { nama: string; lebar: number[]; baris: BarisRencana[] };

/** Sel rincian yang boleh dirujuk Detail – sudah DIBUKTIKAN sama dengan nilainya. */
export type TautanItem = {
  volume: { alamat: string; nilai: number } | null;
  harga: { alamat: string; nilai: number } | null;
};

export type RencanaRincian = {
  lembar: LembarRencana[];
  tautan: Map<string, TautanItem>;
  /** Selisih di DALAM rincian (rumus berkas tak terbukti, harga analisa ≠ hitungan komponen). */
  catatan: string[];
};

export const LEMBAR = {
  backup: "Backup Volume",
  resumeAnalisa: "Resume Analisa",
  analisa: "Analisa",
  bahan: "Bahan & Upah",
} as const;

export const FMT = { vol: "#,##0.000", koef: "0.0000", rp: "#,##0.00", rp0: "#,##0" } as const;

const sama = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const bulat = (x: number, d: number) => {
  const f = 10 ** d;
  return Math.round(Number((x * f).toPrecision(15))) / f;
};
const ref = (lembar: string, c: number, r: number) => `'${lembar}'!${angkaKeKolom(c)}${r}`;
const KATEGORI: { k: KomponenEkspor["kategori"]; judul: string }[] = [
  { k: "upah", judul: "A. TENAGA" },
  { k: "bahan", judul: "B. BAHAN" },
  { k: "alat", judul: "C. PERALATAN" },
  { k: "lain", judul: "D. LAIN-LAIN" },
];

/* ── Bahan & Upah ─────────────────────────────────────────────────────────── */

function susunBahan(rincian: RincianEkspor, dipakai: Set<string>) {
  const baris: BarisRencana[] = [
    { r: 1, sel: [{ c: 1, v: "DAFTAR HARGA BAHAN, UPAH, DAN ALAT", gaya: "judul" }] },
    { r: 2, sel: [{ c: 1, v: "Hanya yang dipakai analisa di sheet Analisa. Angka dari berkas kontrak, apa adanya." }] },
    {
      r: 4,
      gaya: "kepala",
      sel: ["No", "Uraian", "Satuan", "Harga (Rp)", "Asal di berkas"].map((v, i) => ({ c: i + 1, v })),
    },
  ];
  const selHarga = new Map<string, { alamat: string; nilai: number }>();
  let r = 4;
  let no = 0;
  for (const h of rincian.hargaDasar) {
    if (!dipakai.has(h.kunci)) continue;
    r++;
    no++;
    baris.push({
      r,
      sel: [
        { c: 1, v: no },
        { c: 2, v: h.nama ?? "" },
        { c: 3, v: h.satuan ?? "" },
        { c: 4, v: h.harga, fmt: FMT.rp },
        { c: 5, v: h.asalSel },
      ],
    });
    if (h.harga != null) selHarga.set(h.kunci, { alamat: ref(LEMBAR.bahan, 4, r), nilai: h.harga });
  }
  return { lembar: { nama: LEMBAR.bahan, lebar: [6, 48, 10, 16, 30], baris }, selHarga };
}

/* ── Analisa + Resume Analisa ─────────────────────────────────────────────── */

function susunAnalisa(
  analisa: AnalisaEkspor[],
  selHarga: Map<string, { alamat: string; nilai: number }>,
  catatan: string[],
) {
  const baris: BarisRencana[] = [
    { r: 1, sel: [{ c: 1, v: "ANALISA HARGA SATUAN PEKERJAAN", gaya: "judul" }] },
    {
      r: 2,
      sel: [
        {
          c: 1,
          v: "Dari berkas kontrak. Harga komponen tertaut ke sheet Bahan & Upah; sel berwarna = angka berkas yang tidak sama dengan hitungannya, ditulis apa adanya.",
        },
      ],
    },
  ];
  /** Sel harga satuan pekerjaan (F) yang terbukti sama dengan angka berkas. */
  const selF = new Map<string, { alamat: string; nilai: number }>();
  let r = 3;
  for (const a of analisa) {
    r += 2;
    baris.push({
      r,
      gaya: "subjudul",
      sel: [
        { c: 1, v: a.kode ?? "" },
        { c: 2, v: (a.uraian ?? "Tanpa uraian") + (a.asal.warisan ? ` (dari revisi #${a.asal.revisionNo})` : "") },
      ],
    });
    r++;
    baris.push({
      r,
      gaya: "kepala",
      sel: ["No", "Uraian", "Satuan", "Koefisien", "Harga Satuan (Rp)", "Jumlah Harga (Rp)"].map((v, i) => ({ c: i + 1, v })),
    });
    const subtotal: { r: number; nilai: number }[] = [];
    for (const { k, judul } of KATEGORI) {
      const isi = a.komponen.filter((x) => x.kategori === k);
      if (isi.length === 0) continue;
      r++;
      baris.push({ r, sel: [{ c: 2, v: judul, gaya: "subjudul" }] });
      const awal = r + 1;
      let jumlahGrup = 0;
      isi.forEach((x, i) => {
        r++;
        const sel: SelRencana[] = [
          { c: 1, v: i + 1 },
          { c: 2, v: x.nama },
          { c: 3, v: x.satuan ?? "" },
          { c: 4, v: x.koefisien, fmt: FMT.koef },
        ];
        // Harga: tertaut ke Bahan & Upah bila angkanya sama.
        const hd = x.hargaDasar ? selHarga.get(x.hargaDasar) : undefined;
        const harga = x.harga ?? 0;
        if (hd && x.harga != null && sama(hd.nilai, x.harga, 0.005)) {
          sel.push({ c: 5, v: hd.nilai, f: hd.alamat, fmt: FMT.rp });
        } else sel.push({ c: 5, v: x.harga, fmt: FMT.rp });
        const hargaExcel = hd && x.harga != null && sama(hd.nilai, x.harga, 0.005) ? hd.nilai : harga;
        // Jumlah = koefisien × harga, bila sama dengan angka berkas.
        const kali = (x.koefisien ?? 0) * hargaExcel;
        if (x.koefisien != null && x.jumlah != null && sama(kali, x.jumlah, 0.005)) {
          sel.push({ c: 6, v: kali, f: `D${r}*E${r}`, fmt: FMT.rp });
          jumlahGrup += kali;
        } else {
          sel.push({
            c: 6,
            v: x.jumlah,
            fmt: FMT.rp,
            gaya: x.jumlah != null && x.koefisien != null ? "beda" : undefined,
            catatan:
              x.jumlah != null && x.koefisien != null
                ? `Angka berkas ${x.jumlah}; koefisien × harga = ${kali}. Angka berkas dipakai.`
                : undefined,
          });
          jumlahGrup += x.jumlah ?? 0;
        }
        baris.push({ r, sel });
      });
      r++;
      baris.push({
        r,
        gaya: "total",
        sel: [
          { c: 2, v: `Jumlah ${judul.slice(3).toLowerCase()}` },
          { c: 6, v: jumlahGrup, f: `SUM(F${awal}:F${r - 1})`, fmt: FMT.rp },
        ],
      });
      subtotal.push({ r, nilai: jumlahGrup });
    }
    const d = subtotal.reduce((t, s) => t + s.nilai, 0);
    r++;
    const rD = r;
    baris.push({
      r,
      gaya: "total",
      sel: [
        { c: 2, v: "Jumlah (A+B+C)" },
        { c: 6, v: d, f: subtotal.length ? subtotal.map((s) => `F${s.r}`).join("+") : "0", fmt: FMT.rp },
      ],
    });
    let f = d;
    let rumusF = `F${rD}`;
    if (a.overhead != null) {
      r++;
      const e = d * a.overhead;
      baris.push({
        r,
        sel: [
          { c: 2, v: `Overhead & profit ${bulat(a.overhead * 100, 2)} %` },
          { c: 4, v: a.overhead, fmt: "0.00%" },
          { c: 6, v: e, f: `F${rD}*D${r}`, fmt: FMT.rp },
        ],
      });
      f = d + e;
      rumusF = `F${rD}+F${r}`;
    }
    if (a.pembulatan) {
      const { fungsi, digit } = a.pembulatan;
      const dibulat = hitungRumus(`${fungsi}(${f},${digit})`, () => null);
      if (dibulat != null) {
        f = dibulat;
        rumusF = `${fungsi}(${rumusF},${digit})`;
      }
    }
    r++;
    const cocok = a.hargaSatuan != null && sama(f, a.hargaSatuan, 0.005);
    baris.push({
      r,
      gaya: "total",
      sel: [
        { c: 2, v: "Harga satuan pekerjaan" },
        { c: 6, v: f, f: rumusF, fmt: FMT.rp },
      ],
    });
    if (cocok) selF.set(a.id, { alamat: ref(LEMBAR.analisa, 6, r), nilai: f });
    else if (a.hargaSatuan != null) {
      catatan.push(
        `Analisa ${a.kode ?? a.uraian ?? a.id}: hitungan komponen ${f.toFixed(2)}, angka berkas ${a.hargaSatuan.toFixed(2)}. ` +
          `Resume Analisa memakai angka berkas.`,
      );
    }
  }
  const lembarAnalisa: LembarRencana = { nama: LEMBAR.analisa, lebar: [8, 46, 10, 12, 16, 18], baris };

  // Resume Analisa – satu baris per analisa, harga tertaut ke F bila cocok.
  const res: BarisRencana[] = [
    { r: 1, sel: [{ c: 1, v: "RESUME ANALISA HARGA SATUAN", gaya: "judul" }] },
    { r: 3, gaya: "kepala", sel: ["No", "Kode", "Uraian Pekerjaan", "Harga Satuan (Rp)"].map((v, i) => ({ c: i + 1, v })) },
  ];
  const selResume = new Map<string, { alamat: string; nilai: number }>();
  let q = 3;
  analisa.forEach((a, i) => {
    q++;
    const t = selF.get(a.id);
    const harga: SelRencana = t
      ? { c: 4, v: t.nilai, f: t.alamat, fmt: FMT.rp }
      : { c: 4, v: a.hargaSatuan, fmt: FMT.rp, gaya: a.hargaSatuan != null ? "beda" : undefined, catatan: a.hargaSatuan != null ? "Angka berkas – tidak sama dengan hitungan komponen di sheet Analisa." : undefined };
    res.push({ r: q, sel: [{ c: 1, v: i + 1 }, { c: 2, v: a.kode ?? "" }, { c: 3, v: a.uraian ?? "" }, harga] });
    const nilai = t ? t.nilai : a.hargaSatuan;
    if (nilai != null) selResume.set(a.id, { alamat: ref(LEMBAR.resumeAnalisa, 4, q), nilai });
  });
  return { lembarAnalisa, lembarResume: { nama: LEMBAR.resumeAnalisa, lebar: [6, 14, 60, 18], baris: res }, selResume };
}

/* ── Backup Volume ────────────────────────────────────────────────────────── */

function susunBackup(item: ItemEkspor[], catatan: string[]) {
  const baris: BarisRencana[] = [
    { r: 1, sel: [{ c: 1, v: "BACKUP VOLUME", gaya: "judul" }] },
    {
      r: 2,
      sel: [
        {
          c: 1,
          v: "Baris dari berkas kontrak (rumus aslinya dipakai bila terbukti menghasilkan angka yang sama) atau isian di MARLIN. Volume tiap item di Detail RAB tertaut ke baris VOLUME KE RAB.",
        },
      ],
    },
  ];
  const selVolume = new Map<string, { alamat: string; nilai: number }>();
  let r = 3;
  let kolomMaks = 8;
  for (const it of item) {
    const b = it.backup;
    if (!b) continue;
    r += 2;
    const asal = b.asal.warisan ? ` · diwarisi dari revisi #${b.asal.revisionNo}` : "";
    baris.push({
      r,
      gaya: "subjudul",
      sel: [{ c: 1, v: `${it.kode} ${it.nama}`.trim() + ` (${it.satuan ?? "-"})${b.jenis === "isian" ? " · diisi di MARLIN" : ""}${asal}` }],
    });
    if (b.jenis === "isian") {
      r++;
      baris.push({
        r,
        gaya: "kepala",
        sel: ["No", "Uraian", "Jumlah", "Panjang", "Lebar", "Tinggi", "Hasil", "Keterangan"].map((v, i) => ({ c: i + 1, v })),
      });
      const awal = r + 1;
      let total = 0;
      b.baris.forEach((x, i) => {
        r++;
        const hasil = hasilBarisBackup(x);
        const faktor = (["C", "D", "E", "F"] as const).filter((_, k) => [x.jumlah, x.panjang, x.lebar, x.tinggi][k] != null);
        const rumus = faktor.length ? `${x.kurang ? "-" : ""}${faktor.map((k) => `${k}${r}`).join("*")}` : null;
        baris.push({
          r,
          sel: [
            { c: 1, v: i + 1 },
            { c: 2, v: x.uraian + (x.kurang ? " (pengurang)" : "") },
            { c: 3, v: x.jumlah, fmt: FMT.vol },
            { c: 4, v: x.panjang, fmt: FMT.vol },
            { c: 5, v: x.lebar, fmt: FMT.vol },
            { c: 6, v: x.tinggi, fmt: FMT.vol },
            rumus ? { c: 7, v: hasil, f: rumus, fmt: FMT.vol } : { c: 7, v: null },
            { c: 8, v: x.keterangan ?? "" },
          ],
        });
        total += hasil ?? 0;
      });
      r++;
      baris.push({
        r,
        gaya: "total",
        sel: [
          { c: 2, v: "VOLUME KE RAB" },
          { c: 7, v: total, f: b.baris.length ? `SUM(G${awal}:G${r - 1})` : "0", fmt: FMT.vol },
        ],
      });
      selVolume.set(it.lineageKey, { alamat: ref(LEMBAR.backup, 7, r), nilai: total });
      continue;
    }

    // Baris berkas: kolom asli dipertahankan, baris digeser. Satu blok per sheet asal.
    const peta = new Map<string, number>(); // "sheet|baris" → baris baru
    const nilaiAsli = new Map<string, number | string | null>(); // "sheet|c|r"
    const perSheet = new Map<string, BarisBerkasEkspor[]>();
    for (const x of b.baris) {
      const arr = perSheet.get(x.sheet) ?? [];
      arr.push(x);
      perSheet.set(x.sheet, arr);
      for (const s of x.sel) nilaiAsli.set(`${x.sheet}|${s.kolom}|${x.baris}`, s.nilai);
    }
    // Sel sumber yang tidak ada di baris tersimpan tetap ikut, sebagai nilai.
    for (const s of b.sumber) {
      const m = /^\$?([A-Z]{1,3})\$?(\d+)$/i.exec(s.sel);
      if (!m) continue;
      const c = m[1]!.toUpperCase().split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
      const k = `${s.sheet}|${c}|${Number(m[2])}`;
      if (!nilaiAsli.has(k)) nilaiAsli.set(k, s.nilai);
    }
    for (const [sheet, xs] of perSheet) {
      r++;
      baris.push({ r, sel: [{ c: 1, v: `Sheet berkas: ${sheet}` }] });
      // Kepala yang sudah tersimpan sebelum pembaca menyaring galat (#VALUE!) disaring di sini.
      const kepala = b.kepala[sheet] ?? {};
      const kolomKepala = Object.keys(kepala)
        .map(Number)
        .filter((c) => !galatExcel(kepala[c] ?? ""));
      if (kolomKepala.length) {
        r++;
        baris.push({ r, gaya: "kepala", sel: kolomKepala.map((c) => ({ c, v: kepala[c] ?? "" })) });
      }
      for (const x of [...xs].sort((p, q) => p.baris - q.baris)) {
        r++;
        peta.set(`${sheet}|${x.baris}`, r);
      }
      // Baris ditulis setelah petanya lengkap – rumus bisa merujuk baris di bawahnya.
      for (const x of [...xs].sort((p, q) => p.baris - q.baris)) {
        const rb = peta.get(`${sheet}|${x.baris}`)!;
        const sel: SelRencana[] = [];
        for (const s of x.sel) {
          kolomMaks = Math.max(kolomMaks, s.kolom);
          const ambil: AmbilSel = (sh, c, rr) => nilaiAsli.get(`${sh ?? sheet}|${c}|${rr}`);
          let tulis: SelRencana = { c: s.kolom, v: s.nilai, fmt: typeof s.nilai === "number" ? FMT.vol : undefined };
          if (s.rumus && typeof s.nilai === "number") {
            const hasil = hitungRumus(s.rumus, ambil);
            const geser = geserRumus(s.rumus, (sh, c, rr) => {
              const nb = peta.get(`${sh ?? sheet}|${rr}`);
              return nb == null ? null : { sheet: null, c, r: nb };
            });
            if (hasil != null && geser && sama(hasil, s.nilai, 1e-6 * Math.max(1, Math.abs(s.nilai)))) {
              tulis = { ...tulis, f: geser };
            }
          }
          sel.push(tulis);
        }
        baris.push({ r: rb, sel });
      }
    }
    // Baris VOLUME KE RAB: rumus sel volume di RAB berkas, digeser ke baris di atas.
    r++;
    const kolomTotal = 3;
    const nilaiBerkas = b.nilaiRab ?? (b.sumber.length === 1 ? b.sumber[0]!.nilai : null);
    let total: SelRencana = { c: kolomTotal, v: nilaiBerkas, fmt: FMT.vol };
    const rumusRab = b.rumusRab ?? (b.sumber.length === 1 ? `'${b.sumber[0]!.sheet.replace(/'/g, "''")}'!${b.sumber[0]!.sel}` : null);
    if (rumusRab && nilaiBerkas != null) {
      const ambil: AmbilSel = (sh, c, rr) => (sh == null ? undefined : nilaiAsli.get(`${sh}|${c}|${rr}`));
      const hasil = hitungRumus(rumusRab, ambil);
      const geser = geserRumus(rumusRab, (sh, c, rr) => {
        if (sh == null) return null;
        const nb = peta.get(`${sh}|${rr}`);
        return nb == null ? null : { sheet: null, c, r: nb };
      });
      if (hasil != null && geser && sama(hasil, nilaiBerkas, 1e-6 * Math.max(1, Math.abs(nilaiBerkas)))) {
        total = { ...total, f: geser };
      } else {
        catatan.push(
          `Backup ${it.kode} ${it.nama}: rumus volume di berkas (=${rumusRab}) tidak bisa dihitung ulang dari baris yang tersimpan; ` +
            `VOLUME KE RAB ditulis sebagai angka berkas.`,
        );
      }
    }
    baris.push({ r, gaya: "total", sel: [{ c: 1, v: "VOLUME KE RAB" }, total] });
    if (typeof total.v === "number") selVolume.set(it.lineageKey, { alamat: ref(LEMBAR.backup, kolomTotal, r), nilai: total.v });
  }
  const lebar = [12, 40, ...Array.from({ length: Math.max(0, kolomMaks - 2) }, () => 13)];
  return { lembar: { nama: LEMBAR.backup, lebar, baris }, selVolume };
}

/* ── Rakit ────────────────────────────────────────────────────────────────── */

/**
 * Susun keempat sheet rincian + tautan per item. Tautan hanya diberikan bila
 * nilai rinciannya, dibulatkan ke presisi MARLIN, SAMA dengan angka resmi
 * (volume 3 desimal, harga satuan 2 desimal). Yang tidak, diputuskan di Detail.
 */
export function susunRincian(rincian: RincianEkspor): RencanaRincian {
  const catatan: string[] = [];
  const dipakaiAnalisa = new Set(rincian.item.map((i) => i.analisaId).filter((x): x is string => !!x));
  const analisa = rincian.analisa.filter((a) => dipakaiAnalisa.has(a.id));
  const dipakaiHarga = new Set(analisa.flatMap((a) => a.komponen.map((k) => k.hargaDasar).filter((x): x is string => !!x)));

  const bahan = susunBahan(rincian, dipakaiHarga);
  const an = susunAnalisa(analisa, bahan.selHarga, catatan);
  const bk = susunBackup(rincian.item, catatan);

  const tautan = new Map<string, TautanItem>();
  for (const it of rincian.item) {
    const v = bk.selVolume.get(it.lineageKey) ?? null;
    const h = it.analisaId ? (an.selResume.get(it.analisaId) ?? null) : null;
    tautan.set(it.lineageKey, { volume: v, harga: h });
  }
  return { lembar: [bk.lembar, an.lembarResume, an.lembarAnalisa, bahan.lembar], tautan, catatan };
}

/**
 * Keputusan "tautkan bila cocok" untuk satu sel Detail. `null` = jangan
 * tautkan (angka resmi ditulis). Rumus dibungkus ROUND ke presisi MARLIN,
 * jadi hasilnya PERSIS angka resmi.
 */
export function rumusTautan(
  t: { alamat: string; nilai: number } | null,
  resmi: number | null,
  desimal: 2 | 3,
): string | null {
  if (!t || resmi == null) return null;
  // Pembulatan setengah menjauhi nol pada 15 digit bermakna – sama dengan
  // ROUND Excel dan dengan cara volume/harga disimpan (62,3065 → 62,307).
  return bulat(t.nilai, desimal) === bulat(resmi, desimal) ? `ROUND(${t.alamat},${desimal})` : null;
}
