import "server-only";
import JSZip from "jszip";

/**
 * Menyisipkan GRAFIK GARIS NATIVE Excel ke dalam buffer .xlsx hasil exceljs.
 *
 * exceljs tak bisa menulis chart native → kita pasca-proses: unzip (JSZip),
 * tambah part OOXML chart (`xl/charts/chartN.xml`) + drawing (`xl/drawings`) +
 * relasi + content-types, lalu sematkan `<drawing>` di worksheet. Hasil: grafik
 * Excel SUNGGUHAN (bisa diklik/diedit, mengikuti sel) — bukan gambar. Chart
 * mereferensikan sel (kategori + deret), jadi live terhadap data sheet.
 */

export type ChartSeries = {
  /** Nama deret (mis. "Rencana"). */
  name: string;
  /** Referensi nilai X (posisi minggu 0..N), mis. "'Kurva S'!$A$30:$W$30". */
  xRef: string;
  /** Referensi nilai Y (kumulatif %), mis. "'Kurva S'!$A$31:$W$31". */
  yRef: string;
  /** Warna garis heksa tanpa # (mis. "2563EB"). */
  color: string;
};

export type LineChartSpec = {
  sheetName: string;
  series: ChartSeries[];
  /** Anchor sel (0-based) tempat chart diletakkan. */
  anchor: { fromCol: number; fromRow: number; toCol: number; toRow: number };
  /** Batas atas sumbu-X (= jumlah minggu N); origin X=0 = awal pelaksanaan. */
  xMax: number;
  yMin?: number;
  yMax?: number;
};

const C = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const XDR = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function seriesXml(s: ChartSeries, idx: number): string {
  return `<c:ser>
    <c:idx val="${idx}"/><c:order val="${idx}"/>
    <c:tx><c:v>${esc(s.name)}</c:v></c:tx>
    <c:spPr><a:ln w="19050" cap="rnd"><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill></a:ln></c:spPr>
    <c:marker><c:symbol val="circle"/><c:size val="4"/><c:spPr><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill></a:ln></c:spPr></c:marker>
    <c:xVal><c:numRef><c:f>${esc(s.xRef)}</c:f></c:numRef></c:xVal>
    <c:yVal><c:numRef><c:f>${esc(s.yRef)}</c:f></c:numRef></c:yVal>
    <c:smooth val="0"/>
  </c:ser>`;
}

/**
 * Chart OVERLAY ala Time Schedule sipil: SCATTER (XY) — bukan line/kategori — supaya
 * kurva MULAI dari origin (X=0, Y=0%) di pojok kiri-bawah dan titik menembus tepi
 * kolom minggu (X=w di w/N lebar). Latar TRANSPARAN, tanpa sumbu/legenda/judul/
 * gridline, plot diisi (nyaris) penuh frame (manualLayout inner) → sejajar blok kolom
 * minggu tabel di bawahnya. Sumbu X (0..N) & Y (0..100%) `delete=1` (skala jalan, tak
 * tampil). `plotVisOnly=0` → data dari baris helper tersembunyi tetap diplot.
 */
