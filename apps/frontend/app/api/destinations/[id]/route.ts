import { apiDestination } from '@ch-alpineroute/backend/server';
import { clientIp, handle } from '@/lib/server/handle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const from = new URL(req.url).searchParams.get('from');
  // Stammdaten und Routen ändern sich höchstens wöchentlich; Live-Werte alle paar Stunden.
  return handle(() => apiDestination(id, from, clientIp(req)), {
    headers: { 'cache-control': 'public, s-maxage=300, stale-while-revalidate=900' },
  });
}
