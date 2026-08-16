import "server-only";
import { db } from "@/lib/db";
import {
  peringkatPadanan,
  siapkanKandidat,
  tandaItem,
  usulkanPadanan,
  type KandidatAhsp,
} from "./cocok";
import { bacaAturanIstilah, bacaPenulangan, ATURAN_KOSONG, type AturanIstilah } from "./istilah";
import { tokenisasiLengkap } from "./cocok";

/**
 * Pemetaan item RAB → analisa AHSP yang TERSIMPAN (DECISIONS 319).
 *
 * Mesin memetakan otomatis, manusia memperbaiki yang salah, dan hasilnya
 * dipakai seterusnya. Dua aturan yang menentukan bentuk berkas ini:
 *
 *  1. **Koreksi manusia tidak pernah ditimpa mesin.** Pemetaan ulang boleh
 *     dijalankan kapan saja (matcher-nya akan terus diperbaiki), tapi baris
 *     `metode = "koreksi"` dilewati. Kalau tidak, satu klik "petakan ulang"
 *     akan menghapus pekerjaan orang tanpa jejak.
 *  2. **Mesin tidak pernah menulis "tidak ada padanan".** Kalau ia ragu, ia
 *     diam — barisnya tetap kosong dan terlihat sebagai lubang. Hanya manusia
 *     yang boleh menyatakan sebuah pekerjaan memang tak punya analisa AHSP.
 *
 * Angka cakupan di sini SELALU dihitung ulang dari baris RAB + padanan, tidak
 * pernah disimpan sebagai kolom agregat.
 */

export type ItemRabRingkas = {
  id: string;
  lineageKey: string;
  code: string;
  name: string;
  unit: string | null;
  volume: number | null;
  amount: bigint;
  tanda: string;
};

/**
 * Baris RAB yang sebenarnya JUDUL, bukan pekerjaan.
 *
 * RAB lapangan lazim memuat baris seperti "Fasilitas Sarana Kesehatan, terdiri
 * atas :" — tersimpan sebagai daun karena begitulah berkas asalnya, tapi tanpa
 * satuan, tanpa volume, dan bernilai nol. Diukur pada RAB Kedung Mutih: 37 dari
 * 1.657 baris. Kalau ikut dipetakan, ia bisa menang meyakinkan ke analisa yang
 * namanya kebetulan mirip ("Fasilitas") dan mengotori angka cakupan dengan
 * pekerjaan yang tidak ada.
 */
export function adalahJudul(n: { unit: string | null; volume: number | null; amount: bigint }) {
  return !n.unit && n.volume === null && n.amount === 0n;
}

/** Item (daun) RAB revisi aktif satu lokasi — TANPA baris judul. */
export async function itemRabAktif(locationId: string): Promise<ItemRabRingkas[]> {
  const revisi = await db.rabRevision.findFirst({
    where: { locationId, status: "aktif" },
    select: { id: true },
  });
  if (!revisi) return [];

  const nodes = await db.rabNode.findMany({
    where: { revisionId: revisi.id, kind: "item" },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      lineageKey: true,
      code: true,
      name: true,
      unit: true,
      volume: true,
      amount: true,
    },
  });

  return nodes
    .map((n) => ({
      id: n.id,
      lineageKey: n.lineageKey,
      code: n.code,
      name: n.name,
      unit: n.unit,
      volume: n.volume === null ? null : Number(n.volume),
      amount: n.amount,
      tanda: tandaItem(n.name, n.unit),
    }))
    .filter((n) => !adalahJudul(n));
}

/**
 * Muat seluruh analisa AHSP sebagai kandidat siap-cocok.
 *
 * Sekali muat dipakai untuk ribuan item; token-nya di-precompute di
 * `siapkanKandidat`. 5.550 analisa — cukup untuk ditahan di memori satu proses.
 */
