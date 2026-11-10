import { z } from "zod";

export const PAYMENT_SHEETS = ["rh", "criticos"] as const;
export const PAYMENT_STATUSES = ["nao_recebido", "recebido", "enviado", "novo_boleto", "pago"] as const;

export const PaymentSheetSchema = z.enum(PAYMENT_SHEETS);
export const PaymentStatusSchema = z.enum(PAYMENT_STATUSES);

export type PaymentSheet = z.infer<typeof PaymentSheetSchema>;
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

export const SHEET_LABELS: Record<PaymentSheet, string> = {
  rh: "Pagamentos RH",
  criticos: "Títulos críticos",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  nao_recebido: "Não recebido",
  recebido: "Recebido",
  enviado: "Enviado para pagamento",
  novo_boleto: "Novo boleto solicitado",
  pago: "Pagamento efetivado",
};

const optionalDate = z.iso.date("Data inválida.").optional();
const text = (max: number) => z.string().trim().max(max, `Máximo de ${max} caracteres.`);

export const PaymentSchema = z.object({
  id: z.string().min(1),
  sheet: PaymentSheetSchema,
  /** Mês de controle, `YYYY-MM`. */
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mês inválido."),
  /** Posição da linha na planilha. */
  order: z.number().int().min(0),
  supplier: text(120).min(1, "Informe o fornecedor."),
  branch: text(40),
  competence: optionalDate,
  issueDate: optionalDate,
  /** Sempre positivo, em reais. */
  amount: z.number().nonnegative("O valor deve ser positivo.").max(1e12).optional(),
  dueDate: optionalDate,
  paidDate: optionalDate,
  titleNumber: text(200).optional(),
  status: PaymentStatusSchema,
  notes: text(500).optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const PaymentInputSchema = PaymentSchema.omit({ id: true, createdAt: true, updatedAt: true });

export type Payment = z.infer<typeof PaymentSchema>;
export type PaymentInput = z.infer<typeof PaymentInputSchema>;
