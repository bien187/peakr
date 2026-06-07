import { fetchJson } from '../lib/http';
import { env } from '../config/env';
import { logger } from '../lib/logger';

// OPTIONALES, KOSTENPFLICHTIGES Modul. Standardmäßig deaktiviert
// (ENABLE_OPENAI_TREND=false). Reichert den Wikipedia-Score per LLM an.
// Der User-Key wird AES-256-GCM-verschlüsselt aus der DB gelesen, NIE geloggt,
// NIE an den Browser gesendet.

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const MODEL = 'gpt-5';

export interface OpenAiTrendResult {
  score: number; // 1..100
  rationale: string;
}

export function isOpenAiTrendEnabled(): boolean {
  return env.ENABLE_OPENAI_TREND === true;
}

const trendSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    score: { type: 'integer', minimum: 1, maximum: 100 },
    rationale: { type: 'string' },
  },
  required: ['score', 'rationale'],
} as const;

/**
 * Fragt die OpenAI Responses API (mit web_search) nach einem aktuellen
 * Bekanntheits-/Trend-Score. `apiKey` ist der entschlüsselte User-Key.
 * Wirft bei Fehlern — Aufrufer fällt auf den Wikipedia-Score zurück.
 */
export async function enrichTrendWithOpenAi(
  destinationName: string,
  apiKey: string,
): Promise<OpenAiTrendResult> {
  if (!apiKey) throw new Error('Kein OpenAI-Key vorhanden.');

  const body = {
    model: MODEL,
    input: [
      {
        role: 'system',
        content:
          'Du bewertest die aktuelle Bekanntheit/Beliebtheit von Schweizer Ski- und Wanderzielen ' +
          'auf einer Skala 1–100 (100 = sehr bekannt/im Trend). Nutze Websuche für aktuelle Signale. ' +
          'Antworte ausschließlich im geforderten JSON-Format.',
      },
      { role: 'user', content: `Ziel: ${destinationName} (Schweiz). Schätze Score und kurze Begründung.` },
    ],
    tools: [{ type: 'web_search' }],
    text: {
      format: { type: 'json_schema', name: 'trend_score', strict: true, schema: trendSchema },
    },
  };

  const data = await fetchJson<{
    output_text?: string;
    output?: { content?: { type: string; text?: string }[] }[];
  }>(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    timeoutMs: 30000,
    retries: 1,
  });

  const text =
    data.output_text ??
    data.output?.flatMap((o) => o.content ?? []).find((c) => c.type === 'output_text')?.text;
  if (!text) throw new Error('Leere OpenAI-Antwort.');

  const parsed = JSON.parse(text) as OpenAiTrendResult;
  const score = Math.min(100, Math.max(1, Math.round(parsed.score)));
  logger.debug({ destinationName, score }, 'OpenAI-Trend angereichert');
  return { score, rationale: String(parsed.rationale ?? '') };
}
