/**
 * Gerador mínimo de planilhas .xlsx, sem dependências.
 *
 * Monta o pacote Office Open XML (um ZIP sem compressão) com uma única aba,
 * cabeçalho em negrito, primeira linha congelada, autofiltro e colunas de data
 * reconhecidas pelo Excel como datas de verdade (ordenáveis e filtráveis).
 */

/** Data de calendário: objeto `{ date: "YYYY-MM-DD" }` vira data no Excel. */
export type XlsxCell = string | number | { date: string } | null | undefined;

export interface XlsxSheet {
  name: string;
  header: string[];
  rows: XlsxCell[][];
  /** Largura de cada coluna, em caracteres. */
  widths?: number[];
}

// ---------- XML ----------

const escapeXml = (s: string) =>
  s
    // Caracteres de controle são proibidos em XML 1.0 (exceto tab e quebras).
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export function columnName(index: number): string {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/** Número de série de data do Excel (dias desde 30/12/1899). */
export function excelDateSerial(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(ms) ? null : ms / 86_400_000 + 25_569;
}

// ---------- Estilos ----------

const FONTS = [
  `<font><sz val="11"/><name val="Calibri"/></font>`,
  `<font><b/><sz val="11"/><name val="Calibri"/></font>`,
  `<font><b/><sz val="14"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>`,
  `<font><i/><sz val="10"/><color rgb="FF52525B"/><name val="Calibri"/></font>`,
  `<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>`,
  `<font><b/><sz val="11"/><color rgb="FFB91C1C"/><name val="Calibri"/></font>`,
];

const solid = (rgb: string) =>
  `<fill><patternFill patternType="solid"><fgColor rgb="FF${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;
const FILL_COLORS = ["E0E7FF", "1E293B", "334155", "DCFCE7", "DBEAFE", "FEF3C7", "FFEDD5", "F1F5F9", "FEE2E2", "203864", "D9E1F2"] as const;
const fillId = (rgb: (typeof FILL_COLORS)[number]) => FILL_COLORS.indexOf(rgb) + 2;

const NUM_FMT_DATE = 164;
const NUM_FMT_BRL = 165;
/** Número contábil: zero aparece como "-". */
const NUM_FMT_ACC = 166;

interface StyleDef {
  font?: number;
  fill?: (typeof FILL_COLORS)[number];
  border?: boolean;
  numFmt?: number;
  h?: "left" | "center" | "right";
  wrap?: boolean;
}

const STYLES = {
  default: {},
  header: { font: 1, fill: "E0E7FF" },
  date: { numFmt: NUM_FMT_DATE },
  title: { font: 2, fill: "1E293B" },
  subtitle: { font: 3 },
  th: { font: 4, fill: "334155", border: true, h: "center", wrap: true },
  td: { border: true },
  tdWrap: { border: true, wrap: true },
  tdCenter: { border: true, h: "center" },
  tdDate: { border: true, numFmt: NUM_FMT_DATE, h: "center" },
  tdDateLate: { border: true, numFmt: NUM_FMT_DATE, h: "center", fill: "FEE2E2", font: 5 },
  tdMoney: { border: true, numFmt: NUM_FMT_BRL },
  totalLabel: { font: 1, fill: "F1F5F9", border: true, h: "right" },
  totalMoney: { font: 1, fill: "F1F5F9", border: true, numFmt: NUM_FMT_BRL },
  statusGreen: { border: true, wrap: true, fill: "DCFCE7" },
  statusBlue: { border: true, wrap: true, fill: "DBEAFE" },
  statusAmber: { border: true, wrap: true, fill: "FEF3C7" },
  statusOrange: { border: true, wrap: true, fill: "FFEDD5" },
  statusGray: { border: true, wrap: true, fill: "F1F5F9" },
  statusRed: { border: true, wrap: true, fill: "FEE2E2", font: 5 },
  // Capa da conciliação (faixas azul-escuras com texto branco).
  bar: { font: 4, fill: "203864" },
  barRight: { font: 4, fill: "203864", h: "right" },
  barMoney: { font: 4, fill: "203864", numFmt: NUM_FMT_BRL, h: "right" },
  bold: { font: 1 },
  boldCenter: { font: 1, h: "center" },
  thBox: { font: 1, border: true, h: "center" },
  legend: { fill: "D9E1F2", h: "center" },
  legendText: { fill: "D9E1F2" },
  legendMoney: { fill: "D9E1F2", numFmt: NUM_FMT_BRL },
  acc: { numFmt: NUM_FMT_ACC },
  accBold: { font: 1, numFmt: NUM_FMT_ACC },
  dateRight: { numFmt: NUM_FMT_DATE, h: "right" },
  right: { h: "right" },
} satisfies Record<string, StyleDef>;

export type StyleName = keyof typeof STYLES;
const STYLE_NAMES = Object.keys(STYLES) as StyleName[];
const styleIndex = (name: StyleName) => STYLE_NAMES.indexOf(name);

function stylesXml(): string {
  const xfs = STYLE_NAMES.map((name) => {
    const d: StyleDef = STYLES[name];
    const align =
      d.h || d.wrap || d.border
        ? `<alignment${d.h ? ` horizontal="${d.h}"` : ""} vertical="center"${d.wrap ? ` wrapText="1"` : ""}/>`
        : "";
    return (
      `<xf numFmtId="${d.numFmt ?? 0}" fontId="${d.font ?? 0}" fillId="${d.fill ? fillId(d.fill) : 0}" borderId="${d.border ? 1 : 0}" xfId="0"` +
      `${d.numFmt ? ` applyNumberFormat="1"` : ""}${d.font ? ` applyFont="1"` : ""}${d.fill ? ` applyFill="1"` : ""}` +
      `${d.border ? ` applyBorder="1"` : ""}${align ? ` applyAlignment="1">${align}</xf>` : "/>"}`
    );
  });
  const thin = `<left style="thin"><color rgb="FFD4D4D8"/></left><right style="thin"><color rgb="FFD4D4D8"/></right>` +
    `<top style="thin"><color rgb="FFD4D4D8"/></top><bottom style="thin"><color rgb="FFD4D4D8"/></bottom><diagonal/>`;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<numFmts count="3"><numFmt numFmtId="${NUM_FMT_DATE}" formatCode="dd/mm/yyyy"/>` +
    `<numFmt numFmtId="${NUM_FMT_BRL}" formatCode="&quot;R$&quot; #,##0.00;-&quot;R$&quot; #,##0.00"/>` +
    `<numFmt numFmtId="${NUM_FMT_ACC}" formatCode="#,##0.00;-#,##0.00;&quot;-&quot;"/></numFmts>` +
    `<fonts count="${FONTS.length}">${FONTS.join("")}</fonts>` +
    `<fills count="${FILL_COLORS.length + 2}"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
    `${FILL_COLORS.map(solid).join("")}</fills>` +
    `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border>${thin}</border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`
  );
}

// ---------- Planilhas ----------

/** Fórmula do Excel (sem "="), com o valor já calculado para quem abre sem recalcular. */
export interface XlsxFormula {
  formula: string;
  value?: number;
}

export interface StyledCell {
  v: XlsxCell | XlsxFormula;
  s?: StyleName;
}

export interface WorkbookRow {
  cells: (StyledCell | XlsxCell)[];
  /** Altura em pontos. */
  height?: number;
}

export interface WorkbookSheet {
  name: string;
  rows: WorkbookRow[];
  widths?: number[];
  /** Intervalos mesclados, ex.: "A1:H1". */
  merges?: string[];
  /** Congela as linhas acima desta (1-based). */
  freezeRows?: number;
  /** Linha do cabeçalho com filtro (1-based). */
  filterRow?: number;
  /** Linhas repetidas no topo de cada página impressa (1-based, até esta). */
  printTitleRows?: number;
  landscape?: boolean;
  /** Ajusta à largura da página em retrato. */
  fitPortrait?: boolean;
  /** Esconde as linhas de grade (visual de formulário). */
  hideGrid?: boolean;
  /** Imagens (logos) presas a uma célula. */
  images?: SheetImageSpec[];
}

export interface SheetImageSpec {
  data: Uint8Array;
  ext: "png" | "jpeg" | "gif";
  /** Célula de canto superior esquerdo (0-based). */
  col: number;
  row: number;
  /** Tamanho exibido, em pixels. */
  width: number;
  height: number;
  /** Deslocamento dentro da célula, em pixels. */
  offsetX?: number;
}

const isStyled = (c: StyledCell | XlsxCell): c is StyledCell =>
  typeof c === "object" && c !== null && "v" in c;

function cellXml(cell: StyledCell | XlsxCell, ref: string): string {
  const { v: value, s: styleName } = isStyled(cell) ? cell : { v: cell, s: undefined };
  const style = styleName ? styleIndex(styleName) : 0;
  const s = style ? ` s="${style}"` : "";
  if (value === null || value === undefined || value === "") return style ? `<c r="${ref}"${s}/>` : "";
  if (typeof value === "number") {
    return Number.isFinite(value) ? `<c r="${ref}"${s}><v>${value}</v></c>` : "";
  }
  if (typeof value === "object" && "formula" in value) {
    const v = value.value !== undefined && Number.isFinite(value.value) ? `<v>${value.value}</v>` : "";
    return `<c r="${ref}"${s}><f>${escapeXml(value.formula)}</f>${v}</c>`;
  }
  if (typeof value === "object") {
    const serial = excelDateSerial(value.date);
    const ds = style ? s : ` s="${styleIndex("date")}"`;
    return serial === null ? (style ? `<c r="${ref}"${s}/>` : "") : `<c r="${ref}"${ds}><v>${serial}</v></c>`;
  }
  // Limite de caracteres por célula no Excel.
  const text = value.length > 32_767 ? value.slice(0, 32_767) : value;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
}

const sheetTitle = (name: string) =>
  (name.replace(/[\\/?*[\]:]/g, " ").trim() || "Planilha").slice(0, 31);

function worksheetXml(sheet: WorkbookSheet): string {
  const cols = Math.max(1, ...sheet.rows.map((r) => r.cells.length));
  const lastCol = columnName(cols - 1);
  const lastRow = Math.max(1, sheet.rows.length);
  const widths = sheet.widths?.length
    ? `<cols>${sheet.widths
        .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
        .join("")}</cols>`
    : "";
  const rows = sheet.rows
    .map((row, i) => {
      const r = i + 1;
      const ht = row.height ? ` ht="${row.height}" customHeight="1"` : "";
      return `<row r="${r}"${ht}>${row.cells.map((c, ci) => cellXml(c, `${columnName(ci)}${r}`)).join("")}</row>`;
    })
    .join("");
  const freeze = sheet.freezeRows
    ? `<pane ySplit="${sheet.freezeRows}" topLeftCell="A${sheet.freezeRows + 1}" activePane="bottomLeft" state="frozen"/>`
    : "";
  const filter = sheet.filterRow ? `<autoFilter ref="${filterRange(sheet)}"/>` : "";
  const merges = sheet.merges?.length
    ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>`
    : "";
  const fit = sheet.landscape || sheet.fitPortrait;
  const sheetPr = fit ? `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>` : "";
  const page = fit
    ? `<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>` +
      `<pageSetup paperSize="9" orientation="${sheet.landscape ? "landscape" : "portrait"}" fitToWidth="1" fitToHeight="0"/>`
    : "";

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    sheetPr +
    `<dimension ref="A1:${lastCol}${lastRow}"/>` +
    `<sheetViews><sheetView${sheet.hideGrid ? ` showGridLines="0"` : ""} workbookViewId="0">${freeze}</sheetView></sheetViews>` +
    widths +
    `<sheetData>${rows}</sheetData>` +
    filter +
    merges +
    page +
    (sheet.images?.length ? `<drawing r:id="rId1"/>` : "") +
    `</worksheet>`
  );
}

