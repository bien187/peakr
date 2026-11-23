import { apiAddListItem } from '@ch-alpineroute/backend/server';
import { handle, jsonBody } from '@/lib/server/handle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => apiAddListItem(req.headers.get('authorization'), id, await jsonBody(req)), { status: 201 });
}
