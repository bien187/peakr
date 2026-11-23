import { apiJoinList, apiListInvite } from '@ch-alpineroute/backend/server';
import { clientIp, handle } from '@/lib/server/handle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ token: string }> };

/** Vorschau der Einladung (Name, Besitzer, Anzahl Ziele) – auch ohne Anmeldung. */
export async function GET(req: Request, { params }: Ctx) {
  const { token } = await params;
  return handle(() => apiListInvite(req.headers.get('authorization'), token, clientIp(req)));
}

export async function POST(req: Request, { params }: Ctx) {
  const { token } = await params;
  return handle(() => apiJoinList(req.headers.get('authorization'), token, clientIp(req)));
}
