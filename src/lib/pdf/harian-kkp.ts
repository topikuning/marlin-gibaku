import "server-only";
import { db } from "@/lib/db";
import { getBranding } from "@/lib/branding";
import { getKkpDailyData } from "@/lib/daily-report/queries";
import { WORKER_ROLE_LABEL, WORKER_ROLE_ORDER } from "@/lib/daily-report/constants";
import { barisRealisasiKkp, type KkpDailyData } from "@/components/knmp/kkp-daily-report";
import { KKP_WEATHER_HOURS } from "@/lib/weather/hourly";
import {
  PDF_COLORS,
  PDF_FONT,
  docToBuffer,
  createFormA4Doc,
  FORM_MARGIN,
  type PdfDoc,
} from "./document";
import { colWidths, gridRow, gridRowHeight, type GridCell, type GridOptions } from "./grid";
import {
  gambarDokumentasi,
  gambarDokumentasiPelengkap,
  gambarSampul,
  type FotoDok,
  type FotoPelengkapDok,
} from "./harian-kkp-lampiran";
import { signPhotoToken } from "./photo-token";
import { blokTandaTanganPdf, muatTtdPdf, TANPA_TTD_PDF, type TtdPdf } from "./ttd-gambar";

/**
 * Laporan Harian format KKP — BLANKO RESMI, urutan blok PERSIS contoh KKP:
 * kop (logo pemilik · LAPORAN HARIAN | KONSULTAN PENGAWAS | KONTRAKTOR
 * PELAKSANA) → Minggu Ke/Hari/Tanggal → PEKERJAAN/LOKASI/TH. ANGGARAN →
 * TENAGA KERJA | REKAP PEMASUKAN BAHAN / MATERIAL (+ PERALATAN) → KONDISI
 * CUACA per jam (+ SHOP DRAWING) → Jam Kerja → RENCANA | REALISASI PEKERJAAN
 * → tanda tangan. Kemajuan per pekerjaan menyatu di kolom REALISASI.
 *
 * Tata letak mengikuti komponen web `KkpDailyReport` supaya yang dicetak dari
 * layar dan yang disetor ke Drive IDENTIK. A4 lanskap karena matriks cuaca
 * butuh 16 kolom. DECISIONS 145.
 */

const HOURS = KKP_WEATHER_HOURS.map((h) => String(h).padStart(2, "0"));
const volFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 3 });
const orgFmt = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Baris kosong tercetak — blanko punya kotak siap-isi walau datanya belum ada. */
const MIN_MATERIAL_ROWS = 8;
const MIN_EQUIPMENT_ROWS = 6;
const MIN_RR_ROWS = 6;

export type HarianKkpPdfResult = { buffer: Buffer; locationId: string };

/** Lampiran gambar untuk satu hari. Dipakai penyaji harian DAN mingguan. */
export type LampiranHarian = {
  /** Logo pemilik pekerjaan — kop blanko. PNG; lihat catatan data-URI di bawah. */
  logoPemilik?: Buffer | null;
  logoVendor: Buffer | null;
  /** Logo firma konsultan pengawas — kop blanko & sampul (2026-08-24). */
  logoPengawas?: Buffer | null;
  foto: FotoDok[];
  /** Bukti material & alat — halamannya sendiri-sendiri (DECISIONS 304). */
  fotoMaterial?: FotoPelengkapDok[];
  fotoAlat?: FotoPelengkapDok[];
  /** Gambar tanda tangan & stempel (DECISIONS 328); null = ruang kosong. */
  ttd?: TtdPdf | null;
};

/**
 * Tulis BADAN satu laporan harian — blanko + dokumentasi — ke dokumen yang
 * SUDAH ada, tanpa membuat dan tanpa menutupnya (DECISIONS 332).
 *
 * Dipisah supaya berkas mingguan (satu sampul, tujuh laporan) memakai badan
 * yang SAMA PERSIS dengan cetak harian. Kalau keduanya menggambar blanko
 * sendiri-sendiri, cepat atau lambat keduanya menyimpang — aturan yang sama
 * dengan DECISIONS 241, dan yang ketahuan belakangan justru setelah dokumennya
 * dikirim ke PPK.
 *
 * Pemanggil bertanggung jawab menyiapkan halaman kosong yang siap ditulis;
 * fungsi ini mulai dari `FORM_MARGIN` di halaman yang sedang aktif.
 */
