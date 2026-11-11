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
  /** Fim estimado do trecho (x + largura). */
  endX: number;
  /** Tamanho efetivo da fonte (para medir espaços). */
  size: number;
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

// ---------- Fontes (ToUnicode / codificação) ----------

/** Converte os bytes de uma string do PDF em texto e mede a largura (em 1/1000 do tamanho da fonte). */
interface Font {
  decode: (bytes: string) => string;
  /** Larguras de cada código da string, em milésimos do tamanho da fonte. */
  widths: (bytes: string) => number[];
  /** Quantos bytes por código. */
  codeBytes: number;
}

const fromUtf16Hex = (hex: string) => {
  let out = "";
  for (let i = 0; i + 3 < hex.length; i += 4) out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
  return out;
};

/** Lê um CMap ToUnicode (bfchar / bfrange). */
function parseToUnicode(cmap: string): { map: Map<number, string>; bytes: number } {
  const map = new Map<number, string>();
  let bytes = 1;
  const cs = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(cmap);
  if (cs) {
    const first = /<([0-9a-fA-F]+)>/.exec(cs[1]);
    if (first) bytes = Math.max(1, first[1].length / 2);
  }
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) {
      map.set(parseInt(m[1], 16), fromUtf16Hex(m[2]));
      bytes = Math.max(bytes, m[1].length / 2);
    }
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g)) {
      const lo = parseInt(m[1], 16);
      const hi = parseInt(m[2], 16);
      bytes = Math.max(bytes, m[1].length / 2);
      if (hi - lo > 65535) continue;
      if (m[3].startsWith("[")) {
        const list = [...m[3].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => fromUtf16Hex(x[1]));
        list.forEach((u, k) => map.set(lo + k, u));
      } else {
        const base = m[3].slice(1, -1);
        const head = base.slice(0, -4);
        const last = parseInt(base.slice(-4) || "0", 16);
        for (let c = lo; c <= hi; c++) map.set(c, fromUtf16Hex(head + (last + c - lo).toString(16).padStart(4, "0")));
      }
    }
  }
  return { map, bytes };
}

// Nomes de glifo mais comuns em /Differences (letras acentuadas do português).
const GLYPHS: Record<string, string> = {
  space: " ", period: ".", comma: ",", hyphen: "-", minus: "-", slash: "/", colon: ":", semicolon: ";",
  parenleft: "(", parenright: ")", percent: "%", ampersand: "&", plus: "+", asterisk: "*", numbersign: "#",
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9",
  aacute: "á", agrave: "à", acircumflex: "â", atilde: "ã", eacute: "é", ecircumflex: "ê", iacute: "í",
  oacute: "ó", ocircumflex: "ô", otilde: "õ", uacute: "ú", ccedilla: "ç", Aacute: "Á", Agrave: "À",
  Acircumflex: "Â", Atilde: "Ã", Eacute: "É", Ecircumflex: "Ê", Iacute: "Í", Oacute: "Ó", Ocircumflex: "Ô",
  Otilde: "Õ", Uacute: "Ú", Ccedilla: "Ç", ordfeminine: "ª", ordmasculine: "º", degree: "°",
};
const glyphChar = (name: string) =>
  GLYPHS[name] ?? (/^[A-Za-z]$/.test(name) ? name : /^uni([0-9A-F]{4})$/.exec(name) ? String.fromCharCode(parseInt(name.slice(3), 16)) : "");

const DEFAULT_WIDTH = 550;
const winAnsiFont: Font = {
  decode: (s) => [...s].map((ch) => winAnsi(ch.charCodeAt(0))).join(""),
  widths: (s) => [...s].map((ch) => (ch === " " ? 278 : DEFAULT_WIDTH)),
  codeBytes: 1,
};

const numbers = (v: string | undefined) => (v ?? "").replace(/[[\]]/g, " ").trim().split(/\s+/).filter(Boolean).map(Number);

/** Resolve um valor que pode ser uma referência a um objeto (ex.: /Widths 12 0 R). */
const resolve = (v: string | undefined, objects: Map<number, PdfObject>) =>
  v && /^\d+\s+\d+\s+R$/.test(v.trim()) ? objects.get(refs(v)[0])?.dict : v;

