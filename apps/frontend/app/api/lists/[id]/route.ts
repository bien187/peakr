import { apiDeleteList, apiList, apiUpdateList } from '@ch-alpineroute/backend/server';
import { handle, jsonBody } from '@/lib/server/handle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(() => apiList(req.headers.get('authorization'), id));
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(async () => apiUpdateList(req.headers.get('authorization'), id, await jsonBody(req)));
}

/** Besitzer: Liste löschen · Mitglied: Liste verlassen. */
export async function DELETE(req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(() => apiDeleteList(req.headers.get('authorization'), id));
}