export async function muatKandidat(): Promise<{
  kandidat: KandidatAhsp[];
  aturan: AturanIstilah;
}> {
  const [rows, sumber] = await Promise.all([
    db.ahspEntry.findMany({
      select: {
        id: true,
        kode: true,
        uraian: true,
        satuan: true,
        bidang: true,
        perluVerifikasi: true,
        aliases: true,
        _count: { select: { components: true } },
      },
    }),
    // Aturan istilah ikut berkasnya (DECISIONS 321) — kalau terbitannya tidak
    // membawa `matching_engine`, pencocokan jalan tanpa ekspansi istilah, bukan
    // dengan daftar padanan karangan MARLIN.
    db.ahspSource.findFirst({ select: { matchingEngine: true } }),
  ]);
  const aturan = sumber?.matchingEngine ? bacaAturanIstilah(sumber.matchingEngine) : ATURAN_KOSONG;
  return {
    aturan,
    kandidat: siapkanKandidat(
      rows.map((r) => ({
        id: r.id,
        kode: r.kode,
        uraian: r.uraian,
        satuan: r.satuan,
        bidang: r.bidang,
        perluVerifikasi: r.perluVerifikasi,
        jumlahKomponen: r._count.components,
        aliases: r.aliases,
      })),
      aturan,
    ),
  };
}

export type HasilPemetaan = {
  /** Baris RAB (daun) pada revisi aktif. */
  itemRab: number;
  /** Tanda unik — inilah yang benar-benar dipetakan (uraian sama = satu kerja). */
  tandaUnik: number;
  /** Sudah ada padanannya sebelum dijalankan (otomatis maupun koreksi). */
  sudahAda: number;
  /** Dilewati karena sudah diputuskan manusia (disetujui atau dikoreksi). */
  dijagaKoreksi: number;
  /** Padanan baru yang ditulis mesin kali ini. */
  baru: number;
  /** Dari `baru`, yang unggul jauh dari kandidat kedua. */
  baruMeyakinkan: number;
  /** Tanda yang tetap tanpa padanan setelah dijalankan. */
  belumKetemu: number;
  /** Padanan yang tautannya putus dan dipetakan ulang kali ini. */
  dipulihkan: number;
};

/**
 * Petakan otomatis item RAB satu lokasi ke analisa AHSP.
 *
 * Idempoten: dijalankan dua kali berturut-turut, yang kedua menulis 0 baris.
 */
export async function petakanLokasi(
  locationId: string,
  userId: string | null,
): Promise<HasilPemetaan> {
  const items = await itemRabAktif(locationId);
  const perTanda = new Map<string, ItemRabRingkas>();
  for (const it of items) if (!perTanda.has(it.tanda)) perTanda.set(it.tanda, it);

  const kosong: HasilPemetaan = {
    itemRab: items.length,
    tandaUnik: perTanda.size,
    sudahAda: 0,
    dijagaKoreksi: 0,
    baru: 0,
    baruMeyakinkan: 0,
    belumKetemu: 0,
    dipulihkan: 0,
  };
  if (perTanda.size === 0) return kosong;

  const tersimpan = await db.ahspPadanan.findMany({
    where: { tanda: { in: [...perTanda.keys()] } },
    select: { tanda: true, metode: true, entryId: true, tidakAda: true },
  });
  /*
   * Baris yang PUTUS (pernah berpadanan, analisanya hilang saat basis AHSP
   * diganti) sengaja TIDAK dianggap "sudah ada": justru itu yang harus
   * dipetakan ulang. Tanpa pengecualian ini, satu penggantian terbitan membuat
   * ribuan baris macet selamanya — tombol "Petakan otomatis" akan melewatinya
   * karena barisnya memang ada, cuma isinya kosong. DECISIONS 323.
   */
  const putus = new Set(
    tersimpan.filter((p) => p.entryId === null && !p.tidakAda).map((p) => p.tanda),
  );
  const sudah = new Map(
    tersimpan.filter((p) => !putus.has(p.tanda)).map((p) => [p.tanda, p.metode]),
  );

  // Selain yang putus, yang sudah ada TIDAK disentuh — baik hasil koreksi
  // manusia maupun hasil mesin sebelumnya. Memetakan ulang yang sudah dipetakan
  // hanya akan menukar padanan tanpa ada yang meminta.
  const perlu = [...perTanda.values()].filter((it) => !sudah.has(it.tanda));
  const dijagaKoreksi = tersimpan.filter(
    (p) => p.metode !== "otomatis" && !putus.has(p.tanda),
  ).length;
  if (perlu.length === 0) {
    return { ...kosong, sudahAda: sudah.size, dijagaKoreksi, belumKetemu: 0 };
  }

  const { kandidat, aturan } = await muatKandidat();
  const barisBaru: {
    tanda: string;
    uraianContoh: string;
    satuan: string;
    entryId: string;
    metode: string;
    skor: number;
    meyakinkan: boolean;
    catatan: string;
    decidedById: string | null;
  }[] = [];
  let belumKetemu = 0;

  for (const it of perlu) {
    const u = usulkanPadanan({ uraian: it.name, satuan: it.unit }, kandidat, aturan);
    if (!u) {
      belumKetemu += 1;
      continue;
    }
    barisBaru.push({
      tanda: it.tanda,
      uraianContoh: it.name,
      satuan: it.unit ?? "",
      entryId: u.kandidat.id,
      metode: "otomatis",
      // Decimal(5,4) → 0..1 dengan 4 desimal; dibulatkan di sini supaya angka
      // yang tersimpan sama persis dengan yang ditampilkan.
      skor: Math.round(u.skor * 10_000) / 10_000,
      meyakinkan: u.meyakinkan,
      catatan: u.alasan,
      decidedById: userId,
    });
  }

  if (barisBaru.length > 0) {
    // Baris PUTUS sudah ada di tabel, jadi harus ditimpa; sisanya disisipkan.
    // skipDuplicates: dua lokasi bisa dipetakan bersamaan dan berbagi tanda.
    const timpa = barisBaru.filter((b) => putus.has(b.tanda));
    const sisip = barisBaru.filter((b) => !putus.has(b.tanda));
    if (sisip.length > 0) await db.ahspPadanan.createMany({ data: sisip, skipDuplicates: true });
    for (const b of timpa) {
      await db.ahspPadanan.update({
        where: { tanda: b.tanda },
        data: { ...b, tidakAda: false },
      });
    }
  }

  return {
    itemRab: items.length,
    tandaUnik: perTanda.size,
    sudahAda: sudah.size,
    dijagaKoreksi,
    baru: barisBaru.length,
    baruMeyakinkan: barisBaru.filter((b) => b.meyakinkan).length,
    belumKetemu,
    dipulihkan: barisBaru.filter((b) => putus.has(b.tanda)).length,
  };
}