export function tulisBadanHarian(
  doc: PdfDoc,
  d: KkpDailyData,
  lampiran?: LampiranHarian,
): void {
  const x = FORM_MARGIN;
  const width = doc.page.width - FORM_MARGIN * 2;
  const bottom = doc.page.height - FORM_MARGIN - 12;
  let y = FORM_MARGIN;

  // Matikan paginasi otomatis pdfkit: penempatan baris diatur manual lewat `fit`.
  // Tanpa ini, doc.text() dekat margin bawah memicu halaman baru yang kosong.
  const noAutoBreak = () => {
    doc.page.margins.bottom = 0;
  };
  noAutoBreak();

  /** Pindah halaman bila baris berikutnya tak muat; ulangi header tabel bila ada. */
  const fit = (need: number, repeatHeader?: () => void) => {
    if (y + need <= bottom) return;
    doc.addPage();
    noAutoBreak();
    y = FORM_MARGIN;
    repeatHeader?.();
  };

  const draw = (cells: GridCell[], o: GridOptions) => {
    fit(gridRowHeight(doc, cells, o));
    y = gridRow(doc, y, cells, o);
  };

  /* ── Kop + identitas: satu kerangka, persis blanko ───────────────────
     Blok kiri (logo · LAPORAN HARIAN, lalu Minggu/Hari/Tanggal) berakhir di
     44% lebar. Blok kanan (KONSULTAN PENGAWAS | KONTRAKTOR PELAKSANA + nama
     perusahaan) MEMANJANG ke bawah sampai sejajar baris Tanggal, jadi sisi
     kanan tidak menganga. Baru sesudah itu PEKERJAAN/LOKASI/TH. ANGGARAN
     membentang PENUH sampai tepi kanan. */
  const kiriW = width * 0.44;
  const logoW = width * 0.09;
  const labelW = width * 0.23; // kolom label = kotak logo + kolom label blanko
  const colonW = width * 0.03;
  const kananW = width - kiriW;

  const kopKiri: GridOptions = { x, width: kiriW, cols: [logoW, kiriW - logoW], fontSize: 7.5, minRowHeight: 30 };
  const kopKanan: GridOptions = { x: x + kiriW, width: kananW, cols: [kananW / 2, kananW / 2], fontSize: 7.5 };
  const identKiri: GridOptions = { x, width: kiriW, cols: [labelW, colonW, kiriW - labelW - colonW], fontSize: 7 };

  fit(30 + 3 * 13 + 3 * 13);
  const atas = y;

  // Sisi kiri: kop + tiga baris identitas.
  let ky = gridRow(doc, atas, [{ text: " " }, { text: "LAPORAN HARIAN", bold: true }], kopKiri);
  const kopBawah = ky;
  for (const [label, value] of [
    ["Minggu Ke", d.weekNo != null ? String(d.weekNo) : ""],
    ["Hari", d.hari],
    ["Tanggal", d.tanggalFull],
  ] as const) {
    ky = gridRow(doc, ky, [{ text: label }, { text: ":", align: "center" }, { text: value }], identKiri);
  }

  // Sisi kanan: judul kolom, lalu kotak nama perusahaan setinggi sisa blok kiri.
  let ny = gridRow(
    doc,
    atas,
    [
      { text: "KONSULTAN PENGAWAS", align: "center", head: true },
      { text: "KONTRAKTOR PELAKSANA", align: "center", head: true },
    ],
    { ...kopKanan, minRowHeight: kopBawah - atas },
  );
  const firmaAtas = ny;
  ny = gridRow(
    doc,
    ny,
    [
      { text: d.supervisorFirm ?? " ", align: "center" },
      { text: d.contractorFirm ?? " ", align: "center" },
    ],
    { ...kopKanan, minRowHeight: Math.max(12, ky - ny) },
  );
  // Logo firma pengawas di sudut kiri sel KONSULTAN PENGAWAS (user 2026-08-24)
  // — data URI, alasan yang sama dengan logo pemilik di bawah.
  const sisiLogoKop = Math.min(ny - firmaAtas - 4, 18);
  const logoKop = (buf: Buffer | null, kolomKiri: number, siapa: string) => {
    if (!buf || sisiLogoKop <= 6) return;
    try {
      const src = `data:image/png;base64,${buf.toString("base64")}`;
      doc.image(src, kolomKiri + 3, firmaAtas + (ny - firmaAtas - sisiLogoKop) / 2, {
        fit: [sisiLogoKop, sisiLogoKop],
        align: "center",
        valign: "center",
      });
    } catch (err) {
      console.error(`[laporan-harian] logo ${siapa} gagal digambar di kop PDF:`, err);
    }
  };
  logoKop(lampiran?.logoPengawas ?? null, x + kiriW, "pengawas");
  /*
   * Logo PELAKSANA di kop (laporan user 2026-08-26). Sebelumnya hanya pengawas
   * yang berlogo, jadi dua pihak sederajat ditampilkan tidak setara — dan itu
   * terbaca di dokumen resmi.
   */
  logoKop(lampiran?.logoVendor ?? null, x + kiriW + kananW / 2, "pelaksana");
  y = Math.max(ky, ny);

  // Logo pemilik pekerjaan dari menu Sistem — bukan hardcode KKP (DECISIONS 166).
  //
  // Dikirim sebagai DATA URI, bukan Buffer. pdfkit di sini adalah bundle
  // STANDALONE (assets/pdfkit-standalone.cjs) yang membawa shim `Buffer`
  // sendiri: `Buffer.isBuffer(<Buffer Node>)` bernilai false di dalamnya,
  // sehingga input Buffer jatuh ke cabang `fs.readFileSync` yang TIDAK ADA di
  // bundle itu ("fs.readFileSync is not a function"). Data URI ditangani cabang
  // base64 yang bekerja di kedua build.
  const logoPemilik = lampiran?.logoPemilik ?? null;
  if (logoPemilik) {
    try {
      const src = `data:image/png;base64,${logoPemilik.toString("base64")}`;
      doc.image(src, x + 3, atas + 3, { fit: [logoW - 6, kopBawah - atas - 6], align: "center", valign: "center" });
    } catch (err) {
      // Logo rusak tidak boleh menggagalkan laporan — tapi jangan diam-diam.
      console.error("[laporan-harian] logo gagal digambar di kop PDF:", err);
    }
  }

  const ident: GridOptions = { x, width, cols: [labelW, colonW, width - labelW - colonW], fontSize: 7 };
  const barisIdent = (label: string, value: string) =>
    draw([{ text: label }, { text: ":", align: "center" }, { text: value }], ident);
  barisIdent("PEKERJAAN", d.pekerjaan || "Konstruksi");
  barisIdent("LOKASI", `${d.locationName}, ${d.regency}, ${d.province}`);
  barisIdent("TH. ANGGARAN", String(d.tahunAnggaran));

  /* ── Tenaga kerja | Material & peralatan (berdampingan) ────────────── */
  const half = width / 2;
  const leftOpt: GridOptions = { x, width: half, cols: colWidths(half, [0.6, 4, 1, 0.5]), fontSize: 6.5 };
  const rightOpt: GridOptions = {
    x: x + half,
    width: half,
    cols: colWidths(half, [0.5, 3, 0.8, 1, 0.9]),
    fontSize: 6.5,
  };

  // Bangun daftar baris kedua sisi lebih dulu supaya bisa digambar sejajar.
  const leftRows: GridCell[][] = [
    [{ text: "TENAGA KERJA", head: true, align: "center", span: 4 }],
    [
      { text: "NO", head: true, align: "center" },
      { text: "KEAHLIAN", head: true, align: "center" },
      { text: "JMH", head: true, align: "center", span: 2 },
    ],
    ...WORKER_ROLE_ORDER.map((r, i): GridCell[] => [
      { text: String(i + 1), align: "center" },
      { text: WORKER_ROLE_LABEL[r] },
      { text: orgFmt.format(d.workerMap[r] ?? 0), align: "right" },
      { text: "org", align: "center" },
    ]),
    [
      { text: "JUMLAH", span: 2, align: "center", bold: true },
      { text: orgFmt.format(d.totalWorkers), align: "right", bold: true },
      { text: "org", align: "center", bold: true },
    ],
  ];

  const barisMaterial = Math.max(MIN_MATERIAL_ROWS, d.materials.length);
  const barisPeralatan = Math.max(MIN_EQUIPMENT_ROWS, d.equipment.length);
  const matRows: GridCell[][] = [
    [{ text: "REKAP PEMASUKAN BAHAN / MATERIAL", head: true, align: "center", span: 5 }],
    [
      { text: "NO", head: true, align: "center" },
      { text: "JENIS MATERIAL / BAHAN", head: true, align: "center" },
      { text: "SATUAN", head: true, align: "center" },
      { text: "DITERIMA", head: true, align: "center" },
      // Ditolak: ada di blanko, belum ada inputnya — dikosongkan (keputusan user).
      { text: "DITOLAK", head: true, align: "center" },
    ],
    ...Array.from({ length: barisMaterial }, (_, i): GridCell[] => {
      const m = d.materials[i];
      return [
        { text: String(i + 1), align: "center" },
        { text: m?.name ?? " " },
        { text: m?.unit ?? " ", align: "center" },
        { text: m && m.qty != null ? volFmt.format(m.qty) : " ", align: "right" },
        { text: " " },
      ];
    }),
    [{ text: "PERALATAN", head: true, align: "center", span: 5 }],
    [
      { text: "NO", head: true, align: "center" },
      { text: "NAMA PERALATAN", head: true, align: "center", span: 3 },
      { text: "JUMLAH", head: true, align: "center" },
    ],
    ...Array.from({ length: barisPeralatan }, (_, i): GridCell[] => {
      const e = d.equipment[i];
      return [
        { text: String(i + 1), align: "center" },
        { text: e?.name ?? " ", span: 3 },
        { text: e ? String(e.count) : " ", align: "center" },
      ];
    }),
  ];

  /* Dua kolom digambar sejajar dari y yang SAMA; kalau salah satunya belum
     habis saat halaman penuh, KEDUANYA lanjut di halaman berikutnya dari titik
     yang sama lagi.

     Sampai 2026-08-27 sisa barisnya justru DIBUANG (`break` tanpa kelanjutan).
     Pada blanko dengan banyak material, baris ke-9 dan seterusnya tidak pernah
     tercetak sementara blankonya terbaca lengkap — memotong diam-diam, persis
     yang dilarang CLAUDE.md. */
  fit(60);
  let li = 0;
  let ri = 0;
  let sisiAtas = y;
  for (;;) {
    let ly = sisiAtas;
    let ry = sisiAtas;
    // `ly > sisiAtas` menjamin sekurang-kurangnya satu baris tergambar tiap
    // halaman, jadi perulangan ini selalu maju dan tidak bisa berputar abadi.
    while (li < leftRows.length) {
      const h = gridRowHeight(doc, leftRows[li], leftOpt);
      if (ly > sisiAtas && ly + h > bottom) break;
      ly = gridRow(doc, ly, leftRows[li], leftOpt);
      li++;
    }
    while (ri < matRows.length) {
      const h = gridRowHeight(doc, matRows[ri], rightOpt);
      if (ry > sisiAtas && ry + h > bottom) break;
      ry = gridRow(doc, ry, matRows[ri], rightOpt);
      ri++;
    }
    y = Math.max(ly, ry);
    if (li >= leftRows.length && ri >= matRows.length) break;
    doc.addPage();
    noAutoBreak();
    sisiAtas = FORM_MARGIN;
  }

  /* ── Kondisi cuaca per jam ─────────────────────────────────────────── */
  const weatherCols = colWidths(width, [2.2, ...HOURS.map(() => 1), 1.8]);
  const weather: GridOptions = { x, width, cols: weatherCols, fontSize: 5.5, padX: 1 };
  // Matriks cuaca harus utuh dalam satu halaman (2 header + 3 baris kondisi).
  fit(5 * 13);
  draw(
    [
      { text: "KONDISI CUACA", head: true, align: "center", span: HOURS.length + 1 },
      // Shop drawing: ada di blanko, belum ada datanya — dikosongkan.
      { text: "SHOP DRAWING", head: true, align: "center" },
    ],
    weather,
  );
  draw(
    [
      { text: "KONDISI / JAM", head: true, align: "center" },
      ...HOURS.map((h): GridCell => ({ text: `${h}.00`, head: true, align: "center" })),
      { text: " ", head: true },
    ],
    weather,
  );
  for (const cat of ["Cerah", "Mendung", "Hujan"] as const) {
    draw(
      [
        { text: cat, align: "center" },
        // Kondisi PER JAM bila cuaca diambil otomatis dari koordinat lokasi;
        // tanpa itu, jatuh ke perilaku lama (satu kategori sehari penuh).
        ...HOURS.map((h): GridCell => ({
          text: (d.weatherByHour ? d.weatherByHour[Number(h)] === cat : d.activeWeather === cat) ? "v" : "",
          align: "center",
        })),
        { text: "", align: "center" },
      ],
      weather,
    );
  }

  /* ── Jam kerja ─────────────────────────────────────────────────────── */
  const jam: GridOptions = { x, width, cols: [labelW + colonW, width - labelW - colonW], fontSize: 7 };
  draw(
    [
      { text: "Jam Kerja", head: true },
      { text: `mulai ${d.workStart ?? "……"} – selesai ${d.workEnd ?? "……"}` },
    ],
    jam,
  );

  /* ── Rencana | realisasi pekerjaan (dua kolom, mengikuti blanko) ────
     Uraian pekerjaan + kemajuannya menyatu di kolom REALISASI — tidak ada
     tabel progres terpisah (keputusan user 28 Juli 2026). */
  const rrHalf = width / 2;
  const rrLeft: GridOptions = { x, width: rrHalf, cols: colWidths(rrHalf, [0.5, 6]), fontSize: 6.5 };
  const rrRight: GridOptions = { x: x + rrHalf, width: rrHalf, cols: colWidths(rrHalf, [0.5, 6]), fontSize: 6.5 };
  const rencanaTeks = (d.rencana ?? []).map(
    (r) =>
      `${r.name}${r.volume > 0 ? ` – ${volFmt.format(r.volume)}${r.unit ? ` ${r.unit}` : ""}` : ""}` +
      (r.picName ? ` (${r.picName})` : ""),
  );
  // Dikelompokkan per BANGUNAN/KATEGORI — sumbernya sama dengan blanko layar
  // supaya PDF dan pratinjau tidak pernah berbeda isi (permintaan user
  // 2026-08-02, DECISIONS 214).
  const realisasiBaris = barisRealisasiKkp(d.items);
  const barisRR = Math.max(MIN_RR_ROWS, rencanaTeks.length, realisasiBaris.length);
  let noLanjut = d.items.length;

  /* Kepala DUA kolom sekaligus — diulang tiap kali blok ini pindah halaman,
     supaya lembar lanjutannya tetap bisa dibaca sendiri. */
  const kepalaRR = (yy: number): number => {
    gridRow(doc, yy, [{ text: "REALISASI PEKERJAAN", head: true, align: "center", span: 2 }], rrRight);
    return gridRow(doc, yy, [{ text: "RENCANA PEKERJAAN", head: true, align: "center", span: 2 }], rrLeft);
  };
  // Cukup ruang untuk kepala + satu baris; sisanya dipenggal PER BARIS di bawah.
  //
  // Sebelum 2026-08-27 blok ini memesan ruang untuk SELURUH barisnya sekaligus
  // (`fit(14 * (barisRR + 1))`) lalu menggambar tanpa penjagaan lagi. Begitu
  // realisasinya lebih panjang dari satu halaman — 20 item sudah cukup —
  // barisnya digambar terus melewati tepi bawah kertas: sebagian hilang, dan
  // baris yang kebetulan membungkus tepat di tepi memicu pdfkit membuka halaman
  // sendiri dan menaruh penggalan ekornya di sana. Itulah "· dari 1.754 m³ ·
  // 51,3%)" yang berdiri sendirian di halaman 3 berkas 26 Agustus 2026.
  fit(14 * 2);

  // Kedua kolom digambar BARIS PER BARIS dengan tinggi yang SAMA
  // (= yang paling tinggi di antara keduanya). Kalau digambar sebagai dua
  // loop terpisah, satu teks realisasi yang membungkus jadi dua baris
  // menggeser seluruh sisanya dan garis mendatar kiri–kanan tidak lagi
  // bertemu — cacat yang dilaporkan 28 Juli 2026.
  let rry = kepalaRR(y);
  for (let i = 0; i < barisRR; i++) {
    const kiri: GridCell[] = [{ text: String(i + 1), align: "center" }, { text: rencanaTeks[i] ?? " " }];
    const br = realisasiBaris[i];
    if (!br) noLanjut += 1;
    const kanan: GridCell[] = br?.kategori
      ? [{ text: " ", align: "center" }, { text: br.text, head: true }]
      : [{ text: br ? br.no : String(noLanjut), align: "center" }, { text: br?.text ?? " " }];
    const tinggi = Math.max(gridRowHeight(doc, kiri, rrLeft), gridRowHeight(doc, kanan, rrRight));
    if (rry + tinggi > bottom) {
      doc.addPage();
      noAutoBreak();
      rry = kepalaRR(FORM_MARGIN);
    }
    gridRow(doc, rry, kiri, { ...rrLeft, minRowHeight: tinggi });
    rry = gridRow(doc, rry, kanan, { ...rrRight, minRowHeight: tinggi });
  }
  y = rry;

  /* ── Baris basis draft adendum yang TIDAK dicetak (DECISIONS 215) ─────
     Disebut, bukan dihilangkan diam-diam: tanpa baris ini pekerjaan yang
     dilaporkan mandor seolah lenyap dan orang mengira datanya hilang. */
  if ((d.draftItemCount ?? 0) > 0) {
    const nota: GridOptions = { x, width, cols: [width], fontSize: 6 };
    draw(
      [
        {
          text:
            `${d.draftItemCount} pekerjaan hari ini dilaporkan atas usulan adendum yang belum disetujui ` +
            `sehingga tidak dicetak di blanko ini – belum ada dasar kontraknya. ` +
            `Rinciannya ada di pantauan internal MARLIN.`,
        },
      ],
      nota,
    );
  }

  /* ── Catatan (data sistem, di luar blanko) & tanda tangan ──────────── */
  const catatan: GridOptions = { x, width, cols: [width], fontSize: 7 };
  fit(14 + 34 + 70);
  draw([{ text: "CATATAN / KETERANGAN", head: true }], catatan);
  draw([{ text: d.notes || " " }], { ...catatan, minRowHeight: 34 });

  const ttd: GridOptions = { x, width, cols: colWidths(width, [1, 1]), fontSize: 7, minRowHeight: 94 };
  const blokTtd = (judul: string, peran: string, firm: string | null | undefined, nama: string | null | undefined, sub: string) =>
    `${judul}\n${peran}${firm ? `\n${firm}` : ""}\n\n\n\n\n( ${nama ?? "……………………"} )\n${sub}`;
  /* Gambar tanda tangan & stempel digambar LEBIH DULU, teksnya menyusul di
     atasnya (DECISIONS 412) — PDF tidak punya z-index, jadi urutan menggambar
     itulah lapisannya. Kolomnya dua sama lebar: pengawas kiri, penyedia kanan —
     urutan yang sama dengan teksnya. Baris nama "( … )" ada di baris ke-6 blok;
     coretan berpijak tepat di atasnya. */
  const yTtd = y;
  const gbr = lampiran?.ttd;
  const [kolomKiri, kolomKanan] = colWidths(width, [1, 1]);
  // Ruang dari tepi ATAS blok sampai garis nama; stempel dibatasi tepat
  // sebesar ini supaya tidak melimpah keluar blok (DECISIONS 333).
  const RUANG_TTD_PDF = 70;
  const yDasarTtd = yTtd + RUANG_TTD_PDF;
  y = blokTandaTanganPdf(
    doc,
    gbr
      ? [
          {
            berkas: gbr.pengawas,
            opsi: {
              xTengah: x + kolomKiri / 2,
              yDasar: yDasarTtd,
              lebarKolom: kolomKiri,
              ruangDiAtasNama: RUANG_TTD_PDF,
            },
          },
          {
            berkas: gbr.penyedia,
            opsi: {
              xTengah: x + kolomKiri + kolomKanan / 2,
              yDasar: yDasarTtd,
              lebarKolom: kolomKanan,
              ruangDiAtasNama: RUANG_TTD_PDF,
            },
          },
        ]
      : [],
    () =>
      gridRow(
        doc,
        yTtd,
        [
          {
            text: blokTtd("Disetujui Oleh;", "Konsultan Pengawas", d.supervisorFirm ?? d.supervisorSub, d.supervisorName, "Inspector"),
            align: "center",
          },
          {
            text: blokTtd("Dibuat Oleh :", "Kontraktor Pelaksana", d.contractorFirm, d.contractorName, d.contractorSub || "Pelaksana"),
            align: "center",
          },
        ],
        ttd,
      ),
  );

  /* ── Halaman 3+: DOKUMENTASI PEKERJAAN ────────────────────────────── */
  const halamanBaru = () => {
    doc.addPage();
    noAutoBreak();
  };
  gambarDokumentasi(doc, d, lampiran?.foto ?? [], halamanBaru);

  /* ── Lalu MATERIAL, lalu ALAT — masing-masing mulai halaman baru ─────
     Urutannya ditentukan user 2026-08-08: sesudah foto pekerjaan, material
     dan alat disendirikan, masing-masing di halamannya sendiri. */
  gambarDokumentasiPelengkap(
    doc, d, lampiran?.fotoMaterial ?? [], "Dokumentasi Material Masuk", "Material", halamanBaru,
  );
  gambarDokumentasiPelengkap(
    doc, d, lampiran?.fotoAlat ?? [], "Dokumentasi Peralatan", "Alat", halamanBaru,
  );

}


