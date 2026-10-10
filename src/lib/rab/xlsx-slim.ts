import JSZip from "jszip";

/**
 * Perampingan workbook xlsx sebelum di-parse exceljs.
 *
 * MASALAH: sebagian file HPS/Negosiasi KKP raksasa — 40+ sheet volume + ribuan
 * DEFINED NAMES sampah (mis. 47.000 nama `_` berisi byte rusak warisan copy-paste
 * antar-file). exceljs `.load()` memuat SELURUH workbook ke model objek → heap
 * meledak (OOM) padahal importer hanya butuh sheet "RAB".
 *
 * SOLUSI: unzip (JSZip), buang `<definedNames>`, pangkas `<sheets>` menjadi HANYA
 * sheet RAB, lalu simpan closure transitif part yang benar-benar dirujuk sheet itu
 * (sharedStrings, styles, theme, drawing bila ada). Hasilnya workbook 1-sheet mungil
 * yang aman di-`.load()` — atribut sel & `row.hidden` tetap utuh (beda dgn streaming
 * reader exceljs yang membuang hidden).
 */

/** Nama sheet + apakah disembunyikan di Excel. */
export type SheetInfo = { nama: string; tersembunyi: boolean };

/**
 * Sheet isi dikenali SEBERAPA LONGGAR pembacanya mengenalinya, bukan lebih
 * sempit.
 *
 * Dulu `^rab$` — nama persis saja. Padahal `parseHpsWorkbook` memakai `/rab/i`:
 * sheet bernama "RAB MC 0", "Rekap RAB", atau "RAB Revisi" tetap dibaca. Selisih
 * dua daftar itu tepat mengenai berkas yang paling butuh ditipiskan: berkas KKP
 * 40+ sheet yang sheet isinya jarang bernama "RAB" telanjang. Yang terjadi pada
 * berkas begitu bukan salah baca melainkan MATI — exceljs memuat seluruh
 * workbook, memori habis, dan layar cuma berkata *"An unexpected response was
 * received from the server"* (laporan user 2026-09-12; kelasnya sudah tercatat
 * di DECISIONS 297).
 *
 * Pemangkasan tetap aman karena yang tersisa justru sheet yang akan dipilih
 * pembaca: nama persis "RAB" didahulukan, baru yang mengandung "rab".
 */
const RAB_RE = /rab/i;
/**
 * Sheet CCO KKP ("CCO-01", "CCO - 1") ikut dianggap sheet isi (DECISIONS 296).
 *
 * Tim lapangan mengerjakan adendum di berkas KKP, dan berkas itu bisa sama
 * gemuknya dengan HPS aslinya — 40+ sheet volume. Tanpa baris ini penipisan
 * dilewati dan seluruh workbook ikut dimuat, yang justru masalah yang modul ini
 * ada untuk mencegahnya.
 */
const CCO_RE = /^cco\s*-?\s*\d+$/i;

/** Resolve path relatif (Target di file .rels) terhadap folder part pemiliknya. */
function resolveRelTarget(ownerPath: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const base = ownerPath.includes("/") ? ownerPath.slice(0, ownerPath.lastIndexOf("/")) : "";
  const parts = (base ? `${base}/${target}` : target).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "." || p === "") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

/** Path file .rels utk sebuah part ("xl/workbook.xml" → "xl/_rels/workbook.xml.rels"). */
function relsPathFor(partPath: string): string {
  const slash = partPath.lastIndexOf("/");
  const dir = slash >= 0 ? partPath.slice(0, slash) : "";
  const file = slash >= 0 ? partPath.slice(slash + 1) : partPath;
  return `${dir ? `${dir}/` : ""}_rels/${file}.rels`;
}

/**
 * Kembalikan buffer xlsx ramping berisi HANYA sheet RAB (+ part yang dirujuknya),
 * tanpa defined names. Bila tak ada sheet mirip "RAB" atau struktur tak terduga,
 * kembalikan buffer asli (biarkan parser menangani/erroring seperti biasa).
 */
