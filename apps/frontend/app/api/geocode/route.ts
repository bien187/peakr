import { apiGeocode } from '@ch-alpineroute/backend/server';
import { handle } from '@/lib/server/handle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('q');
  return handle(() => apiGeocode(q), { headers: { 'cache-control': 'public, s-maxage=86400, stale-while-revalidate=604800' } });
}
