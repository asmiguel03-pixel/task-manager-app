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

// ---------- Boleto (linha digitável / código de barras) ----------

const BANKS: Record<string, string> = {
  "001": "Banco do Brasil", "003": "Banco da Amazônia", "004": "Banco do Nordeste", "021": "Banestes",
  "033": "Santander", "037": "Banpará", "041": "Banrisul", "047": "Banese", "070": "BRB",
  "077": "Inter", "084": "Uniprime", "085": "Ailos", "104": "Caixa Econômica Federal",
  "133": "Cresol", "136": "Unicred", "197": "Stone", "208": "BTG Pactual", "212": "Banco Original",
  "237": "Bradesco", "260": "Nubank", "290": "PagBank", "323": "Mercado Pago", "336": "C6 Bank",
  "341": "Itaú", "380": "PicPay", "389": "Banco Mercantil", "403": "Cora", "422": "Safra",
  "633": "Rendimento", "634": "Banco Triângulo", "655": "Banco Votorantim", "707": "Daycoval",
  "745": "Citibank", "746": "Modal", "748": "Sicredi", "756": "Sicoob",
};

const ARRECADACAO_SEGMENTS: Record<string, string> = {
  "1": "Prefeituras",
  "2": "Saneamento",
  "3": "Energia elétrica e gás",
  "4": "Telecomunicações",
  "5": "Órgãos governamentais",
  "6": "Carnês e assemelhados",
  "7": "Multas de trânsito",
  "9": "Uso exclusivo do banco",
};

/** Módulo 10 (pesos 2,1,2,1… da direita; soma os dígitos de cada produto). */
export function mod10(digits: string): number {
  let sum = 0;
  let weight = 2;
  for (let i = digits.length - 1; i >= 0; i--) {
    const p = Number(digits[i]) * weight;
    sum += p > 9 ? p - 9 : p;
    weight = weight === 2 ? 1 : 2;
  }
  return (10 - (sum % 10)) % 10;
}

