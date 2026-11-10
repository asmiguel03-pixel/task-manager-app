import { MONTH_NAMES } from "./payment-domain";
import type { PaymentInput, PaymentSheet, PaymentStatus } from "./payment-schema";
import type { CellValue, ReadSheet } from "./xlsx-read";

/** Uma aba da planilha reconhecida como um mês de controle. */
export interface ImportedMonth {
  tab: string;
  month: string; // YYYY-MM
  sheetGuess: PaymentSheet;
  rows: Omit<PaymentInput, "sheet">[];
  /** Avisos de valores que não puderam ser lidos (ficam nas observações). */
  warnings: string[];
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const pad = (n: number) => String(n).padStart(2, "0");

/** Número de série de data do Excel → `YYYY-MM-DD`. */
export function serialToISO(serial: number): string | undefined {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2_958_465) return undefined;
  const d = new Date(Math.round((serial - 25_569) * 86_400_000));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Aceita série do Excel ou texto `dd/mm/aaaa`. Retorna undefined se não for data válida. */
export function toDate(value: CellValue | undefined): string | undefined {
  if (typeof value === "number") return serialToISO(value);
  if (typeof value !== "string") return undefined;
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(value);
  if (!m) return undefined;
  const iso = `${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
  return serialToISO((Date.parse(`${iso}T00:00:00Z`) / 86_400_000) + 25_569) === iso ? iso : undefined;
}

const isNotReceived = (v: CellValue | undefined) => typeof v === "string" && /n[aã]o recebid/i.test(v);
const isBlankish = (v: CellValue | undefined) =>
  v === undefined || (typeof v === "string" && /^\s*[-–—]?\s*$/.test(v));

/** Converte o texto de observação no status padronizado. */
export function statusFromText(text: string, hasPaidDate: boolean): PaymentStatus {
  const t = norm(text);
  if (/efetivad|\bpago\b|pagamento realizado|quitad/.test(t)) return "pago";
  if (/novo boleto/.test(t)) return "novo_boleto";
  if (/nao recebid/.test(t)) return "nao_recebido";
  if (/enviad|encaminhad/.test(t)) return "enviado";
  if (/recebid/.test(t)) return "recebido";
  return hasPaidDate ? "pago" : "nao_recebido";
}

type Field = "supplier" | "branch" | "competence" | "issueDate" | "amount" | "dueDate" | "paidDate" | "title" | "obs";

function headerField(text: string): Field | undefined {
  const t = norm(text);
  if (/fornecedor/.test(t)) return "supplier";
  if (/filial|planta/.test(t)) return "branch";
  if (/competen/.test(t)) return "competence";
  if (/emiss/.test(t)) return "issueDate";
  if (/^valor/.test(t)) return "amount";
  if (/efetivo|pagto|pagamento/.test(t) && /dat|dta/.test(t)) return "paidDate";
  if (/venc/.test(t)) return "dueDate";
  if (/titulo/.test(t)) return "title";
  if (/observ/.test(t)) return "obs";
  return undefined;
}

function monthFromTab(name: string): number | undefined {
  const t = norm(name).replace(/^\d+\.?\s*/, "");
  const i = MONTH_NAMES.findIndex((m) => t.startsWith(norm(m)));
  return i >= 0 ? i + 1 : undefined;
}

const looksLikeTitle = (v: CellValue | undefined) =>
  (typeof v === "number" && Number.isInteger(v)) || (typeof v === "string" && /^[\d\s.,/;eE-]+$/.test(v) && /\d/.test(v));

/**
 * Lê as abas de mês (ex.: "11. Novembro", "Outubro") de uma planilha de controle.
 * Abas ocultas e abas sem a coluna "Fornecedor" são ignoradas.
 */
export function parsePaymentWorkbook(sheets: ReadSheet[], fallbackYear: number): ImportedMonth[] {
  const result: ImportedMonth[] = [];

  for (const sheet of sheets) {
    if (sheet.hidden) continue;
    const monthNumber = monthFromTab(sheet.name);
    if (!monthNumber) continue;

    // Linha de cabeçalho: a primeira com "Fornecedor".
    let headerRow = -1;
    for (const [r, cells] of sheet.rows) {
      if ([...cells.values()].some((v) => typeof v === "string" && /fornecedor/i.test(v))) {
        headerRow = r;
        break;
      }
    }
    if (headerRow < 0) continue;

    const columns = new Map<number, Field>();
    const obsColumns: number[] = [];
    // O cabeçalho pode ocupar a linha acima (ex.: "OBSERVAÇÕES" mesclado em H1:H2).
    for (const r of [headerRow - 1, headerRow]) {
      for (const [c, v] of sheet.rows.get(r) ?? []) {
        if (typeof v !== "string") continue;
        const f = headerField(v);
        if (!f || (r < headerRow && f !== "obs")) continue;
        if (f === "obs") {
          if (!obsColumns.includes(c)) obsColumns.push(c);
        } else if (![...columns.values()].includes(f)) columns.set(c, f);
      }
    }
    const col = (f: Field) => [...columns].find(([, v]) => v === f)?.[0];

    const titleText = [...(sheet.rows.get(headerRow - 1)?.values() ?? []), ...(sheet.rows.get(1)?.values() ?? [])]
      .filter((v): v is string => typeof v === "string")
      .join(" ");
    const year = Number(/\b(20\d{2})\b/.exec(titleText)?.[1]) || fallbackYear;
    const month = `${year}-${pad(monthNumber)}`;
    const sheetGuess: PaymentSheet =
      col("title") !== undefined || /importante|critic/i.test(norm(titleText)) ? "criticos" : "rh";

    const lastKnown = Math.max(...columns.keys(), ...obsColumns, 0);
    const rows: ImportedMonth["rows"] = [];
    const warnings: string[] = [];

    for (const [r, cells] of [...sheet.rows].sort((a, b) => a[0] - b[0])) {
      if (r <= headerRow) continue;
      const get = (f: Field) => {
        const c = col(f);
        return c === undefined ? undefined : cells.get(c);
      };
      const supplierRaw = get("supplier");
      if (typeof supplierRaw !== "string" || !supplierRaw.trim()) continue;
      const supplier = supplierRaw.trim().slice(0, 120);

      const notes: string[] = [];
      const date = (f: Field, label: string) => {
        const v = get(f);
        if (isNotReceived(v) || isBlankish(v)) return undefined;
        const iso = toDate(v);
        if (!iso) {
          notes.push(`${label} original: ${String(v)}`);
          warnings.push(`${supplier}: ${label.toLowerCase()} "${String(v)}" não é uma data válida (guardado nas observações).`);
        }
        return iso;
      };

      const competence = date("competence", "Competência");
      const issueDate = date("issueDate", "Emissão");
      const dueDate = date("dueDate", "Vencimento");
      const paidDate = date("paidDate", "Data do pagamento");

      let amount: number | undefined;
      const rawAmount = get("amount");
      if (typeof rawAmount === "number") amount = Math.round(Math.abs(rawAmount) * 100) / 100;
      else if (!isNotReceived(rawAmount) && !isBlankish(rawAmount)) {
        const parsed = Number(String(rawAmount).replace(/\./g, "").replace(",", "."));
        if (Number.isFinite(parsed)) amount = Math.round(Math.abs(parsed) * 100) / 100;
        else notes.push(`Valor original: ${String(rawAmount)}`);
      }

      // Observações: a primeira coluna com texto de status define o status; o resto vira nota.
      let statusText = "";
      let title = get("title");
      if (isNotReceived(title)) title = undefined;
      const extra = [...obsColumns, ...[...cells.keys()].filter((c) => c > lastKnown)];
      for (const c of [...new Set(extra)]) {
        const v = cells.get(c);
        if (isBlankish(v)) continue;
        if (title === undefined && c !== obsColumns[0] && looksLikeTitle(v)) {
          title = v;
          continue;
        }
        const s = String(v).trim();
        if (!statusText) statusText = s;
        else notes.push(s);
      }

      const hasDocument = amount !== undefined || !!dueDate || !!issueDate;
      const status: PaymentStatus = statusText
        ? statusFromText(statusText, !!paidDate)
        : paidDate
          ? "pago"
          : hasDocument
            ? "recebido"
            : "nao_recebido";
      // Guarda o texto original quando ele traz mais do que o status.
      if (statusText && !/^(pagamento efetivado|enviado para pagamento|encaminhado para pagamento|nao recebido|novo boleto solicitado|recebido)$/.test(norm(statusText))) {
        notes.unshift(statusText);
      }

      const branch = get("branch");
      const titleNumber = isBlankish(title) ? undefined : String(title).trim().slice(0, 200);
      rows.push({
        month,
        order: rows.length,
        supplier,
        branch: typeof branch === "string" ? branch.trim().slice(0, 40) : "",
        competence,
        issueDate,
        amount,
        dueDate,
        paidDate,
        titleNumber,
        status,
        notes: notes.length ? notes.join(" · ").slice(0, 500) : undefined,
      });
    }

    if (rows.length) result.push({ tab: sheet.name.trim(), month, sheetGuess, rows, warnings });
  }

  return result.sort((a, b) => b.month.localeCompare(a.month));
}
