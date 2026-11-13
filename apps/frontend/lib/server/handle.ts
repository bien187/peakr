import { AppError, logger } from '@ch-alpineroute/backend/server';
import { NextResponse } from 'next/server';

/** Erste Adresse aus X-Forwarded-For (setzt Vercel bzw. der Reverse-Proxy). */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'local';
}

export async function jsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new AppError(400, 'VALIDATION', 'Ungültiger JSON-Body.');
  }
}

/**
 * Führt eine Server-Funktion aus und übersetzt das Ergebnis bzw. den Fehler in
 * das einheitliche JSON-Format. Interne Fehlermeldungen gehen nur ins Log.
 */
export async function handle<T>(
  fn: () => Promise<T>,
  init: { status?: number; headers?: Record<string, string> } = {},
): Promise<NextResponse> {
  try {
    const data = await fn();
    return NextResponse.json(data, {
      status: init.status ?? 200,
      headers: { 'cache-control': 'no-store', ...init.headers },
    });
  } catch (err) {
    if (err instanceof AppError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message, details: err.details } },
        { status: err.statusCode, headers: { 'cache-control': 'no-store' } },
      );
    }
    logger.error({ error: err instanceof Error ? (err.stack ?? err.message) : String(err) }, 'Unerwarteter API-Fehler');
    return NextResponse.json(
      { error: { code: 'INTERNAL', message: 'Interner Serverfehler.' } },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    );
  }
}