function mod11Sum(digits: string): number {
  let sum = 0;
  let weight = 2;
  for (let i = digits.length - 1; i >= 0; i--) {
    sum += Number(digits[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  return sum % 11;
}

/** DV geral do boleto bancário: resultados 0, 10 e 11 viram 1. */
export function mod11Bank(digits: string): number {
  const dv = 11 - mod11Sum(digits);
  return dv === 0 || dv >= 10 ? 1 : dv;
}

/** DV módulo 11 dos boletos de arrecadação (contas, tributos). */
export function mod11Collection(digits: string): number {
  const rest = mod11Sum(digits);
  return rest < 2 ? 0 : 11 - rest;
}

const isoFromUTC = (ms: number) => toISO(new Date(ms));

/**
 * Vencimento a partir do fator (dias desde 07/10/1997). Em 22/02/2025 o fator
 * voltou a 1000; como o mesmo fator vale nos dois ciclos, usa a data mais
 * próxima de `today`.
 */
export function dueDateFromFactor(factor: number, today: string): string | null {
  if (factor === 0) return null;
  const old = Date.UTC(1997, 9, 7) + factor * 86_400_000;
  const renewed = Date.UTC(2025, 1, 22) + (factor - 1000) * 86_400_000;
  const ref = parseISO(today)?.getTime() ?? Date.now();
  const candidates = factor >= 1000 ? [old, renewed] : [old];
  const best = candidates.reduce((a, b) => (Math.abs(b - ref) < Math.abs(a - ref) ? b : a));
  return isoFromUTC(best);
}

export type BoletoResult =
  | { ok: false; error: string }
  | {
      ok: true;
      kind: "bancario";
      bank: string;
      amount: number | null; // null = valor em aberto (definido na hora de pagar)
      dueDate: string | null; // null = sem vencimento no código
      barcode: string;
      line: string;
    }
  | {
      ok: true;
      kind: "arrecadacao";
      segment: string;
      amount: number | null; // null quando o campo é "valor de referência"
      barcode: string;
      line: string;
    };

const fail = (error: string): BoletoResult => ({ ok: false, error });

function bankBarcodeFromLine(l: string): string {
  return l.slice(0, 4) + l[32] + l.slice(33, 47) + l.slice(4, 9) + l.slice(10, 20) + l.slice(21, 31);
}

function bankLineFromBarcode(b: string): string {
  const f1 = b.slice(0, 4) + b.slice(19, 24);
  const f2 = b.slice(24, 34);
  const f3 = b.slice(34, 44);
  return f1 + mod10(f1) + f2 + mod10(f2) + f3 + mod10(f3) + b[4] + b.slice(5, 19);
}

function parseBank(barcode: string, line: string, today: string): BoletoResult {
  const expected = mod11Bank(barcode.slice(0, 4) + barcode.slice(5));
  if (expected !== Number(barcode[4])) {
    return fail(
      `Dígito verificador geral inválido (deveria ser ${expected}). O código pode ter sido digitado errado ou adulterado.`,
    );
  }
  if (barcode[3] !== "9") return fail("Moeda diferente de Real (código 9). Confira o boleto.");
  const cents = Number(barcode.slice(9, 19));
  const code = barcode.slice(0, 3);
  return {
    ok: true,
    kind: "bancario",
    bank: BANKS[code] ? `${BANKS[code]} (${code})` : `Banco ${code}`,
    amount: cents ? cents / 100 : null,
    dueDate: dueDateFromFactor(Number(barcode.slice(5, 9)), today),
    barcode,
    line,
  };
}

function collectionCheck(effective: string) {
  return effective === "6" || effective === "7" ? mod10 : effective === "8" || effective === "9" ? mod11Collection : null;
}

function parseCollection(barcode: string, line: string): BoletoResult {
  const check = collectionCheck(barcode[2]);
  if (!check) return fail("Terceiro dígito inválido para boleto de arrecadação (deve ser 6, 7, 8 ou 9).");
  const expected = check(barcode.slice(0, 3) + barcode.slice(4));
  if (expected !== Number(barcode[3])) {
    return fail(
      `Dígito verificador geral inválido (deveria ser ${expected}). O código pode ter sido digitado errado ou adulterado.`,
    );
  }
  const value = Number(barcode.slice(4, 15));
  return {
    ok: true,
    kind: "arrecadacao",
    segment: ARRECADACAO_SEGMENTS[barcode[1]] ?? `Segmento ${barcode[1]}`,
    amount: barcode[2] === "6" || barcode[2] === "8" ? (value ? value / 100 : null) : null,
    barcode,
    line,
  };
}

/** Valida linha digitável (47/48 dígitos) ou código de barras (44 dígitos). */
export function parseBoleto(raw: string, today = toISO(new Date(Date.now() - new Date().getTimezoneOffset() * 60_000))): BoletoResult {
  const d = raw.replace(/\D/g, "");

  if (d.length === 47) {
    const fields: [string, number, string][] = [
      [d.slice(0, 9), Number(d[9]), "1º"],
      [d.slice(10, 20), Number(d[20]), "2º"],
      [d.slice(21, 31), Number(d[31]), "3º"],
    ];
    for (const [data, dv, name] of fields) {
      if (mod10(data) !== dv) {
        return fail(`Erro no ${name} bloco da linha digitável: o dígito de controle não confere. Confira a digitação desse trecho.`);
      }
    }
    return parseBank(bankBarcodeFromLine(d), d, today);
  }

  if (d.length === 48) {
    if (d[0] !== "8") return fail("Linha com 48 dígitos deve começar com 8 (conta de consumo/tributo).");
    const check = collectionCheck(d[2]);
    if (!check) return fail("Terceiro dígito inválido para boleto de arrecadação (deve ser 6, 7, 8 ou 9).");
    for (let i = 0; i < 4; i++) {
      const block = d.slice(i * 12, i * 12 + 11);
      if (check(block) !== Number(d[i * 12 + 11])) {
        return fail(`Erro no ${i + 1}º bloco da linha digitável: o dígito de controle não confere. Confira a digitação desse trecho.`);
      }
    }
    const barcode = [0, 1, 2, 3].map((i) => d.slice(i * 12, i * 12 + 11)).join("");
    return parseCollection(barcode, d);
  }

  if (d.length === 44) {
    if (d[0] === "8") {
      const check = collectionCheck(d[2]);
      const line = check
        ? [0, 1, 2, 3].map((i) => d.slice(i * 11, i * 11 + 11)).map((b) => b + check(b)).join("")
        : d;
      return parseCollection(d, line);
    }
    return parseBank(d, bankLineFromBarcode(d), today);
  }

  return fail(
    `O código tem ${d.length} dígito(s). A linha digitável tem 47 (boleto de banco) ou 48 (contas e tributos); o código de barras tem 44.`,
  );
}

export function formatBoletoLine(line: string): string {
  if (line.length === 47) {
    return `${line.slice(0, 5)}.${line.slice(5, 10)} ${line.slice(10, 15)}.${line.slice(15, 21)} ${line.slice(21, 26)}.${line.slice(26, 32)} ${line[32]} ${line.slice(33)}`;
  }
  if (line.length === 48) {
    return [0, 1, 2, 3].map((i) => `${line.slice(i * 12, i * 12 + 11)}-${line[i * 12 + 11]}`).join(" ");
  }
  return line;
}

// ---------- Dia útil ----------

/** Verdadeiro se a data não é fim de semana nem feriado nacional. */
export function isBusinessDay(iso: string, includeOptional = false): boolean {
  const d = parseISO(iso);
  if (!d || isWeekend(d)) return false;
  return !holidaySet(d.getUTCFullYear(), d.getUTCFullYear(), includeOptional).has(iso);
}

/** A própria data, se for dia útil; senão, o próximo dia útil. */
export function nextBusinessDay(iso: string): string {
  const d = parseISO(iso);
  if (!d) return iso;
  return addBusinessDays(toISO(addDays(d, -1)), 1)?.date ?? iso;
}

// ---------- CNPJ / CPF ----------

/** Valor de um caractere no cálculo do CNPJ (dígitos e, no CNPJ alfanumérico, letras: código ASCII − 48). */
const cnpjValue = (ch: string) => ch.charCodeAt(0) - 48;

/** Valida CNPJ numérico ou alfanumérico (14 caracteres, os 2 últimos sempre dígitos). */
export function isValidCNPJ(raw: string): boolean {
  const c = raw.toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (!/^[0-9A-Z]{12}\d{2}$/.test(c) || /^(\d)\1{13}$/.test(c)) return false;
  const dv = (base: string) => {
    let sum = 0;
    let weight = 2;
    for (let i = base.length - 1; i >= 0; i--) {
      sum += cnpjValue(base[i]) * weight;
      weight = weight === 9 ? 2 : weight + 1;
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const d1 = dv(c.slice(0, 12));
  const d2 = dv(c.slice(0, 12) + d1);
  return c.endsWith(`${d1}${d2}`);
}

export function isValidCPF(raw: string): boolean {
  const c = raw.replace(/\D/g, "");
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(c[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10]);
}

export const formatCPF = (c: string) => `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}`;

// ---------- "Só números": limpa e identifica ----------

export type NumberKind = "boleto" | "access_key" | "cnpj" | "cpf" | "unknown" | "empty";

export interface CleanResult {
  /** Só os dígitos (ou, no CNPJ alfanumérico, letras maiúsculas e dígitos). */
  clean: string;
  kind: NumberKind;
  valid: boolean;
  /** Descrição curta do que foi identificado. */
  label: string;
  /** Versão formatada, quando faz sentido. */
  formatted?: string;
}

export function cleanAndIdentify(raw: string): CleanResult {
  const alnum = raw.toUpperCase().replace(/[^0-9A-Z]/g, "");
  // CNPJ alfanumérico (a partir de 2026): mantém as letras.
  if (/[A-Z]/.test(alnum) && /^[0-9A-Z]{12}\d{2}$/.test(alnum)) {
    const valid = isValidCNPJ(alnum);
    return { clean: alnum, kind: "cnpj", valid, label: valid ? "CNPJ alfanumérico válido" : "CNPJ alfanumérico com dígito verificador inválido", formatted: formatCNPJ(alnum) };
  }
  const d = raw.replace(/\D/g, "");
  if (!d) return { clean: "", kind: "empty", valid: false, label: "" };

  if (d.length === 47 || d.length === 48) {
    const b = parseBoleto(d);
    return { clean: d, kind: "boleto", valid: b.ok, label: b.ok ? "Linha digitável de boleto válida" : b.error, formatted: formatBoletoLine(d) };
  }
  if (d.length === 44) {
    // 44 dígitos: chave de acesso (NF-e/CT-e) ou código de barras de boleto.
    const key = parseAccessKey(d);
    if (key.ok) return { clean: d, kind: "access_key", valid: true, label: `Chave de acesso válida — ${key.model}`, formatted: groupKey(d) };
    const b = parseBoleto(d);
    if (b.ok) return { clean: d, kind: "boleto", valid: true, label: "Código de barras de boleto válido", formatted: b.line ? formatBoletoLine(b.line) : undefined };
    return { clean: d, kind: "access_key", valid: false, label: "44 dígitos, mas não é chave de acesso nem código de barras válido — confira a digitação." };
  }
  if (d.length === 14) {
    const valid = isValidCNPJ(d);
    return { clean: d, kind: "cnpj", valid, label: valid ? "CNPJ válido" : "CNPJ com dígito verificador inválido", formatted: formatCNPJ(d) };
  }
  if (d.length === 11) {
    const valid = isValidCPF(d);
    return { clean: d, kind: "cpf", valid, label: valid ? "CPF válido" : "CPF com dígito verificador inválido", formatted: formatCPF(d) };
  }
  return { clean: d, kind: "unknown", valid: false, label: `${d.length} dígitos` };
}