/** Intervalo do autofiltro: do cabeçalho até a última linha de dados contígua. */
function filterRange(sheet: WorkbookSheet): string {
  const header = sheet.filterRow ?? 1;
  const cols = sheet.rows[header - 1]?.cells.length ?? 1;
  let last = header;
  while (last < sheet.rows.length && sheet.rows[last].cells.length > 0) last++;
  return `A${header}:${columnName(cols - 1)}${last}`;
}

function drawingXml(images: SheetImageSpec[]): string {
  const EMU = 9525;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    images
      .map(
        (img, i) =>
          `<xdr:oneCellAnchor><xdr:from><xdr:col>${img.col}</xdr:col><xdr:colOff>${Math.round((img.offsetX ?? 0) * EMU)}</xdr:colOff><xdr:row>${img.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
          `<xdr:ext cx="${Math.round(img.width * EMU)}" cy="${Math.round(img.height * EMU)}"/>` +
          `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${i + 2}" name="Imagem ${i + 1}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
          `<xdr:blipFill><a:blip r:embed="rId${i + 1}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
          `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${Math.round(img.width * EMU)}" cy="${Math.round(img.height * EMU)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>` +
          `</xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`,
      )
      .join("") +
    `</xdr:wsDr>`
  );
}

const RELS_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function packageFiles(sheets: WorkbookSheet[]): Record<string, string | Uint8Array> {
  const names = sheets.map((s) => sheetTitle(s.name));
  const quoted = (i: number) => `'${escapeXml(names[i]).replace(/'/g, "''")}'`;
  const abs = (range: string) => range.replace(/([A-Z]+)(\d+)/g, "$$$1$$$2");
  const defined = sheets.flatMap((s, i) => [
    ...(s.filterRow
      ? [`<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${quoted(i)}!${abs(filterRange(s))}</definedName>`]
      : []),
    ...(s.printTitleRows
      ? [`<definedName name="_xlnm.Print_Titles" localSheetId="${i}">${quoted(i)}!$1:$${s.printTitleRows}</definedName>`]
      : []),
  ]);

  const files: Record<string, string | Uint8Array> = {
    "[Content_Types].xml":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/>` +
      sheets
        .map((s, i) =>
          s.images?.length
            ? `<Override PartName="/xl/drawings/drawing${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`
            : "",
        )
        .join("") +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      sheets
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join("") +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      `</Types>`,
    "_rels/.rels":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`,
    "xl/workbook.xml":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheets>${names.map((n, i) => `<sheet name="${escapeXml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>` +
      (defined.length ? `<definedNames>${defined.join("")}</definedNames>` : "") +
      `<calcPr calcId="191029" fullCalcOnLoad="1"/>` +
      `</workbook>`,
    "xl/_rels/workbook.xml.rels":
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      sheets
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join("") +
      `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `</Relationships>`,
    "xl/styles.xml": stylesXml(),
  };
  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = worksheetXml(s);
    if (!s.images?.length) return;
    const n = i + 1;
    files[`xl/worksheets/_rels/sheet${n}.xml.rels`] =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${RELS_NS}">` +
      `<Relationship Id="rId1" Type="${REL_TYPE}/drawing" Target="../drawings/drawing${n}.xml"/></Relationships>`;
    files[`xl/drawings/drawing${n}.xml`] = drawingXml(s.images);
    files[`xl/drawings/_rels/drawing${n}.xml.rels`] =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${RELS_NS}">` +
      s.images.map((img, k) => `<Relationship Id="rId${k + 1}" Type="${REL_TYPE}/image" Target="../media/image${n}_${k + 1}.${img.ext}"/>`).join("") +
      `</Relationships>`;
    s.images.forEach((img, k) => (files[`xl/media/image${n}_${k + 1}.${img.ext}`] = img.data));
  });
  return files;
}

