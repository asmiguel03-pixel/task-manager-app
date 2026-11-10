import { describe, expect, it } from "vitest";
import {
  accessKeyCheckDigit,
  addBusinessDays,
  brazilHolidays,
  businessDaysBetween,
  easterSunday,
  evaluateExpression,
  parseAccessKey,
} from "./work-tools";

describe("feriados e dias úteis", () => {
  it("calcula a Páscoa", () => {
    expect(easterSunday(2025)).toBe("2025-04-20");
    expect(easterSunday(2026)).toBe("2026-04-05");
    expect(easterSunday(2027)).toBe("2027-03-28");
  });

  it("lista feriados móveis de 2026", () => {
    const dates = brazilHolidays(2026).map((h) => h.date);
    expect(dates).toContain("2026-04-03"); // Sexta-feira Santa
    expect(dates).toContain("2026-02-16"); // Carnaval
    expect(dates).toContain("2026-06-04"); // Corpus Christi
  });

  it("pula fim de semana e feriado ao somar dias úteis", () => {
    const r = addBusinessDays("2026-11-13", 5);
    expect(r?.date).toBe("2026-11-23");
    expect(r?.skipped.map((h) => h.date)).toEqual(["2026-11-20"]);
    expect(addBusinessDays("2026-11-23", -5)?.date).toBe("2026-11-13");
  });

  it("só considera Carnaval quando pedido", () => {
    expect(addBusinessDays("2026-02-13", 1)?.date).toBe("2026-02-16");
    expect(addBusinessDays("2026-02-13", 1, true)?.date).toBe("2026-02-18");
  });

  it("conta dias úteis entre datas", () => {
    expect(businessDaysBetween("2026-11-01", "2026-11-30")).toBe(19);
    expect(businessDaysBetween("2026-11-30", "2026-11-01")).toBe(-19);
    expect(businessDaysBetween("2026-02-30", "2026-03-01")).toBeNull();
  });
});

describe("chave de acesso", () => {
  const base = "35261101234567000190550010000123451876543213".slice(0, 43);

  it("calcula o dígito verificador", () => {
    expect(accessKeyCheckDigit(base)).toBe(3);
  });

  it("decodifica uma chave válida, aceitando espaços", () => {
    const r = parseAccessKey("3526 1101 2345 6700 0190 5500 1000 0123 4518 7654 3213");
    expect(r).toMatchObject({
      ok: true,
      uf: "SP (35)",
      month: "11/2026",
      cnpj: "01.234.567/0001-90",
      model: "NF-e (modelo 55)",
      series: 1,
      number: 12345,
    });
  });

  it("recusa tamanho errado e dígito errado", () => {
    expect(parseAccessKey("123").ok).toBe(false);
    expect(parseAccessKey(base + "4").ok).toBe(false);
  });
});

describe("calculadora", () => {
  it.each([
    ["1250,50 * 3", 3751.5],
    ["200 * 15%", 30],
    ["(1+2)*3", 9],
    ["-2^2", -4],
    ["0,1 + 0,2", 0.3],
    ["10 ÷ 4", 2.5],
  ])("%s = %s", (expr, value) => {
    expect(evaluateExpression(expr)).toBe(value);
  });

  it("recusa contas inválidas", () => {
    expect(() => evaluateExpression("1/0")).toThrow();
    expect(() => evaluateExpression("2+")).toThrow();
    expect(() => evaluateExpression("alert(1)")).toThrow();
  });
});
