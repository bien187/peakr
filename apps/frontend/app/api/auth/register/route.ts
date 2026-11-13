import { apiRegister } from '@ch-alpineroute/backend/server';
import { clientIp, handle, jsonBody } from '@/lib/server/handle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return handle(async () => apiRegister(await jsonBody(req), clientIp(req)), { status: 201 });
}
