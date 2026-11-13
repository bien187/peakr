import { logger } from './logger';

export interface FetchJsonOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Timeout pro Versuch (Default 8s). */
  timeoutMs?: number;
  /** Zusätzliche Wiederholungen nach dem ersten Versuch (Default 1). */
  retries?: number;
  retryDelayMs?: number;
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface ErrorCause {
  code?: string;
  syscall?: string;
  address?: string;
  port?: number;
  message?: string;
  errors?: unknown[];
}

/**
 * Fehlertext inklusive Ursache. Node meldet jeden Netzwerkfehler von fetch nur
 * als «fetch failed»; ob die Verbindung abgewiesen, zurückgesetzt oder per DNS
 * nicht aufgelöst wurde, steht in `cause` (bei IPv4/IPv6-Versuchen als
 * AggregateError mit mehreren Einzelfehlern).
 */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const describe = (c: ErrorCause): string =>
    [c.code, c.syscall, c.address && (c.port ? `${c.address}:${c.port}` : c.address), c.code ? undefined : c.message]
      .filter(Boolean)
      .join(' ');
  const cause = (err as Error & { cause?: unknown }).cause;
  if (!cause || typeof cause !== 'object') return err.message;
  const c = cause as ErrorCause;
  const inner = Array.isArray(c.errors)
    ? c.errors.filter((e): e is ErrorCause => !!e && typeof e === 'object').map(describe).join('; ')
    : '';
  const detail = [describe(c), inner].filter(Boolean).join(' – ');
  return detail ? `${err.message} (${detail})` : err.message;
}

/** 4xx (außer 429) gelten als endgültig — kein Retry. */
function isFinalClientError(err: unknown): boolean {
  return err instanceof HttpError && err.status >= 400 && err.status < 500 && err.status !== 429;
}

/**
 * Robuster JSON-Fetch mit Timeout + Retry. Wirft bei endgültigem Fehler.
 * Aufrufer kappseln das mit try/catch oder `settle()`, damit eine kaputte
 * Quelle nie den ganzen Request killt.
 */
export async function fetchJson<T>(url: string, opts: FetchJsonOptions = {}): Promise<T> {
  const { timeoutMs = 8000, retries = 1, retryDelayMs = 500, headers = {}, ...rest } = opts;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...rest,
        headers: { accept: 'application/json', ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new HttpError(res.status, `HTTP ${res.status} bei ${url}`, text.slice(0, 500));
      }
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
      if (isFinalClientError(err) || attempt === retries) break;
      logger.warn(
        { url, attempt: attempt + 1, error: describeError(err) },
        'fetchJson – Wiederholung',
      );
      await sleep(retryDelayMs);
    }
  }
  throw lastErr;
}

/** Wandelt ein Promise in ein Result um, ohne zu werfen. */
export async function settle<T>(
  promise: Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: Error }> {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}
