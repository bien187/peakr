import { type z, type ZodTypeAny } from 'zod';

/** Anwendungsfehler mit HTTP-Status + maschinenlesbarem Code. */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** Validiert mit Zod und wirft bei Fehlern einen AppError(400). Liefert den Output-Typ. */
export function validate<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AppError(400, 'VALIDATION', 'Ungültige Eingabe', result.error.flatten());
  }
  return result.data;
}

/** PostgreSQL unique_violation (23505). */
export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  );
}
