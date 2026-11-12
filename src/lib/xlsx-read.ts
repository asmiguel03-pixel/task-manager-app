/**
 * Leitor mínimo de .xlsx (sem dependências): abre o ZIP com a API nativa
 * `DecompressionStream` e extrai os valores das células de cada aba.
 * Fórmulas retornam o último valor calculado salvo pelo Excel.
 */

export type CellValue = string | number | boolean;

export interface ReadSheet {
  name: string;
  hidden: boolean;
  /** Linhas (1-based) → colunas (0-based) → valor. */
  rows: Map<number, Map<number, CellValue>>;
}

// ---------- ZIP ----------

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(
  bytes: Uint8Array,
  // Abas em xl/worksheets/ ou soltas em xl/ (exportações do SAP gravam assim).
  wanted: RegExp = /^(xl\/(workbook\.xml|sharedStrings\.xml|worksheets\/[^/]+\.xml|(?!styles)[^/]+\.xml|_rels\/workbook\.xml\.rels))$/,
): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("O arquivo não parece ser uma planilha .xlsx.");
  const count = view.getUint16(eocd + 10, true);
  let pos = view.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const files = new Map<string, Uint8Array>();

  for (let n = 0; n < count; n++) {
    if (view.getUint32(pos, true) !== 0x02014b50) throw new Error("Planilha corrompida.");
    const method = view.getUint16(pos + 10, true);
    const size = view.getUint32(pos + 20, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const local = view.getUint32(pos + 42, true);
    // Alguns sistemas (ex.: exportação do SAP) gravam o caminho com "\\".
    const name = dec.decode(bytes.subarray(pos + 46, pos + 46 + nameLen)).replace(/\\/g, "/");
    pos += 46 + nameLen + extraLen + commentLen;

    if (!wanted.test(name)) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + size);
    if (method === 0) files.set(name, raw);
    else if (method === 8) files.set(name, await inflateRaw(raw));
    else throw new Error("Formato de compressão não suportado.");
  }
  return files;
}

// ---------- XML ----------

const decodeXml = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? decodeXml(m[1]) : undefined;
};

