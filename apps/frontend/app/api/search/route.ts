import { apiSearch } from '@ch-alpineroute/backend/server';
import { clientIp, handle, jsonBody } from '@/lib/server/handle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: Request) {
  return handle(async () => apiSearch(await jsonBody(req), clientIp(req)));
}
