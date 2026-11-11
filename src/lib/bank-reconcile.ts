/**
 * Conciliação bancária: extrato × razão da conta banco.
 * Cruza por valor e data (com folga de dias), depois agrupa lançamentos que
 * somados batem (ex.: várias vendas Cielo × um lançamento no razão).
 */
import type { StatementEntry } from "./bank-statement";
import { parseMoneyBR } from "./bank-statement";
import type { TextLine } from "./pdf-text";
import { toDate } from "./payment-import";
import { toAmount, type Table } from "./reconcile";

export interface LedgerEntry {
  date: string;
  description: string;
  doc?: string;
  /** Positivo = débito na conta banco (entrada); negativo = crédito (saída). */
  amount: number;
  balance?: number;
  /** Nº do lançamento e conta de contrapartida (Contmatic). */
  lanc?: string;
  counterpart?: string;
}

export interface Ledger {
  /** Conta contábil do razão, ex.: "1.01.01.02.01.01.000006" e "5 - BANCO DO BRASIL". */
  account?: { code: string; name?: string };
  opening?: number;
  closing?: number;
  entries: LedgerEntry[];
  warnings: string[];
}

// ---------- Leitura do razão ----------

export interface LedgerColumns {
  date: number;
  description?: number;
  doc?: number;
  debit?: number;
  credit?: number;
  /** Valor único com sinal ou com coluna D/C. */
  value?: number;
  dc?: number;
  lanc?: number;
  counterpart?: number;
  balance?: number;
}

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export function guessLedgerColumns(headers: string[]): LedgerColumns {
  const find = (re: RegExp, not?: RegExp) => {
    const i = headers.findIndex((h) => re.test(norm(h)) && !(not && not.test(norm(h))));
    return i >= 0 ? i : undefined;
  };
  return {
    date: find(/^data|^dt\b|^dia/) ?? 0,
    description: find(/hist|descri|complement/),
    doc: find(/^doc|documento|lote|n[ºo°.]?\s*doc/),
    debit: find(/^debito|^deb\b|d[eé]bito/),
    credit: find(/^credito|^cred\b|cr[eé]dito/),
    value: find(/^valor|montante/),
    dc: find(/^d\/c$|natureza|^dc$/),
    balance: find(/saldo/),
    lanc: find(/^lanc/),
    counterpart: find(/partida/),
  };
}

const signedBalance = (v: unknown): number | undefined => {
  if (typeof v === "number") return Math.round(v * 100) / 100;
  if (typeof v !== "string") return undefined;
  const m = /(-?[\d.]+,\d{2})\s*([CD])?\s*$/.exec(v.trim());
  if (!m) return toAmount(v);
  const n = parseMoneyBR(m[1]);
  // Conta banco é de ativo: saldo devedor (D) é positivo.
  return m[2] === "C" ? -n : n;
};

