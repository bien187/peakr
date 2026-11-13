import { apiRadarFrames } from '@ch-alpineroute/backend/server';
import { handle } from '@/lib/server/handle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** Liste der jüngsten Radarbilder; MeteoSchweiz liefert alle 5 Minuten ein neues. */
export async function GET() {
  return handle(() => apiRadarFrames(), {
    headers: { 'cache-control': 'public, s-maxage=120, stale-while-revalidate=300' },
  });
}
