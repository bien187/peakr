import { apiMe, apiUpdateMe } from '@ch-alpineroute/backend/server';
import { handle, jsonBody } from '@/lib/server/handle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return handle(() => apiMe(req.headers.get('authorization')));
}

export async function PATCH(req: Request) {
  return handle(async () => apiUpdateMe(req.headers.get('authorization'), await jsonBody(req)));
}
