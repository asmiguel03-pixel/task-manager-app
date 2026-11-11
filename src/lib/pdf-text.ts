/**
 * Extrator mínimo de texto de PDF, sem dependências, para relatórios gerados
 * por sistema (extratos bancários etc.) com fontes padrão (Helvetica/Courier,
 * codificação WinAnsi). Lê objetos comprimidos (ObjStm), páginas e formulários,
 * e devolve cada trecho de texto com sua posição na página.
 */

export interface TextItem {
  page: number;
  x: number;
  y: number;
  text: string;
}

export interface TextLine {
  page: number;
  y: number;
  items: { x: number; text: string }[];
  /** Trechos da linha juntados por espaço, da esquerda para a direita. */
  text: string;
}

// ---------- Decodificação ----------

const latin1 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return s;
};

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  for (const format of ["deflate", "deflate-raw"] as const) {
    try {
      const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream(format));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      // tenta o próximo formato
    }
  }
  throw new Error("Não foi possível descompactar o PDF.");
}

// WinAnsiEncoding: 0x80–0x9F diferem do Latin-1.
const WIN_ANSI_HIGH: Record<number, string> = {
  0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…", 0x86: "†", 0x87: "‡", 0x88: "ˆ", 0x89: "‰",
  0x8a: "Š", 0x8b: "‹", 0x8c: "Œ", 0x8e: "Ž", 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•",
  0x96: "–", 0x97: "—", 0x98: "˜", 0x99: "™", 0x9a: "š", 0x9b: "›", 0x9c: "œ", 0x9e: "ž", 0x9f: "Ÿ",
};
const winAnsi = (code: number) => WIN_ANSI_HIGH[code] ?? String.fromCharCode(code);

// ---------- Objetos ----------

interface PdfObject {
  dict: string;
  stream?: Uint8Array;
}

/** Valor bruto de uma chave no dicionário (até a próxima chave de mesmo nível). */
function dictValue(dict: string, key: string): string | undefined {
  const i = dict.search(new RegExp(`/${key}(?=[\\s/\\[<(]|$)`));
  if (i < 0) return undefined;
  let j = i + key.length + 1;
  while (dict[j] === " " || dict[j] === "\n" || dict[j] === "\r") j++;
  const start = j;
  if (dict[j] === "[" || dict.startsWith("<<", j)) {
    const open = dict[j] === "[" ? "[" : "<<";
    const close = open === "[" ? "]" : ">>";
    let depth = 0;
    while (j < dict.length) {
      if (dict.startsWith(open, j)) {
        depth++;
        j += open.length;
      } else if (dict.startsWith(close, j)) {
        depth--;
        j += close.length;
        if (!depth) break;
      } else j++;
    }
    return dict.slice(start, j);
  }
  const m = /^(\d+\s+\d+\s+R|\/[^\s/\[\]<>()]+|[^\s/\[\]<>()]+)/.exec(dict.slice(j));
  return m?.[1];
}

const refs = (value: string | undefined) => [...(value ?? "").matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1]));

async function readObjects(bytes: Uint8Array): Promise<Map<number, PdfObject>> {
  const text = latin1(bytes);
  const objects = new Map<number, PdfObject>();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const num = Number(m[1]);
    const bodyStart = m.index + m[0].length;
    const end = text.indexOf("endobj", bodyStart);
    if (end < 0) break;
    const body = text.slice(bodyStart, end);
    const s = body.search(/stream\r?\n/);
    if (s >= 0 && body.slice(0, s).includes("<<")) {
      const dict = body.slice(0, s).trim();
      const headerLen = body.slice(s).startsWith("stream\r\n") ? 8 : 7;
      const dataStart = bodyStart + s + headerLen;
      const declared = Number(dictValue(dict, "Length"));
      const endStream = text.indexOf("endstream", dataStart);
      const len = Number.isFinite(declared) && declared > 0 && dataStart + declared <= endStream ? declared : endStream - dataStart;
      objects.set(num, { dict, stream: bytes.subarray(dataStart, dataStart + len) });
    } else {
      objects.set(num, { dict: body.trim() });
    }
    re.lastIndex = end;
  }

  // Objetos guardados dentro de object streams (PDF 1.5+).
  for (const obj of [...objects.values()]) {
    if (!obj.stream || !/\/Type\s*\/ObjStm/.test(obj.dict)) continue;
    const data = latin1(/FlateDecode/.test(obj.dict) ? await inflate(obj.stream) : obj.stream);
    const n = Number(dictValue(obj.dict, "N"));
    const first = Number(dictValue(obj.dict, "First"));
    const header = data.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < n; i++) {
      const num = header[i * 2];
      const off = first + header[i * 2 + 1];
      const next = i + 1 < n ? first + header[(i + 1) * 2 + 1] : data.length;
      if (!objects.has(num)) objects.set(num, { dict: data.slice(off, next).trim() });
    }
  }
  return objects;
}

async function streamData(obj: PdfObject): Promise<Uint8Array> {
  if (!obj.stream) return new Uint8Array();
  const filter = dictValue(obj.dict, "Filter") ?? "";
  if (/DCTDecode|JPX|CCITT|JBIG2/.test(filter)) return new Uint8Array();
  return /FlateDecode/.test(filter) ? inflate(obj.stream) : obj.stream;
}

