import { apiFavorites } from '@ch-alpineroute/backend/server';
import { handle } from '@/lib/server/handle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return handle(() => apiFavorites(req.headers.get('authorization')));
}
