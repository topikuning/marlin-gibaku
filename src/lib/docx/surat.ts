import "server-only";
import JSZip from "jszip";
import sharp from "sharp";
import type { Blok, Run, SuratTersusun } from "@/lib/surat-penyedia/aturan";
import type { KopSurat } from "@/lib/pdf/surat-penyedia";

/**
 * WORD (.docx) SURAT BERKOP PENYEDIA (DECISIONS 716) – pilihan user: PDF dan
 * Word. Isinya blok yang SAMA dengan PDF (`surat-penyedia/aturan.ts`); di sini
 * hanya cara menggambarnya.
 *
 * Disusun langsung sebagai WordprocessingML di dalam zip (jszip sudah jadi
 * dependensi) – cukup untuk paragraf, tabel tanpa garis, dan satu gambar kop,
 * tanpa menambah pustaka baru.
 */

const TWIP_HALAMAN = { lebar: 11906, tinggi: 16838 };
const MARGIN = 1134; // 2 cm
const LEBAR_ISI = TWIP_HALAMAN.lebar - MARGIN * 2;
const EMU_PER_TWIP = 635;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function run(r: Run, ukuran?: number): string {
  const rPr = [r.tebal ? "<w:b/>" : "", r.garisBawah ? '<w:u w:val="single"/>' : "", ukuran ? `<w:sz w:val="${ukuran}"/>` : ""].join("");
  return r.teks
    .split("\n")
    .map((baris, i) => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}${i > 0 ? "<w:br/>" : ""}<w:t xml:space="preserve">${esc(baris)}</w:t></w:r>`)
    .join("");
}

function paragraf(
  isi: Run[],
  o: { rata?: "left" | "right" | "center" | "both"; sebelum?: number; ukuran?: number; indentKiri?: number; gantung?: number } = {},
): string {
  const pPr = [
    `<w:spacing w:before="${o.sebelum ?? 0}" w:after="60"/>`,
    o.indentKiri ? `<w:ind w:left="${o.indentKiri}" w:hanging="${o.gantung ?? 0}"/>` : "",
    o.rata ? `<w:jc w:val="${o.rata}"/>` : "",
  ].join("");
  return `<w:p><w:pPr>${pPr}</w:pPr>${isi.map((r) => run(r, o.ukuran)).join("")}</w:p>`;
}

function sel(lebar: number, isi: string, o: { garis?: boolean; vAlign?: "center" | "top" } = {}): string {
  const garis = o.garis
    ? '<w:tcBorders><w:top w:val="single" w:sz="8"/><w:left w:val="single" w:sz="8"/><w:bottom w:val="single" w:sz="8"/><w:right w:val="single" w:sz="8"/></w:tcBorders>'
    : "";
  return `<w:tc><w:tcPr><w:tcW w:w="${lebar}" w:type="dxa"/>${garis}${o.vAlign ? `<w:vAlign w:val="${o.vAlign}"/>` : ""}</w:tcPr>${isi || "<w:p/>"}</w:tc>`;
}

function tabel(kolom: number[], baris: string[][]): string {
  const grid = kolom.map((w) => `<w:gridCol w:w="${w}"/>`).join("");
  const isi = baris.map((b) => `<w:tr>${b.join("")}</w:tr>`).join("");
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="${kolom.reduce((a, b) => a + b, 0)}" w:type="dxa"/>` +
    '<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>' +
    `<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${isi}</w:tbl>`
  );
}

