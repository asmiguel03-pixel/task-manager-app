/**
 * Conferência de boletos do DDA × títulos do sistema (Senior, SAP...).
 * Mesmas regras usadas na conferência manual:
 *  - OK: mesmo fornecedor (CNPJ), nº do documento e valor, mesmo vencimento;
 *  - OK - DIA ÚTIL: vencimento do sistema cai em fim de semana/feriado e o DDA traz o dia útil seguinte;
 *  - OK - AGRUPADO: um boleto paga vários títulos (a soma bate);
 *  - DIVERGÊNCIA DATA / DIVERGÊNCIA VALOR: achou o título, mas a data ou o valor não bate;
 *  - CONFERIR: mesmo fornecedor e valor, mas nº e data diferentes;
 *  - NÃO TEM NO SISTEMA: boleto sem título;
 *  - NÃO TEM NO DDA: título de fornecedor que manda boleto, mas esse não chegou;
 *  - FORA DO DDA: título de fornecedor que não aparece no DDA (pago por transferência, guia etc.).
 */
import { toDate } from "./payment-import";
import { toAmount, type Table } from "./reconcile";
import { nextBusinessDay } from "./work-tools";
import type { CellValue } from "./xlsx-read";

export interface DdaColumns {
  doc: number;
  taxId: number;
  amount: number;
  due?: number;
  supplier?: number;
}

export type DdaStatusKind =
  | "ok"
  | "business_day"
  | "grouped"
  | "diverge_date"
  | "diverge_value"
  | "check"
  | "missing"
  | "outside";

export interface DdaStatus {
  kind: DdaStatusKind;
  label: string;
  /** Linhas do outro arquivo ligadas a esta. */
  partners: number[];
}

export interface DdaCheck {
  dda: (DdaStatus | undefined)[];
  system: (DdaStatus | undefined)[];
}

interface Item {
  row: number;
  tax: string;
  doc: string;
  amount: number;
  due?: string;
}

/** CNPJ: raiz (8 dígitos), para aceitar matriz e filial; CPF: inteiro. */
export function taxRoot(v: CellValue | undefined): string {
  const d = v === undefined ? "" : String(v).replace(/\D/g, "");
  if (d.length >= 12) return d.padStart(14, "0").slice(0, 8);
  return d.length >= 9 ? d.padStart(11, "0") : "";
}

const groupsOf = (doc: string) => (doc.match(/\d+/g) ?? []).map((g) => g.replace(/^0+/, "") || "0");
const longKeys = (doc: string) => groupsOf(doc).filter((g) => g.length >= 3);
/** "000186053" = "186053.01"; "NF 226" = "2026226-01" (um termina com o outro). */
export function docMatch(a: string, b: string): boolean {
  const kb = longKeys(b);
  // Um ano solto ("FADEZ2026") não serve para casar pelo final ("112026F01").
  const year = (k: string) => /^20\d\d$/.test(k);
  return longKeys(a).some((x) =>
    kb.some((y) => x === y || (!year(y) && x.endsWith(y)) || (!year(x) && y.endsWith(x))),
  );
}
/** Mesmo número inclusive a parcela: "208705-2" = "208705.02". */
const exactDoc = (a: string, b: string) => {
  const ga = groupsOf(a);
  const gb = groupsOf(b);
  return ga.length > 0 && ga.length === gb.length && ga.every((g, i) => g === gb[i]);
};
const cents = (n: number) => Math.round(n * 100);
const daysBetween = (a?: string, b?: string) =>
  a && b ? Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000 : 999;

function items(t: Table, c: DdaColumns): Item[] {
  return t.rows.flatMap((r, row) => {
    const amount = toAmount(r[c.amount]);
    const doc = r[c.doc] === undefined ? "" : String(r[c.doc]).trim();
    if (amount === undefined || (!doc && r[c.taxId] === undefined)) return [];
    return [{ row, tax: taxRoot(r[c.taxId]), doc, amount, due: c.due !== undefined ? toDate(r[c.due]) : undefined }];
  });
}

