import { z } from "zod";

const requiredText = z.string().trim().min(1, "Preencha este campo.");
const id = z.string().trim().min(1, "Identificador inválido.");

function value(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "");
}

export function requiredFormText(formData: FormData, name: string): string {
  return requiredText.parse(value(formData, name));
}

export function optionalFormText(formData: FormData, name: string): string | undefined {
  const text = value(formData, name).trim();
  return text || undefined;
}

export function optionalUrl(formData: FormData, name: string): string | undefined {
  const text = optionalFormText(formData, name);
  if (text == null) return undefined;
  return z.url("Informe uma URL válida.").parse(text);
}

export function formId(formData: FormData, name: string): string {
  return id.parse(value(formData, name));
}

export function formIds(formData: FormData, name: string): string[] {
  return z
    .array(id)
    .min(1, "Selecione ao menos um item.")
    .parse(formData.getAll(name).map(String));
}

export function formEnum<T extends readonly [string, ...string[]]>(
  formData: FormData,
  name: string,
  values: T,
): T[number] {
  return z.enum(values).parse(value(formData, name));
}

export function optionalFiniteNumber(
  formData: FormData,
  name: string,
  options: { min?: number; max?: number } = {},
): number | undefined {
  const text = optionalFormText(formData, name);
  if (text == null) return undefined;
  return z
    .number({ error: "Informe um número válido." })
    .finite("Informe um número válido.")
    .min(options.min ?? -Infinity)
    .max(options.max ?? Infinity)
    .parse(Number(text));
}

/** datetime-local fields describe São Paulo clock time in this application. */
export function formDateTime(formData: FormData, name: string): Date {
  const raw = requiredText.parse(value(formData, name));
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw) ? `${raw}:00-03:00` : raw;
  const date = new Date(iso);
  return z
    .date({ error: "Informe uma data e hora válidas." })
    .refine((candidate) => !Number.isNaN(candidate.getTime()), {
      message: "Informe uma data e hora válidas.",
    })
    .parse(date);
}

export function formAliases(formData: FormData, name: string): string[] {
  return value(formData, name)
    .split(",")
    .map((alias) => alias.trim())
    .filter(Boolean);
}
