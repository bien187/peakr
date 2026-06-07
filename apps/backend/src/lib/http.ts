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
        { url, attempt: attempt + 1, error: err instanceof Error ? err.message : String(err) },
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