/** Larguras por código: fontes simples (/FirstChar + /Widths) e CID (/W, /DW). */
function widthTable(font: PdfObject, objects: Map<number, PdfObject>): (code: number) => number {
  const type0 = /\/Subtype\s*\/Type0/.test(font.dict);
  if (type0) {
    const desc = objects.get(refs(dictValue(font.dict, "DescendantFonts"))[0]);
    const dw = Number(dictValue(desc?.dict ?? "", "DW")) || 1000;
    const table = new Map<number, number>();
    const w = resolve(dictValue(desc?.dict ?? "", "W"), objects) ?? "";
    // Formato: c [w1 w2 ...]  ou  c1 c2 w
    const tokens = [...w.matchAll(/\[[^\]]*\]|-?\d+(?:\.\d+)?/g)].map((m) => m[0]);
    for (let i = 0; i < tokens.length; ) {
      const c = Number(tokens[i]);
      if (tokens[i + 1]?.startsWith("[")) {
        numbers(tokens[i + 1]).forEach((wd, k) => table.set(c + k, wd));
        i += 2;
      } else {
        const c2 = Number(tokens[i + 1]);
        const wd = Number(tokens[i + 2]);
        if (c2 - c < 65536) for (let k = c; k <= c2; k++) table.set(k, wd);
        i += 3;
      }
    }
    return (code) => table.get(code) ?? dw;
  }
  const first = Number(dictValue(font.dict, "FirstChar")) || 0;
  const widths = numbers(resolve(dictValue(font.dict, "Widths"), objects));
  // Type3: larguras no espaço do glifo, escaladas pela /FontMatrix.
  const fm = numbers(dictValue(font.dict, "FontMatrix"));
  const scale = /\/Subtype\s*\/Type3/.test(font.dict) && fm.length === 6 ? fm[0] * 1000 : 1;
  return (code) => {
    const w = widths[code - first];
    return w !== undefined && Number.isFinite(w) ? w * scale : code === 32 ? 278 : DEFAULT_WIDTH;
  };
}

async function loadFont(font: PdfObject | undefined, objects: Map<number, PdfObject>): Promise<Font> {
  if (!font) return winAnsiFont;
  const type0 = /\/Subtype\s*\/Type0/.test(font.dict);
  const widthOf = widthTable(font, objects);
  const tu = refs(dictValue(font.dict, "ToUnicode"))[0];
  const tuObj = tu !== undefined ? objects.get(tu) : undefined;
  let map: Map<number, string> | undefined;
  let codeBytes = type0 ? 2 : 1;
  if (tuObj?.stream) {
    const parsed = parseToUnicode(latin1(await streamData(tuObj)));
    map = parsed.map;
    codeBytes = type0 ? Math.max(2, parsed.bytes) : parsed.bytes;
  }
  const codes = (s: string) => {
    const out: number[] = [];
    for (let i = 0; i + codeBytes <= s.length; i += codeBytes) {
      let code = 0;
      for (let k = 0; k < codeBytes; k++) code = code * 256 + s.charCodeAt(i + k);
      out.push(code);
    }
    return out;
  };
  // Fonte simples sem ToUnicode: WinAnsi + /Differences.
  const diffs = new Map<number, string>();
  if (!map && !type0) {
    const enc = dictValue(font.dict, "Encoding");
    const encDict = enc?.startsWith("<<") ? enc : enc && /\d+\s+\d+\s+R/.test(enc) ? objects.get(refs(enc)[0])?.dict : undefined;
    const d = encDict ? dictValue(encDict, "Differences") : undefined;
    if (d) {
      let code = 0;
      for (const tok of d.replace(/[[\]]/g, " ").trim().split(/\s+|(?=\/)/)) {
        if (/^\d+$/.test(tok)) code = Number(tok);
        else if (tok.startsWith("/")) {
          const ch = glyphChar(tok.slice(1));
          if (ch) diffs.set(code, ch);
          code++;
        }
      }
    }
  }
  return {
    codeBytes,
    decode: (s) =>
      codes(s)
        .map((c) => (map ? map.get(c) ?? (codeBytes === 1 ? winAnsi(c) : "") : type0 ? "" : diffs.get(c) ?? winAnsi(c)))
        .join(""),
    widths: (s) => codes(s).map(widthOf),
  };
}