export function checkDda(dda: Table, dc: DdaColumns, sys: Table, sc: DdaColumns, systemName = "SISTEMA"): DdaCheck {
  const boletos = items(dda, dc);
  const titles = items(sys, sc);
  const result: DdaCheck = { dda: dda.rows.map(() => undefined), system: sys.rows.map(() => undefined) };
  const byTax = new Map<string, Item[]>();
  for (const t of titles) if (t.tax) byTax.set(t.tax, [...(byTax.get(t.tax) ?? []), t]);
  const used = new Set<number>();
  const done = new Set<number>();

  const label: Record<DdaStatusKind, string> = {
    ok: "OK",
    business_day: "OK - DIA ÚTIL",
    grouped: "OK - AGRUPADO",
    diverge_date: "DIVERGÊNCIA DATA",
    diverge_value: "DIVERGÊNCIA VALOR",
    check: "CONFERIR",
    missing: `NÃO TEM NO ${systemName}`,
    outside: "FORA DO DDA",
  };
  const link = (b: Item, ts: Item[], kind: DdaStatusKind) => {
    done.add(b.row);
    result.dda[b.row] = { kind, label: label[kind], partners: ts.map((t) => t.row) };
    for (const t of ts) {
      used.add(t.row);
      result.system[t.row] = { kind, label: label[kind], partners: [b.row] };
    }
  };
  const dateKind = (t: Item, b: Item): DdaStatusKind =>
    t.due === b.due ? "ok" : t.due && nextBusinessDay(t.due) === b.due ? "business_day" : "diverge_date";
  const free = (b: Item) => (b.tax ? (byTax.get(b.tax) ?? []) : []).filter((t) => !used.has(t.row));
  const sameValue = (t: Item, b: Item) => cents(t.amount) === cents(b.amount);

  // 1) Nº do documento + valor (se houver título com o nº exato, inclusive parcela, só ele vale).
  //    Primeiro os que batem a data; os de data diferente só depois de tentar valor + data exata,
  //    para não roubar o título de outro boleto do mesmo fornecedor que bate em tudo menos no nº.
  const byDoc = (b: Item) => {
    let c = free(b).filter((t) => docMatch(t.doc, b.doc));
    if (c.some((t) => exactDoc(t.doc, b.doc))) c = c.filter((t) => exactDoc(t.doc, b.doc));
    return c.filter((t) => sameValue(t, b)).sort((x, y) => Number(x.due !== b.due) - Number(y.due !== b.due));
  };
  for (const b of boletos) {
    const c = byDoc(b).filter((t) => dateKind(t, b) !== "diverge_date");
    if (c.length) link(b, [c[0]], dateKind(c[0], b));
  }
  for (const b of boletos) {
    if (done.has(b.row)) continue;
    const c = free(b).filter((t) => sameValue(t, b) && t.due === b.due && !boletos.some((o) => o !== b && !done.has(o.row) && docMatch(t.doc, o.doc)));
    if (c.length) link(b, [c[0]], "ok");
  }
  for (const b of boletos) {
    if (done.has(b.row)) continue;
    const c = byDoc(b);
    if (c.length) link(b, [c[0]], dateKind(c[0], b));
  }
  // 2) Um boleto pagando vários títulos do mesmo fornecedor.
  for (const b of boletos) {
    if (done.has(b.row)) continue;
    const pool = free(b)
      .sort(
        (x, y) =>
          Number(!docMatch(x.doc, b.doc)) - Number(!docMatch(y.doc, b.doc)) || daysBetween(x.due, b.due) - daysBetween(y.due, b.due),
      )
      .slice(0, 14);
    const combo = findSubset(pool, cents(b.amount));
    if (combo) link(b, combo, "grouped");
  }
  // 3) Achou o nº, mas o valor é outro.
  for (const b of boletos) {
    if (done.has(b.row)) continue;
    let c = free(b).filter((t) => docMatch(t.doc, b.doc));
    if (c.some((t) => exactDoc(t.doc, b.doc))) c = c.filter((t) => exactDoc(t.doc, b.doc));
    c.sort(
      (x, y) => Number(x.due !== b.due) - Number(y.due !== b.due) || Math.abs(x.amount - b.amount) - Math.abs(y.amount - b.amount),
    );
    if (c.length) link(b, [c[0]], "diverge_value");
  }
  // 4) Só o valor bate: se a data também (ou é o dia útil seguinte), OK; senão, conferir.
  for (const b of boletos) {
    if (done.has(b.row)) continue;
    const c = free(b)
      .filter((t) => sameValue(t, b))
      .sort((x, y) => {
        const rank = (t: Item) => (t.due === b.due ? 0 : t.due && nextBusinessDay(t.due) === b.due ? 1 : 2);
        return rank(x) - rank(y) || daysBetween(x.due, b.due) - daysBetween(y.due, b.due);
      });
    if (c.length) {
      const k = dateKind(c[0], b);
      link(b, [c[0]], k === "diverge_date" ? "check" : k);
    }
  }
  // Sobras.
  const ddaTax = new Set(boletos.map((b) => b.tax).filter(Boolean));
  for (const b of boletos) if (!done.has(b.row)) result.dda[b.row] = { kind: "missing", label: label.missing, partners: [] };
  for (const t of titles) {
    if (used.has(t.row)) continue;
    const kind: DdaStatusKind = t.tax && ddaTax.has(t.tax) ? "missing" : "outside";
    result.system[t.row] = { kind, label: kind === "missing" ? "NÃO TEM NO DDA" : label.outside, partners: [] };
  }
  return result;
}

/** Menor combinação (2 a 6 títulos) cuja soma dá o valor do boleto. */
function findSubset(pool: Item[], target: number): Item[] | undefined {
  const values = pool.map((t) => cents(t.amount));
  for (let k = 2; k <= Math.min(6, pool.length); k++) {
    const pick: number[] = [];
    const walk = (start: number, sum: number): boolean => {
      if (pick.length === k) return sum === target;
      for (let i = start; i < pool.length; i++) {
        pick.push(i);
        if (walk(i + 1, sum + values[i])) return true;
        pick.pop();
      }
      return false;
    };
    if (walk(0, 0)) return pick.map((i) => pool[i]);
  }
  return undefined;
}

export function countStatuses(list: (DdaStatus | undefined)[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of list) if (s) m.set(s.label, (m.get(s.label) ?? 0) + 1);
  return m;
}

/** Nome do sistema pelo nome do arquivo (para "NÃO TEM NO SÊNIOR"). */
export function systemNameFromFile(fileName: string): string {
  const n = fileName.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (n.includes("senior")) return "SÊNIOR";
  if (/\bsap\b|fbl1n/.test(n)) return "SAP";
  if (n.includes("totvs") || n.includes("protheus")) return "TOTVS";
  return "SISTEMA";
}