function chartXml(spec: LineChartSpec): string {
  const X_AX = 111111111;
  const Y_AX = 222222222;
  const yMin = spec.yMin ?? 0;
  const yMax = spec.yMax ?? 100;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${C}" xmlns:a="${A}" xmlns:r="${R}">
  <c:chart>
    <c:autoTitleDeleted val="1"/>
    <c:plotArea>
      <c:layout>
        <c:manualLayout>
          <c:layoutTarget val="inner"/>
          <c:xMode val="edge"/><c:yMode val="edge"/>
          <c:x val="0"/><c:y val="0.02"/><c:w val="1"/><c:h val="0.96"/>
        </c:manualLayout>
      </c:layout>
      <c:scatterChart>
        <c:scatterStyle val="lineMarker"/>
        <c:varyColors val="0"/>
        ${spec.series.map((s, i) => seriesXml(s, i)).join("\n")}
        <c:axId val="${X_AX}"/>
        <c:axId val="${Y_AX}"/>
      </c:scatterChart>
      <c:valAx>
        <c:axId val="${X_AX}"/>
        <c:scaling><c:orientation val="minMax"/><c:max val="${spec.xMax}"/><c:min val="0"/></c:scaling>
        <c:delete val="1"/>
        <c:axPos val="b"/>
        <c:crossAx val="${Y_AX}"/>
      </c:valAx>
      <c:valAx>
        <c:axId val="${Y_AX}"/>
        <c:scaling><c:orientation val="minMax"/><c:max val="${yMax}"/><c:min val="${yMin}"/></c:scaling>
        <c:delete val="1"/>
        <c:axPos val="l"/>
        <c:crossAx val="${X_AX}"/>
      </c:valAx>
      <c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>
    </c:plotArea>
    <c:plotVisOnly val="0"/>
    <c:dispBlanksAs val="gap"/>
  </c:chart>
  <c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>
</c:chartSpace>`;
}

/** Satu anchor grafik — potongan yang bisa berdiri sendiri ATAU disisipkan. */
function chartAnchorXml(spec: LineChartSpec, relId: string, shapeId: number): string {
  const a = spec.anchor;
  return `<xdr:twoCellAnchor editAs="oneCell">
    <xdr:from><xdr:col>${a.fromCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${a.fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>${a.toCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${a.toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:graphicFrame macro="">
      <xdr:nvGraphicFramePr>
        <xdr:cNvPr id="${shapeId}" name="Kurva S"/>
        <xdr:cNvGraphicFramePr/>
      </xdr:nvGraphicFramePr>
      <xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
      <a:graphic>
        <a:graphicData uri="${C}">
          <c:chart xmlns:c="${C}" xmlns:r="${R}" r:id="${relId}"/>
        </a:graphicData>
      </a:graphic>
    </xdr:graphicFrame>
    <xdr:clientData/>
  </xdr:twoCellAnchor>`;
}

function drawingXml(spec: LineChartSpec, relId: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="${XDR}" xmlns:a="${A}" xmlns:c="${C}" xmlns:r="${R}">
  ${chartAnchorXml(spec, relId, 2)}
</xdr:wsDr>`;
}

/** Petakan nama sheet → path worksheet XML lewat workbook.xml + rels. */
async function resolveSheetPath(zip: JSZip, sheetName: string): Promise<string | null> {
  const wbXml = (await zip.file("xl/workbook.xml")?.async("string")) ?? "";
  const relsXml = (await zip.file("xl/_rels/workbook.xml.rels")?.async("string")) ?? "";
  const rid = new RegExp(`<sheet\\b[^>]*\\bname="${sheetName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*/>`).exec(wbXml)?.[0];
  const ridVal = rid ? /\br:id="([^"]+)"/.exec(rid)?.[1] : null;
  if (!ridVal) return null;
  const relEl = new RegExp(`<Relationship\\b[^>]*\\bId="${ridVal}"[^>]*/?>`).exec(relsXml)?.[0];
  const target = relEl ? /\bTarget="([^"]+)"/.exec(relEl)?.[1] : null;
  if (!target) return null;
  return target.startsWith("/") ? target.slice(1) : `xl/${target}`;
}

/** rId bebas berikutnya dalam satu berkas .rels. */
function ridBerikutnya(relsXml: string): string {
  const ids = [...relsXml.matchAll(/\bId="rId(\d+)"/g)].map((m) => Number(m[1]));
  return `rId${(ids.length ? Math.max(...ids) : 0) + 1}`;
}

/**
 * Sisipkan grafik kurva-S ke workbook yang SUDAH ditulis exceljs.
 *
 * Aturan OOXML yang menentukan bentuk fungsi ini: **satu worksheet hanya boleh
 * menunjuk SATU drawing part**. Sejak kop laporan memasang logo (DECISIONS 269),
 * exceljs sudah membuat `xl/drawings/drawingN.xml` sendiri untuk sheet-sheet
 * yang berlogo. Versi lama fungsi ini menulis paksa `drawing1.xml` beserta
 * rels-nya, sehingga:
 *
 *  - drawing milik sheet lain (sampul) TERTIMPA → logonya hilang, dan sheet itu
 *    malah menunjuk gambar grafik;
 *  - kalau sheet kurva-S sendiri sudah punya drawing, blok penyisipan dilewati
 *    (`includes("<drawing ")`) → grafiknya yang hilang.
 *
 * Keduanya gagal DIAM-DIAM: berkasnya tetap terbuka dan seluruh angkanya benar.
 * Sekarang: kalau sheet sudah punya drawing, anchor grafik DISISIPKAN ke dalam
 * drawing itu; kalau belum, dibuat part baru dengan nomor yang masih bebas.
 */