// ---------- ZIP (método "stored", sem compressão) ----------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(files: Record<string, string | Uint8Array>, now = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const data = typeof content === "string" ? enc.encode(content) : content;
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // versão necessária
    lv.setUint16(6, 0x0800, true); // nomes em UTF-8
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // feito por
    cv.setUint16(6, 20, true); // versão necessária
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    // extra, comentário, disco, atributos: zero
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);

    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }

  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const out = new Uint8Array(offset + centralSize + end.length);
  let pos = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}

/** Gera um .xlsx com várias abas, estilos, mesclagens e fórmulas. */
export function buildWorkbook(sheets: WorkbookSheet[], now = new Date()): Uint8Array {
  return zip(packageFiles(sheets), now);
}

/** Atalho: uma aba simples com cabeçalho destacado, filtro e primeira linha congelada. */
export function buildXlsx(sheet: XlsxSheet, now = new Date()): Uint8Array {
  return buildWorkbook(
    [
      {
        name: sheet.name,
        widths: sheet.widths,
        freezeRows: 1,
        filterRow: 1,
        rows: [
          { cells: sheet.header.map((h) => ({ v: h, s: "header" as const })) },
          ...sheet.rows.map((cells) => ({ cells })),
        ],
      },
    ],
    now,
  );
}

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
