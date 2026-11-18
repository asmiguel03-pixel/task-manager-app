/**
 * Leitura de PDFs em que o texto virou desenho (contornos), como os gerados pelo
 * "Microsoft Print to PDF" a partir do navegador. Não há texto no arquivo: cada letra
 * é um preenchimento. Aqui os contornos são agrupados em caracteres, organizados em
 * linhas e reconhecidos por comparação com modelos de letras (pdf-outline-glyphs.ts).
 */
import type { PdfFill, TextItem } from "./pdf-text";

export interface Glyph {
  page: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  paths: number[][];
}

export interface GlyphRow {
  page: number;
  /** Linha de base (y, com o eixo para cima). */
  baseline: number;
  /** Altura das maiúsculas/algarismos da linha. */
  height: number;
  glyphs: Glyph[];
}

const bbox = (paths: number[][]) => {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of paths) {
    for (let i = 0; i < p.length; i += 2) {
      if (p[i] < x0) x0 = p[i];
      if (p[i] > x1) x1 = p[i];
      if (p[i + 1] < y0) y0 = p[i + 1];
      if (p[i + 1] > y1) y1 = p[i + 1];
    }
  }
  return { x0, y0, x1, y1 };
};

const merge = (a: Glyph, b: Glyph): Glyph => ({
  page: a.page,
  x0: Math.min(a.x0, b.x0),
  y0: Math.min(a.y0, b.y0),
  x1: Math.max(a.x1, b.x1),
  y1: Math.max(a.y1, b.y1),
  paths: [...a.paths, ...b.paths],
});

/** Partes que se sobrepõem na horizontal e estão coladas na vertical são o mesmo caractere. */
const sameChar = (a: Glyph, b: Glyph) => {
  const overlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  if (overlap <= 0.15 * Math.min(a.x1 - a.x0, b.x1 - b.x0)) return false;
  const gap = Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1);
  return gap <= 0.4 * Math.max(a.y1 - a.y0, b.y1 - b.y0, 1);
};

/** Agrupa os preenchimentos em caracteres e descarta linhas de tabela, fundos e molduras. */
export function fillsToGlyphs(fills: PdfFill[]): Glyph[] {
  const parts: Glyph[] = [];
  for (const fill of fills) {
    // Um preenchimento pode ter vários caracteres (contornos retos desenhados juntos).
    const pieces = fill.paths
      .map((p) => ({ page: fill.page, ...bbox([p]), paths: [p] }))
      .sort((a, b) => a.x0 - b.x0);
    const groups: Glyph[] = [];
    for (const piece of pieces) {
      const g = groups.find((x) => sameChar(x, piece));
      if (g) Object.assign(g, merge(g, piece));
      else groups.push(piece);
    }
    parts.push(...groups);
  }
  const text = parts.filter((g) => {
    const w = g.x1 - g.x0;
    const h = g.y1 - g.y0;
    if (w > 30 || h > 30) return false; // fundos, molduras, logotipos
    if (w > 12 && h < 1.5) return false; // linhas da tabela
    if (h > 12 && w < 1.5) return false;
    return w > 0.05 || h > 0.05;
  });

  // Pingos e acentos desenhados à parte vão para a letra mais próxima.
  const byPage = new Map<number, Glyph[]>();
  for (const g of text) byPage.set(g.page, [...(byPage.get(g.page) ?? []), g]);
  const out: Glyph[] = [];
  for (const list of byPage.values()) {
    list.sort((a, b) => a.x0 - b.x0);
    const alive = list.map(() => true);
    for (let i = 0; i < list.length; i++) {
      const small = list[i];
      const sh = small.y1 - small.y0;
      const sw = small.x1 - small.x0;
      if (!alive[i] || sh > 2.5 || sw > 3) continue;
      let best = -1;
      let bestGap = Infinity;
      for (let j = Math.max(0, i - 12); j < Math.min(list.length, i + 12); j++) {
        if (j === i || !alive[j]) continue;
        const o = list[j];
        const gap = Math.max(o.y0, small.y0) - Math.min(o.y1, small.y1);
        const oh = o.y1 - o.y0;
        const ow = o.x1 - o.x0;
        const xOverlap = Math.min(o.x1, small.x1) - Math.max(o.x0, small.x0);
        // Dois pontos empilhados (":" e ";"): peças pequenas, alinhadas e próximas.
        const stacked = oh <= 2.5 && ow <= 3 && xOverlap > 0.6 * Math.min(sw, ow) && gap > 0 && gap < 2.5 * Math.max(sh, oh, 0.8);
        if (!stacked && (oh <= sh * 1.2 || !sameChar(small, o))) continue;
        if (gap < bestGap) {
          bestGap = gap;
          best = j;
        }
      }
      if (best >= 0 && bestGap > 0) {
        list[best] = merge(list[best], small);
        alive[i] = false;
      }
    }
    out.push(...list.filter((_, i) => alive[i]));
  }
  return out;
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/**
 * Linhas de texto: liga caracteres vizinhos na horizontal cuja altura se sobrepõe
 * (vírgulas e hífens entram pela sobreposição). Cada coluna da tabela vira um trecho
 * próprio; toLines junta depois os trechos da mesma altura.
 */
export function glyphRows(glyphs: Glyph[]): GlyphRow[] {
  const sorted = [...glyphs].sort((a, b) => a.page - b.page || b.y1 - a.y1);
  const parent = sorted.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      if (b.page !== a.page || b.y1 < a.y0) break;
      const ha = a.y1 - a.y0;
      const hb = b.y1 - b.y0;
      const hGap = Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1);
      if (hGap > 1.5 * Math.max(ha, hb)) continue;
      const overlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      const minH = Math.max(Math.min(ha, hb), 0.3);
      // Peças pequenas (vírgula, hífen) só precisam encostar; letras precisam estar na mesma altura.
      const need = Math.min(ha, hb) < 0.5 * Math.max(ha, hb) ? 0.3 : 0.6;
      if (overlap >= need * minH) parent[find(j)] = find(i);
    }
  }
  const groups = new Map<number, Glyph[]>();
  sorted.forEach((g, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), g]));
  const rows: GlyphRow[] = [];
  for (const list of groups.values()) {
    const maxH = Math.max(...list.map((g) => g.y1 - g.y0));
    const tall = list.filter((g) => g.y1 - g.y0 >= 0.6 * maxH);
    rows.push({
      page: list[0].page,
      baseline: median(tall.map((g) => g.y0)),
      height: Math.max(median(tall.map((g) => g.y1 - g.y0)), 0.5),
      glyphs: list.sort((a, b) => a.x0 - b.x0),
    });
  }
  return rows.sort((a, b) => a.page - b.page || b.baseline - a.baseline);
}

