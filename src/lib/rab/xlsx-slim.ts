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

const RAB_RE = /^rab$/i;
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
export async function slimRabWorkbook(buf: Buffer | ArrayBuffer): Promise<Buffer> {
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
  for (const m of wbXml.matchAll(/<sheet\b[^>]*\/>/g)) {
    const el = m[0];
    const name = /\bname="([^"]*)"/.exec(el)?.[1] ?? "";
    const rid = /\br:id="([^"]*)"/.exec(el)?.[1] ?? "";
    sheets.push({ el, name, rid });
  }
  const chosen =
    sheets.find((s) => s.name === "RAB") ??
    sheets.find((s) => RAB_RE.test(s.name.trim())) ??
    sheets.find((s) => CCO_RE.test(s.name.trim()));
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

function toBuffer(buf: Buffer | ArrayBuffer): Buffer {
  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
}