// ---------- Conteúdo da página ----------

type Matrix = [number, number, number, number, number, number];
const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

type Token = { t: "num"; v: number } | { t: "str"; v: string } | { t: "op"; v: string } | { t: "arr"; v: Token[] } | { t: "name"; v: string };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  const stack: Token[][] = [out];
  let i = 0;
  const push = (tok: Token) => stack[stack.length - 1].push(tok);
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
    } else if (c === "%") {
      while (i < src.length && src[i] !== "\n" && src[i] !== "\r") i++;
    } else if (c === "(") {
      let depth = 1;
      let s = "";
      i++;
      while (i < src.length && depth) {
        const ch = src[i];
        if (ch === "\\") {
          const nx = src[i + 1];
          const esc: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" };
          if (nx in esc) {
            s += esc[nx];
            i += 2;
          } else if (/[0-7]/.test(nx)) {
            const oct = /^[0-7]{1,3}/.exec(src.slice(i + 1))![0];
            s += String.fromCharCode(parseInt(oct, 8));
            i += 1 + oct.length;
          } else if (nx === "\r" || nx === "\n") {
            i += nx === "\r" && src[i + 2] === "\n" ? 3 : 2;
          } else {
            s += nx ?? "";
            i += 2;
          }
          continue;
        }
        if (ch === "(") depth++;
        if (ch === ")" && --depth === 0) {
          i++;
          break;
        }
        s += ch;
        i++;
      }
      push({ t: "str", v: s });
    } else if (c === "<" && src[i + 1] !== "<") {
      const end = src.indexOf(">", i);
      const hex = src.slice(i + 1, end).replace(/\s/g, "");
      let s = "";
      for (let k = 0; k < hex.length; k += 2) s += String.fromCharCode(parseInt(hex.slice(k, k + 2).padEnd(2, "0"), 16));
      push({ t: "str", v: s });
      i = end + 1;
    } else if (c === "[") {
      const arr: Token[] = [];
      push({ t: "arr", v: arr });
      stack.push(arr);
      i++;
    } else if (c === "]") {
      if (stack.length > 1) stack.pop();
      i++;
    } else if (c === "<" || c === ">") {
      // dicionários inline (<< >>): ignorados
      i += src[i + 1] === c ? 2 : 1;
    } else if (c === "/") {
      const m = /^\/[^\s/\[\]<>()%{}]*/.exec(src.slice(i))!;
      push({ t: "name", v: m[0].slice(1) });
      i += m[0].length;
    } else {
      const m = /^[^\s/\[\]<>()%{}]+/.exec(src.slice(i));
      if (!m) {
        i++;
        continue;
      }
      const word = m[0];
      const n = Number(word);
      push(Number.isFinite(n) && /^[+-]?(\d+\.?\d*|\.\d+)$/.test(word) ? { t: "num", v: n } : { t: "op", v: word });
      i += word.length;
      if (word === "BI") {
        // imagem inline: pula até EI
        const ei = src.indexOf("EI", i);
        i = ei < 0 ? src.length : ei + 2;
      }
    }
  }
  return out;
}