/**
 * Catatan kaki tiap halaman: nama aplikasi + status, dan "Halaman i dari n"
 * yang MENERUS untuk seluruh berkas.
 *
 * Menerus itu yang benar untuk berkas mingguan: satu berkas = satu penomoran.
 * Kalau tiap hari dinomori ulang, tujuh "Halaman 1 dari 5" dalam satu PDF
 * membuat orang mengira berkasnya terpotong.
 */
export function kakiHalaman(doc: PdfDoc, appName: string, status: string): void {
  const width = doc.page.width - FORM_MARGIN * 2;
  /* ── Catatan kaki tiap halaman ─────────────────────────────────────── */
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    /*
     * Matikan paginasi otomatis pada halaman yang sedang ditulisi.
     *
     * Badan laporan sudah melakukannya untuk tiap halaman yang IA buat, tetapi
     * halaman yang dibuka pdfkit SENDIRI (mis. teks yang membungkus tepat di
     * tepi bawah) tetap memakai margin bawah bakunya. Kaki halaman ditulis di
     * BAWAH margin itu, jadi pdfkit menganggapnya tidak muat, membuka halaman
     * baru, dan menaruh kaki halamannya di sana — satu lembar kosong per
     * pemanggilan `text()`. Dua lembar kosong di ekor berkas 26 Agustus 2026
     * lahir persis begitu, lengkap dengan kaki halaman yang terbelah.
     */
    doc.page.margins.bottom = 0;
    doc
      .font(PDF_FONT.regular)
      .fontSize(6.5)
      .fillColor(PDF_COLORS.inkFaint)
      .text(
        `${appName} · ${status}`,
        FORM_MARGIN,
        doc.page.height - FORM_MARGIN + 2,
        { width: width, align: "left", lineBreak: false },
      )
      .text(`Halaman ${i - range.start + 1} dari ${range.count}`, FORM_MARGIN, doc.page.height - FORM_MARGIN + 2, {
        width,
        align: "right",
        lineBreak: false,
      });
  }
}