/**
 * Padanan yang boleh dipakai menghitung RAPL.
 *
 * Usulan mesin TIDAK termasuk — sekalipun skornya tinggi. Batas ini yang
 * membedakan "mesin menebak" dari "orang bertanggung jawab": angka kebutuhan
 * bahan hanya lahir dari padanan yang sudah ada yang menyetujuinya.
 */
export function sudahDisetujui(keadaan: BarisPadanan["keadaan"]): boolean {
  return keadaan === "disetujui" || keadaan === "koreksi";
}

/** Bentuk yang sama, dibaca dari kolom `metode` — dipakai jalur RAPL. */
export function metodeDisetujui(metode: string): boolean {
  return metode === "disetujui" || metode === "koreksi";
}

export type BarisPadanan = {
  lineageKey: string;
  code: string;
  uraian: string;
  unit: string | null;
  volume: number | null;
  amount: bigint;
  tanda: string;
  ahsp: {
    id: string;
    kode: string;
    uraian: string;
    satuan: string;
    jumlahKomponen: number;
    perluVerifikasi: boolean;
  } | null;
  /**
   * belum        — belum pernah diperiksa
   * usulan       — mesin sudah memilih, MANUSIA BELUM menyetujui
   * disetujui    — manusia menerima pilihan mesin apa adanya
   * koreksi      — manusia mengganti pilihan mesin
   * tidak_ada    — manusia menyatakan memang tak ada analisanya
   * putus        — pernah berpadanan, tapi analisanya HILANG saat basis AHSP
   *                diganti. Bukan keputusan siapa pun; barisnya perlu
   *                dipetakan ulang. DECISIONS 323.
   */
  keadaan: "belum" | "usulan" | "disetujui" | "koreksi" | "tidak_ada" | "putus";
  skor: number | null;
  meyakinkan: boolean;
  catatan: string | null;
  /**
   * Untuk baris yang BELUM berpadanan: kenapa mesin tidak memutuskan sendiri,
   * dan apa yang perlu dilihat orang. "Tidak ada padanan" tanpa sebab hanya
   * memindahkan kebuntuan; dengan sebabnya ia jadi pekerjaan yang bisa
   * diselesaikan. DECISIONS 321.
   */
  petunjuk: string | null;
};