export async function slimRabWorkbook(
  buf: Buffer | ArrayBuffer,
  pilihan?: string,
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buf);
  const wbFile = zip.file("xl/workbook.xml");
  const relsFile = zip.file("xl/_rels/workbook.xml.rels");
  if (!wbFile || !relsFile) return toBuffer(buf);

  const wbXml = await wbFile.async("string");
  const relsXml = await relsFile.async("string");

  // Peta r:id → Target dari workbook.xml.rels (urutan atribut bebas).
  const relTargets = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*?\/?>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && target) relTargets.set(id, target);
  }

  // Sheet dari workbook.xml: name + r:id. Pilih RAB (nama sama persis, lalu /rab/i).
  type SheetRef = { el: string; name: string; rid: string };
  const sheets: SheetRef[] = [];
  for (const m of wbXml.matchAll(ELEMEN_SHEET)) {
    // Disimpan sebagai elemen self-closing: `<sheet …></sheet>` yang sah juga
    // ditulis sebagian aplikasi, dan elemen pembukanya saja tidak boleh
    // ditaruh sendirian di <sheets> yang baru.
    const el = m[0].replace(/\s*\/?>$/, "/>");
    const name = lepasEntitas(/\bname="([^"]*)"/.exec(el)?.[1] ?? "");
    const rid = ID_RELASI.exec(el)?.[1] ?? "";
    sheets.push({ el, name, rid });
  }
  /**
   * Sheet TERSEMBUNYI tidak pernah dipilih (permintaan user 2026-08-07:
   * *"kamu kan cuma perlu baca sheet tertentu saja, dan yang tidak dihide"*).
   * Sheet yang di-hide di berkas KKP itu sisa kerja, arsip, atau lembar bantu –
   * bukan yang sedang dipakai tim.
   */
  const terlihat = sheets.filter((s) => !/\bstate="(hidden|veryHidden)"/i.test(s.el));
  const chosen = pilihan
    ? terlihat.find((s) => s.name === pilihan)
    : (terlihat.find((s) => s.name === "RAB") ??
      terlihat.find((s) => RAB_RE.test(s.name.trim())) ??
      terlihat.find((s) => CCO_RE.test(s.name.trim())));
  if (!chosen || !chosen.rid) return toBuffer(buf);
  const chosenTarget = relTargets.get(chosen.rid);
  if (!chosenTarget) return toBuffer(buf);
  const chosenSheetPath = resolveRelTarget("xl/workbook.xml", chosenTarget);

  // 1) workbook.xml: buang defined names + pangkas <sheets> jadi hanya RAB.
  let newWbXml = wbXml.replace(/<definedNames>[\s\S]*?<\/definedNames>/g, "");
  newWbXml = newWbXml.replace(/<sheets>[\s\S]*?<\/sheets>/, `<sheets>${chosen.el}</sheets>`);

  // 2) workbook.xml.rels: buang relasi WORKSHEET selain RAB (simpan sharedStrings/styles/theme).
  const newRelsXml = relsXml.replace(/<Relationship\b[^>]*\/?>/g, (rel) => {
    const id = /\bId="([^"]+)"/.exec(rel)?.[1] ?? "";
    const target = /\bTarget="([^"]+)"/.exec(rel)?.[1] ?? "";
    const isWorksheet = /(^|\/)worksheets\//.test(target);
    if (isWorksheet && id !== chosen.rid) return "";
    return rel;
  });

  // 3) Closure part yang dipertahankan: BFS dari workbook, ikuti .rels tiap part.
  //    Rels workbook sudah dipangkas → sheet lain tak akan terikut.
  const keep = new Set<string>(["xl/workbook.xml"]);
  const overrideRels = new Map<string, string>([["xl/_rels/workbook.xml.rels", newRelsXml]]);
  const queue = ["xl/workbook.xml"];
  while (queue.length) {
    const part = queue.shift()!;
    const rp = relsPathFor(part);
    const rf = zip.file(rp);
    if (!rf) continue;
    const xml = overrideRels.get(rp) ?? (await rf.async("string"));
    keep.add(rp);
    for (const m of xml.matchAll(/<Relationship\b[^>]*\bTarget="([^"]+)"[^>]*\/?>/g)) {
      const mode = /\bTargetMode="External"/.test(m[0]);
      if (mode) continue;
      const resolved = resolveRelTarget(part, m[1]);
      if (resolved && !keep.has(resolved) && zip.file(resolved)) {
        keep.add(resolved);
        queue.push(resolved);
      }
    }
  }

  // 4) [Content_Types].xml: buang Override utk part yang tak dipertahankan.
  const ctFile = zip.file("[Content_Types].xml");
  let newCt: string | null = null;
  if (ctFile) {
    const ct = await ctFile.async("string");
    newCt = ct.replace(/<Override\b[^>]*\/>/g, (ov) => {
      const pn = /\bPartName="([^"]+)"/.exec(ov)?.[1] ?? "";
      const rel = pn.replace(/^\//, "");
      // Simpan Override hanya bila part-nya dipertahankan (workbook, sheet RAB, styles, dst).
      return keep.has(rel) || rel === "xl/workbook.xml" ? ov : "";
    });
  }

  // 5) Susun zip baru: part esensial + closure keep; tulis ulang yg dimodifikasi.
  const out = new JSZip();
  const rootRels = zip.file("_rels/.rels");
  if (rootRels) out.file("_rels/.rels", await rootRels.async("nodebuffer"));
  if (newCt != null) out.file("[Content_Types].xml", newCt);
  out.file("xl/workbook.xml", newWbXml);
  out.file("xl/_rels/workbook.xml.rels", newRelsXml);
  for (const path of keep) {
    if (path === "xl/workbook.xml" || path === "xl/_rels/workbook.xml.rels") continue;
    const f = zip.file(path);
    if (f) out.file(path, await f.async("nodebuffer"));
  }

  const result = await out.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return result;
}

