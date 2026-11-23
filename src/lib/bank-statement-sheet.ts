/**
 * Extrato bancário em planilha (Excel/CSV exportado do internet banking).
 * Leitura genérica pelo cabeçalho: Data, Lançamento/Histórico, Valor (ou Crédito e
 * Débito, ou Valor + Tipo), Saldo. Testado com o "Extrato" do Itaú em Excel
 * (Data | Lançamento | Razão Social | CPF/CNPJ | Valor (R$) | Saldo (R$)).
 */
import type { Statement, StatementEntry } from "./bank-statement";
import { toDate } from "./payment-import";
import { toAmount, type Table } from "./reconcile";

export interface StatementColumns {
  date: number;
  description?: number;
  /** Nome de quem pagou/recebeu (ex.: "Razão Social" no Itaú), somado ao histórico. */
  party?: number;
  doc?: number;
  value?: number;
  credit?: number;
  debit?: number;
  /** Coluna "D/C" ou "Tipo" (Entrada/Saída) quando o valor vem sem sinal. */
  dc?: number;
  balance?: number;
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export function guessStatementColumns(headers: string[]): StatementColumns | undefined {
  const h = headers.map(norm);
  const find = (re: RegExp, skip: number[] = []) => {
    const i = h.findIndex((v, k) => re.test(v) && !skip.includes(k));
    return i >= 0 ? i : undefined;
  };
  const date = find(/^data\b|^dt\b|^dia\b/);
  if (date === undefined) return undefined;
  const balance = find(/^saldo/);
  const credit = find(/^credito|^entrada|^receb/);
  const debit = find(/^debito|^saida|^pagam/);
  const value = find(/^valor|^montante|^quantia/);
  const description = find(/^lancamento|^hist|^descri|^complement|^movimenta|^transac/);
  const party = find(/razao social|favorecido|^nome|pagador|recebedor|contraparte|origem.*destino/, [description ?? -1]);
  const doc = find(/^doc|documento|n.? ?doc/);
  const dc = find(/^d\/?c$|^tipo|natureza|^c\/d$/);
  if (value === undefined && credit === undefined && debit === undefined) return undefined;
  return { date, description, party, doc, value, credit, debit, dc, balance };
}

const BANKS: [RegExp, string][] = [
  [/(^|[^a-z])ita([uú]|[^a-z]|$)/i, "Itaú"],
  [/bradesco/i, "Bradesco"],
  [/santander/i, "Santander"],
  [/caixa|cef\b/i, "Caixa"],
  [/banco do brasil|\bbb\b/i, "Banco do Brasil"],
  [/sicoob/i, "Sicoob"],
  [/sicredi/i, "Sicredi"],
  [/\bbanco inter\b/i, "Inter"],
  [/nubank/i, "Nubank"],
  [/safra/i, "Safra"],
  [/btg/i, "BTG"],
];

const cellText = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());

/** "Agência: 0641" / "Conta: 0010312-2" / "Periodo: 01/09/2026 até 30/09/2026" nas linhas de cima. */
function headerInfo(rows: unknown[][]) {
  const info: { agency?: string; account?: string; period?: string; text: string[] } = { text: [] };
  for (const row of rows) {
    const cells = row.map(cellText).filter(Boolean);
    info.text.push(...cells);
    for (let i = 0; i < cells.length; i++) {
      const label = norm(cells[i]).replace(/:$/, "");
      const inline = /^([^:]+):\s*(.+)$/.exec(cells[i]);
      const value = inline ? inline[2].trim() : cells[i + 1];
      const key = inline ? norm(inline[1]) : label;
      if (!value) continue;
      if (/^agencia\b/.test(key) && !info.agency) info.agency = value;
      else if (/^(conta|c\/c|conta corrente)$/.test(key) && !info.account) info.account = value;
      else if (/^periodo\b/.test(key) && !info.period) info.period = value;
    }
  }
  return info;
}

/** Escolhe a aba que parece o extrato e monta o Statement. */
export function statementFromTables(tables: Table[], fileName = ""): Statement {
  let best: { t: Table; c: StatementColumns } | undefined;
  let bestRows = -1;
  for (const t of tables) {
    const c = guessStatementColumns(t.headers);
    if (!c) continue;
    const n = t.rows.filter((r) => toDate(r[c.date])).length;
    if (n > bestRows) {
      best = { t, c };
      bestRows = n;
    }
  }
  if (!best || bestRows <= 0) {
    throw new Error('Não achei o extrato na planilha. Ela precisa de uma linha de cabeçalho com "Data" e "Valor" (ou "Crédito" e "Débito").');
  }
  return statementFromTable(best.t, best.c, fileName);
}