export type CakupanPadanan = {
  item: number;
  terpetakan: number;
  /** Sudah dipakai RAPL: disetujui manusia atau hasil koreksi manusia. */
  disetujui: number;
  /** Usulan mesin yang masih menunggu persetujuan — TIDAK dipakai RAPL. */
  menunggu: number;
  /** Dari `menunggu`, yang beda tipis dengan kandidat lain. */
  perluDiperiksa: number;
  dinyatakanTidakAda: number;
  /** Padanan yang tautannya putus saat basis AHSP diganti — perlu dipetakan ulang. */
  putus: number;
  belum: number;
  nilaiTotal: bigint;
  nilaiTerpetakan: bigint;
  nilaiDisetujui: bigint;
  nilaiBelum: bigint;
};

/**
 * Keadaan pemetaan satu lokasi: baris per item RAB + cakupannya.
 *
 * Cakupan dilaporkan dalam DUA satuan — jumlah baris DAN nilai rupiah — karena
 * "80% item terpetakan" bisa berarti 30% nilai kalau yang belum justru
 * pekerjaan besar. Yang menentukan seberapa berguna estimasi RAPL-nya adalah
 * nilai, bukan cacah baris.
 */
export async function keadaanPadanan(
  locationId: string,
): Promise<{ baris: BarisPadanan[]; cakupan: CakupanPadanan }> {
  const items = await itemRabAktif(locationId);
  const tanda = [...new Set(items.map((i) => i.tanda))];

  const sumber = await db.ahspSource.findFirst({ select: { matchingEngine: true } });
  const aturan = sumber?.matchingEngine ? bacaAturanIstilah(sumber.matchingEngine) : ATURAN_KOSONG;

  const padanan = tanda.length
    ? await db.ahspPadanan.findMany({
        where: { tanda: { in: tanda } },
        select: {
          tanda: true,
          metode: true,
          tidakAda: true,
          skor: true,
          meyakinkan: true,
          catatan: true,
          entry: {
            select: {
              id: true,
              kode: true,
              uraian: true,
              satuan: true,
              perluVerifikasi: true,
              _count: { select: { components: true } },
            },
          },
        },
      })
    : [];
  const peta = new Map(padanan.map((p) => [p.tanda, p]));

  const baris: BarisPadanan[] = items.map((it) => {
    const p = peta.get(it.tanda);
    const ahsp = p?.entry
      ? {
          id: p.entry.id,
          kode: p.entry.kode,
          uraian: p.entry.uraian,
          satuan: p.entry.satuan,
          jumlahKomponen: p.entry._count.components,
          perluVerifikasi: p.entry.perluVerifikasi,
        }
      : null;
    let keadaan: BarisPadanan["keadaan"] = "belum";
    if (p) {
      // "Tidak ada padanan" HANYA kalau manusia menyatakannya (`tidakAda`).
      // Baris tanpa tautan yang tidak dinyatakan siapa pun = tautannya putus.
      if (!ahsp) keadaan = p.tidakAda ? "tidak_ada" : "putus";
      else if (p.metode === "koreksi") keadaan = "koreksi";
      else if (p.metode === "disetujui") keadaan = "disetujui";
      else keadaan = "usulan";
    }
    return {
      lineageKey: it.lineageKey,
      code: it.code,
      uraian: it.name,
      unit: it.unit,
      volume: it.volume,
      amount: it.amount,
      tanda: it.tanda,
      ahsp,
      keadaan,
      skor: p?.skor == null ? null : Number(p.skor),
      meyakinkan: p?.meyakinkan ?? false,
      catatan: p?.catatan ?? null,
      petunjuk: ahsp
        ? null
        : p && !p.tidakAda
          ? "Padanan sebelumnya hilang saat basis AHSP diganti — tekan “Petakan otomatis” untuk menyambungnya kembali, atau pilih sendiri."
          : petunjukBaris(it.name, aturan),
    };
  });

  const cakupan: CakupanPadanan = {
    item: baris.length,
    terpetakan: 0,
    disetujui: 0,
    menunggu: 0,
    perluDiperiksa: 0,
    dinyatakanTidakAda: 0,
    putus: 0,
    belum: 0,
    nilaiTotal: 0n,
    nilaiTerpetakan: 0n,
    nilaiDisetujui: 0n,
    nilaiBelum: 0n,
  };
  for (const b of baris) {
    cakupan.nilaiTotal += b.amount;
    if (b.ahsp) {
      cakupan.terpetakan += 1;
      cakupan.nilaiTerpetakan += b.amount;
      if (sudahDisetujui(b.keadaan)) {
        cakupan.disetujui += 1;
        cakupan.nilaiDisetujui += b.amount;
      } else {
        cakupan.menunggu += 1;
        if (!b.meyakinkan) cakupan.perluDiperiksa += 1;
      }
    } else if (b.keadaan === "tidak_ada") {
      cakupan.dinyatakanTidakAda += 1;
      cakupan.nilaiBelum += b.amount;
    } else if (b.keadaan === "putus") {
      cakupan.putus += 1;
      cakupan.nilaiBelum += b.amount;
    } else {
      cakupan.belum += 1;
      cakupan.nilaiBelum += b.amount;
    }
  }
  return { baris, cakupan };
}