/** Junta os trechos <t> de um <si>/<is> (texto com formatação vem em vários <r>). */
const textRuns = (xml: string) =>
  [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)]
    .map((m) => {
      const raw = m[1] ?? "";
      // Alguns sistemas gravam o texto como <![CDATA[...]]> (sem escapar nada).
      const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(raw.trim());
      return cdata ? cdata[1] : decodeXml(raw);
    })
    .join("");

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseSheet(xml: string, shared: string[]): ReadSheet["rows"] {
  const rows: ReadSheet["rows"] = new Map();
  const data = /<sheetData[^>]*>([\s\S]*?)<\/sheetData>/.exec(xml)?.[1] ?? "";
  for (const row of data.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const r = Number(attr(row[1], "r"));
    const cells = new Map<number, CellValue>();
    for (const c of row[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(c[1], "r") ?? "";
      const type = attr(c[1], "t");
      const body = c[2] ?? "";
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value: CellValue | undefined;
      if (type === "s" && v !== undefined) value = shared[Number(v)];
      else if (type === "inlineStr") value = textRuns(body);
      else if (type === "str" || type === "e") value = v !== undefined ? decodeXml(v) : undefined;
      else if (type === "b") value = v === "1";
      else if (v !== undefined && v !== "") value = Number(v);
      if (value !== undefined && !(typeof value === "string" && !value.trim()) && !(typeof value === "number" && Number.isNaN(value))) {
        cells.set(columnIndex(ref), value);
      }
    }
    if (cells.size) rows.set(r, cells);
  }
  return rows;
}

export async function readXlsx(bytes: Uint8Array): Promise<ReadSheet[]> {
  const files = await unzip(bytes);
  const dec = new TextDecoder();
  const get = (name: string) => {
    const f = files.get(name);
    return f ? dec.decode(f) : "";
  };

  const shared = [...get("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textRuns(m[1]));
  const rels = new Map(
    [...get("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b([^>]*)\/?>/g)].map((m) => [
      attr(m[1], "Id") ?? "",
      (attr(m[1], "Target") ?? "").replace(/^\/?(xl\/)?/, ""),
    ]),
  );

  return [...get("xl/workbook.xml").matchAll(/<sheet\b([^>]*)\/?>/g)].map((m) => {
    const target = rels.get(attr(m[1], "r:id") ?? "") ?? "";
    return {
      name: attr(m[1], "name") ?? "",
      hidden: (attr(m[1], "state") ?? "visible") !== "visible",
      rows: parseSheet(get(`xl/${target}`), shared),
    };
  });
}

// ---------- Imagens da capa ----------

export interface SheetImage {
  data: Uint8Array;
  ext: string;
  /** Coluna (0-based) onde a imagem começa: serve para saber o que fica à esquerda. */
  col: number;
}

/** Imagens (logos) da aba de capa de uma planilha: a aba "CAPA" ou, sem ela, a primeira visível. */
export async function readCoverImages(bytes: Uint8Array): Promise<SheetImage[]> {
  const files = await unzip(bytes, /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|worksheets\/_rels\/.*|drawings\/.*|media\/.*)$/);
  const text = (name: string) => {
    const f = files.get(name);
    return f ? new TextDecoder().decode(f) : "";
  };
  const resolve = (base: string, target: string) => {
    if (target.startsWith("/")) return target.slice(1);
    const parts = base.split("/").slice(0, -1);
    for (const seg of target.split("/")) {
      if (seg === "..") parts.pop();
      else if (seg !== ".") parts.push(seg);
    }
    return parts.join("/");
  };
  const rels = (xml: string) =>
    new Map([...xml.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attr(m[0], "Id") ?? "", attr(m[0], "Target") ?? ""]));

  const sheets = [...text("xl/workbook.xml").matchAll(/<sheet\b[^>]*>/g)].map((m) => ({
    name: attr(m[0], "name") ?? "",
    hidden: !!attr(m[0], "state") && attr(m[0], "state") !== "visible",
    id: attr(m[0], "r:id") ?? "",
  }));
  const cover = sheets.find((s) => /^capa$/i.test(s.name.trim())) ?? sheets.find((s) => !s.hidden);
  if (!cover) return [];
  const sheetPath = resolve("xl/workbook.xml", rels(text("xl/_rels/workbook.xml.rels")).get(cover.id) ?? "");
  const sheetRels = rels(text(sheetPath.replace(/([^/]+)$/, "_rels/$1.rels")));
  const drawingTarget = [...sheetRels.values()].find((t) => /drawings\//.test(t));
  if (!drawingTarget) return [];
  const drawingPath = resolve(sheetPath, drawingTarget);
  const drawingRels = rels(text(drawingPath.replace(/([^/]+)$/, "_rels/$1.rels")));
  const images: SheetImage[] = [];
  for (const anchor of text(drawingPath).matchAll(/<xdr:(?:twoCellAnchor|oneCellAnchor|absoluteAnchor)\b[\s\S]*?<\/xdr:(?:twoCellAnchor|oneCellAnchor|absoluteAnchor)>/g)) {
    const embed = /r:embed="([^"]+)"/.exec(anchor[0])?.[1];
    if (!embed) continue;
    const path = resolve(drawingPath, drawingRels.get(embed) ?? "");
    const data = files.get(path);
    if (!data) continue;
    const col = Number(/<xdr:col>(\d+)<\/xdr:col>/.exec(anchor[0])?.[1] ?? 0);
    images.push({ data, ext: (/\.(\w+)$/.exec(path)?.[1] ?? "png").toLowerCase(), col });
  }
  return images.sort((a, b) => a.col - b.col);
}