async function contentText(
  content: string,
  page: number,
  ctm0: Matrix,
  resources: string,
  objects: Map<number, PdfObject>,
  out: TextItem[],
  depth = 0,
): Promise<void> {
  const tokens = tokenize(content);
  let ctm = ctm0;
  const gstack: Matrix[] = [];
  let tm: Matrix = IDENTITY;
  let tlm: Matrix = IDENTITY;
  let leading = 0;
  let fontSize = 10;
  const args: Token[] = [];
  const num = (k: number) => {
    const t = args[args.length - k];
    return t && t.t === "num" ? t.v : 0;
  };
  const emit = (s: string) => {
    const text = [...s].map((ch) => winAnsi(ch.charCodeAt(0))).join("");
    if (!text.trim()) return;
    const m = multiply(tm, ctm);
    out.push({ page, x: m[4], y: m[5], text });
  };
  const xobjects = (() => {
    const v = dictValue(resources, "XObject");
    if (!v) return new Map<string, number>();
    const inner = v.startsWith("<<") ? v : objects.get(refs(v)[0])?.dict ?? "";
    return new Map([...inner.matchAll(/\/([^\s/]+)\s+(\d+)\s+\d+\s+R/g)].map((m) => [m[1], Number(m[2])]));
  })();

  for (const tok of tokens) {
    if (tok.t !== "op") {
      args.push(tok);
      continue;
    }
    switch (tok.v) {
      case "q":
        gstack.push(ctm);
        break;
      case "Q":
        ctm = gstack.pop() ?? ctm0;
        break;
      case "cm":
        ctm = multiply([num(6), num(5), num(4), num(3), num(2), num(1)], ctm);
        break;
      case "BT":
        tm = IDENTITY;
        tlm = IDENTITY;
        break;
      case "Tf":
        fontSize = num(1) || fontSize;
        break;
      case "TL":
        leading = num(1);
        break;
      case "Td":
        tlm = multiply([1, 0, 0, 1, num(2), num(1)], tlm);
        tm = tlm;
        break;
      case "TD":
        leading = -num(1);
        tlm = multiply([1, 0, 0, 1, num(2), num(1)], tlm);
        tm = tlm;
        break;
      case "Tm":
        tlm = [num(6), num(5), num(4), num(3), num(2), num(1)];
        tm = tlm;
        break;
      case "T*":
        tlm = multiply([1, 0, 0, 1, 0, -leading], tlm);
        tm = tlm;
        break;
      case "Tj": {
        const s = args[args.length - 1];
        if (s?.t === "str") emit(s.v);
        break;
      }
      case "'":
      case '"': {
        tlm = multiply([1, 0, 0, 1, 0, -leading], tlm);
        tm = tlm;
        const s = args[args.length - 1];
        if (s?.t === "str") emit(s.v);
        break;
      }
      case "TJ": {
        const arr = args[args.length - 1];
        if (arr?.t === "arr") {
          let s = "";
          for (const part of arr.v) {
            if (part.t === "str") s += part.v;
            // Ajuste grande de espaçamento costuma ser um espaço entre palavras.
            else if (part.t === "num" && part.v < -(fontSize > 0 ? 200 : 200)) s += " ";
          }
          emit(s);
        }
        break;
      }
      case "Do": {
        const name = args[args.length - 1];
        if (depth < 5 && name?.t === "name") {
          const id = xobjects.get(name.v);
          const xo = id !== undefined ? objects.get(id) : undefined;
          if (xo && /\/Subtype\s*\/Form/.test(xo.dict)) {
            const mx = dictValue(xo.dict, "Matrix");
            const nums = mx ? mx.replace(/[[\]]/g, "").trim().split(/\s+/).map(Number) : [];
            const formMatrix: Matrix = nums.length === 6 ? (nums as Matrix) : IDENTITY;
            const res = dictValue(xo.dict, "Resources") ?? resources;
            const resDict = res.startsWith("<<") ? res : objects.get(refs(res)[0])?.dict ?? resources;
            await contentText(latin1(await streamData(xo)), page, multiply(formMatrix, ctm), resDict, objects, out, depth + 1);
          }
        }
        break;
      }
    }
    args.length = 0;
  }
}

/** Extrai os trechos de texto de todas as páginas, com posição. */
export async function readPdfText(bytes: Uint8Array): Promise<TextItem[]> {
  if (latin1(bytes.subarray(0, 5)) !== "%PDF-") throw new Error("O arquivo não é um PDF.");
  const objects = await readObjects(bytes);
  if ([...objects.values()].some((o) => /\/Encrypt\b/.test(o.dict) && /\/Type\s*\/XRef|trailer/.test(o.dict))) {
    throw new Error("PDF protegido por senha: abra e salve uma cópia sem proteção.");
  }

  // Páginas na ordem da árvore /Pages.
  const catalog = [...objects.values()].find((o) => /\/Type\s*\/Catalog/.test(o.dict));
  const pages: PdfObject[] = [];
  const walk = (id: number, inherited: string, guard = 0) => {
    const node = objects.get(id);
    if (!node || guard > 50) return;
    const res = dictValue(node.dict, "Resources") ?? inherited;
    if (/\/Type\s*\/Pages/.test(node.dict)) {
      for (const kid of refs(dictValue(node.dict, "Kids"))) walk(kid, res, guard + 1);
    } else if (/\/Type\s*\/Page\b/.test(node.dict)) {
      pages.push({ dict: dictValue(node.dict, "Resources") ? node.dict : `${node.dict} /Resources ${inherited}` });
    }
  };
  const root = catalog ? refs(dictValue(catalog.dict, "Pages"))[0] : undefined;
  if (root !== undefined) walk(root, "");
  if (!pages.length) {
    for (const o of objects.values()) if (/\/Type\s*\/Page\b/.test(o.dict)) pages.push(o);
  }

  const out: TextItem[] = [];
  for (const [i, page] of pages.entries()) {
    const contents = refs(dictValue(page.dict, "Contents"));
    let content = "";
    for (const id of contents) {
      const obj = objects.get(id);
      if (obj) content += `${latin1(await streamData(obj))}\n`;
    }
    const res = dictValue(page.dict, "Resources") ?? "";
    const resDict = res.startsWith("<<") ? res : objects.get(refs(res)[0])?.dict ?? "";
    await contentText(content, i + 1, IDENTITY, resDict, objects, out);
  }
  return out;
}

/** Agrupa os trechos em linhas (mesma página e mesma altura), de cima para baixo. */
export function toLines(items: TextItem[], tolerance = 2): TextLine[] {
  const sorted = [...items].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const lines: TextLine[] = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && last.page === it.page && Math.abs(last.y - it.y) <= tolerance) last.items.push({ x: it.x, text: it.text });
    else lines.push({ page: it.page, y: it.y, items: [{ x: it.x, text: it.text }], text: "" });
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    l.text = l.items.map((i) => i.text.trim()).filter(Boolean).join(" ");
  }
  return lines;
}