/**
 * Kenapa satu baris belum berpadanan — sejauh yang benar-benar bisa dikatakan.
 *
 * Sekarang baru menjawab untuk pekerjaan penulangan, karena di situlah sebabnya
 * pasti dan berulang: analisa AHSP membedakan elemen struktur, jenis baja, dan
 * kelas diameter, sementara uraian RAB lazim hanya menyebut sebagian. Itu fakta
 * tentang RAB-nya, bukan kegagalan pencocok — dan yang dibutuhkan orang adalah
 * tahu HARUS MELIHAT APA, bukan sekadar diberi tahu "tidak ketemu".
 */
function petunjukBaris(uraian: string, aturan: AturanIstilah): string | null {
  const t = tokenisasiLengkap(uraian, aturan);
  const rein = bacaPenulangan(uraian, aturan, {
    teks: "",
    istilah: t.istilah,
    elemen: t.elemen,
    kelasDiameter: t.kelasDiameter,
  });
  if (!rein || rein.kodeKandidat.length === 0) return null;
  const daftar = rein.kodeKandidat.join(", ");
  if (!rein.perluKonteks) return `Analisa penulangan yang cocok: ${daftar}.`;
  return `Pekerjaan penulangan — ${rein.alasan.join("; ")}. Kandidat resmi: ${daftar}. Pilih setelah memastikan konteksnya.`;
}

/** Kandidat alternatif untuk satu baris — bahan pilihan saat mengoreksi. */
export async function alternatifPadanan(uraian: string, satuan: string | null) {
  const { kandidat, aturan } = await muatKandidat();
  return peringkatPadanan({ uraian, satuan }, kandidat, 8, aturan).map((x) => ({
    id: x.kandidat.id,
    kode: x.kandidat.kode,
    uraian: x.kandidat.uraian,
    satuan: x.kandidat.satuan,
    bidang: x.kandidat.bidang,
    perluVerifikasi: x.kandidat.perluVerifikasi,
    punyaKomponen: x.kandidat.punyaKomponen,
    skor: x.skor,
  }));
}

