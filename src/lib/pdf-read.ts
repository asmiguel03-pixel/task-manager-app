/**
 * Lê as linhas de um PDF: primeiro pelo texto do arquivo; se não houver texto
 * (PDF "impresso" em que as letras viraram desenho), reconhece as letras pelos contornos.
 */
import { readPdfShapes, readPdfText, toLines, type TextLine } from "./pdf-text";

export interface PdfLines {
  lines: TextLine[];
  /** true quando o texto foi reconhecido pelo desenho das letras. */
  fromOutlines: boolean;
}

/** Fração máxima de letras não reconhecidas para aceitar a leitura pelos contornos. */
const MAX_UNKNOWN = 0.15;

export async function readPdfLines(bytes: Uint8Array): Promise<PdfLines> {
  const lines = toLines(await readPdfText(bytes));
  if (lines.length) return { lines, fromOutlines: false };

  const fills = await readPdfShapes(bytes);
  if (fills.length) {
    // Carregados só quando precisa (os modelos de letras ocupam algumas dezenas de KB).
    const [{ outlineText }, { OUTLINE_TEMPLATES }] = await Promise.all([import("./pdf-outline"), import("./pdf-outline-glyphs")]);
    const r = outlineText(fills, OUTLINE_TEMPLATES);
    if (r.glyphs && r.unknown / r.glyphs <= MAX_UNKNOWN) return { lines: toLines(r.items), fromOutlines: true };
  }
  return { lines: [], fromOutlines: false };
}
