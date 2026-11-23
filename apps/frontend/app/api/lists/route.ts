import { apiCreateList, apiLists } from '@ch-alpineroute/backend/server';
import { clientIp, handle, jsonBody } from '@/lib/server/handle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const destination = new URL(req.url).searchParams.get('destination');
  return handle(() => apiLists(req.headers.get('authorization'), destination));
}

export async function POST(req: Request) {
  return handle(async () => apiCreateList(req.headers.get('authorization'), await jsonBody(req), clientIp(req)), { status: 201 });
}
