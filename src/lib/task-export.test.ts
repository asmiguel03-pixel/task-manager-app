import { describe, expect, it } from "vitest";
import { buildTask } from "./task-domain";
import { exportFileName, tasksToSheet } from "./task-export";
import { buildXlsx, columnName, crc32, excelDateSerial } from "./xlsx";

describe("xlsx", () => {
  it("nomeia colunas como o Excel", () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(["A", "Z", "AA", "AB", "ZZ", "AAA"]);
  });

  it("converte datas para o número de série do Excel", () => {
    expect(excelDateSerial("1900-03-01")).toBe(61);
    expect(excelDateSerial("2026-11-10")).toBe(46336);
    expect(excelDateSerial("inválida")).toBeNull();
  });

  it("calcula CRC-32 padrão", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("gera um ZIP com as partes da planilha e o texto escapado", () => {
    const bytes = buildXlsx({ name: "Tarefas", header: ["A"], rows: [["<a & b>"]] });
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("xl/worksheets/sheet1.xml");
    expect(text).toContain("&lt;a &amp; b&gt;");
  });
});

describe("exportação de tarefas", () => {
  const now = new Date("2026-06-15T12:00:00");
  const task = buildTask(
    {
      title: "Conciliação",
      status: "in_progress",
      priority: "urgent",
      category: "Sibelco",
      assignee: "Nath",
      dueDate: "2026-06-10",
      subtasks: [
        { id: "s1", title: "BB", completed: true },
        { id: "s2", title: "Caixa", completed: false },
      ],
    },
    now,
  );

  it("monta uma linha por tarefa com rótulos em português", () => {
    const sheet = tasksToSheet([task], "2026-06-15");
    expect(sheet.header[0]).toBe("Título");
    const row = Object.fromEntries(sheet.header.map((h, i) => [h, sheet.rows[0][i]]));
    expect(row).toMatchObject({
      Título: "Conciliação",
      Status: "Em Progresso",
      Prioridade: "Urgente",
      Responsável: "Nath",
      Categoria: "Sibelco",
      Prazo: { date: "2026-06-10" },
      Atrasada: "Sim",
      Subtarefas: "1/2",
      "Concluída em": null,
    });
  });

  it("marca tarefas sem responsável", () => {
    const sheet = tasksToSheet([{ ...task, assignee: undefined }], "2026-06-15");
    expect(sheet.rows[0][sheet.header.indexOf("Responsável")]).toBe("Sem responsável");
  });

  it("gera nomes de arquivo limpos", () => {
    expect(exportFileName(undefined, now)).toBe("tarefas-2026-06-15.xlsx");
    expect(exportFileName("João Ávila", now)).toBe("tarefas-joao-avila-2026-06-15.xlsx");
  });
});
