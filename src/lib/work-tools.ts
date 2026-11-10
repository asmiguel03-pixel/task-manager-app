/**
 * Lógica das ferramentas da aba lateral (sem dependências, testável).
 * Datas sempre no formato de calendário `YYYY-MM-DD`, sem fuso horário.
 */

// ---------- Datas ----------

const pad = (n: number) => String(n).padStart(2, "0");
const toISO = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

function parseISO(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return toISO(d) === iso ? d : null;
}

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${pad(month)}-${pad(day)}`;
}

export interface Holiday {
  date: string;
  name: string;
  /** Ponto facultativo (Carnaval, Corpus Christi): só conta se o usuário pedir. */
  optional?: boolean;
}

/** Feriados nacionais do Brasil e pontos facultativos mais comuns. */
export function brazilHolidays(year: number): Holiday[] {
  const easter = parseISO(easterSunday(year))!;
  const rel = (days: number) => toISO(addDays(easter, days));
  const fixed: [string, string][] = [
    ["01-01", "Confraternização Universal"],
    ["04-21", "Tiradentes"],
    ["05-01", "Dia do Trabalho"],
    ["09-07", "Independência do Brasil"],
    ["10-12", "Nossa Senhora Aparecida"],
    ["11-02", "Finados"],
    ["11-15", "Proclamação da República"],
    ["11-20", "Dia da Consciência Negra"],
    ["12-25", "Natal"],
  ];
  return [
    ...fixed.map(([md, name]) => ({ date: `${year}-${md}`, name })),
    { date: rel(-2), name: "Sexta-feira Santa" },
    { date: rel(-48), name: "Carnaval (segunda)", optional: true },
    { date: rel(-47), name: "Carnaval (terça)", optional: true },
    { date: rel(60), name: "Corpus Christi", optional: true },
  ].sort((x, y) => x.date.localeCompare(y.date));
}

function holidaySet(fromYear: number, toYear: number, includeOptional: boolean) {
  const set = new Map<string, string>();
  for (let y = fromYear; y <= toYear; y++) {
    for (const h of brazilHolidays(y)) if (includeOptional || !h.optional) set.set(h.date, h.name);
  }
  return set;
}

const isWeekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;

export interface BusinessDayResult {
  date: string;
  /** Feriados que caíram em dia de semana no caminho e foram pulados. */
  skipped: Holiday[];
}

/**
 * Soma (ou subtrai, se negativo) `n` dias úteis a partir de `start`.
 * O dia inicial não conta, como em prazos: "5 dias úteis a partir de hoje".
 */
export function addBusinessDays(
  start: string,
  n: number,
  includeOptional = false,
): BusinessDayResult | null {
  const d0 = parseISO(start);
  if (!d0 || !Number.isInteger(n) || Math.abs(n) > 3650) return null;
  const y = d0.getUTCFullYear();
  const holidays = holidaySet(y - 11, y + 11, includeOptional);
  const step = n < 0 ? -1 : 1;
  const skipped: Holiday[] = [];
  let d = d0;
  let left = Math.abs(n);
  while (left > 0) {
    d = addDays(d, step);
    if (isWeekend(d)) continue;
    const name = holidays.get(toISO(d));
    if (name) {
      skipped.push({ date: toISO(d), name });
      continue;
    }
    left--;
  }
  return { date: toISO(d), skipped: step < 0 ? skipped.reverse() : skipped };
}

/** Dias úteis entre duas datas (exclui a inicial, inclui a final). */
export function businessDaysBetween(
  from: string,
  to: string,
  includeOptional = false,
): number | null {
  const a = parseISO(from);
  const b = parseISO(to);
  if (!a || !b) return null;
  const sign = a <= b ? 1 : -1;
  const [lo, hi] = sign > 0 ? [a, b] : [b, a];
  if ((hi.getTime() - lo.getTime()) / 86_400_000 > 3650 * 2) return null;
  const holidays = holidaySet(lo.getUTCFullYear(), hi.getUTCFullYear(), includeOptional);
  let count = 0;
  for (let d = addDays(lo, 1); d <= hi; d = addDays(d, 1)) {
    if (!isWeekend(d) && !holidays.has(toISO(d))) count++;
  }
  return count * sign;
}

export function weekdayName(iso: string): string {
  const d = parseISO(iso);
  return d
    ? ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"][
        d.getUTCDay()
      ]
    : "";
}

export const formatBR = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

// ---------- Chave de acesso NF-e / CT-e / NFC-e / MDF-e ----------

const UF_BY_CODE: Record<string, string> = {
  "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP", "17": "TO",
  "21": "MA", "22": "PI", "23": "CE", "24": "RN", "25": "PB", "26": "PE", "27": "AL", "28": "SE", "29": "BA",
  "31": "MG", "32": "ES", "33": "RJ", "35": "SP",
  "41": "PR", "42": "SC", "43": "RS",
  "50": "MS", "51": "MT", "52": "GO", "53": "DF",
};

const MODEL_NAMES: Record<string, string> = {
  "55": "NF-e",
  "57": "CT-e",
  "58": "MDF-e",
  "65": "NFC-e",
  "67": "CT-e OS",
};

/** Dígito verificador módulo 11 (pesos 2 a 9 da direita para a esquerda). */
export function accessKeyCheckDigit(first43: string): number {
  let sum = 0;
  let weight = 2;
  for (let i = first43.length - 1; i >= 0; i--) {
    sum += Number(first43[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

export const formatCNPJ = (c: string) =>
  c.length === 14 ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}` : c;