async function fontsOf(resources: string, objects: Map<number, PdfObject>): Promise<Map<string, Font>> {
  const v = dictValue(resources, "Font");
  const map = new Map<string, Font>();
  if (!v) return map;
  const inner = v.startsWith("<<") ? v : objects.get(refs(v)[0])?.dict ?? "";
  for (const m of inner.matchAll(/\/([^\s/<>[\]]+)\s+(\d+)\s+\d+\s+R/g)) {
    map.set(m[1], await loadFont(objects.get(Number(m[2])), objects));
  }
  return map;
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
  const fonts = await fontsOf(resources, objects);
  let font: Font = winAnsiFont;
  let charSpacing = 0;
  let wordSpacing = 0;
  let hScale = 1;
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
  /** Mostra uma string: registra o trecho e avança a posição do texto. */
  const show = (s: string) => {
    const text = font.decode(s);
    const widths = font.widths(s);
    let advance = 0;
    const isSpace = font.codeBytes === 1 ? [...s].map((c) => c === " ") : widths.map(() => false);
    widths.forEach((w, k) => {
      advance += ((w / 1000) * fontSize + charSpacing + (isSpace[k] ? wordSpacing : 0)) * hScale;
    });
    const m = multiply(tm, ctm);
    const scaleX = Math.hypot(m[0], m[1]) || 1;
    const size = fontSize * (Math.hypot(m[2], m[3]) || 1);
    if (text.trim()) {
      out.push({ page, x: m[4], y: m[5], endX: m[4] + advance * scaleX, size, text });
    }
    tm = multiply([1, 0, 0, 1, advance, 0], tm);
  };
  const shift = (thousandths: number) => {
    tm = multiply([1, 0, 0, 1, (-thousandths / 1000) * fontSize * hScale, 0], tm);
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
      case "Tf": {
        fontSize = num(1) || fontSize;
        const name = args[args.length - 2];
        if (name?.t === "name") font = fonts.get(name.v) ?? winAnsiFont;
        break;
      }
      case "Tc":
        charSpacing = num(1);
        break;
      case "Tw":
        wordSpacing = num(1);
        break;
      case "Tz":
        hScale = num(1) / 100 || 1;
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
        if (s?.t === "str") show(s.v);
        break;
      }
      case "'":
      case '"': {
        tlm = multiply([1, 0, 0, 1, 0, -leading], tlm);
        tm = tlm;
        const s = args[args.length - 1];
        if (s?.t === "str") show(s.v);
        break;
      }
      case "TJ": {
        const arr = args[args.length - 1];
        if (arr?.t === "arr") {
          for (const part of arr.v) {
            if (part.t === "str") show(part.v);
            else if (part.t === "num") shift(part.v);
          }
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

/**
 * Agrupa os trechos em linhas (mesma página e mesma altura), de cima para baixo,
 * e junta letras/pedaços vizinhos em células: espaço pequeno vira espaço entre
 * palavras; espaço grande separa colunas.
 */
export function toLines(items: TextItem[], tolerance = 2): TextLine[] {
  const sorted = [...items].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const rows: { page: number; y: number; items: TextItem[] }[] = [];
  for (const it of sorted) {
    const last = rows[rows.length - 1];
    if (last && last.page === it.page && Math.abs(last.y - it.y) <= tolerance) last.items.push(it);
    else rows.push({ page: it.page, y: it.y, items: [it] });
  }
  return rows.map((row) => {
    const cells: { x: number; endX: number; size: number; text: string; lastLen: number }[] = [];
    for (const it of [...row.items].sort((a, b) => a.x - b.x)) {
      const cell = cells[cells.length - 1];
      const size = Math.max(it.size, 1);
      const gap = cell ? it.x - cell.endX : Infinity;
      // Junta só fragmentos (letras soltas, como em PDFs gerados por navegador)
      // ou pedaços praticamente encostados; trechos inteiros próximos são colunas.
      const fragment = it.text.trim().length <= 2 || (cell?.lastLen ?? 99) <= 2;
      if (cell && gap <= 0.45 * size && (fragment || gap <= 0.12 * size)) {
        cell.text += (gap > 0.2 * size ? " " : "") + it.text;
        cell.endX = Math.max(cell.endX, it.endX);
        cell.lastLen = it.text.trim().length;
      } else {
        cells.push({ x: it.x, endX: it.endX, size, text: it.text, lastLen: it.text.trim().length });
      }
    }
    const lineItems = cells.map((c) => ({ x: c.x, text: c.text.replace(/\s+/g, " ").trim() })).filter((c) => c.text);
    return { page: row.page, y: row.y, items: lineItems, text: lineItems.map((c) => c.text).join(" ") };
  });
}