/** Escolhe a aba que parece o razão (tem data e débito/crédito ou valor), ignorando capas. */
export function bestLedgerTable(tables: Table[]): number {
  let best = 0;
  let bestScore = -1;
  tables.forEach((t, i) => {
    const c = guessLedgerColumns(t.headers);
    const hasDate = t.headers.some((h) => /^data|^dt\b|^dia/.test(norm(h)));
    const score =
      (hasDate ? 3 : 0) +
      (c.debit !== undefined ? 3 : 0) +
      (c.credit !== undefined ? 3 : 0) +
      (c.value !== undefined ? 2 : 0) +
      (c.balance !== undefined ? 1 : 0) +
      (c.description !== undefined ? 1 : 0) +
      Math.min(t.rows.length, 50) / 100;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

export function ledgerFromTable(t: Table, c: LedgerColumns): Ledger {
  const ledger: Ledger = { entries: [], warnings: [] };
  for (const row of t.rows) {
    const date = toDate(row[c.date]);
    const text = (i?: number) => (i === undefined || row[i] === undefined ? "" : String(row[i]).trim());
    const hist = text(c.description);
    if (/saldo anterior|saldo inicial/i.test(hist) || (!date && /saldo anterior/i.test(row.map(String).join(" ")))) {
      const raw = c.balance !== undefined ? row[c.balance] : undefined;
      // Contmatic mostra saldo zerado como "-".
      ledger.opening = typeof raw === "string" && /^\s*-\s*$/.test(raw) ? 0 : (signedBalance(raw) ?? ledger.opening);
      continue;
    }
    if (!date) continue;
    let amount: number | undefined;
    if (c.debit !== undefined || c.credit !== undefined) {
      const d = c.debit !== undefined ? Math.abs(toAmount(row[c.debit]) ?? 0) : 0;
      const cr = c.credit !== undefined ? Math.abs(toAmount(row[c.credit]) ?? 0) : 0;
      amount = d - cr;
    } else if (c.value !== undefined) {
      const v = toAmount(row[c.value]);
      if (v !== undefined) {
        const dc = text(c.dc).toUpperCase();
        amount = dc.startsWith("C") ? -Math.abs(v) : dc.startsWith("D") ? Math.abs(v) : v;
      }
    }
    if (!amount) continue;
    const balance = c.balance !== undefined ? signedBalance(row[c.balance]) : undefined;
    ledger.entries.push({
      date,
      description: hist,
      doc: text(c.doc) || undefined,
      lanc: text(c.lanc) || undefined,
      counterpart: text(c.counterpart) || undefined,
      amount: Math.round(amount * 100) / 100,
      balance,
    });
    if (balance !== undefined) ledger.closing = balance;
  }
  ledger.account = accountFromRows(t.above ?? []);
  finishLedger(ledger);
  return ledger;
}

/** Código da conta contábil (ex.: 1.01.01.02.01.01.000006) nas linhas acima do cabeçalho. */
function accountFromRows(rows: unknown[][]): Ledger["account"] {
  for (const row of rows) {
    const cells = row.map((v) => (v === undefined || v === null ? "" : String(v).trim()));
    const i = cells.findIndex((v) => /^\d+(\.\d+){3,}$/.test(v));
    if (i >= 0) return { code: cells[i], name: cells.slice(i + 1).find((v) => v) || undefined };
  }
  return undefined;
}

/** Razão em PDF: linhas com data + valores; débito/crédito/saldo pelas colunas do cabeçalho. */
export function ledgerFromPdfLines(lines: TextLine[]): Ledger {
  const ledger: Ledger = { entries: [], warnings: [] };
  const header = lines.find((l) => /d[ée]bito/i.test(l.text) && /cr[ée]dito/i.test(l.text));
  if (!header) {
    ledger.warnings.push('Não achei o cabeçalho com "Débito" e "Crédito" no PDF do razão. Tente exportar em Excel.');
    return ledger;
  }
  const xOf = (re: RegExp) => header.items.find((i) => re.test(i.text))?.x;
  const cols = [
    ["debit", xOf(/d[ée]bito/i)],
    ["credit", xOf(/cr[ée]dito/i)],
    ["balance", xOf(/saldo/i)],
  ].filter((c): c is [string, number] => typeof c[1] === "number");
  const MONEY = /^-?\d{1,3}(?:\.\d{3})*,\d{2}(\s*[CD])?$/;
  const columnOf = (x: number) => cols.filter((c) => c[1] <= x + 25).sort((a, b) => b[1] - a[1])[0]?.[0];
  let date = "";
  let last: LedgerEntry | undefined;
  const headerIndex = lines.indexOf(header);
  for (const line of lines.slice(headerIndex + 1)) {
    const dItem = line.items.find((i) => /^\d{2}\/\d{2}\/\d{4}$/.test(i.text.trim()) && i.x < 120);
    const money = line.items.filter((i) => MONEY.test(i.text.trim()));
    if (dItem) date = toDate(dItem.text.trim()) ?? date;
    if (/saldo anterior|saldo inicial/i.test(line.text)) {
      const b = money.find((m) => columnOf(m.x) === "balance") ?? money[money.length - 1];
      if (b) ledger.opening = signedBalance(b.text);
      continue;
    }
    if (!money.length) {
      if (last && !dItem && line.text.length < 120) last.description = `${last.description} · ${line.text}`;
      continue;
    }
    if (!date || /^total/i.test(line.text)) continue;
    let debit = 0;
    let credit = 0;
    let balance: number | undefined;
    for (const m of money) {
      const kind = columnOf(m.x);
      const v = Math.abs(parseMoneyBR(m.text.trim().replace(/\s*[CD]$/, "")));
      if (kind === "debit") debit += v;
      else if (kind === "credit") credit += v;
      else if (kind === "balance") balance = signedBalance(m.text);
    }
    if (!debit && !credit) continue;
    last = {
      date,
      description: line.items
        .filter((i) => i !== dItem && !money.includes(i))
        .map((i) => i.text.trim())
        .join(" "),
      amount: Math.round((debit - credit) * 100) / 100,
      balance,
    };
    ledger.entries.push(last);
    if (balance !== undefined) ledger.closing = balance;
  }
  finishLedger(ledger);
  return ledger;
}

function finishLedger(l: Ledger) {
  const sum = l.entries.reduce((s, e) => s + e.amount, 0);
  if (l.opening === undefined && l.entries[0]?.balance !== undefined) {
    l.opening = Math.round((l.entries[0].balance - l.entries[0].amount) * 100) / 100;
  }
  if (l.closing === undefined && l.opening !== undefined) l.closing = Math.round((l.opening + sum) * 100) / 100;
  if (l.opening !== undefined && l.closing !== undefined && Math.abs(l.opening + sum - l.closing) > 0.009) {
    l.warnings.push("Saldo inicial + lançamentos do razão não fecha com o saldo final lido. Confira as colunas.");
  }
}

// ---------- Cruzamento ----------

export interface ReconMatch {
  statement: number[]; // índices no extrato
  ledger: number[]; // índices no razão
  kind: "1:1" | "grupo";
  /** Diferença de dias entre as datas (maior). */
  days: number;
}

export interface BankReconciliation {
  matches: ReconMatch[];
  onlyStatement: number[];
  onlyLedger: number[];
}

const DAY = 86_400_000;
const dayDiff = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY;
const cents = (n: number) => Math.round(n * 100);

const tokens = (s: string) =>
  new Set(
    norm(s)
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((w) => w.length >= 3),
  );
const similarity = (a: string, b: string) => {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const w of ta) if (tb.has(w)) shared++;
  return shared / Math.min(ta.size, tb.size);
};

/** Subconjunto (até `max` itens) que soma exatamente o alvo, em centavos. */
function subsetSum(values: number[], target: number, max = 8): number[] | null {
  const n = values.length;
  for (let size = 2; size <= Math.min(max, n); size++) {
    const pick: number[] = [];
    let found: number[] | null = null;
    const walk = (start: number, sum: number) => {
      if (found) return;
      if (pick.length === size) {
        if (sum === target) found = [...pick];
        return;
      }
      for (let i = start; i < n; i++) {
        pick.push(i);
        walk(i + 1, sum + values[i]);
        pick.pop();
        if (found) return;
      }
    };
    walk(0, 0);
    if (found) return found;
  }
  return null;
}

export function reconcileBank(
  statement: StatementEntry[],
  ledger: LedgerEntry[],
  windowDays = 3,
): BankReconciliation {
  const usedS = new Set<number>();
  const usedL = new Set<number>();
  const matches: ReconMatch[] = [];

  // 1) Um para um: mesmo valor (com sinal), data mais próxima, depois histórico parecido.
  const order = statement.map((_, i) => i).sort((a, b) => statement[a].date.localeCompare(statement[b].date));
  for (let pass = 0; pass <= windowDays; pass++) {
    for (const si of order) {
      if (usedS.has(si)) continue;
      const s = statement[si];
      let best = -1;
      let bestScore = -1;
      ledger.forEach((l, li) => {
        if (usedL.has(li) || cents(l.amount) !== cents(s.amount)) return;
        const d = dayDiff(s.date, l.date);
        if (d > pass) return;
        const score = similarity(`${s.description} ${s.doc ?? ""}`, `${l.description} ${l.doc ?? ""}`) - d / 10;
        if (score > bestScore) {
          best = li;
          bestScore = score;
        }
      });
      if (best >= 0) {
        usedS.add(si);
        usedL.add(best);
        matches.push({ statement: [si], ledger: [best], kind: "1:1", days: dayDiff(s.date, ledger[best].date) });
      }
    }
  }

  // 2) Agrupados: vários do extrato = um do razão, e vice-versa (mesmo sinal, dentro da janela).
  const group = (
    targets: { date: string; amount: number }[],
    usedT: Set<number>,
    pool: { date: string; amount: number }[],
    usedP: Set<number>,
    toMatch: (t: number, p: number[]) => ReconMatch,
  ) => {
    targets.forEach((t, ti) => {
      if (usedT.has(ti)) return;
      const candidates = pool
        .map((p, pi) => ({ p, pi }))
        .filter(({ p, pi }) => !usedP.has(pi) && Math.sign(p.amount) === Math.sign(t.amount) && dayDiff(p.date, t.date) <= windowDays + 2)
        .sort((a, b) => dayDiff(a.p.date, t.date) - dayDiff(b.p.date, t.date))
        .slice(0, 16);
      const pick = subsetSum(
        candidates.map(({ p }) => cents(p.amount)),
        cents(t.amount),
      );
      if (pick) {
        const chosen = pick.map((k) => candidates[k].pi);
        usedT.add(ti);
        chosen.forEach((pi) => usedP.add(pi));
        matches.push(toMatch(ti, chosen));
      }
    });
  };
  group(ledger, usedL, statement, usedS, (li, sis) => ({
    statement: sis,
    ledger: [li],
    kind: "grupo",
    days: Math.max(...sis.map((si) => dayDiff(statement[si].date, ledger[li].date))),
  }));
  group(statement, usedS, ledger, usedL, (si, lis) => ({
    statement: [si],
    ledger: lis,
    kind: "grupo",
    days: Math.max(...lis.map((li) => dayDiff(statement[si].date, ledger[li].date))),
  }));

  // 3) Lançamentos mensais no razão (ex.: "Tarifas do mês") = soma de lançamentos
  //    do extrato com o mesmo histórico, no mesmo mês.
  const descKey = (d: string) => norm(d.split(" · ")[0]).replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
  ledger.forEach((l, li) => {
    if (usedL.has(li)) return;
    const clusters = new Map<string, number[]>();
    statement.forEach((s, si) => {
      if (usedS.has(si) || Math.sign(s.amount) !== Math.sign(l.amount) || s.date.slice(0, 7) !== l.date.slice(0, 7)) return;
      const k = descKey(s.description);
      if (k) clusters.set(k, [...(clusters.get(k) ?? []), si]);
    });
    for (const idx of clusters.values()) {
      if (idx.length < 2) continue;
      const values = idx.map((si) => cents(statement[si].amount));
      const total = values.reduce((a, b) => a + b, 0);
      const pick = total === cents(l.amount) ? idx.map((_, k) => k) : idx.length <= 16 ? subsetSum(values, cents(l.amount), 16) : null;
      if (!pick) continue;
      const chosen = pick.map((k) => idx[k]);
      usedL.add(li);
      chosen.forEach((si) => usedS.add(si));
      matches.push({
        statement: chosen,
        ledger: [li],
        kind: "grupo",
        days: Math.max(...chosen.map((si) => dayDiff(statement[si].date, l.date))),
      });
      break;
    }
  });

  return {
    matches: matches.sort((a, b) => Math.min(...a.statement) - Math.min(...b.statement)),
    onlyStatement: statement.map((_, i) => i).filter((i) => !usedS.has(i)),
    onlyLedger: ledger.map((_, i) => i).filter((i) => !usedL.has(i)),
  };
}

export interface ReconSummary {
  statementClosing?: number;
  ledgerClosing?: number;
  difference?: number;
  /** Soma das pendências: só no extrato − só no razão. */
  explained: number;
  unexplained?: number;
}

export function reconSummary(
  st: { closing?: number },
  ledger: { closing?: number },
  statement: StatementEntry[],
  ledgerEntries: LedgerEntry[],
  r: BankReconciliation,
): ReconSummary {
  const sum = (list: number[], arr: { amount: number }[]) => list.reduce((s, i) => s + arr[i].amount, 0);
  const explained = Math.round((sum(r.onlyStatement, statement) - sum(r.onlyLedger, ledgerEntries)) * 100) / 100;
  const difference =
    st.closing !== undefined && ledger.closing !== undefined ? Math.round((st.closing - ledger.closing) * 100) / 100 : undefined;
  return {
    statementClosing: st.closing,
    ledgerClosing: ledger.closing,
    difference,
    explained,
    unexplained: difference !== undefined ? Math.round((difference - explained) * 100) / 100 : undefined,
  };
}

// ---------- Período ----------

/** Período do extrato: pelo texto ("01/10/2026 a 31/10/2026", "10/2026") ou pelas datas dos lançamentos. */
export function statementRange(period: string | undefined, dates: string[]): [string, string] | undefined {
  const two = period && /(\d{2})\/(\d{2})\/(\d{4}).*?(\d{2})\/(\d{2})\/(\d{4})/.exec(period);
  if (two) return [`${two[3]}-${two[2]}-${two[1]}`, `${two[6]}-${two[5]}-${two[4]}`];
  const month = period && /^(\d{2})\s*\/\s*(\d{4})$/.exec(period.trim());
  if (month) {
    const last = new Date(Date.UTC(Number(month[2]), Number(month[1]), 0)).getUTCDate();
    return [`${month[2]}-${month[1]}-01`, `${month[2]}-${month[1]}-${String(last).padStart(2, "0")}`];
  }
  if (!dates.length) return undefined;
  const sorted = [...dates].sort();
  return [sorted[0], sorted[sorted.length - 1]];
}

/** Recorta o razão no período do extrato, com o saldo do razão no início e no fim dele. */
export function ledgerForPeriod(ledger: Ledger, [start, end]: [string, string]): Ledger & { cut: { before: number; after: number } } {
  const before = ledger.entries.filter((e) => e.date < start);
  const inside = ledger.entries.filter((e) => e.date >= start && e.date <= end);
  const after = ledger.entries.filter((e) => e.date > end);
  const sum = (list: LedgerEntry[]) => list.reduce((s, e) => s + e.amount, 0);
  const round = (n: number) => Math.round(n * 100) / 100;
  const opening =
    before.length && before[before.length - 1].balance !== undefined
      ? before[before.length - 1].balance
      : ledger.opening !== undefined
        ? round(ledger.opening + sum(before))
        : inside[0]?.balance !== undefined
          ? round(inside[0].balance - inside[0].amount)
          : undefined;
  const closing =
    inside.length && inside[inside.length - 1].balance !== undefined
      ? inside[inside.length - 1].balance
      : opening !== undefined
        ? round(opening + sum(inside))
        : undefined;
  return { account: ledger.account, opening, closing, entries: inside, warnings: ledger.warnings, cut: { before: before.length, after: after.length } };
}