function gambarInline(rId: string, lebarEmu: number, tinggiEmu: number, id: number): string {
  return (
    `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${lebarEmu}" cy="${tinggiEmu}"/>` +
    `<wp:docPr id="${id}" name="Gambar ${id}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:nvPicPr><pic:cNvPr id="${id}" name="gambar${id}.png"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${lebarEmu}" cy="${tinggiEmu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
  );
}

type Gambar = { rId: string; nama: string; png: Buffer; lebarEmu: number; tinggiEmu: number };

async function siapkanGambar(buf: Buffer, rId: string, nama: string, maksLebarTwip: number, maksTinggiTwip: number): Promise<Gambar | null> {
  try {
    const png = await sharp(buf).png().toBuffer();
    const meta = await sharp(png).metadata();
    if (!meta.width || !meta.height) return null;
    const skala = Math.min(maksLebarTwip / meta.width, maksTinggiTwip / meta.height);
    return {
      rId,
      nama,
      png,
      lebarEmu: Math.round(meta.width * skala * EMU_PER_TWIP),
      tinggiEmu: Math.round(meta.height * skala * EMU_PER_TWIP),
    };
  } catch (err) {
    console.error("[surat-penyedia] gambar kop gagal disiapkan untuk Word:", err);
    return null;
  }
}

function kopXml(kop: KopSurat, gambar: Gambar | null, logo: Gambar | null): string {
  if (gambar) return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${gambarInline(gambar.rId, gambar.lebarEmu, gambar.tinggiEmu, 1)}</w:p>`;
  const kontak = [kop.telepon && `Telp. ${kop.telepon}`, kop.email && `Email ${kop.email}`].filter(Boolean).join(" · ");
  const teks =
    paragraf([{ teks: kop.nama.toUpperCase(), tebal: true }], { ukuran: 34 }) +
    (kop.alamat ? paragraf([{ teks: kop.alamat }], { ukuran: 18 }) : "") +
    (kontak ? paragraf([{ teks: kontak }], { ukuran: 18 }) : "");
  const lebarLogo = logo ? 1500 : 0;
  const isi = logo
    ? tabel([lebarLogo, LEBAR_ISI - lebarLogo], [[
        sel(lebarLogo, `<w:p>${gambarInline(logo.rId, logo.lebarEmu, logo.tinggiEmu, 2)}</w:p>`, { vAlign: "center" }),
        sel(LEBAR_ISI - lebarLogo, teks, { vAlign: "center" }),
      ]])
    : teks;
  // Garis bawah kop: paragraf kosong bergaris ganda.
  return `${isi}<w:p><w:pPr><w:pBdr><w:bottom w:val="double" w:sz="12" w:space="1" w:color="111111"/></w:pBdr><w:spacing w:after="240"/></w:pPr></w:p>`;
}

function blokXml(b: Blok): string {
  switch (b.jenis) {
    case "paragraf":
      return paragraf(b.isi, {
        rata: b.rata === "penuh" ? "both" : b.rata === "kanan" ? "right" : b.rata === "tengah" ? "center" : "left",
        sebelum: (b.jarakAtas ?? 6) * 20,
      });
    case "judul":
      return (
        paragraf([{ teks: b.teks, tebal: true, garisBawah: true }], { rata: "center", sebelum: 200, ukuran: 28 }) +
        (b.sub ? paragraf([{ teks: b.sub }], { rata: "center" }) : "")
      );
    case "pasangan": {
      const kolom = [2400, 240, LEBAR_ISI - 2640];
      return tabel(
        kolom,
        b.baris.map((x) => [
          sel(kolom[0], paragraf([{ teks: x.label }])),
          sel(kolom[1], paragraf([{ teks: ":" }])),
          sel(kolom[2], paragraf(x.isi)),
        ]),
      );
    }
    case "daftar":
      return b.butir.map((butir, i) => paragraf([{ teks: `${i + 1}.\t${butir}` }], { indentKiri: 567, gantung: 340 })).join("");
    case "ttd": {
      const kiri = Math.round(LEBAR_ISI * 0.5);
      const kanan = LEBAR_ISI - kiri;
      const sisiKanan =
        (b.tempatTanggal ? paragraf([{ teks: b.tempatTanggal }], { rata: "center" }) : "") +
        paragraf([{ teks: b.salam }], { rata: "center" }) +
        paragraf([{ teks: b.perusahaan, tebal: true }], { rata: "center" }) +
        (b.meterai ? paragraf([{ teks: "Meterai" }], { rata: "center", sebelum: 400, ukuran: 14 }) : "") +
        paragraf([{ teks: b.nama, tebal: true, garisBawah: true }], { rata: "center", sebelum: b.meterai ? 500 : 1100 }) +
        paragraf([{ teks: b.jabatan }], { rata: "center" });
      const sisiKiri = b.kotakNominal
        ? tabel([kiri - 400], [[sel(kiri - 400, paragraf([{ teks: b.kotakNominal, tebal: true }], { rata: "center", ukuran: 26 }), { garis: true, vAlign: "center" })]])
        : "<w:p/>";
      return paragraf([], { sebelum: 300 }) + tabel([kiri, kanan], [[sel(kiri, sisiKiri, { vAlign: "center" }), sel(kanan, sisiKanan)]]);
    }
  }
}

export async function buatDocxSurat(surat: SuratTersusun, kop: KopSurat): Promise<Buffer> {
  const gambar = kop.gambar ? await siapkanGambar(kop.gambar, "rIdKop", "kop.png", LEBAR_ISI, 1900) : null;
  const logo = !gambar && kop.logo ? await siapkanGambar(kop.logo, "rIdLogo", "logo.png", 1300, 1300) : null;
  const media = [gambar, logo].filter((g): g is Gambar => g !== null);

  const body = kopXml(kop, gambar, logo) + surat.blok.map(blokXml).join("");
  const dokumen =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">' +
    `<w:body>${body}<w:sectPr><w:pgSz w:w="${TWIP_HALAMAN.lebar}" w:h="${TWIP_HALAMAN.tinggi}"/>` +
    `<w:pgMar w:top="${MARGIN}" w:right="${MARGIN}" w:bottom="${MARGIN}" w:left="${MARGIN}" w:header="567" w:footer="567" w:gutter="0"/>` +
    "</w:sectPr></w:body></w:document>";

  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="png" ContentType="image/png"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      "</Types>",
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      "</Relationships>",
  );
  zip.file(
    "word/_rels/document.xml.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      media
        .map((g) => `<Relationship Id="${g.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${g.nama}"/>`)
        .join("") +
      "</Relationships>",
  );
  zip.file(
    "word/styles.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="22"/><w:lang w:val="id-ID"/></w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr><w:spacing w:after="60" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      "</w:styles>",
  );
  zip.file("word/document.xml", dokumen);
  for (const g of media) zip.file(`word/media/${g.nama}`, g.png);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