export async function addLineChartToXlsx(buffer: Buffer, spec: LineChartSpec): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  const sheetPath = await resolveSheetPath(zip, spec.sheetName);
  if (!sheetPath) return buffer; // sheet tak ketemu → biarkan tanpa chart (aman)

  const sheetFile = sheetPath.slice(sheetPath.lastIndexOf("/") + 1);
  const sheetRelsPath = `xl/worksheets/_rels/${sheetFile}.rels`;
  const sheetRels = (await zip.file(sheetRelsPath)?.async("string")) ?? "";

  // Nomor chart yang masih bebas — jangan menimpa chart lain.
  const chartNo =
    Math.max(0, ...Object.keys(zip.files).map((f) => Number(/^xl\/charts\/chart(\d+)\.xml$/.exec(f)?.[1] ?? 0))) + 1;
  const chartPath = `xl/charts/chart${chartNo}.xml`;
  zip.file(chartPath, chartXml(spec));

  // Apakah worksheet ini SUDAH punya drawing (mis. dari logo kop)?
  const drawingRelEl = /<Relationship\b[^>]*\bType="[^"]*\/drawing"[^>]*\/?>/.exec(sheetRels)?.[0];
  const drawingTarget = drawingRelEl ? /\bTarget="([^"]+)"/.exec(drawingRelEl)?.[1] : null;
  const drawingPath = drawingTarget
    ? drawingTarget.startsWith("/")
      ? drawingTarget.slice(1)
      : `xl/drawings/${drawingTarget.replace(/^\.\.\/drawings\//, "")}`
    : null;
  const drawingLama = drawingPath ? await zip.file(drawingPath)?.async("string") : undefined;

  if (drawingPath && drawingLama) {
    // ── Sisipkan ke drawing yang sudah ada (jangan bikin part kedua). ──
    const drawingRelsPath = drawingPath.replace(/([^/]+)$/, "_rels/$1.rels");
    const relsLama =
      (await zip.file(drawingRelsPath)?.async("string")) ??
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
    const chartRid = ridBerikutnya(relsLama);
    zip.file(
      drawingRelsPath,
      relsLama.replace(
        "</Relationships>",
        `<Relationship Id="${chartRid}" Type="${R}/chart" Target="../charts/chart${chartNo}.xml"/></Relationships>`,
      ),
    );
    // id shape harus unik dalam satu drawing.
    const idMaks = Math.max(1, ...[...drawingLama.matchAll(/<xdr:cNvPr\b[^>]*\bid="(\d+)"/g)].map((m) => Number(m[1])));
    let isi = drawingLama.replace("</xdr:wsDr>", `${chartAnchorXml(spec, chartRid, idMaks + 1)}</xdr:wsDr>`);
    // Namespace c: mungkin belum dideklarasikan pada drawing bikinan exceljs.
    if (!/xmlns:c=/.test(isi)) isi = isi.replace("<xdr:wsDr ", `<xdr:wsDr xmlns:c="${C}" `);
    zip.file(drawingPath, isi);
  } else {
    // ── Belum ada drawing: buat part baru dengan nomor yang masih bebas. ──
    const drawingNo =
      Math.max(0, ...Object.keys(zip.files).map((f) => Number(/^xl\/drawings\/drawing(\d+)\.xml$/.exec(f)?.[1] ?? 0))) + 1;
    const baru = `xl/drawings/drawing${drawingNo}.xml`;
    zip.file(baru, drawingXml(spec, "rId1"));
    zip.file(
      `xl/drawings/_rels/drawing${drawingNo}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="${R}/chart" Target="../charts/chart${chartNo}.xml"/>
</Relationships>`,
    );
    const drawingRid = sheetRels ? ridBerikutnya(sheetRels) : "rId1";
    zip.file(
      sheetRelsPath,
      sheetRels
        ? sheetRels.replace(
            "</Relationships>",
            `<Relationship Id="${drawingRid}" Type="${R}/drawing" Target="../drawings/drawing${drawingNo}.xml"/></Relationships>`,
          )
        : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="${R}/drawing" Target="../drawings/drawing${drawingNo}.xml"/>
</Relationships>`,
    );
    const wsXml = (await zip.file(sheetPath)?.async("string")) ?? "";
    zip.file(sheetPath, wsXml.replace(/(<\/worksheet>\s*)$/, `<drawing r:id="${drawingRid}"/>$1`));
    // content-types utk drawing baru.
    const ctPath = "[Content_Types].xml";
    let ct = (await zip.file(ctPath)?.async("string")) ?? "";
    if (!ct.includes(`PartName="/${baru}"`)) {
      ct = ct.replace(
        "</Types>",
        `<Override PartName="/${baru}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`,
      );
      zip.file(ctPath, ct);
    }
  }

  // content-types utk chart (selalu part baru).
  const ctPath = "[Content_Types].xml";
  let ct = (await zip.file(ctPath)?.async("string")) ?? "";
  if (!ct.includes(`PartName="/${chartPath}"`)) {
    ct = ct.replace(
      "</Types>",
      `<Override PartName="/${chartPath}" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>`,
    );
    zip.file(ctPath, ct);
  }

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/** Ubah indeks kolom 1-based → huruf Excel (1→A, 27→AA). */
export function colLetter(n: number): string {
  let s = "";
  let x = n;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}
