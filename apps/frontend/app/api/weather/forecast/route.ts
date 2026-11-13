import { apiWeatherForecast } from '@ch-alpineroute/backend/server';
import { handle } from '@/lib/server/handle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** Prognoseraster der Wetterkarte (?var=precip|snowfall|gust|temp|cloud). Neue Prognosen kommen alle 6 h. */
export async function GET(req: Request) {
  const variable = new URL(req.url).searchParams.get('var');
  return handle(() => apiWeatherForecast(variable), {
    headers: { 'cache-control': 'public, s-maxage=900, stale-while-revalidate=3600' },
  });
}
