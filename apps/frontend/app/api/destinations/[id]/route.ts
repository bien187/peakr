import { apiDestination } from '@ch-alpineroute/backend/server';
import { clientIp, handle } from '@/lib/server/handle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sp = new URL(req.url).searchParams;
  // Stammdaten und Routen ändern sich höchstens wöchentlich; Live-Werte und Verfügbarkeit alle paar Stunden.
  return handle(() => apiDestination(id, sp.get('from'), clientIp(req), { date: sp.get('date'), start: sp.get('start') }), {
    headers: { 'cache-control': 'public, s-maxage=300, stale-while-revalidate=600' },
  });
}
