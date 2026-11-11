import { describe, expect, it } from "vitest";
import {
  accessKeyCheckDigit,
  addBusinessDays,
  brazilHolidays,
  businessDaysBetween,
  cleanAndIdentify,
  dueDateFromFactor,
  easterSunday,
  evaluateExpression,
  isValidCNPJ,
  isValidCPF,
  parseAccessKey,
  parseBoleto,
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

describe("boleto", () => {
  // Exemplo público do Banco do Brasil.
  const bb = "00190000090114971860168524522114675860000102656";

  it("valida linha digitável de banco e lê valor e vencimento", () => {
    expect(parseBoleto(bb, "2026-11-10")).toMatchObject({
      ok: true,
      kind: "bancario",
      bank: "Banco do Brasil (001)",
      amount: 1026.56,
      dueDate: "2018-07-15",
      barcode: "00196758600001026560000001149718606852452211",
    });
  });

  it("converte código de barras de volta para a mesma linha digitável", () => {
    const r = parseBoleto("00196758600001026560000001149718606852452211", "2026-11-10");
    expect(r.ok && r.line).toBe(bb);
  });

  it("aponta o bloco com erro de digitação", () => {
    const typo = bb.slice(0, 12) + ((Number(bb[12]) + 1) % 10) + bb.slice(13);
    const r = parseBoleto(typo);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("2º bloco");
  });

  it("usa o novo ciclo do fator de vencimento (a partir de 22/02/2025)", () => {
    expect(dueDateFromFactor(1000, "2026-11-10")).toBe("2025-02-22");
    expect(dueDateFromFactor(9999, "2025-01-01")).toBe("2025-02-21");
    expect(dueDateFromFactor(0, "2026-11-10")).toBeNull();
  });

  it("valida conta de consumo/tributo (48 dígitos)", () => {
    const r = parseBoleto("818400000095876512345679890123456785901234567894");
    expect(r).toMatchObject({ ok: true, kind: "arrecadacao", segment: "Prefeituras", amount: 987.65 });
  });

  it("recusa tamanho errado", () => {
    expect(parseBoleto("123").ok).toBe(false);
  });
});

describe("só números", () => {
  it("limpa e reconhece a linha digitável", () => {
    const r = cleanAndIdentify("34191.09008 14213.212591 70000.130008 5 16340023245720");
    expect(r).toMatchObject({ clean: "34191090081421321259170000130008516340023245720", kind: "boleto", valid: true });
  });

  it("aponta erro de digitação no boleto", () => {
    const r = cleanAndIdentify("34191.09008 14213.212591 70000.130008 5 16340023245721");
    expect(r.kind).toBe("boleto");
    expect(r.valid).toBe(false);
  });

  it("separa chave de acesso de código de barras (44 dígitos)", () => {
    expect(cleanAndIdentify("3526 1101 2345 6700 0190 5500 1000 0123 4518 7654 3213").kind).toBe("access_key");
    expect(cleanAndIdentify("00196758600001026560000001149718606852452211")).toMatchObject({ kind: "boleto", valid: true });
  });

  it("valida CNPJ numérico, alfanumérico e CPF", () => {
    expect(cleanAndIdentify("11.222.333/0001-81")).toMatchObject({ kind: "cnpj", valid: true, clean: "11222333000181" });
    expect(cleanAndIdentify("11.222.333/0001-82").valid).toBe(false);
    expect(isValidCNPJ("12.ABC.345/01DE-35")).toBe(true);
    expect(cleanAndIdentify("12.ABC.345/01DE-35")).toMatchObject({ kind: "cnpj", valid: true, clean: "12ABC34501DE35" });
    expect(cleanAndIdentify("529.982.247-25")).toMatchObject({ kind: "cpf", valid: true });
    expect(isValidCPF("111.111.111-11")).toBe(false);
  });
});
