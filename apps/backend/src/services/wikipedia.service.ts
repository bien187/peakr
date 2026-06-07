import { fetchJson, HttpError } from '../lib/http';

const PAGEVIEWS_BASE =
  'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/de.wikipedia/all-access/all-agents';

// Wikimedia verlangt einen aussagekräftigen User-Agent.
const USER_AGENT = 'CH-AlpineRoute/0.1 (privates Tool; kontakt via lokale Instanz)';

function yyyymmdd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * Summe der Seitenaufrufe eines de.wikipedia-Artikels über die letzten `days` Tage.
 * Gibt null zurück, wenn der Artikel nicht existiert (404).
 */
export async function fetchPageviewsSum(article: string, days = 30): Promise<number | null> {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1); // gestern (heute oft noch unvollständig)
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));

  const encoded = encodeURIComponent(article.replace(/ /g, '_'));
  const url = `${PAGEVIEWS_BASE}/${encoded}/daily/${yyyymmdd(start)}/${yyyymmdd(end)}`;

  try {
    const data = await fetchJson<{ items?: { views?: number }[] }>(url, {
      timeoutMs: 8000,
      retries: 1,
      headers: { 'User-Agent': USER_AGENT },
    });
    return (data.items ?? []).reduce((sum, item) => sum + (item.views ?? 0), 0);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null;
    throw err;
  }
}

// Logarithmische Skalierung auf 1–100. ~10 Aufrufe/Monat ≈ 1, ~150k ≈ 100.
const MIN_LOG = 1; // log10(10)
const MAX_LOG = Math.log10(150_000);

/** Ehrlicher Bekanntheits-Score aus Pageviews. Immer eine Schätzung. */
export function pageviewsToScore(totalViews: number | null): {
  score: number;
  isEstimate: true;
} {
  if (!totalViews || totalViews <= 0) return { score: 1, isEstimate: true };
  const ratio = (Math.log10(totalViews) - MIN_LOG) / (MAX_LOG - MIN_LOG);
  const score = Math.round(Math.min(100, Math.max(1, ratio * 100)));
  return { score, isEstimate: true };
}
