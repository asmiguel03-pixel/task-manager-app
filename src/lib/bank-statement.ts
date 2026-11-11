/**
 * Leitura de extratos bancários em PDF (texto com posições, de pdf-text.ts).
 * Layouts conhecidos: Bradesco (Extrato Mensal / Por Período) e Banco do Brasil
 * (Lançamentos). Outros bancos usam uma leitura genérica pelas colunas do cabeçalho.
 */
import type { TextLine } from "./pdf-text";

export interface StatementEntry {
  date: string; // YYYY-MM-DD
  description: string;
  doc?: string;
  /** Positivo = entrada (crédito na conta); negativo = saída (débito). */
  amount: number;
  /** Saldo após o lançamento, quando o extrato mostra. */
  balance?: number;
}

export interface Statement {
  bank: string;
  account?: string;
  period?: string;
  opening?: number;
  closing?: number;
  entries: StatementEntry[];
  /** Avisos de leitura (ex.: saldo que não fecha). */
  warnings: string[];
}

const MONEY = /^-?\d{1,3}(?:\.\d{3})*,\d{2}$/;
const MONEY_CD = /^(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*([CD])$/;
const DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

export const parseMoneyBR = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));
const iso = (s: string) => {
  const m = DATE.exec(s.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : undefined;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Confere se saldo inicial + lançamentos = saldo final e se cada saldo intermediário bate. */
function checkBalances(st: Statement): void {
  if (st.opening === undefined) return;
  let running = st.opening;
  let mismatches = 0;
  for (const e of st.entries) {
    running = round2(running + e.amount);
    if (e.balance !== undefined && Math.abs(running - e.balance) > 0.009) mismatches++;
  }
  if (st.closing !== undefined && Math.abs(running - st.closing) > 0.009) {
    st.warnings.push(
      `Saldo inicial + lançamentos = ${running.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}, mas o extrato mostra ${st.closing.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}. Algum lançamento pode não ter sido lido.`,
    );
  } else if (mismatches) {
    st.warnings.push(`${mismatches} saldo(s) intermediário(s) não bateram na leitura. Confira o extrato.`);
  }
  if (st.closing === undefined) st.closing = running;
}

// ---------- Bradesco ----------

function parseBradesco(lines: TextLine[]): Statement {
  const st: Statement = { bank: "Bradesco", entries: [], warnings: [] };
  const all = lines.map((l) => l.text).join("\n");
  const acc = /Ag:\s*(\d+)\s*\|\s*CC:\s*([\d\s-]+?)\s*\|/.exec(all);
  if (acc) st.account = `Ag. ${acc[1]} · CC ${acc[2].replace(/\s+/g, "")}`;
  const per = /Entre\s+(\d{2}\/\d{2}\/\d{4})\s+e\s+(\d{2}\/\d{2}\/\d{4})/.exec(all);
  if (per) st.period = `${per[1]} a ${per[2]}`;

  type Tx = { page: number; y: number; entry: StatementEntry; desc: string[] };
  let inTable = false;
  let date = "";
  const txs: Tx[] = [];
  const descLines: { page: number; y: number; text: string }[] = [];

  for (const line of lines) {
    const t = line.text;
    if (/Saldos Invest/i.test(t)) break;
    if (/Dcto\./.test(t) && /Saldo/.test(t)) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    if (/^Total\b/.test(t)) {
      inTable = false;
      continue;
    }
    const money = line.items.filter((i) => MONEY.test(i.text.trim()));
    const dateItem = line.items.find((i) => DATE.test(i.text.trim()) && i.x < 100);
    if (dateItem) date = iso(dateItem.text)!;
    if (/SALDO ANTERIOR/.test(t)) {
      if (st.opening === undefined && money.length) st.opening = parseMoneyBR(money[money.length - 1].text);
      continue;
    }
    if (money.length >= 1 && date) {
      const value = parseMoneyBR(money[0].text);
      const balance = money.length >= 2 ? parseMoneyBR(money[money.length - 1].text) : undefined;
      const doc = line.items.find((i) => /^\d+$/.test(i.text.trim()) && i.x > 200 && i.x < 320)?.text.trim();
      const inline = line.items
        .filter((i) => i !== dateItem && !money.includes(i) && i.text.trim() !== doc && i.x > 90 && i.x < 260)
        .map((i) => i.text.trim())
        .join(" ");
      txs.push({ page: line.page, y: line.y, entry: { date, description: "", doc, amount: value, balance }, desc: inline ? [inline] : [] });
      if (balance !== undefined) st.closing = balance;
    } else if (line.items.every((i) => i.x > 90 && i.x < 260)) {
      descLines.push({ page: line.page, y: line.y, text: t });
    }
  }

  // Cada linha de descrição vai para o lançamento mais próximo (acima ou abaixo).
  for (const d of descLines) {
    let best: Tx | undefined;
    for (const tx of txs) {
      if (tx.page !== d.page) continue;
      if (!best || Math.abs(tx.y - d.y) < Math.abs(best.y - d.y)) best = tx;
    }
    if (best && Math.abs(best.y - d.y) <= 9) best.desc.push(`${d.y > best.y ? "\u0000" : ""}${d.text}`);
  }
  for (const tx of txs) {
    // Linhas acima do valor vêm primeiro (título), depois as de baixo (detalhe).
    const above = tx.desc.filter((s) => s.startsWith("\u0000")).map((s) => s.slice(1));
    const rest = tx.desc.filter((s) => !s.startsWith("\u0000"));
    tx.entry.description = [...above, ...rest].join(" · ");
    st.entries.push(tx.entry);
  }
  checkBalances(st);
  return st;
}

// ---------- Banco do Brasil ----------

function parseBB(lines: TextLine[]): Statement {
  const st: Statement = { bank: "Banco do Brasil", entries: [], warnings: [] };
  const all = lines.map((l) => l.text).join("\n");
  const ag = /Agência\s+([\d-]+)/.exec(all);
  const cc = /Conta corrente\s+([\d-]+)/.exec(all);
  if (ag || cc) st.account = `Ag. ${ag?.[1] ?? "?"} · CC ${cc?.[1] ?? "?"}`;
  const per = /Período do extrato\s+(\d{2})\s*\/\s*(\d{4})/.exec(all);
  if (per) st.period = `${per[1]}/${per[2]}`;

  let inTable = false;
  let last: StatementEntry | undefined;
  let lastBalance: number | undefined;
  for (const line of lines) {
    const t = line.text;
    if (/Dt\.\s*balancete/.test(t) && /Hist/.test(t)) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    if (/OBSERVA|\*\*\*|Serviço de Atendimento/i.test(t)) {
      inTable = false;
      continue;
    }
    const first = line.items[0];
    const date = first && first.x < 110 ? iso(first.text) : undefined;
    const money = line.items
      .map((i) => ({ i, m: MONEY_CD.exec(i.text.trim()) }))
      .filter((x): x is { i: (typeof line.items)[number]; m: RegExpExecArray } => !!x.m)
      .map(({ i, m }) => ({ x: i.x, value: parseMoneyBR(m[1]) * (m[2] === "D" ? -1 : 1), item: i }));
    if (!date) {
      // Complemento do histórico na linha de baixo.
      if (last && !money.length) last.description = `${last.description} · ${t}`;
      continue;
    }
    if (/Saldo Anterior/i.test(t)) {
      if (money.length) st.opening = money[money.length - 1].value;
      last = undefined;
      continue;
    }
    if (/S\s*A\s*L\s*D\s*O/.test(t) && !/Saldo Anterior/i.test(t)) {
      if (money.length) st.closing = money[money.length - 1].value;
      last = undefined;
      continue;
    }
    if (!money.length) continue;
    const valueCol = money.filter((m) => m.x < 495);
    const balanceCol = money.filter((m) => m.x >= 495);
    const value = (valueCol[0] ?? money[0]).value;
    const balance = balanceCol.length ? balanceCol[balanceCol.length - 1].value : undefined;
    // Histórico (às vezes grudado no lote: "14134 Crédito CASSI").
    const hist = line.items
      .filter((i) => i.x >= 220 && i.x < 360 && !MONEY_CD.test(i.text.trim()))
      .map((i) => i.text.trim().replace(/^\d{4,5}\s+(?=\D)/, ""))
      .filter((t) => !/^\d{4,5}$/.test(t));
    const doc = line.items.find((i) => i.x >= 360 && i.x < 450 && /^[\d.]+$/.test(i.text.trim()))?.text.trim();
    last = { date, description: hist.join(" "), doc, amount: value, balance };
    st.entries.push(last);
    if (balance !== undefined) lastBalance = balance;
  }
  if (st.closing === undefined) st.closing = lastBalance;
  checkBalances(st);
  return st;
}

// ---------- Santander (Santander Empresas) ----------

/** Lançamentos do mais novo para o mais antigo, sem linha de saldo anterior. */
function parseSantander(lines: TextLine[]): Statement {
  const st: Statement = { bank: "Santander", entries: [], warnings: [] };
  const all = lines.map((l) => l.text).join("\n");
  const acc = /Ag[êe]ncia:\s*(\d+)\s+Conta:\s*([\d-]+)/.exec(all);
  if (acc) st.account = `Ag. ${acc[1]} · CC ${acc[2]}`;
  const per = /Per[íi]odos?:\s*(\d{2}\/\d{2}\/\d{4})\s*a\s*(\d{2}\/\d{2}\/\d{4})/.exec(all);
  if (per) st.period = `${per[1]} a ${per[2]}`;

  type Tx = { page: number; y: number; entry: StatementEntry; desc: { y: number; text: string }[] };
  const txs: Tx[] = [];
  const descLines: { page: number; y: number; text: string }[] = [];
  let inTable = false;
  for (const line of lines) {
    if (/Hist[óo]rico/.test(line.text) && /Saldo/.test(line.text)) {
      inTable = true;
      continue;
    }
    if (/Saldo de ContaMax|Entenda a composi/i.test(line.text)) break;
    if (!inTable) continue;
    const first = line.items[0];
    const dm = first && first.x < 60 ? /^(\d{2}\/\d{2}\/\d{4})\s*(.*)$/.exec(first.text) : null;
    const money = line.items.filter((i) => MONEY.test(i.text.trim()));
    if (dm && money.length) {
      const balanceItem = money.find((m) => m.x >= 495);
      const valueItem = money.find((m) => m.x < 495);
      if (!valueItem) continue;
      const doc = line.items.find((i) => i.x >= 290 && i.x < 400 && /^\d+$/.test(i.text.trim()))?.text.trim();
      const inline = [dm[2], ...line.items.filter((i) => i !== first && i.x >= 80 && i.x < 290).map((i) => i.text)]
        .map((t) => t.trim())
        .filter(Boolean);
      txs.push({
        page: line.page,
        y: line.y,
        entry: {
          date: iso(dm[1])!,
          description: "",
          doc,
          amount: parseMoneyBR(valueItem.text.trim()),
          balance: balanceItem ? parseMoneyBR(balanceItem.text.trim()) : undefined,
        },
        desc: inline.length ? [{ y: line.y, text: inline.join(" ") }] : [],
      });
    } else if (!money.length && line.items.every((i) => i.x >= 80 && i.x < 300)) {
      descLines.push({ page: line.page, y: line.y, text: line.text });
    }
  }
  for (const d of descLines) {
    let best: Tx | undefined;
    for (const tx of txs) if (tx.page === d.page && (!best || Math.abs(tx.y - d.y) < Math.abs(best.y - d.y))) best = tx;
    if (best && Math.abs(best.y - d.y) <= 12) best.desc.push(d);
  }
  // Do mais antigo para o mais novo.
  for (const tx of txs.reverse()) {
    tx.entry.description = tx.desc
      .sort((a, b) => b.y - a.y)
      .map((d) => d.text)
      .join(" · ");
    st.entries.push(tx.entry);
  }
  const oldest = st.entries[0];
  const newest = st.entries[st.entries.length - 1];
  if (oldest?.balance !== undefined) st.opening = round2(oldest.balance - oldest.amount);
  if (newest?.balance !== undefined) st.closing = newest.balance;
  checkBalances(st);
  return st;
}

// ---------- Caixa ----------

/** Sinal de menos às vezes separado do valor (até em outra linha); saldo como "R$ 1.234,56". */
function parseCaixa(lines: TextLine[]): Statement {
  const st: Statement = { bank: "Caixa", entries: [], warnings: [] };
  const all = lines.map((l) => l.text).join("\n");
  const ag = /Ag[êe]ncia:\s*(\d+)/.exec(all);
  const cc = /Conta:\s*([\d-]+)/.exec(all);
  if (ag || cc) st.account = `Ag. ${ag?.[1] ?? "?"} · CC ${cc?.[1] ?? "?"}`;
  const per = /Lan[çc]amentos de\s*(\d{2}\/\d{2}\/\d{4})\s*[àa]\s*(\d{2}\/\d{2}\/\d{4})/.exec(all);
  if (per) st.period = `${per[1]} a ${per[2]}`;

  const header = lines.find((l) => /Valor\s*\(R\$\)/.test(l.text) && /Saldo/.test(l.text));
  const xValue = header?.items.find((i) => /Valor/.test(i.text))?.x ?? 440;
  const xBalance = header?.items.find((i) => /Saldo/.test(i.text))?.x ?? 505;
  const xHist = header?.items.find((i) => /Hist/.test(i.text))?.x ?? 300;
  const near = (l: TextLine, y: number, page: number) => l.page === page && Math.abs(l.y - y) <= 10;
  const signed = (t: string) => {
    const m = /(-)?\s*R?\$?\s*(-)?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/.exec(t);
    return m ? parseMoneyBR(m[3]) * (m[1] || m[2] ? -1 : 1) : undefined;
  };

  for (const line of lines) {
    const first = line.items[0];
    if (!first || first.x > 60 || !DATE.test(first.text.trim())) continue;
    if (/SALDO DIA|SALDO ANTERIOR/i.test(line.text)) continue;
    const around = lines.filter((l) => near(l, line.y, line.page));
    const valueText = around
      .flatMap((l) => l.items.filter((i) => i.x >= xValue - 15 && i.x < xBalance - 5).map((i) => ({ y: l.y, t: i.text })))
      .sort((a, b) => b.y - a.y)
      .map((v) => v.t)
      .join(" ");
    const amount = signed(valueText.replace(/\s+/g, " "));
    if (amount === undefined || amount === 0) continue;
    const balanceItem = line.items.find((i) => i.x >= xBalance - 5);
    const desc = around
      .filter((l) => l === line || !l.items.some((i) => DATE.test(i.text.trim())))
      .sort((a, b) => b.y - a.y)
      .flatMap((l) => l.items.filter((i) => i.x >= xHist - 10 && i.x < xValue - 15).map((i) => i.text.trim()))
      .filter(Boolean);
    const doc = line.items.find((i) => i.x > 200 && i.x < xHist - 10 && /^\d+$/.test(i.text.trim()))?.text.trim();
    st.entries.push({
      date: iso(line.items.length > 1 && DATE.test(line.items[1].text.trim()) ? line.items[1].text : first.text)!,
      description: desc.join(" "),
      doc: doc && doc !== "0" ? doc : undefined,
      amount,
      balance: balanceItem ? signed(balanceItem.text) : undefined,
    });
  }
  const first = st.entries[0];
  if (first?.balance !== undefined) st.opening = round2(first.balance - first.amount);
  const last = st.entries[st.entries.length - 1];
  if (last?.balance !== undefined) st.closing = last.balance;
  checkBalances(st);
  return st;
}

// ---------- Genérico (colunas pelo cabeçalho) ----------

function parseGeneric(lines: TextLine[]): Statement {
  const st: Statement = { bank: "Banco (layout não reconhecido)", entries: [], warnings: [] };
  st.warnings.push("Layout de extrato não reconhecido: leitura aproximada. Confira os lançamentos e me mande um exemplo deste banco.");
  // Cabeçalho com colunas de crédito/débito/saldo, se houver.
  const header = lines.find((l) => /cr[ée]dito/i.test(l.text) && /d[ée]bito/i.test(l.text));
  const col = (re: RegExp) => header?.items.find((i) => re.test(i.text))?.x;
  const xCredit = col(/cr[ée]dito/i);
  const xDebit = col(/d[ée]bito/i);
  const xBalance = col(/saldo/i);
  let date = "";
  for (const line of lines) {
    const dItem = line.items.find((i) => DATE.test(i.text.trim()) && i.x < 150);
    if (dItem) date = iso(dItem.text)!;
    const money = line.items.filter((i) => MONEY.test(i.text.trim()) || MONEY_CD.test(i.text.trim()));
    if (!money.length || !date) continue;
    if (/saldo anterior/i.test(line.text)) {
      const m = money[money.length - 1].text.trim();
      const cd = MONEY_CD.exec(m);
      st.opening = cd ? parseMoneyBR(cd[1]) * (cd[2] === "D" ? -1 : 1) : parseMoneyBR(m);
      continue;
    }
    if (/^total|saldo (final|do dia|atual)|^s\s*a\s*l\s*d\s*o/i.test(line.text)) continue;
    const signed = (it: { x: number; text: string }) => {
      const cd = MONEY_CD.exec(it.text.trim());
      if (cd) return parseMoneyBR(cd[1]) * (cd[2] === "D" ? -1 : 1);
      const v = parseMoneyBR(it.text.trim());
      if (v < 0) return v;
      // Sem sinal: decide pela coluna mais próxima à esquerda.
      const cols = [
        ["c", xCredit],
        ["d", xDebit],
        ["s", xBalance],
      ].filter((c): c is [string, number] => typeof c[1] === "number" && c[1] <= it.x + 15);
      const nearest = cols.sort((a, b) => b[1] - a[1])[0]?.[0];
      return nearest === "d" ? -v : v;
    };
    const balanceItem =
      xBalance !== undefined ? money.find((m) => m.x >= xBalance - 15) : money.length >= 2 ? money[money.length - 1] : undefined;
    const valueItem = money.find((m) => m !== balanceItem);
    if (!valueItem) continue;
    st.entries.push({
      date,
      description: line.items
        .filter((i) => i !== dItem && !money.includes(i))
        .map((i) => i.text.trim())
        .join(" "),
      amount: signed(valueItem),
      balance: balanceItem ? signed(balanceItem) : undefined,
    });
  }
  checkBalances(st);
  return st;
}

/** Escolhe o leitor pelo layout. */
export function parseStatement(lines: TextLine[]): Statement {
  const all = lines.map((l) => l.text).join("\n");
  if (/Extrato Mensal \/ Por Per[ií]odo|Extrato de: Ag:/.test(all) && /Dcto\./.test(all)) return parseBradesco(lines);
  if (/Dt\.\s*balancete/.test(all) && /Ouvidoria BB|Conta corrente/.test(all)) return parseBB(lines);
  if (/Santander/i.test(all) && /Hist[óo]rico/.test(all)) return parseSantander(lines);
  if (/SAC CAIXA|Al[ôo] CAIXA/i.test(all) && /Data de/.test(all)) return parseCaixa(lines);
  return parseGeneric(lines);
}