/** Cari analisa AHSP dengan kata kunci bebas — untuk saat daftar usulan meleset. */
export async function cariAhsp(kueri: string, batas = 20) {
  const q = kueri.trim();
  if (q.length < 3) return [];
  const rows = await db.ahspEntry.findMany({
    where: {
      OR: [{ uraian: { contains: q, mode: "insensitive" } }, { kode: { contains: q, mode: "insensitive" } }],
    },
    orderBy: [{ perluVerifikasi: "asc" }, { kode: "asc" }],
    take: batas,
    select: {
      id: true,
      kode: true,
      uraian: true,
      satuan: true,
      bidang: true,
      perluVerifikasi: true,
      _count: { select: { components: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    kode: r.kode,
    uraian: r.uraian,
    satuan: r.satuan,
    bidang: r.bidang,
    perluVerifikasi: r.perluVerifikasi,
    punyaKomponen: r._count.components > 0,
    skor: null as number | null,
  }));
}

/**
 * Simpan koreksi manusia untuk satu tanda.
 *
 * `entryId = null` berarti dinyatakan TIDAK ADA analisa yang cocok — itu
 * keputusan yang sah dan berbeda dari "belum diperiksa", jadi tetap ditulis
 * sebagai baris. Berlaku untuk SEMUA lokasi yang uraiannya persis sama.
 */
export async function koreksiPadanan(args: {
  tanda: string;
  uraianContoh: string;
  satuan: string;
  entryId: string | null;
  userId: string;
  catatan?: string | null;
}): Promise<{ barisKena: number; lokasiKena: number }> {
  const isi = {
    uraianContoh: args.uraianContoh,
    satuan: args.satuan,
    entryId: args.entryId,
    // Disimpan POSITIF: "tidak ada padanan" adalah pernyataan manusia, bukan
    // sesuatu yang boleh disimpulkan dari kolom kosong. DECISIONS 323.
    tidakAda: args.entryId === null,
    metode: "koreksi",
    skor: null,
    meyakinkan: true,
    catatan: args.catatan ?? null,
    decidedById: args.userId,
  };
  await db.ahspPadanan.upsert({
    where: { tanda: args.tanda },
    create: { tanda: args.tanda, ...isi },
    update: isi,
  });

  // Berapa banyak yang ikut terbetulkan — dilaporkan supaya jelas keputusannya
  // tidak berhenti di layar yang sedang dibuka. Disaring dua tahap: SQL menarik
  // baris beruraian sama (murah), lalu `tandaItem` menyaring yang satuannya
  // memang cocok. Varian tanda baca tidak terhitung di sini; angkanya jadi
  // BATAS BAWAH — lebih baik kurang daripada menjanjikan yang tidak terjadi.
  const kena = await db.rabNode.findMany({
    where: {
      kind: "item",
      name: { equals: args.uraianContoh, mode: "insensitive" },
      revision: { status: "aktif" },
    },
    select: { name: true, unit: true, revision: { select: { locationId: true } } },
  });
  const cocok = kena.filter((n) => tandaItem(n.name, n.unit) === args.tanda);
  return {
    barisKena: cocok.length,
    lokasiKena: new Set(cocok.map((n) => n.revision.locationId)).size,
  };
}

/**
 * Setujui usulan mesin secara BORONGAN.
 *
 * Kenapa persetujuan borongan diperbolehkan padahal padanan menentukan angka
 * uang: yang diperiksa orang bukan satu-satu baris RAB melainkan satu-satu
 * URAIAN. Di Kedung Mutih, 1.620 baris kerja cuma 480 uraian unik, dan seorang
 * pelaksana yang memandangi daftar "Rambu Petunjuk → Rambu Petunjuk Jurusan"
 * bisa membenarkan puluhan sekaligus tanpa kehilangan makna. Yang dilarang
 * bukan borongannya, melainkan memakai usulan yang BELUM ada yang menyetujui.
 *
 * Hanya baris `otomatis` yang berpadanan yang tersentuh:
 *  - `koreksi` tidak ditimpa — orang sudah memilih sesuatu yang lain;
 *  - baris tanpa `entryId` ("memang tidak ada") tidak ikut disetujui, karena
 *    menyetujui ketiadaan bukan hal yang sama dengan menyetujui padanan.
 *
 * `skor` dan `meyakinkan` DIPERTAHANKAN apa adanya: jejak "yang disetujui itu
 * tebakan 45% yang beda tipis" harus tetap terbaca setelah disetujui.
 */
export async function setujuiPadanan(args: {
  tanda: string[];
  userId: string;
}): Promise<{ disetujui: number }> {
  if (args.tanda.length === 0) return { disetujui: 0 };
  const r = await db.ahspPadanan.updateMany({
    where: { tanda: { in: args.tanda }, metode: "otomatis", entryId: { not: null } },
    data: { metode: "disetujui", decidedById: args.userId },
  });
  return { disetujui: r.count };
}

/** Tanda usulan mesin yang masih menunggu persetujuan di satu lokasi. */
export async function tandaMenunggu(locationId: string): Promise<string[]> {
  const items = await itemRabAktif(locationId);
  const tanda = [...new Set(items.map((i) => i.tanda))];
  if (tanda.length === 0) return [];
  const rows = await db.ahspPadanan.findMany({
    where: { tanda: { in: tanda }, metode: "otomatis", entryId: { not: null } },
    select: { tanda: true },
  });
  return rows.map((r) => r.tanda);
}