/** Satu laporan harian utuh: sampul + badan. */
export async function buildHarianKkpPdf(
  d: KkpDailyData,
  appName: string,
  logo?: Buffer | null,
  lampiran?: LampiranHarian & { tanpaSampul?: boolean },
): Promise<Buffer> {
  const doc = createFormA4Doc({ title: `Laporan Harian KKP – ${d.locationName}` });

  /* ── Halaman 1: SAMPUL ─────────────────────────────────────────────────
     Blanko di halaman berikutnya TIDAK berubah sedikit pun (permintaan user
     2026-08-07: *"halaman 2: seperti blanko apa adanya saat ini"*).

     Sampulnya bertuliskan "MINGGU KE-n" — memang sampul MINGGUAN. Sejak
     DECISIONS 332 ia bisa dimatikan (`tanpaSampul`) untuk yang menyusun
     berkas mingguan sendiri atau cuma butuh blankonya. */
  if (!lampiran?.tanpaSampul) {
    doc.page.margins.bottom = 0;
    gambarSampul(doc, d, logo ?? null, lampiran?.logoVendor ?? null, lampiran?.logoPengawas ?? null);
    doc.addPage();
  }

  tulisBadanHarian(doc, d, {
    ...lampiran,
    logoPemilik: logo ?? null,
    logoVendor: lampiran?.logoVendor ?? null,
    logoPengawas: lampiran?.logoPengawas ?? null,
    foto: lampiran?.foto ?? [],
  });
  kakiHalaman(doc, appName, d.isFinal ? "Laporan final" : "PRATINJAU – belum difinalisasi");
  return docToBuffer(doc);
}