/**
 * Nama sheet di workbook.xml ditulis dengan entitas XML ("Bahan &amp; Upah").
 * Tanpa dilepas, sheet bernama "Bahan & Upah" tidak pernah cocok dengan
 * pilihan pemanggil, dan penipisan diam-diam jatuh ke berkas UTUH.
 */
function lepasEntitas(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

/**
 * Elemen `<sheet>` di workbook.xml, dalam semua bentuk sah yang pernah ditemui:
 * `<sheet …/>`, `<sheet …></sheet>`, dan ber-awalan namespace (`<x:sheet …/>`,
 * keluaran OpenXML SDK). `\b` sesudah "sheet" menolak `<sheets>`.
 *
 * Dulu hanya `<sheet …/>` yang dikenali. Berkas bentuk lain terbaca "tanpa
 * sheet", lalu impor berhenti dengan pesan *"Sheet RAB tidak ditemukan"* –
 * padahal sheet-nya ada (pertanyaan user 2026-10-10, DECISIONS 664).
 */
const ELEMEN_SHEET = /<(?:[A-Za-z_][\w.-]*:)?sheet\b[^>]*>/g;
/** `r:id` – awalannya bebas, yang tetap adalah atribut `id` ber-awalan. */
const ID_RELASI = /\b[A-Za-z_][\w.-]*:id="([^"]*)"/;
const NS_UTAMA = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const DEKLARASI_AWALAN_UTAMA = /\sxmlns:([A-Za-z_][\w.-]*)="http:\/\/schemas\.openxmlformats\.org\/spreadsheetml\/2006\/main"/;