export type AccessKeyResult =
  | { ok: false; error: string; digits: string }
  | {
      ok: true;
      digits: string;
      uf: string;
      month: string; // "MM/AAAA"
      cnpj: string;
      model: string;
      series: number;
      number: number;
      emission: string;
    };

export function parseAccessKey(raw: string): AccessKeyResult {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 44) {
    return { ok: false, digits, error: `A chave tem ${digits.length} dígito(s); precisa ter 44.` };
  }
  const expected = accessKeyCheckDigit(digits.slice(0, 43));
  if (expected !== Number(digits[43])) {
    return {
      ok: false,
      digits,
      error: `Dígito verificador inválido: o último dígito deveria ser ${expected}. Confira se algum número foi digitado errado.`,
    };
  }
  const uf = UF_BY_CODE[digits.slice(0, 2)];
  const yy = digits.slice(2, 4);
  const mm = digits.slice(4, 6);
  const model = digits.slice(20, 22);
  const emission = digits[34];
  return {
    ok: true,
    digits,
    uf: uf ? `${uf} (${digits.slice(0, 2)})` : `código ${digits.slice(0, 2)} (desconhecido)`,
    month: `${mm}/20${yy}`,
    cnpj: formatCNPJ(digits.slice(6, 20)),
    model: MODEL_NAMES[model] ? `${MODEL_NAMES[model]} (modelo ${model})` : `modelo ${model}`,
    series: Number(digits.slice(22, 25)),
    number: Number(digits.slice(25, 34)),
    emission: emission === "1" ? "Normal" : `Contingência (tipo ${emission})`,
  };
}

export const groupKey = (digits: string) => digits.replace(/(\d{4})(?=\d)/g, "$1 ");

// ---------- Calculadora ----------

/**
 * Avalia uma expressão aritmética simples com segurança (sem `eval`).
 * Aceita + - * / ×  ÷ ^ %, parênteses e vírgula ou ponto como decimal.
 * `%` após um número divide por 100 (ex.: `200 * 15%` = 30).
 */
export function evaluateExpression(input: string): number {
  const src = input.replace(/×/g, "*").replace(/÷/g, "/").replace(/,/g, ".").replace(/\s+/g, "");
  if (!src) throw new Error("Digite uma conta.");
  let pos = 0;

  const peek = () => src[pos];
  const fail = (): never => {
    throw new Error("Conta inválida.");
  };

  function number(): number {
    const m = /^\d*\.?\d+|^\d+\./.exec(src.slice(pos));
    if (!m) fail();
    pos += m![0].length;
    let v = Number(m![0]);
    if (peek() === "%") {
      pos++;
      v /= 100;
    }
    return v;
  }

  function primary(): number {
    const c = peek();
    if (c === "(") {
      pos++;
      const v = expr();
      if (peek() !== ")") fail();
      pos++;
      if (peek() === "%") {
        pos++;
        return v / 100;
      }
      return v;
    }
    if (c === "-" || c === "+") {
      pos++;
      const v = power();
      return c === "-" ? -v : v;
    }
    return number();
  }

  function power(): number {
    const base = primary();
    if (peek() === "^") {
      pos++;
      return base ** power();
    }
    return base;
  }

  function term(): number {
    let v = power();
    while (peek() === "*" || peek() === "/") {
      const op = src[pos++];
      const r = power();
      if (op === "/" && r === 0) throw new Error("Divisão por zero.");
      v = op === "*" ? v * r : v / r;
    }
    return v;
  }

  function expr(): number {
    let v = term();
    while (peek() === "+" || peek() === "-") {
      const op = src[pos++];
      const r = term();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }

  const result = expr();
  if (pos !== src.length || !Number.isFinite(result)) fail();
  // Remove ruído de ponto flutuante (0,1 + 0,2).
  return Math.round(result * 1e10) / 1e10;
}

export const formatNumberBR = (n: number) =>
  n.toLocaleString("pt-BR", { maximumFractionDigits: 10 });