/**
 * Batas foto yang ditempel ke SATU berkas mingguan (DECISIONS 332).
 *
 * Diukur, bukan ditebak: `createFormA4Doc` memakai `bufferPages: true` sehingga
 * seluruh dokumen ditahan di RAM sampai selesai. Pada kontainer 0,5 vCPU /
 * 512 MB, puncak RSS terukur (foto kamera 4000x3000 lewat pipeline 900px q72):
 *
 *     1 hari,  15 foto → 212 MB      7 hari, 105 foto → 304 MB
 *     7 hari,  70 foto → 255 MB      7 hari, 175 foto → 358 MB
 *
 * 120 dipilih di bawah titik 358 MB, menyisakan ruang untuk server Next yang
 * sudah residen. Yang terpotong WAJIB disebutkan pemanggil — memotong
 * dokumentasi diam-diam membuat berkasnya terbaca lengkap padahal tidak.
 */
export const BATAS_FOTO_MINGGUAN = 120;

/**
 * Logo pemilik pekerjaan untuk kop, sebagai PNG.
 *
 * WAJIB dikonversi: logo disimpan sebagai WebP (system/actions.ts), sedangkan
 * pdfkit HANYA mendukung JPEG dan PNG. Tanpa konversi `doc.image()` melempar
 * dan logonya hilang DIAM-DIAM di semua keluaran PDF (unduh, Drive, WhatsApp)
 * padahal di layar tampil normal — persis ketidakkonsistenan yang dilaporkan
 * 28 Juli 2026.
 */