/**
 * Lepas awalan namespace utama spreadsheet (`<x:row>` → `<row>`) di semua
 * part XML. exceljs hanya mengenal nama elemen tanpa awalan; workbook
 * ber-awalan – sah menurut standar, ditulis OpenXML SDK – gagal dibuka sama
 * sekali (DECISIONS 664). Berkas biasa dikembalikan apa adanya tanpa ditulis
 * ulang.
 *
 * Hanya untuk MEMBACA. Berkas yang diarsipkan tetap berkas yang diunggah.
 */
export async function tanpaAwalanNamespace(buf: Buffer | ArrayBuffer): Promise<Buffer> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    return toBuffer(buf);
  }
  const wb = zip.file("xl/workbook.xml");
  if (!wb || !DEKLARASI_AWALAN_UTAMA.test(await wb.async("string"))) return toBuffer(buf);
  for (const path of Object.keys(zip.files)) {
    const f = zip.file(path);
    if (!f || !/^xl\/.+\.xml$/i.test(path)) continue;
    const xml = await f.async("string");
    const awalan = DEKLARASI_AWALAN_UTAMA.exec(xml)?.[1];
    if (!awalan) continue;
    const bawaan = /\sxmlns="([^"]*)"/.exec(xml)?.[1];
    // Namespace bawaan milik namespace lain → melepas awalan akan memindahkan
    // elemennya ke namespace yang salah. Biarkan part itu.
    if (bawaan && bawaan !== NS_UTAMA) continue;
    const a = awalan.replace(/[.-]/g, "\\$&");
    zip.file(
      path,
      xml
        .replace(new RegExp(`<(/?)${a}:`, "g"), "<$1")
        .replace(new RegExp(`\\sxmlns:${a}="[^"]*"`), bawaan ? "" : ` xmlns="${NS_UTAMA}"`),
    );
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function toBuffer(buf: Buffer | ArrayBuffer): Buffer {
  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
}

/**
 * Nama sheet saja – TANPA memuat isinya.
 *
 * Hanya `xl/workbook.xml` yang dibuka (beberapa KB), jadi biayanya tetap kecil
 * berapa pun besarnya berkas.
 *
 * Ada untuk menghentikan pemborosan yang nyata. Impor mode draft dulu memuat
 * SELURUH workbook cuma untuk mengintip satu sel penanda template adendum.
 * Pada berkas KKP 3 MB / 45 sheet, sekali intip itu berharga **180 MB heap dan
 * 25 detik** – sementara parse yang sesungguhnya (sesudah penipisan) hanya
 * 69 MB dan 0,5 detik. Di kontainer 512 MB, itulah yang mematikan prosesnya
 * (DECISIONS 297).
 *
 * Nama sheet sudah cukup: penanda template hanya mungkin ada bila sheet-nya
 * ada. Berkas gagal dibaca → daftar kosong, dan pemanggilnya memperlakukan itu
 * sebagai "bukan template" – jalur berikutnya yang akan melaporkan galatnya
 * dengan pesan yang sudah dikenal user.
 */
export async function namaSheetXlsx(buf: Buffer | ArrayBuffer): Promise<SheetInfo[]> {
  try {
    const zip = await JSZip.loadAsync(buf);
    const wbFile = zip.file("xl/workbook.xml");
    if (!wbFile) return [];
    const xml = await wbFile.async("string");
    const out: SheetInfo[] = [];
    for (const m of xml.matchAll(ELEMEN_SHEET)) {
      const nama = /\bname="([^"]*)"/.exec(m[0])?.[1];
      if (!nama) continue;
      // state="hidden" / "veryHidden" → sheet kerja lama, arsip, atau bantuan.
      const state = /\bstate="([^"]*)"/.exec(m[0])?.[1] ?? "visible";
      // Entitas dilepas dengan aturan yang SAMA dengan penipisan; kalau tidak,
      // nama ber-tanda kutip tidak pernah cocok dan sheet yang benar tidak dibaca.
      out.push({ nama: lepasEntitas(nama), tersembunyi: state !== "visible" });
    }
    return out;
  } catch {
    return [];
  }
}