// ---------- Reconhecimento ----------

export const GRID_W = 8;
export const GRID_H = 10;
const SUB = 3;

/** Cobertura (0–1) de cada célula da grade sobre a caixa do caractere (regra par-ímpar). */
function raster(g: Glyph): number[] {
  const w = Math.max(g.x1 - g.x0, 1e-3);
  const h = Math.max(g.y1 - g.y0, 1e-3);
  const out = new Array<number>(GRID_W * GRID_H).fill(0);
  const edges: [number, number, number, number][] = [];
  for (const p of g.paths) {
    for (let i = 0; i < p.length; i += 2) {
      const j = (i + 2) % p.length;
      edges.push([p[i], p[i + 1], p[j], p[j + 1]]);
    }
  }
  const total = GRID_H * SUB;
  for (let r = 0; r < total; r++) {
    const y = g.y1 - ((r + 0.5) / total) * h;
    const xs: number[] = [];
    for (const [ax, ay, bx, by] of edges) {
      if (ay > y === by > y) continue;
      xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let c = 0; c < GRID_W * SUB; c++) {
      const x = g.x0 + ((c + 0.5) / (GRID_W * SUB)) * w;
      let inside = false;
      for (const v of xs) {
        if (v > x) break;
        inside = !inside;
      }
      if (inside) out[Math.floor(r / SUB) * GRID_W + Math.floor(c / SUB)] += 1 / (SUB * SUB);
    }
  }
  return out;
}

/** Vetor de características: forma na grade + largura, altura e posição em relação à linha de base. */
export function glyphFeatures(g: Glyph, row: GlyphRow): number[] {
  const H = row.height;
  return [...raster(g), (g.x1 - g.x0) / H, (g.y1 - g.y0) / H, (g.y0 - row.baseline) / H];
}

export interface GlyphTemplate {
  ch: string;
  f: number[];
}

const METRIC_WEIGHT = 6;

export function featureDistance(a: number[], b: number[]): number {
  const n = GRID_W * GRID_H;
  let d = 0;
  for (let i = 0; i < n; i++) d += (a[i] - b[i]) ** 2;
  for (let i = n; i < a.length; i++) d += METRIC_WEIGHT * METRIC_WEIGHT * (a[i] - b[i]) ** 2;
  return d;
}

/** Acima disto o caractere é considerado desconhecido. */
const MAX_DISTANCE = 6;

export function classify(f: number[], templates: GlyphTemplate[]): { ch: string; distance: number } {
  let best = { ch: "?", distance: Infinity };
  for (const t of templates) {
    const d = featureDistance(f, t.f);
    if (d < best.distance) best = { ch: t.ch, distance: d };
  }
  return best.distance <= MAX_DISTANCE ? best : { ch: "?", distance: best.distance };
}

/**
 * Reconhece o texto desenhado e devolve trechos com posição, no mesmo formato de
 * readPdfText (cada trecho já é uma célula: palavras da mesma coluna juntas).
 */
export function outlineText(
  fills: PdfFill[],
  templates: GlyphTemplate[],
): { items: TextItem[]; glyphs: number; unknown: number } {
  const rows = glyphRows(fillsToGlyphs(fills));
  const items: TextItem[] = [];
  let count = 0;
  let unknown = 0;
  const cache = new Map<string, string>();
  for (const row of rows) {
    const H = row.height;
    let cell: { x: number; endX: number; text: string } | null = null;
    const flush = () => {
      if (cell && cell.text.trim()) {
        items.push({ page: row.page, x: cell.x, y: row.baseline, endX: cell.endX, size: H * 1.4, text: cell.text.trim() });
      }
      cell = null;
    };
    for (const g of row.glyphs) {
      const f = glyphFeatures(g, row);
      const key = f.map((v) => v.toFixed(2)).join(",");
      let ch = cache.get(key);
      if (ch === undefined) {
        ch = classify(f, templates).ch;
        cache.set(key, ch);
      }
      count++;
      if (ch === "?") unknown++;
      const c = cell as { x: number; endX: number; text: string } | null;
      const gap = c ? g.x0 - c.endX : Infinity;
      if (c && gap < 1.1 * H) {
        c.text += (gap > 0.3 * H ? " " : "") + ch;
        c.endX = Math.max(c.endX, g.x1);
      } else {
        flush();
        cell = { x: g.x0, endX: g.x1, text: ch };
      }
    }
    flush();
  }
  return { items, glyphs: count, unknown };
}
