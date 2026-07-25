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
  /** Referensi nilai, mis. "'Kurva S'!$D$14:$O$14". */
  valRef: string;
  /** Warna garis heksa tanpa # (mis. "64748B"). */
  color: string;
  /** true = garis putus-putus. */
  dash?: boolean;
};

export type LineChartSpec = {
  sheetName: string;
  title?: string;
  /** Referensi label kategori (sumbu X), mis. "'Kurva S'!$D$5:$O$5". */
  catRef: string;
  series: ChartSeries[];
  /** Anchor sel (0-based) tempat chart diletakkan. */
  anchor: { fromCol: number; fromRow: number; toCol: number; toRow: number };
  yMin?: number;
  yMax?: number;
};

const C = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const XDR = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function seriesXml(s: ChartSeries, idx: number, catRef: string): string {
  const dash = s.dash ? `<a:prstDash val="dash"/>` : "";
  return `<c:ser>
    <c:idx val="${idx}"/><c:order val="${idx}"/>
    <c:tx><c:v>${esc(s.name)}</c:v></c:tx>
    <c:spPr><a:ln w="22225" cap="rnd"><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill>${dash}</a:ln></c:spPr>
    <c:marker><c:symbol val="none"/></c:marker>
    <c:cat><c:strRef><c:f>${esc(catRef)}</c:f></c:strRef></c:cat>
    <c:val><c:numRef><c:f>${esc(s.valRef)}</c:f></c:numRef></c:val>
    <c:smooth val="0"/>
  </c:ser>`;
}

function chartXml(spec: LineChartSpec): string {
  const CAT_AX = 111111111;
  const VAL_AX = 222222222;
  const title = spec.title
    ? `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr b="1" sz="1200"/><a:t>${esc(spec.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>`
    : `<c:autoTitleDeleted val="1"/>`;
  const yMin = spec.yMin ?? 0;
  const yMax = spec.yMax ?? 100;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${C}" xmlns:a="${A}" xmlns:r="${R}">
  <c:chart>
    ${title}
    <c:plotArea>
      <c:layout/>
      <c:lineChart>
        <c:grouping val="standard"/>
        <c:varyColors val="0"/>
        ${spec.series.map((s, i) => seriesXml(s, i, spec.catRef)).join("\n")}
        <c:marker val="1"/>
        <c:axId val="${CAT_AX}"/>
        <c:axId val="${VAL_AX}"/>
      </c:lineChart>
      <c:catAx>
        <c:axId val="${CAT_AX}"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="b"/>
        <c:crossAx val="${VAL_AX}"/>
      </c:catAx>
      <c:valAx>
        <c:axId val="${VAL_AX}"/>
        <c:scaling><c:orientation val="minMax"/><c:max val="${yMax}"/><c:min val="${yMin}"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="l"/>
        <c:majorGridlines/>
        <c:numFmt formatCode="0&quot;%&quot;" sourceLinked="0"/>
        <c:crossAx val="${CAT_AX}"/>
      </c:valAx>
    </c:plotArea>
    <c:legend><c:legendPos val="t"/><c:overlay val="0"/></c:legend>
    <c:plotVisOnly val="1"/>
    <c:dispBlanksAs val="gap"/>
  </c:chart>
</c:chartSpace>`;
}

function drawingXml(spec: LineChartSpec, relId: string): string {
  const a = spec.anchor;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="${XDR}" xmlns:a="${A}" xmlns:c="${C}" xmlns:r="${R}">
  <xdr:twoCellAnchor editAs="oneCell">
    <xdr:from><xdr:col>${a.fromCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${a.fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>${a.toCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${a.toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:graphicFrame macro="">
      <xdr:nvGraphicFramePr>
        <xdr:cNvPr id="2" name="Kurva S"/>
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
  </xdr:twoCellAnchor>
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

export async function addLineChartToXlsx(buffer: Buffer, spec: LineChartSpec): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  const sheetPath = await resolveSheetPath(zip, spec.sheetName);
  if (!sheetPath) return buffer; // sheet tak ketemu → biarkan tanpa chart (aman)

  const sheetFile = sheetPath.slice(sheetPath.lastIndexOf("/") + 1);
  const sheetRelsPath = `xl/worksheets/_rels/${sheetFile}.rels`;

  // 1) chart + drawing parts.
  zip.file("xl/charts/chart1.xml", chartXml(spec));
  zip.file("xl/drawings/drawing1.xml", drawingXml(spec, "rId1"));
  zip.file(
    "xl/drawings/_rels/drawing1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="${R}/chart" Target="../charts/chart1.xml"/>
</Relationships>`,
  );

  // 2) worksheet rels → drawing (buat/append; hindari tabrakan rId).
  const existingRels = await zip.file(sheetRelsPath)?.async("string");
  let drawingRid = "rId1";
  if (existingRels) {
    const ids = [...existingRels.matchAll(/\bId="rId(\d+)"/g)].map((m) => Number(m[1]));
    drawingRid = `rId${(ids.length ? Math.max(...ids) : 0) + 1}`;
    zip.file(
      sheetRelsPath,
      existingRels.replace(
        "</Relationships>",
        `<Relationship Id="${drawingRid}" Type="${R}/drawing" Target="../drawings/drawing1.xml"/></Relationships>`,
      ),
    );
  } else {
    zip.file(
      sheetRelsPath,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="${R}/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>`,
    );
  }

  // 3) sematkan <drawing> di worksheet (sebelum </worksheet>, sesudah pageSetup).
  const wsXml = (await zip.file(sheetPath)?.async("string")) ?? "";
  const withDrawing = wsXml.includes("<drawing ")
    ? wsXml
    : wsXml.replace(/(<\/worksheet>\s*)$/, `<drawing r:id="${drawingRid}"/>$1`);
  zip.file(sheetPath, withDrawing);

  // 4) content-types: override chart + drawing.
  const ctPath = "[Content_Types].xml";
  let ct = (await zip.file(ctPath)?.async("string")) ?? "";
  const add: string[] = [];
  if (!ct.includes('PartName="/xl/drawings/drawing1.xml"'))
    add.push(`<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
  if (!ct.includes('PartName="/xl/charts/chart1.xml"'))
    add.push(`<Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`);
  if (add.length) ct = ct.replace("</Types>", `${add.join("")}</Types>`);
  zip.file(ctPath, ct);

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