export async function muatLogoPemilik(key: string | null | undefined): Promise<Buffer | null> {
  if (!key) return null;
  try {
    const { r2GetBuffer } = await import("@/lib/r2");
    const sharp = (await import("sharp")).default;
    return await sharp(await r2GetBuffer(key)).png().toBuffer();
  } catch (err) {
    console.error("[laporan-kkp] logo pemilik gagal disiapkan untuk PDF:", err);
    return null;
  }
}

/**
 * Muat logo pelaksana + foto bukti satu hari, siap ditempel ke PDF.
 *
 * BEST-EFFORT seluruhnya: kegagalan R2/sharp tidak boleh menggagalkan laporan
 * resminya; halaman dokumentasi cuma ikut kosong, dan itu terlihat — bukan
 * diam-diam salah.
 *
 * `sisaFoto` membatasi berapa foto yang masih boleh diambil (dipakai berkas
 * mingguan). `null` = tanpa batas, yaitu perilaku cetak harian.
 */
export async function muatLampiranFoto(
  data: KkpDailyData,
  baseUrl: string | null,
  sisaFoto: number | null = null,
): Promise<{
  logoVendor: Buffer | null;
  /** Logo firma konsultan pengawas — kop blanko & sampul (2026-08-24). */
  logoPengawas?: Buffer | null;
  foto: FotoDok[];
  fotoMaterial: FotoPelengkapDok[];
  fotoAlat: FotoPelengkapDok[];
  /** Berapa foto TIDAK diambil karena batas. Pemanggil wajib menyebutkannya. */
  dipotong: number;
}> {
  let sisa = sisaFoto;
  const bolehLagi = () => sisa === null || sisa > 0;
  const pakai = () => {
    if (sisa !== null) sisa -= 1;
  };
  let dipotong = 0;
  let logoVendor: Buffer | null = null;
  let logoPengawas: Buffer | null = null;
  const foto: FotoDok[] = [];
  const fotoMaterial: FotoPelengkapDok[] = [];
  const fotoAlat: FotoPelengkapDok[] = [];
  try {
    const { isR2Configured, r2GetBuffer } = await import("@/lib/r2");
    if (isR2Configured()) {
      const sharp = (await import("sharp")).default;
      if (data.vendorLogoKey) {
        try {
          logoVendor = await sharp(await r2GetBuffer(data.vendorLogoKey)).png().toBuffer();
        } catch {
          logoVendor = null;
        }
      }
      if (data.supervisorLogoKey) {
        try {
          logoPengawas = await sharp(await r2GetBuffer(data.supervisorLogoKey)).png().toBuffer();
        } catch {
          logoPengawas = null;
        }
      }
      for (const p of data.photos ?? []) {
        if (!bolehLagi()) {
          dipotong += 1;
          continue;
        }
        try {
          const kecil = await sharp(await r2GetBuffer(p.r2Key))
            .rotate()
            .resize(900, 900, { fit: "inside", withoutEnlargement: true })
            .jpeg({ quality: 72 })
            .toBuffer();
          foto.push({
            buf: kecil,
            pekerjaan: p.pekerjaan,
            kategori: p.kategori,
            bobot: p.bobot,
            link: baseUrl ? `${baseUrl}/api/foto/${signPhotoToken(p.id)}` : null,
          });
          pakai();
        } catch {
          /* satu foto gagal tidak menggagalkan sisanya */
        }
      }
      // Bukti material & alat (DECISIONS 304) — perlakuan identik: dikecilkan
      // dulu, satu yang gagal tidak menjatuhkan sisanya.
      for (const [rows, keranjang] of [
        [data.materialPhotos ?? [], fotoMaterial],
        [data.equipmentPhotos ?? [], fotoAlat],
      ] as const) {
        for (const p of rows) {
          if (!bolehLagi()) {
            dipotong += 1;
            continue;
          }
          try {
            const kecil = await sharp(await r2GetBuffer(p.r2Key))
              .rotate()
              .resize(900, 900, { fit: "inside", withoutEnlargement: true })
              .jpeg({ quality: 72 })
              .toBuffer();
            keranjang.push({
              buf: kecil,
              nama: p.nama,
              keterangan: p.keterangan,
              link: baseUrl ? `${baseUrl}/api/foto/${signPhotoToken(p.id)}` : null,
            });
            pakai();
          } catch {
            /* satu foto gagal tidak menggagalkan sisanya */
          }
        }
      }
    }
  } catch (err) {
    console.error("[laporan-kkp] lampiran dokumentasi gagal disiapkan:", err);
  }
  return { logoVendor, logoPengawas, foto, fotoMaterial, fotoAlat, dipotong };
}

export async function renderHarianKkpPdf(
  slug: string,
  dateKey: string,
  opts?: { baseUrl?: string | null; tanpaSampul?: boolean },
): Promise<HarianKkpPdfResult | null> {
  const baseUrl = opts?.baseUrl?.replace(/\/+$/, "") || null;
  const [data, branding, loc] = await Promise.all([
    getKkpDailyData(slug, dateKey),
    getBranding(),
    db.location.findUnique({ where: { slug }, select: { id: true } }),
  ]);
  if (!data || !loc) return null;
  const logo = await muatLogoPemilik(branding.ownerLogoKey);
  const { logoVendor, logoPengawas, foto, fotoMaterial, fotoAlat } = await muatLampiranFoto(data, baseUrl);
  const gambarTtd = await muatTtdPdf(loc.id, "harian").catch(() => TANPA_TTD_PDF);
  return {
    buffer: await buildHarianKkpPdf(data, branding.appName, logo, {
      logoVendor,
      logoPengawas,
      foto,
      fotoMaterial,
      fotoAlat,
      ttd: gambarTtd,
      tanpaSampul: opts?.tanpaSampul,
    }),
    locationId: loc.id,
  };
}