export function statementFromTable(t: Table, c: StatementColumns, fileName = ""): Statement {
  const info = headerInfo(t.above ?? []);
  const where = [fileName, t.name, ...info.text].join(" ");
  // Exportação do Itaú: Data | Lançamento | Razão Social | CPF/CNPJ | Valor (R$) | Saldo (R$).
  const itauLayout = c.party !== undefined && t.headers.some((h) => /cpf\/cnpj/i.test(h)) && /^lan/i.test(norm(t.headers[c.description ?? -1] ?? ""));
  const bank = BANKS.find(([re]) => re.test(where))?.[1] ?? (itauLayout ? "Itaú" : "Banco (planilha)");
  const account = [info.agency && `Ag. ${info.agency}`, info.account && `C/C ${info.account}`].filter(Boolean).join(" · ") || undefined;
  const st: Statement = { bank, account, period: info.period, entries: [], warnings: [] };

  const round = (n: number) => Math.round(n * 100) / 100;
  let lastBalance: number | undefined;
  for (const row of t.rows) {
    const text = (i?: number) => (i === undefined ? "" : cellText(row[i]));
    const desc = text(c.description);
    const balance = c.balance !== undefined ? toAmount(row[c.balance]) : undefined;

    let amount: number | undefined;
    if (c.credit !== undefined || c.debit !== undefined) {
      const cr = c.credit !== undefined ? Math.abs(toAmount(row[c.credit]) ?? 0) : 0;
      const db = c.debit !== undefined ? Math.abs(toAmount(row[c.debit]) ?? 0) : 0;
      amount = cr - db;
    } else if (c.value !== undefined) {
      const v = toAmount(row[c.value]);
      if (v !== undefined) {
        const dc = norm(text(c.dc));
        amount = /^(d|debito|saida|s)\b/.test(dc) ? -Math.abs(v) : /^(c|credito|entrada|e)\b/.test(dc) ? Math.abs(v) : v;
      }
    }

    // Linhas de saldo: "SALDO ANTERIOR" é o inicial; "SALDO TOTAL DISPONÍVEL DIA", "S A L D O"... só conferem.
    const nd = norm(desc).replace(/\s/g, "");
    if (/^saldo(anterior|inicial)/.test(nd)) {
      st.opening = balance ?? amount;
      continue;
    }
    if (/^saldo/.test(nd) && (!amount || balance === undefined)) {
      const b = balance ?? amount;
      if (b !== undefined) lastBalance = b;
      continue;
    }

    const date = toDate(row[c.date]);
    if (!date || !amount) continue;
    const party = text(c.party);
    const entry: StatementEntry = {
      date,
      description: [desc, party && !norm(desc).includes(norm(party)) ? party : ""].filter(Boolean).join(" · "),
      doc: text(c.doc) || undefined,
      amount: round(amount),
      balance,
    };
    st.entries.push(entry);
    if (balance !== undefined) lastBalance = balance;
  }

  // Alguns bancos exportam do mais novo para o mais antigo.
  if (st.entries.length > 1 && st.entries[0].date > st.entries[st.entries.length - 1].date) {
    st.entries.reverse();
    const withBalance = st.entries.filter((e) => e.balance !== undefined);
    if (withBalance.length) lastBalance = withBalance[withBalance.length - 1].balance;
  }

  const sum = st.entries.reduce((s, e) => s + e.amount, 0);
  if (st.opening === undefined && st.entries[0]?.balance !== undefined) st.opening = round(st.entries[0].balance - st.entries[0].amount);
  st.closing = lastBalance ?? (st.opening !== undefined ? round(st.opening + sum) : undefined);
  if (st.opening === undefined && st.closing !== undefined) st.opening = round(st.closing - sum);

  if (!st.entries.length) st.warnings.push("Não encontrei lançamentos com data e valor na planilha.");
  else if (st.opening !== undefined && st.closing !== undefined && Math.abs(st.opening + sum - st.closing) > 0.009) {
    st.warnings.push("Saldo inicial + lançamentos da planilha não fecha com o saldo final. Confira se o extrato está completo.");
  }
  if (!st.period && st.entries.length) {
    const br = (d: string) => d.split("-").reverse().join("/");
    st.period = `${br(st.entries[0].date)} a ${br(st.entries[st.entries.length - 1].date)}`;
  }
  return st;
}
